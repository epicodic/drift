// Turns a window's interactive-move lifecycle into a live column reorder: as the
// window's own leading edge crosses a neighbor's center, its neighbors slide out
// of the way (docs §2.1.7); on release, the dragged column itself snaps instantly
// into its final slot. The window's own real geometry is never touched while
// dragging — it keeps following the cursor untouched throughout.

import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { Viewport } from '../viewport/viewport';

export interface DragReorderDeps {
    grid: Grid;
    viewport: Viewport;
    area: Rect;
    render(excludeWindowId?: string, instant?: boolean): void;
    snapColumn(columnId: number): void;
}

/** Virtual x of `win`'s own left and right edges — the anchors used to decide
 * whether it has crossed into a neighbor's territory, so the vote reflects the
 * dragged window itself rather than wherever the cursor happened to grab it. */
function windowEdgesVirtualX(win: WindowAdapter, area: Rect, viewportOffsetX: number): { left: number; right: number } {
    const rect = win.frameGeometry();
    return {
        left: toVirtualX(rect.x, area, viewportOffsetX),
        right: toVirtualX(rect.x + rect.width, area, viewportOffsetX),
    };
}

/** Wires `win`'s move lifecycle to reorder `columnId` in `deps.grid` live, and to
 * settle it on release. Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, columnId: number, deps: DragReorderDeps): () => void {
    let dragging = false;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
    });

    /** Reorders `columnId` to swap with its current left or right neighbor if the
     * window's own edge has crossed that neighbor's center. Returns whether the
     * order actually changed. */
    const reorderToCurrentPosition = (): boolean => {
        const { left, right } = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForEdges(columnId, left, right);
        if (targetIndex === deps.grid.indexOf(columnId)) {
            return false;
        }
        deps.grid.moveColumn(columnId, targetIndex);
        return true;
    };

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        if (reorderToCurrentPosition()) {
            deps.render(win.id, false);
        }
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        reorderToCurrentPosition();
        deps.snapColumn(columnId);
        deps.render();
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
    };
}
