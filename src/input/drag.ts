// Turns a window's interactive-move lifecycle into a column reorder on release
// (docs §2.1.7). The window moves freely under the cursor while dragging — Drift
// only acts once the drag ends, snapping the column into the nearest slot.

import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { Viewport } from '../viewport/viewport';

export interface DragReorderDeps {
    grid: Grid;
    viewport: Viewport;
    workspaceAdapter: WorkspaceAdapter;
    area: Rect;
    render(): void;
}

/** Wires `win`'s move lifecycle to reorder `columnId` in `deps.grid` on release.
 * Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, columnId: number, deps: DragReorderDeps): () => void {
    let dragging = false;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        const virtualX = toVirtualX(deps.workspaceAdapter.cursorX(), deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForX(columnId, virtualX);
        deps.grid.moveColumn(columnId, targetIndex);
        deps.render();
    });

    return () => {
        disconnectStarted();
        disconnectFinished();
    };
}
