// Pure geometry: given a target column already identified by the caller (via pointer
// position — see drag.ts's priority logic), which vertical slot within that column's tile
// stack a drag should land in. No KWin dependency — takes only already-resolved column ids
// and a y position, so it's directly unit-testable without mocking any signal wiring
// (docs: 2026-09-04-drag-reorder-stack-priority-design).

import { Grid } from '../core/grid';

export interface StackHover {
    columnId: number;
    slot: number;
}

/** `excludeColumnId`/`excludeTileId` identify the dragged tile itself: when `targetColumnId`
 * IS the dragged tile's own column (a same-column drag, re-ordering tiles within one stack),
 * that tile is excluded from the slot computation so it doesn't count as its own neighbor.
 * For a genuine cross-column hover, nothing is excluded — the target's own tiles are all real
 * candidates. Returns null only when `targetColumnId` doesn't resolve to a real column. */
export function resolveStackSlot(
    grid: Grid,
    targetColumnId: number,
    excludeColumnId: number,
    excludeTileId: number,
    yCenter: number,
): number | null {
    const targetColumn = grid.column(targetColumnId);
    if (targetColumn === null) {
        return null;
    }
    const sameColumn = targetColumnId === excludeColumnId;
    const others = targetColumn.tiles().filter((tile) => !sameColumn || tile.id !== excludeTileId);
    let y = 0;
    for (let i = 0; i < others.length; i++) {
        if (yCenter < y + others[i].height / 2) {
            return i;
        }
        y += others[i].height;
    }
    return others.length;
}
