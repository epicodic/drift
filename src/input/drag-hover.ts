// Pure geometry: which candidate tile a drag is aimed at, and above/below it, purely from
// rect overlap with the dragged window — the single mechanism shared by same-column
// (reordering within your own stack) and cross-column (stacking into a neighbor) drags
// alike. No KWin dependency and no `Grid` dependency: takes only already-resolved rects,
// so it's directly unit-testable without mocking any signal wiring or layout model
// (docs: 2026-09-07-drag-reorder-stack-refinement-design).

import { Rect } from '../core/coordinates';

export type StackDirection = 'above' | 'below';

/** One tile a drag could land on: which column it belongs to (its own column for a
 * same-column candidate, a neighbor's for a cross-column one), its tile id, and its
 * current on-screen rect. The dragged tile itself is never included — callers filter
 * it out before calling `resolveStackTarget`. */
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

/** Picks which candidate a drag is aimed at, and above/below it. Among candidates whose
 * horizontal overlap with `draggedRect` (as a fraction of the candidate's own width)
 * clears `overlapFraction`, the one with the most vertical overlap wins; its height is
 * then split into an above/below/dead-zone band by where `draggedRect`'s own top edge
 * falls: top 25% -> above, bottom 25% -> below, the middle 50% -> no target (this dead
 * zone is what keeps a near-boundary hover from flickering between adjacent slots).
 * Returns null when no candidate clears the gate, or the winning candidate's band is
 * the dead zone. */
export function resolveStackTarget(
    draggedRect: Rect,
    candidates: readonly StackCandidate[],
    overlapFraction: number,
): StackTarget | null {
    let best: StackCandidate | null = null;
    let bestOverlapY = 0;
    for (const candidate of candidates) {
        if (horizontalOverlapFraction(draggedRect, candidate.rect) < overlapFraction) {
            continue;
        }
        const overlapY = verticalOverlap(draggedRect, candidate.rect);
        if (overlapY <= 0) {
            continue;
        }
        if (best === null || overlapY > bestOverlapY) {
            best = candidate;
            bestOverlapY = overlapY;
        }
    }
    if (best === null) {
        return null;
    }
    const topFraction = (draggedRect.y - best.rect.y) / best.rect.height;
    if (topFraction < 0.25) {
        return { columnId: best.columnId, tileId: best.tileId, direction: 'above' };
    }
    if (topFraction > 0.75) {
        return { columnId: best.columnId, tileId: best.tileId, direction: 'below' };
    }
    return null;
}

/** Translates a resolved `StackTarget` into a tile-list index for `Column.insertTileAt`/
 * `Column.moveTile`, given the exact tile list the target column currently holds (the
 * dragged tile already excluded by the caller for a same-column list, exactly as
 * `StackCandidate`s themselves are). */
export function stackTargetIndex(target: StackTarget, tiles: readonly { id: number }[]): number {
    const index = tiles.findIndex((tile) => tile.id === target.tileId);
    return target.direction === 'above' ? index : index + 1;
}

function verticalOverlap(a: Rect, b: Rect): number {
    return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

function horizontalOverlapFraction(dragged: Rect, target: Rect): number {
    const overlap = Math.min(dragged.x + dragged.width, target.x + target.width) - Math.max(dragged.x, target.x);
    if (overlap <= 0) {
        return 0;
    }
    return overlap / target.width;
}
