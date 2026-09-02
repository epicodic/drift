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
    /** Row-crossing hooks (docs: 2026-09-02-cross-row-drag-design) — StripStack supplies
     * these to watch the pointer's vertical position on every drag tick without a second,
     * independent signal connection on the same window. All optional; omitted when not
     * row-aware (e.g. a Strip used outside a StripStack). */
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
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
 * settle it on release. `initiallyDragging` seeds the local dragging state for a
 * connection created mid-drag — e.g. when a cross-row move reparents the window into
 * a new row's Strip while the user is still holding the drag (docs:
 * 2026-09-02-cross-row-drag-design): the new connection never sees
 * `interactiveMoveResizeStarted`, since it already fired once on the connection this
 * one replaces. Returns a disconnect function. */
export function registerDragReorder(
    win: WindowAdapter,
    columnId: number,
    deps: DragReorderDeps,
    initiallyDragging = false,
): () => void {
    let dragging = initiallyDragging;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        if (dragging) {
            deps.onDragStarted?.(win);
        }
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
        deps.onDragTick?.(win);
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        reorderToCurrentPosition();
        deps.snapColumn(columnId);
        deps.render();
        deps.onDragFinished?.();
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
    };
}
