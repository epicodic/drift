// Turns a window's interactive-move lifecycle into a live column reorder: as the
// window's center crosses a boundary, its neighbors slide out of the way (docs
// §2.1.7); on release, the dragged column itself snaps instantly into its final
// slot. The window's own real geometry is never touched while dragging — it keeps
// following the cursor untouched throughout.

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

/** Virtual x of `win`'s own center — the anchor used to find the nearest insertion
 * boundary, so the vote reflects the dragged window itself rather than wherever the
 * cursor happened to grab it. */
function windowCenterVirtualX(win: WindowAdapter, area: Rect, viewportOffsetX: number): number {
    const rect = win.frameGeometry();
    return toVirtualX(rect.x + rect.width / 2, area, viewportOffsetX);
}

/** Wires `win`'s move lifecycle to reorder `columnId` in `deps.grid` live, and to
 * settle it on release. Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, columnId: number, deps: DragReorderDeps): () => void {
    let dragging = false;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
    });

    /** Reorders `columnId` to the insertion index nearest the window's current
     * center. Returns whether the order actually changed. */
    const reorderToCurrentPosition = (): boolean => {
        const virtualX = windowCenterVirtualX(win, deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForX(columnId, virtualX);
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
