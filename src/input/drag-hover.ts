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

/** Picks which candidate a drag is aimed at, and above/below it, using only the dragged
 * window's own top-left corner (`draggedRect.y`) — never its height, which would let a
 * tall/short dragged window reach a differently-sized band than a candidate's own edge
 * would suggest. A candidate bands into 'above' when that corner falls in its own top
 * 25%, 'below' when it falls in its own bottom 25%; the middle 50% (and the corner
 * falling outside the candidate's range entirely) excludes that candidate rather than
 * returning a dead zone, so a same-position candidate can't flicker between a band and
 * nothing as an uninvolved neighbor's geometry changes. Among candidates that clear both
 * the horizontal overlap gate and band into a direction, the one with the most
 * horizontal overlap wins. Returns null when no candidate qualifies at all. */
export function resolveStackTarget(
    draggedRect: Rect,
    candidates: readonly StackCandidate[],
    overlapFraction: number,
): StackTarget | null {
    let best: StackCandidate | null = null;
    let bestDirection: StackDirection | null = null;
    let bestOverlapFraction = 0;
    for (const candidate of candidates) {
        const overlap = horizontalOverlapFraction(draggedRect, candidate.rect);
        if (overlap < overlapFraction) {
            continue;
        }
        const direction = resolveDirection(draggedRect.y, candidate.rect);
        if (direction === null) {
            continue;
        }
        if (best === null || overlap > bestOverlapFraction) {
            best = candidate;
            bestDirection = direction;
            bestOverlapFraction = overlap;
        }
    }
    if (best === null || bestDirection === null) {
        return null;
    }
    return { columnId: best.columnId, tileId: best.tileId, direction: bestDirection };
}

/** Bands `draggedY` (the dragged window's own top-left corner) against `target`'s top
 * 25%/bottom 25%, or excludes it (null) for the middle 50% or for falling outside
 * `target`'s own y-range entirely. */
function resolveDirection(draggedY: number, target: Rect): StackDirection | null {
    if (draggedY < target.y || draggedY > target.y + target.height) {
        return null;
    }
    if (draggedY < target.y + 0.25 * target.height) {
        return 'above';
    }
    if (draggedY > target.y + 0.75 * target.height) {
        return 'below';
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

function horizontalOverlapFraction(dragged: Rect, target: Rect): number {
    const overlap = Math.min(dragged.x + dragged.width, target.x + target.width) - Math.max(dragged.x, target.x);
    if (overlap <= 0) {
        return 0;
    }
    // Divide by the narrower of the two widths, not always the candidate's — otherwise
    // a dragged window narrower than half the candidate's width could never clear the
    // gate, even when it sits fully inside the candidate horizontally (overlap capped at
    // the dragged window's own width, so the fraction against the candidate's width
    // alone would always undercount it).
    return overlap / Math.min(dragged.width, target.width);
}
