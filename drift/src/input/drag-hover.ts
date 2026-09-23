// Pure geometry for drag-to-stack: which column a drag is aimed at (from the dragged window's
// own horizontal overlap), which slot inside it (from the pointer's y against the tile rects
// currently on screen), and where a stack tile's phantom column first appears. No KWin and no
// Grid dependency: everything takes already-resolved rects, so it's directly unit-testable
// (docs: 2026-09-18-drag-stack-phantom-design).

import { Rect } from '../core/coordinates';

export type StackDirection = 'above' | 'below';

/** One tile a drag could land next to: its column, its id, and the rect it is currently drawn
 * at (see `previewTileRects`). The dragged tile itself is never a candidate. */
export interface StackCandidate {
    columnId: number;
    tileId: number;
    rect: Rect;
}

export interface StackTarget {
    columnId: number;
    tileId: number;
    direction: StackDirection;
}

/** Horizontal overlap as a fraction of the NARROWER of the two widths — so a dragged window
 * narrower than the other rect can still reach 1 when fully inside it. */
export function horizontalOverlapFraction(a: Rect, b: Rect): number {
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (overlap <= 0) {
        return 0;
    }
    return overlap / Math.min(a.width, b.width);
}

/** The slot the pointer's y points at within one column's tiles (ordered top to bottom): the
 * first tile whose bottom edge is below the pointer, clamped to the last tile; `above` in its
 * upper half, `below` from its midline down. Never a dead zone. */
export function resolveSlotFromPointer(
    pointerY: number,
    tiles: readonly StackCandidate[],
): { tileId: number; direction: StackDirection } | null {
    if (tiles.length === 0) {
        return null;
    }
    const tile =
        tiles.find((candidate) => pointerY < candidate.rect.y + candidate.rect.height) ?? tiles[tiles.length - 1];
    const midline = tile.rect.y + tile.rect.height / 2;
    return { tileId: tile.tileId, direction: pointerY < midline ? 'above' : 'below' };
}

/** Which column the drag is aimed at (the candidate column with the most horizontal overlap,
 * provided it clears `overlapFraction`) and which slot in it (from `pointerY`). Candidates may
 * span several columns; a column's overlap is the same for all its tiles. */
export function resolveStackTarget(
    draggedRect: Rect,
    pointerY: number,
    candidates: readonly StackCandidate[],
    overlapFraction: number,
): StackTarget | null {
    let bestColumnId: number | null = null;
    let bestOverlap = 0;
    for (const candidate of candidates) {
        const overlap = horizontalOverlapFraction(draggedRect, candidate.rect);
        if (overlap < overlapFraction || overlap <= bestOverlap) {
            continue;
        }
        bestColumnId = candidate.columnId;
        bestOverlap = overlap;
    }
    if (bestColumnId === null) {
        return null;
    }
    const columnId = bestColumnId;
    const slot = resolveSlotFromPointer(
        pointerY,
        candidates.filter((candidate) => candidate.columnId === columnId),
    );
    return slot === null ? null : { columnId, tileId: slot.tileId, direction: slot.direction };
}

/** Where a stack tile's phantom column first appears: at `homeIndex` (left of home) when the
 * dragged window's center is left of the home column's center, else right after it. */
export function initialPhantomIndex(draggedRect: Rect, homeRect: Rect, homeIndex: number): number {
    const draggedCenter = draggedRect.x + draggedRect.width / 2;
    const homeCenter = homeRect.x + homeRect.width / 2;
    return draggedCenter < homeCenter ? homeIndex : homeIndex + 1;
}

/** Translates a resolved `StackTarget` into a tile-list index for `Column.insertTileAt`/
 * `Column.moveTile`, given the exact tile list the target column will hold (the dragged tile
 * already excluded by the caller for a same-column list). */
export function stackTargetIndex(target: StackTarget, tiles: readonly { id: number }[]): number {
    const index = tiles.findIndex((tile) => tile.id === target.tileId);
    return target.direction === 'above' ? index : index + 1;
}
