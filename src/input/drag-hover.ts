// Pure geometry decision for a live drag: is the dragged tile currently hovering a
// "stack zone" (the middle half of some column's width), and if so, which vertical
// slot within that column's tile stack would it land in? No KWin dependency — takes
// only already-resolved virtual-x/real-y geometry, so it's directly unit-testable
// without mocking any signal wiring (docs: 2026-09-03-drag-to-stack-design).

import { Grid } from '../core/grid';

export interface StackHover {
    columnId: number;
    slot: number;
}

/** `excludeColumnId`/`excludeTileId` identify the dragged tile itself, so hovering
 * its own current column excludes it from the slot computation rather than treating
 * it as a foreign tile to insert relative to. Returns null when the drag is in a
 * "reorder zone" (outer quarter of a column on either side) — ordinary column-reorder
 * logic applies instead — or when the grid has no visible columns at all. */
export function resolveStackHover(
    grid: Grid,
    excludeColumnId: number,
    excludeTileId: number,
    virtualXCenter: number,
    yCenter: number,
): StackHover | null {
    const targetColumnId = grid.columnAtVirtualX(virtualXCenter);
    if (targetColumnId === null) {
        return null;
    }
    const rect = grid.columnRect(targetColumnId);
    const localFraction = (virtualXCenter - rect.x) / rect.width;
    if (localFraction < 0.25 || localFraction > 0.75) {
        return null;
    }
    const targetColumn = grid.column(targetColumnId);
    if (targetColumn === null) {
        return null;
    }
    const sameColumn = targetColumnId === excludeColumnId;
    const others = targetColumn.tiles().filter((tile) => !sameColumn || tile.id !== excludeTileId);
    let y = 0;
    for (let i = 0; i < others.length; i++) {
        if (yCenter < y + others[i].height / 2) {
            return { columnId: targetColumnId, slot: i };
        }
        y += others[i].height;
    }
    return { columnId: targetColumnId, slot: others.length };
}

/** Which column, if any, the dragged tile's own center has crossed into ENOUGH to
 * warrant a live reorder swap — the exact complement of `resolveStackHover`'s stack
 * zone, using the SAME measurement (the dragged tile's center's local fraction
 * within whichever column currently contains it). Returns null when the center is
 * still within `excludeColumnId` itself (nothing to reorder into yet), when it has
 * moved into a neighbor's middle 50% (that's stack-zone territory — see
 * `resolveStackHover`), or when the grid has no visible columns at all. Otherwise
 * returns the id of the column whose outer quarter the center has entered, which the
 * caller should swap `excludeColumnId` into.
 *
 * Reorder and stack used to be decided from two different, uncalibrated
 * measurements: this function's predecessor (`Grid.insertionIndexForEdges`) fired
 * off the dragged window's own EDGE crossing a neighbor's CENTER, while
 * `resolveStackHover` requires the window's CENTER to be deep (25%-75%) inside a
 * neighbor. For equal-width columns those two thresholds nearly coincide — the edge
 * reaches the neighbor's center at almost exactly the instant the window's own
 * center is at the neighbor's very edge (local fraction ~0) — so the edge-based
 * reorder trigger always fired before the stack zone could ever be reached, making
 * drag-to-stack geometrically unreachable. Deriving both from the same center-based
 * measurement makes the two zones mutually exclusive and exhaustive by
 * construction. */
export function resolveReorderTarget(grid: Grid, excludeColumnId: number, virtualXCenter: number): number | null {
    const targetColumnId = grid.columnAtVirtualX(virtualXCenter);
    if (targetColumnId === null || targetColumnId === excludeColumnId) {
        return null;
    }
    const rect = grid.columnRect(targetColumnId);
    const localFraction = (virtualXCenter - rect.x) / rect.width;
    if (localFraction >= 0.25 && localFraction <= 0.75) {
        return null;
    }
    return targetColumnId;
}
