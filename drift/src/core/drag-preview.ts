// What a live drag is currently previewing, and the tile rects that preview puts on screen.
// `previewTileRects` is consumed by Strip.render to draw it. drag.ts imports only the
// `DragPreview` shape it builds each tick — it deliberately does NOT resolve hover against
// these preview rects: the vertical slot is resolved against the target column's COMMITTED
// tile rects (see `tileCandidates` in drag.ts), positioned at the column's previewed x from
// `Grid.previewLayout`, so an armed gap here can never feed back into where the next tick
// looks for the pointer (docs: 2026-09-18-drag-stack-phantom-design).

import type { Column } from './column';
import type { Rect } from './coordinates';
import type { PhantomColumn } from './grid';

export interface DragPreview {
    /** The dragged stack tile previewed as its own standalone column — see `Grid.previewLayout`. */
    phantom?: PhantomColumn;
    /** The column the dragged tile is leaving; its remaining tiles close up around the hole. */
    leaving?: { columnId: number; tileId: number };
    /** The column opening a gap of `gapHeight` at tile-list `index` for the dragged tile.
     * `excludeTileId` is set for a same-column reorder, where the dragged tile is also removed
     * from that column's list before the gap is placed. When `entering` and `leaving` name the
     * same column, `entering` wins. */
    entering?: { columnId: number; index: number; gapHeight: number; excludeTileId?: number };
}

/** The tile rects `Strip.render` shows for `column` under `preview`: the entering gap layout if
 * the preview enters this column, the closed-up layout if it leaves it, else the committed
 * rects. A tile absent from the result (the dragged one, in either preview branch) is drawn
 * nowhere — its real window follows the pointer. */
export function previewTileRects(
    column: Column,
    columnRect: Rect,
    preview: DragPreview | undefined,
): Map<number, Rect> {
    if (preview?.entering !== undefined && preview.entering.columnId === column.id) {
        const entering = preview.entering;
        return column.previewRectsWithGapAt(entering.index, entering.gapHeight, columnRect, entering.excludeTileId);
    }
    if (preview?.leaving !== undefined && preview.leaving.columnId === column.id) {
        return column.previewRectsWithoutTile(preview.leaving.tileId, columnRect);
    }
    const rects = new Map<number, Rect>();
    for (const tile of column.tiles()) {
        rects.set(tile.id, column.tileRect(tile.id, columnRect));
    }
    return rects;
}
