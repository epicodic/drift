// One (activity, virtualDesktop) pair's full vertical stack of rows: an ordered set of
// independent Strips (each one row, unchanged), paged between via a Drift-native vertical
// camera. Rows are created lazily in either direction (positive or negative index) and pruned
// once empty and inactive, including row 0 (docs: 2026-09-01-row-navigation-design,
// 2026-09-02-symmetric-row-stack-design).
//
// Owns the one SharedTicker for every row it creates — see the "Important Implementation
// Note" in docs/agents/plans/2026-09-01-row-navigation.md for why this can't be left to
// each row's own Strip constructor. Also drives its own vertical Animator off that same
// ticker, to move the transition camera during row paging.

import type { Rect, EdgeDirection } from '../core/coordinates';
import { edgeDirection } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { MinimapSnapshot } from '../ui/minimap';
import { Animator, type Timer } from '../viewport/animator';
import { EdgeDwell } from '../viewport/edge-dwell';
import { SharedTicker } from '../viewport/shared-ticker';
import { Strip, type RowDragHooks } from './strip';

export type StripFactory = (area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) => Strip;

export class StripStack {
    private readonly rows = new Map<number, Strip>();
    private readonly rowByWindow = new Map<string, number>();
    private readonly ticker: SharedTicker;
    private readonly verticalAnimator: Animator;
    private activeRowIndex = 0;
    private transitionRows: [number, number] = [0, 0];
    private transitionExcludeWindowId: string | undefined;
    private cameraY = 0;
    private edgeDwell: EdgeDwell | null = null;
    private draggedWindowId: string | null = null;

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (area, settings, timer, workspaceAdapter) =>
            new Strip(area, settings, timer, workspaceAdapter),
    ) {
        this.ticker = new SharedTicker(timer, settings.animationTickMs);
        this.verticalAnimator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            settings.animationTickMs,
            (cameraY) => this.applyVerticalOffset(cameraY),
        );
        this.row(0);
    }

    addWindow(win: WindowAdapter): void {
        win.setSkipTaskbar(false);
        this.activeStrip().addWindow(win, false, this.rowDragHooks());
        this.rowByWindow.set(win.id, this.activeRowIndex);
    }

    removeWindow(win: WindowAdapter): void {
        const rowIndex = this.rowByWindow.get(win.id);
        if (rowIndex === undefined) {
            return;
        }
        // A closed/crashed window tears down its signals (SignalManager.destroy(), via
        // Strip.removeWindow) without ever firing interactiveMoveResizeFinished, so
        // onDragFinished never runs for it. Without this, a still-armed edge watch for the
        // now-gone window would keep ticking and re-fire onEdgeDwellFired forever, relocating
        // whatever window happens to be focused in the row instead (docs:
        // 2026-09-02-cross-row-drag-design).
        if (win.id === this.draggedWindowId) {
            this.endEdgeWatch();
        }
        this.requireRow(rowIndex).removeWindow(win);
        this.rowByWindow.delete(win.id);
        this.pruneIfEmpty(rowIndex);
    }

    render(): void {
        this.activeStrip().render();
    }

    /** Activates `win` wherever it is, paging to its row first if it isn't the active one —
     * extends Strip's existing "every focus change triggers a reveal" model up one level, so
     * an off-screen window activated externally (taskbar, Alt-Tab, a notification) doesn't
     * silently take KWin focus while parked off-screen (docs: 2026-09-01-row-navigation-design). */
    activateWindow(win: WindowAdapter): void {
        const rowIndex = this.rowByWindow.get(win.id);
        if (rowIndex === undefined) {
            return;
        }
        this.switchToRow(rowIndex);
        this.requireRow(rowIndex).activateWindow(win);
    }

    focusLeft(): void {
        this.activeStrip().focusLeft();
    }

    focusRight(): void {
        this.activeStrip().focusRight();
    }

    cycleAlignLeft(): void {
        this.activeStrip().cycleAlignLeft();
    }

    cycleAlignRight(): void {
        this.activeStrip().cycleAlignRight();
    }

    shiftViewportLeft(): void {
        this.activeStrip().shiftViewportLeft();
    }

    shiftViewportRight(): void {
        this.activeStrip().shiftViewportRight();
    }

    rowUp(): void {
        this.switchToRow(this.activeRowIndex - 1);
    }

    rowDown(): void {
        this.switchToRow(this.activeRowIndex + 1);
    }

    moveWindowToRowAbove(): void {
        this.moveFocusedWindowToRow(this.activeRowIndex - 1);
    }

    moveWindowToRowBelow(): void {
        this.moveFocusedWindowToRow(this.activeRowIndex + 1);
    }

    minimapSnapshot(): MinimapSnapshot {
        return this.activeStrip().minimapSnapshot();
    }

    private activeStrip(): Strip {
        return this.row(this.activeRowIndex);
    }

    /** Row 0 is created eagerly as the stack's starting position; every row, in either
     * direction, is created lazily on first access after that. */
    private row(index: number): Strip {
        let strip = this.rows.get(index);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.ticker.subscribe(), this.workspaceAdapter);
            this.rows.set(index, strip);
        }
        return strip;
    }

    private switchToRow(newIndex: number, excludeWindowId?: string): void {
        const oldIndex = this.activeRowIndex;
        if (newIndex === oldIndex) {
            return;
        }
        this.row(newIndex); // ensure the target row exists before anything below touches it
        this.activeRowIndex = newIndex;
        const fromCameraY = this.verticalAnimator.isAnimating() ? this.cameraY : oldIndex * this.area.height;
        // Prime the incoming row's remembered offset to its pre-transition resting position
        // immediately, synchronously — before any other code (e.g. addWindow, called right
        // after this returns in moveFocusedWindowToRow) can render into it at the wrong (0)
        // offset. The animator's own ticks take over from here once it starts below.
        this.rows.get(newIndex)?.render(excludeWindowId, true, this.restingOffset(fromCameraY, newIndex));
        this.snapRestingRows(oldIndex, newIndex);
        this.rows.get(oldIndex)?.setSkipTaskbar(true);
        this.rows.get(newIndex)?.setSkipTaskbar(false);
        // Must be set before verticalAnimator.animate(): animate() can finish synchronously
        // (calling applyVerticalOffset immediately) when durationMs <= 0, and applyVerticalOffset
        // reads transitionRows/transitionExcludeWindowId — reordering these lines would render
        // the wrong row pair (or fail to exclude a mid-drag window) on that first frame.
        this.transitionRows = [oldIndex, newIndex];
        this.transitionExcludeWindowId = excludeWindowId;
        this.verticalAnimator.animate(fromCameraY, newIndex * this.area.height, this.settings.animationDurationMs);
        // Leaving an unpopulated row prunes it, so plain navigation never accumulates empty rows.
        this.pruneIfEmpty(oldIndex);
    }

    private applyVerticalOffset(cameraY: number): void {
        this.cameraY = cameraY;
        for (const rowIndex of this.transitionRows) {
            this.rows
                .get(rowIndex)
                ?.render(this.transitionExcludeWindowId, false, this.restingOffset(cameraY, rowIndex));
        }
    }

    /** The real-pixel vertical offset for the row at `rowIndex` given the camera is
     * currently at `cameraY`. */
    private restingOffset(cameraY: number, rowIndex: number): number {
        return cameraY - rowIndex * this.area.height;
    }

    /** Snaps every row except the outgoing/incoming pair straight to its resting offset
     * relative to the new active row — those rows are off-screen the whole transition, so
     * jumping directly to the final position (rather than animating) is visually identical
     * and avoids a per-tick render for rows nobody can see move. */
    private snapRestingRows(oldIndex: number, newIndex: number): void {
        const targetCameraY = newIndex * this.area.height;
        for (const [rowIndex, strip] of this.rows) {
            if (rowIndex === oldIndex || rowIndex === newIndex) {
                continue;
            }
            strip.render(undefined, true, this.restingOffset(targetCameraY, rowIndex));
        }
    }

    private moveFocusedWindowToRow(
        targetIndex: number,
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
    ): void {
        const sourceIndex = this.activeRowIndex;
        const win = this.requireRow(sourceIndex).detachFocusedColumn();
        if (win === null) {
            return;
        }
        this.rowByWindow.delete(win.id);
        // If this emptied the source row, switchToRow's trailing pruneIfEmpty(oldIndex) removes it —
        // no separate cleanup needed here. Must run before addWindow so the target row's remembered
        // offset is primed to its correct resting position before anything renders into it.
        this.switchToRow(targetIndex, options.excludeWindowId);
        const targetStrip = this.row(targetIndex);
        targetStrip.addWindow(win, options.initiallyDragging ?? false, this.rowDragHooks());
        this.rowByWindow.set(win.id, targetIndex);
    }

    /** Hooks passed to every `Strip.addWindow` call so a live drag's vertical position keeps
     * feeding this stack's edge watch across a mid-drag reparent (docs:
     * 2026-09-02-cross-row-drag-design). A fresh object every call, but `beginEdgeWatch` is only
     * ever actually invoked once per continuous drag: `registerDragReorder`'s `initiallyDragging`
     * flag (set on the reparented window's new connection) means the new row's copy of these
     * hooks never sees its own `onDragStarted` fire — only `onDragTick`/`onDragFinished` do, so
     * `this.edgeDwell`/`this.draggedWindowId` (armed once, on the original row) keep tracking the
     * same window straight through the reparent instead of being reset. */
    private rowDragHooks(): RowDragHooks {
        return {
            onDragStarted: (win) => this.beginEdgeWatch(win),
            onDragTick: () => this.updateEdgeWatch(),
            onDragFinished: () => this.endEdgeWatch(),
        };
    }

    /** Starts watching `win`'s vertical position for an edge-dwell trigger. Stops any prior
     * watch first as defensive hardening — `onDragStarted` firing at most once per continuous
     * drag is the load-bearing invariant that keeps `this.edgeDwell` tracking the same window
     * across a mid-drag reparent (see `rowDragHooks`), so this should never actually find a
     * live watch to stop, but a leaked, orphaned timer if that invariant is ever violated
     * elsewhere is silent and hard to diagnose. */
    private beginEdgeWatch(win: WindowAdapter): void {
        this.edgeDwell?.stop();
        this.draggedWindowId = win.id;
        this.edgeDwell = new EdgeDwell(
            this.ticker.subscribe(),
            () => Date.now(),
            this.settings.animationTickMs,
            this.settings.rowDragDwellMs,
            (direction) => this.onEdgeDwellFired(direction),
        );
    }

    /** Feeds the mouse pointer's current vertical position to the armed edge watch on every drag
     * tick — the pointer, not the dragged window's own frame geometry, since the window is
     * typically grabbed away from its center (e.g. near the titlebar), so relying on the
     * window's edge either overshoots (its far edge crosses well before the pointer does) or
     * never crosses at all. Keeps working across a mid-drag row reparent — see `rowDragHooks`'
     * doc comment — even though it's a different Strip's connection calling in before and
     * after. */
    private updateEdgeWatch(): void {
        this.edgeDwell?.update(
            edgeDirection(this.workspaceAdapter.cursorPos().y, this.area, this.settings.rowDragEdgeBorderPx),
        );
    }

    /** Disarms the edge watch unconditionally — used both when the drag itself ends normally
     * (via `onDragFinished`) and when the watched window disappears out from under it (closed
     * or crashed mid-drag; see `removeWindow`, which is the only other caller). */
    private endEdgeWatch(): void {
        this.edgeDwell?.stop();
        this.edgeDwell = null;
        this.draggedWindowId = null;
    }

    /** Relocates the dragged window into the row above/below once the edge dwell elapses —
     * reuses the exact same `moveFocusedWindowToRow` machinery as the keyboard shortcuts,
     * reached here via a live-drag callback chain instead of a keypress. */
    private onEdgeDwellFired(direction: EdgeDirection): void {
        if (this.draggedWindowId === null) {
            return;
        }
        const targetIndex = direction === 'above' ? this.activeRowIndex - 1 : this.activeRowIndex + 1;
        this.moveFocusedWindowToRow(targetIndex, { excludeWindowId: this.draggedWindowId, initiallyDragging: true });
    }

    private requireRow(index: number): Strip {
        const strip = this.rows.get(index);
        if (strip === undefined) {
            throw new Error(`Unknown row index: ${index}`);
        }
        return strip;
    }

    private pruneIfEmpty(index: number): void {
        if (index === this.activeRowIndex) {
            return; // you can't prune the row you're standing in
        }
        const strip = this.rows.get(index);
        if (strip === undefined || !strip.isEmpty()) {
            return;
        }
        this.rows.delete(index);
    }
}
