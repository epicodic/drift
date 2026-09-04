// One (activity, virtualDesktop) pair's full vertical stack of strips: an ordered set of
// independent Strips (each one strip, unchanged), paged between via a Drift-native vertical
// camera. Strips are created lazily in either direction (positive or negative index) and pruned
// once empty and inactive, including strip 0 (docs: 2026-09-01-row-navigation-design,
// 2026-09-02-symmetric-row-stack-design).
//
// Owns the one SharedTicker for every strip it creates — see the "Important Implementation
// Note" in docs/agents/plans/2026-09-01-row-navigation.md for why this can't be left to
// each strip's own Strip constructor. Also drives its own vertical Animator off that same
// ticker, to move the transition camera during strip paging.

import type { Rect, EdgeDirection } from '../core/coordinates';
import { edgeDirection } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { combineStripStackSnapshot, type StripStackMinimapSnapshot } from '../ui/minimap';
import { Animator, type Timer } from '../viewport/animator';
import { EdgeDwell } from '../viewport/edge-dwell';
import { SharedTicker } from '../viewport/shared-ticker';
import { Strip, type StripDragHooks } from './strip';

export type StripFactory = (area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) => Strip;

export class StripStack {
    private readonly strips = new Map<number, Strip>();
    private readonly stripByWindow = new Map<string, number>();
    private readonly ticker: SharedTicker;
    private readonly verticalAnimator: Animator;
    private activeStripIndex = 0;
    private transitionStrips: [number, number] = [0, 0];
    private transitionExcludeWindowId: string | undefined;
    private cameraY = 0;
    private edgeDwell: EdgeDwell<EdgeDirection> | null = null;
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
        this.strip(0);
    }

    addWindow(win: WindowAdapter): void {
        win.setSkipTaskbar(false);
        this.activeStrip().addWindow(win, false, this.stripDragHooks());
        this.stripByWindow.set(win.id, this.activeStripIndex);
    }

    removeWindow(win: WindowAdapter): void {
        const stripIndex = this.stripByWindow.get(win.id);
        if (stripIndex === undefined) {
            return;
        }
        // A closed/crashed window tears down its signals (SignalManager.destroy(), via
        // Strip.removeWindow) without ever firing interactiveMoveResizeFinished, so
        // onDragFinished never runs for it. Without this, a still-armed edge watch for the
        // now-gone window would keep ticking and re-fire onEdgeDwellFired forever, relocating
        // whatever window happens to be focused in the strip instead (docs:
        // 2026-09-02-cross-row-drag-design).
        if (win.id === this.draggedWindowId) {
            this.endEdgeWatch();
        }
        this.requireStrip(stripIndex).removeWindow(win);
        this.stripByWindow.delete(win.id);
        this.pruneIfEmpty(stripIndex);
    }

    render(): void {
        this.activeStrip().render();
    }

    /** Activates `win` wherever it is, paging to its strip first if it isn't the active one —
     * extends Strip's existing "every focus change triggers a reveal" model up one level, so
     * an off-screen window activated externally (taskbar, Alt-Tab, a notification) doesn't
     * silently take KWin focus while parked off-screen (docs: 2026-09-01-row-navigation-design). */
    activateWindow(win: WindowAdapter): void {
        const stripIndex = this.stripByWindow.get(win.id);
        if (stripIndex === undefined) {
            return;
        }
        this.switchToStrip(stripIndex);
        this.requireStrip(stripIndex).activateWindow(win);
    }

    focusLeft(): void {
        this.activeStrip().focusLeft();
    }

    focusRight(): void {
        this.activeStrip().focusRight();
    }

    focusUp(): boolean {
        return this.activeStrip().focusUp();
    }

    focusDown(): boolean {
        return this.activeStrip().focusDown();
    }

    /** Moves tile focus up within the active strip's stack if it can; otherwise pages to
     * the strip above (docs: unifying in-column and strip navigation onto one key). */
    navigateUp(): void {
        if (!this.focusUp()) {
            this.stripUp();
        }
    }

    /** Moves tile focus down within the active strip's stack if it can; otherwise pages
     * to the strip below. */
    navigateDown(): void {
        if (!this.focusDown()) {
            this.stripDown();
        }
    }

    moveWindowLeft(): void {
        this.activeStrip().moveWindowLeft();
    }

    moveWindowRight(): void {
        this.activeStrip().moveWindowRight();
    }

    absorbRight(): void {
        this.activeStrip().absorbRight();
    }

    expel(): void {
        this.activeStrip().expel();
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

    stripUp(): void {
        this.switchToStrip(this.activeStripIndex - 1);
    }

    stripDown(): void {
        this.switchToStrip(this.activeStripIndex + 1);
    }

    moveWindowToStripAbove(): void {
        this.moveFocusedWindowToStrip(this.activeStripIndex - 1);
    }

    moveWindowToStripBelow(): void {
        this.moveFocusedWindowToStrip(this.activeStripIndex + 1);
    }

    minimapSnapshot(): StripStackMinimapSnapshot {
        const strips = Array.from(this.strips.entries())
            .map(([stripIndex, strip]) => ({ stripIndex, snapshot: strip.minimapSnapshot() }))
            .sort((a, b) => a.stripIndex - b.stripIndex);
        return combineStripStackSnapshot(strips, this.activeStripIndex, this.area.height);
    }

    private activeStrip(): Strip {
        return this.strip(this.activeStripIndex);
    }

    /** Strip 0 is created eagerly as the stack's starting position; every strip, in either
     * direction, is created lazily on first access after that. */
    private strip(index: number): Strip {
        let strip = this.strips.get(index);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.ticker.subscribe(), this.workspaceAdapter);
            this.strips.set(index, strip);
        }
        return strip;
    }

    private switchToStrip(newIndex: number, excludeWindowId?: string): void {
        const oldIndex = this.activeStripIndex;
        if (newIndex === oldIndex) {
            return;
        }
        this.strip(newIndex); // ensure the target strip exists before anything below touches it
        this.activeStripIndex = newIndex;
        const fromCameraY = this.verticalAnimator.isAnimating() ? this.cameraY : oldIndex * this.area.height;
        // Prime the incoming strip's remembered offset to its pre-transition resting position
        // immediately, synchronously — before any other code (e.g. addWindow, called right
        // after this returns in moveFocusedWindowToStrip) can render into it at the wrong (0)
        // offset. The animator's own ticks take over from here once it starts below.
        this.strips.get(newIndex)?.render(excludeWindowId, true, this.restingOffset(fromCameraY, newIndex));
        this.snapRestingStrips(oldIndex, newIndex);
        this.strips.get(oldIndex)?.setSkipTaskbar(true);
        this.strips.get(newIndex)?.setSkipTaskbar(false);
        // Must be set before verticalAnimator.animate(): animate() can finish synchronously
        // (calling applyVerticalOffset immediately) when durationMs <= 0, and applyVerticalOffset
        // reads transitionStrips/transitionExcludeWindowId — reordering these lines would render
        // the wrong strip pair (or fail to exclude a mid-drag window) on that first frame.
        this.transitionStrips = [oldIndex, newIndex];
        this.transitionExcludeWindowId = excludeWindowId;
        this.verticalAnimator.animate(fromCameraY, newIndex * this.area.height, this.settings.animationDurationMs);
        // Leaving an unpopulated strip prunes it, so plain navigation never accumulates empty strips.
        this.pruneIfEmpty(oldIndex);
    }

    private applyVerticalOffset(cameraY: number): void {
        this.cameraY = cameraY;
        for (const stripIndex of this.transitionStrips) {
            this.strips
                .get(stripIndex)
                ?.render(this.transitionExcludeWindowId, false, this.restingOffset(cameraY, stripIndex));
        }
    }

    /** The real-pixel vertical offset for the strip at `stripIndex` given the camera is
     * currently at `cameraY`. */
    private restingOffset(cameraY: number, stripIndex: number): number {
        return cameraY - stripIndex * this.area.height;
    }

    /** Snaps every strip except the outgoing/incoming pair straight to its resting offset
     * relative to the new active strip — those strips are off-screen the whole transition, so
     * jumping directly to the final position (rather than animating) is visually identical
     * and avoids a per-tick render for strips nobody can see move. */
    private snapRestingStrips(oldIndex: number, newIndex: number): void {
        const targetCameraY = newIndex * this.area.height;
        for (const [stripIndex, strip] of this.strips) {
            if (stripIndex === oldIndex || stripIndex === newIndex) {
                continue;
            }
            strip.render(undefined, true, this.restingOffset(targetCameraY, stripIndex));
        }
    }

    private moveFocusedWindowToStrip(
        targetIndex: number,
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
    ): void {
        const sourceIndex = this.activeStripIndex;
        const windows = this.requireStrip(sourceIndex).detachFocusedColumn();
        if (windows.length === 0) {
            return;
        }
        for (const win of windows) {
            this.stripByWindow.delete(win.id);
        }
        // If this emptied the source strip, switchToStrip's trailing pruneIfEmpty(oldIndex) removes it —
        // no separate cleanup needed here. Must run before addWindow so the target strip's remembered
        // offset is primed to its correct resting position before anything renders into it.
        this.switchToStrip(targetIndex, options.excludeWindowId);
        const targetStrip = this.strip(targetIndex);
        // A stacked column's tiles are NOT kept stacked across strips this pass — each window
        // becomes its own column in the target strip (docs: 2026-09-03-vertical-tiling-design,
        // Out of Scope). The overwhelmingly common case is a single window here, unaffected.
        for (const win of windows) {
            targetStrip.addWindow(win, options.initiallyDragging ?? false, this.stripDragHooks());
            this.stripByWindow.set(win.id, targetIndex);
        }
    }

    /** Hooks passed to every `Strip.addWindow` call so a live drag's vertical position keeps
     * feeding this stack's edge watch across a mid-drag reparent (docs:
     * 2026-09-02-cross-row-drag-design). A fresh object every call, but `beginEdgeWatch` is only
     * ever actually invoked once per continuous drag: `registerDragReorder`'s `initiallyDragging`
     * flag (set on the reparented window's new connection) means the new strip's copy of these
     * hooks never sees its own `onDragStarted` fire — only `onDragTick`/`onDragFinished` do, so
     * `this.edgeDwell`/`this.draggedWindowId` (armed once, on the original strip) keep tracking the
     * same window straight through the reparent instead of being reset. */
    private stripDragHooks(): StripDragHooks {
        return {
            onDragStarted: (win) => this.beginEdgeWatch(win),
            onDragTick: () => this.updateEdgeWatch(),
            onDragFinished: () => this.endEdgeWatch(),
        };
    }

    /** Starts watching `win`'s vertical position for an edge-dwell trigger. Stops any prior
     * watch first as defensive hardening — `onDragStarted` firing at most once per continuous
     * drag is the load-bearing invariant that keeps `this.edgeDwell` tracking the same window
     * across a mid-drag reparent (see `stripDragHooks`), so this should never actually find a
     * live watch to stop, but a leaked, orphaned timer if that invariant is ever violated
     * elsewhere is silent and hard to diagnose. */
    private beginEdgeWatch(win: WindowAdapter): void {
        this.edgeDwell?.stop();
        this.draggedWindowId = win.id;
        this.edgeDwell = new EdgeDwell<EdgeDirection>(
            this.ticker.subscribe(),
            () => Date.now(),
            this.settings.animationTickMs,
            this.settings.stripDragDwellMs,
            (direction) => this.onEdgeDwellFired(direction),
        );
    }

    /** Feeds the mouse pointer's current vertical position to the armed edge watch on every drag
     * tick — the pointer, not the dragged window's own frame geometry, since the window is
     * typically grabbed away from its center (e.g. near the titlebar), so relying on the
     * window's edge either overshoots (its far edge crosses well before the pointer does) or
     * never crosses at all. Keeps working across a mid-drag strip reparent — see `stripDragHooks`'
     * doc comment — even though it's a different Strip's connection calling in before and
     * after. */
    private updateEdgeWatch(): void {
        this.edgeDwell?.update(
            edgeDirection(this.workspaceAdapter.cursorPos().y, this.area, this.settings.stripDragEdgeBorderPx),
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

    /** Relocates the dragged window into the strip above/below once the edge dwell elapses —
     * reuses the exact same `moveFocusedWindowToStrip` machinery as the keyboard shortcuts,
     * reached here via a live-drag callback chain instead of a keypress. */
    private onEdgeDwellFired(direction: EdgeDirection): void {
        if (this.draggedWindowId === null) {
            return;
        }
        const targetIndex = direction === 'above' ? this.activeStripIndex - 1 : this.activeStripIndex + 1;
        this.moveFocusedWindowToStrip(targetIndex, { excludeWindowId: this.draggedWindowId, initiallyDragging: true });
    }

    private requireStrip(index: number): Strip {
        const strip = this.strips.get(index);
        if (strip === undefined) {
            throw new Error(`Unknown strip index: ${index}`);
        }
        return strip;
    }

    private pruneIfEmpty(index: number): void {
        if (index === this.activeStripIndex) {
            return; // you can't prune the strip you're standing in
        }
        const strip = this.strips.get(index);
        if (strip === undefined || !strip.isEmpty()) {
            return;
        }
        this.strips.delete(index);
    }
}
