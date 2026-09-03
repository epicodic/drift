import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import { resolveStackSlot } from './drag-hover';

describe('resolveStackSlot', () => {
    it('returns null when the target column does not exist', () => {
        const grid = new Grid(1000, 0);
        expect(resolveStackSlot(grid, 999, 999, 1, 0)).toBeNull();
    });

    it('picks slot 0 (insert above) for a plain single-tile neighbor when hovering its top half', () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300);
        const neighbor = grid.addColumn(300); // single tile, 1000 tall

        expect(resolveStackSlot(grid, neighbor.id, dragged.id, dragged.tiles()[0].id, 100)).toBe(0);
    });

    it('picks the trailing slot (insert below) for a plain single-tile neighbor when hovering its bottom half', () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300);
        const neighbor = grid.addColumn(300); // single tile, 1000 tall

        expect(resolveStackSlot(grid, neighbor.id, dragged.id, dragged.tiles()[0].id, 900)).toBe(1);
    });

    it("resolves the slot from vertical position among an already-stacked target column's tiles", () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300);
        const neighbor = grid.addColumn(300);
        neighbor.addTile(); // neighbor now has 2 tiles, each 500 tall: [0..500), [500..1000)

        const topSlot = resolveStackSlot(grid, neighbor.id, dragged.id, dragged.tiles()[0].id, 100);
        expect(topSlot).toBe(0); // above the first tile's midpoint (250)

        const bottomSlot = resolveStackSlot(grid, neighbor.id, dragged.id, dragged.tiles()[0].id, 900);
        expect(bottomSlot).toBe(2); // below every tile's midpoint -> append at bottom
    });

    it("does not exclude any tile when the target is a different column than the dragged tile's home", () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300);
        const neighbor = grid.addColumn(300);
        neighbor.addTile();
        const neighborTopTileId = neighbor.tiles()[0].id;

        // Even if excludeTileId happened to numerically collide with a neighbor tile id, the
        // exclusion filter only applies when targetColumnId === excludeColumnId (same-column
        // drag) — here it's a genuine cross-column hover, so nothing in `neighbor` is excluded.
        const slot = resolveStackSlot(grid, neighbor.id, dragged.id, neighborTopTileId, 100);
        expect(slot).toBe(0);
    });

    it("excludes the dragged tile from its own column's slot computation (same-column drag)", () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        const bottomId = column.addTile(); // [top tile 0..500), [bottomId 500..1000)

        // Dragging bottomId within its own column, hovering near the top (y=100).
        const topSlot = resolveStackSlot(grid, column.id, column.id, bottomId, 100);
        expect(topSlot).toBe(0); // the top tile is the only "other" tile, and its midpoint (250) is below yCenter

        // Hovering near the bottom (y=900) discriminates exclusion, unlike y=100 above.
        // Correct (bottomId excluded): others = [topTile], midpoint 250; 900 is past it,
        // so the loop falls through -> slot = others.length = 1.
        // Broken (bottomId NOT excluded): others = [topTile, bottomId], midpoints 250 and 750;
        // 900 is past both -> slot = others.length = 2. The two cases disagree (1 vs 2), so
        // this assertion actually fails if the exclusion filter is removed.
        const bottomSlot = resolveStackSlot(grid, column.id, column.id, bottomId, 900);
        expect(bottomSlot).toBe(1);
    });
});
