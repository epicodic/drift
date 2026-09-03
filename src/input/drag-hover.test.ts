import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import { resolveReorderTarget, resolveStackHover } from './drag-hover';

describe('resolveStackHover', () => {
    it('returns null in the outer 25% of a column (reorder zone)', () => {
        const grid = new Grid(1000, 0);
        grid.addColumn(300); // target column, 0..300
        const dragged = grid.addColumn(300); // 300..600, this is the "dragged" column

        // virtualXCenter = 30 -> local fraction 0.1, well inside the left outer band
        expect(resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 30, 500)).toBeNull();
    });

    it('returns the target column and a slot in the middle 50% of a column (stack zone)', () => {
        const grid = new Grid(1000, 0);
        const target = grid.addColumn(300); // 0..300
        const dragged = grid.addColumn(300);

        // virtualXCenter = 150 -> local fraction 0.5, dead center
        const hover = resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 150, 500);

        expect(hover).not.toBeNull();
        expect(hover?.columnId).toBe(target.id);
    });

    it("resolves the slot from vertical position among the target column's tiles", () => {
        const grid = new Grid(1000, 0);
        const target = grid.addColumn(300);
        target.addTile(); // target now has 2 tiles, each 500 tall: [0..500), [500..1000)
        const dragged = grid.addColumn(300);

        const topHover = resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 150, 100);
        expect(topHover?.slot).toBe(0); // above the first tile's midpoint (250)

        const bottomHover = resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 150, 900);
        expect(bottomHover?.slot).toBe(2); // below every tile's midpoint -> append at bottom
    });

    it("excludes the dragged tile from its own column's slot computation", () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        const bottomId = column.addTile(); // [top tile 0..500), [bottomId 500..1000)

        // Dragging bottomId within its own column, hovering near the top (y=100).
        const hover = resolveStackHover(grid, column.id, bottomId, 150, 100);

        expect(hover?.columnId).toBe(column.id);
        expect(hover?.slot).toBe(0); // the top tile is the only "other" tile, and its midpoint (250) is below yCenter

        // Hovering near the bottom (y=900) discriminates exclusion, unlike y=100 above.
        // Correct (bottomId excluded): others = [topTile], midpoint 250; 900 is past it,
        // so the loop falls through -> slot = others.length = 1.
        // Broken (bottomId NOT excluded): others = [topTile, bottomId], midpoints 250 and 750;
        // 900 is past both -> slot = others.length = 2. The two cases disagree (1 vs 2),
        // so this assertion actually fails if the exclusion filter is removed.
        const bottomHover = resolveStackHover(grid, column.id, bottomId, 150, 900);
        expect(bottomHover?.columnId).toBe(column.id);
        expect(bottomHover?.slot).toBe(1);
    });

    it('returns null for an empty grid', () => {
        const grid = new Grid(1000, 0);
        expect(resolveStackHover(grid, 1, 1, 0, 0)).toBeNull();
    });
});

describe('resolveReorderTarget', () => {
    it("returns null while the dragged tile's own center is still within its own column", () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300); // 0..300
        grid.addColumn(300); // 300..600

        // virtualXCenter = 30 -> local fraction 0.1 of the dragged column itself, near its own left edge.
        expect(resolveReorderTarget(grid, dragged.id, 30)).toBeNull();
    });

    it("returns the neighboring column's id once the center has crossed into its near (left) outer quarter", () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300); // 0..300
        const neighbor = grid.addColumn(300); // 300..600

        // virtualXCenter = 320 -> local fraction (320-300)/300 = 0.0667 within neighbor, well under 0.25.
        expect(resolveReorderTarget(grid, dragged.id, 320)).toBe(neighbor.id);
    });

    it('returns the neighboring column id again past the stack zone, near its far outer quarter', () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300); // 0..300
        const neighbor = grid.addColumn(300); // 300..600

        // virtualXCenter = 580 -> local fraction (580-300)/300 = 0.9333 within neighbor, well over 0.75.
        expect(resolveReorderTarget(grid, dragged.id, 580)).toBe(neighbor.id);
    });

    it("returns null in the neighboring column's middle 50% — that is stack-zone territory, not reorder", () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300); // 0..300
        grid.addColumn(300); // 300..600

        // virtualXCenter = 450 -> local fraction 0.5 within the neighbor, dead center.
        expect(resolveReorderTarget(grid, dragged.id, 450)).toBeNull();
    });

    it('treats the 0.25/0.75 boundary itself as stack-zone territory, matching resolveStackHover exactly', () => {
        const grid = new Grid(1000, 0);
        const dragged = grid.addColumn(300); // 0..300
        grid.addColumn(300); // 300..600

        // 375 = 300 + 0.25*300 (fraction exactly 0.25); 525 = 300 + 0.75*300 (fraction exactly 0.75).
        expect(resolveReorderTarget(grid, dragged.id, 375)).toBeNull();
        expect(resolveReorderTarget(grid, dragged.id, 525)).toBeNull();
    });

    it('returns null for an empty grid', () => {
        const grid = new Grid(1000, 0);
        expect(resolveReorderTarget(grid, 1, 0)).toBeNull();
    });
});

describe('resolveStackHover + resolveReorderTarget — reachability regression', () => {
    it("reaches column B's stack zone during a continuous pixel-by-pixel drag from A into B", () => {
        // Regression test for a real bug: the live reorder commit used to relabel a
        // neighbor's entire spatial territory as belonging to the dragged column the
        // instant a swap landed, so the cursor could never again be observed hovering
        // that neighbor's true middle 50% during one continuous drag — stacking was
        // geometrically unreachable in practice, even though the pure zone-boundary
        // math (tested above) was individually correct (docs: 2026-09-03-drag-to-stack-design).
        // This test simulates exactly what `drag.ts`'s `tick()` does per frame: EITHER
        // resolve a stack hover, OR resolve a reorder target for PREVIEW purposes only —
        // deliberately never calling `grid.moveColumn`, since the real fix defers that
        // one commit to release. If this ever regresses back to a live per-tick commit,
        // this test fails the same way the live bug did.
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300); // 0..300
        const b = grid.addColumn(300); // 300..600
        const tileId = a.tiles()[0].id;

        let reachedStackOnB = false;
        for (let virtualXCenter = 150; virtualXCenter <= 450; virtualXCenter += 1) {
            const hover = resolveStackHover(grid, a.id, tileId, virtualXCenter, 500);
            if (hover !== null && hover.columnId === b.id) {
                reachedStackOnB = true;
                break;
            }
            // Preview-only: deliberately not mutating `grid` here, unlike the old bug.
            resolveReorderTarget(grid, a.id, virtualXCenter);
        }

        expect(reachedStackOnB).toBe(true);
        // The real order was never touched by the simulated drag above.
        expect(grid.columns().map((col) => col.id)).toEqual([a.id, b.id]);
    });
});
