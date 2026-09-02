// One (activity, virtualDesktop) pair's full vertical stack of rows: an ordered set of
// independent Strips (each one row, unchanged), paged between via a Drift-native vertical
// camera. Row 0 always exists; rows above/below are created lazily and pruned once empty
// (docs: 2026-09-01-row-navigation-design).
//
// Owns the one SharedTicker for every row it creates — see the "Important Implementation
// Note" in docs/agents/plans/2026-09-01-row-navigation.md for why this can't be left to
// each row's own Strip constructor. Also drives its own vertical Animator off that same
// ticker, to move the transition camera during row paging.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { MinimapSnapshot } from '../ui/minimap';
import { Animator, type Timer } from '../viewport/animator';
import { SharedTicker } from '../viewport/shared-ticker';
import { Strip } from './strip';

export type StripFactory = (area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) => Strip;

export class StripStack {
    private readonly rows = new Map<number, Strip>();
    private readonly rowByWindow = new Map<string, number>();
    private readonly ticker: SharedTicker;
    private readonly verticalAnimator: Animator;
    private activeRowIndex = 0;
    private transitionRows: [number, number] = [0, 0];
    private cameraY = 0;

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
        this.activeStrip().addWindow(win);
        this.rowByWindow.set(win.id, this.activeRowIndex);
    }

    removeWindow(win: WindowAdapter): void {
        const rowIndex = this.rowByWindow.get(win.id);
        if (rowIndex === undefined) {
            return;
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
        if (this.activeRowIndex === 0) {
            return;
        }
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

    /** Row 0 always exists; other rows are created lazily on first access. */
    private row(index: number): Strip {
        let strip = this.rows.get(index);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.ticker.subscribe(), this.workspaceAdapter);
            this.rows.set(index, strip);
        }
        return strip;
    }

    private switchToRow(newIndex: number): void {
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
        this.rows.get(newIndex)?.render(undefined, true, this.restingOffset(fromCameraY, newIndex));
        this.snapRestingRows(oldIndex, newIndex);
        this.rows.get(oldIndex)?.setSkipTaskbar(true);
        this.rows.get(newIndex)?.setSkipTaskbar(false);
        // Must be set before verticalAnimator.animate(): animate() can finish synchronously
        // (calling applyVerticalOffset immediately) when durationMs <= 0, and applyVerticalOffset
        // reads transitionRows — reordering these two lines would render the wrong row pair
        // on that first frame.
        this.transitionRows = [oldIndex, newIndex];
        this.verticalAnimator.animate(fromCameraY, newIndex * this.area.height, this.settings.animationDurationMs);
        // Leaving an unpopulated row prunes it, so plain navigation never accumulates empty rows.
        this.pruneIfEmpty(oldIndex);
    }

    private applyVerticalOffset(cameraY: number): void {
        this.cameraY = cameraY;
        for (const rowIndex of this.transitionRows) {
            this.rows.get(rowIndex)?.render(undefined, false, this.restingOffset(cameraY, rowIndex));
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

    private moveFocusedWindowToRow(targetIndex: number): void {
        if (targetIndex < 0) {
            return;
        }
        const sourceIndex = this.activeRowIndex;
        const win = this.requireRow(sourceIndex).detachFocusedColumn();
        if (win === null) {
            return;
        }
        this.rowByWindow.delete(win.id);
        // If this emptied the source row, switchToRow's trailing pruneIfEmpty(oldIndex) removes it —
        // no separate cleanup needed here. Must run before addWindow so the target row's remembered
        // offset is primed to its correct resting position before anything renders into it.
        this.switchToRow(targetIndex);
        const targetStrip = this.row(targetIndex);
        targetStrip.addWindow(win);
        this.rowByWindow.set(win.id, targetIndex);
    }

    private requireRow(index: number): Strip {
        const strip = this.rows.get(index);
        if (strip === undefined) {
            throw new Error(`Unknown row index: ${index}`);
        }
        return strip;
    }

    private pruneIfEmpty(index: number): void {
        if (index === 0 || index === this.activeRowIndex) {
            return; // row 0 is never pruned; you can't prune the row you're standing in
        }
        const strip = this.rows.get(index);
        if (strip === undefined || !strip.isEmpty()) {
            return;
        }
        this.rows.delete(index);
    }
}
