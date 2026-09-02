import { describe, it, expect } from 'vitest';
import { Column } from './column';

describe('Column', () => {
    it('exposes its id and width', () => {
        const column = new Column(1, 300, 1000);
        expect(column.id).toBe(1);
        expect(column.width).toBe(300);
    });

    it('updates its width', () => {
        const column = new Column(1, 300, 1000);
        column.setWidth(500);
        expect(column.width).toBe(500);
    });

    it('rejects a non-positive width on construction', () => {
        expect(() => new Column(1, 0, 1000)).toThrow();
        expect(() => new Column(1, -10, 1000)).toThrow();
    });

    it('rejects a non-positive width on resize', () => {
        const column = new Column(1, 300, 1000);
        expect(() => column.setWidth(0)).toThrow();
    });

    it('rejects a non-positive height on construction', () => {
        expect(() => new Column(1, 300, 0)).toThrow();
        expect(() => new Column(1, 300, -10)).toThrow();
    });
});

describe('Column — hidden flag', () => {
    it('starts visible', () => {
        const column = new Column(1, 300, 1000);
        expect(column.hidden).toBe(false);
    });

    it('toggles hidden via setHidden', () => {
        const column = new Column(1, 300, 1000);
        column.setHidden(true);
        expect(column.hidden).toBe(true);
        column.setHidden(false);
        expect(column.hidden).toBe(false);
    });
});

describe('Column — tile stack', () => {
    it('starts with exactly one tile spanning the full height, focused', () => {
        const column = new Column(1, 300, 1000);
        expect(column.tileCount()).toBe(1);
        const [tile] = column.tiles();
        expect(tile.height).toBe(1000);
        expect(column.focusedTileId).toBe(tile.id);
    });

    it('addTile appends a tile, splitting height evenly across the whole stack', () => {
        const column = new Column(1, 300, 1000);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.height)).toEqual([500, 500]);
        expect(secondId).not.toBe(firstId);
        // addTile does not change focus — absorbing a window shouldn't steal it.
        expect(column.focusedTileId).toBe(firstId);
    });

    it('addTile keeps splitting evenly as the stack grows', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile();
        expect(column.tiles().map((t) => t.height)).toEqual([300, 300, 300]);
    });

    it('removeTile redistributes height proportionally to the rest', () => {
        const column = new Column(1, 300, 900);
        const secondId = column.addTile();
        column.addTile(); // three even tiles of 300 each
        column.removeTile(secondId);
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]);
    });

    it('removeTile reassigns focus to a remaining tile if the removed one was focused', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        column.setFocusedTile(secondId);
        column.removeTile(secondId);
        expect(column.focusedTileId).toBe(firstId);
    });

    it('removeTile throws when called on a column with only one tile', () => {
        const column = new Column(1, 300, 900);
        expect(() => column.removeTile(column.tiles()[0].id)).toThrow();
    });

    it('removeTile throws for an unknown tile id', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        expect(() => column.removeTile(9999)).toThrow();
    });

    it('setFocusedTile throws for an unknown tile id', () => {
        const column = new Column(1, 300, 900);
        expect(() => column.setFocusedTile(9999)).toThrow();
    });

    it('focusUp/focusDown move focus within the stack and no-op at the ends', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        const thirdId = column.addTile();

        column.focusUp(); // already at the top tile — no-op
        expect(column.focusedTileId).toBe(firstId);

        column.focusDown();
        expect(column.focusedTileId).toBe(secondId);
        column.focusDown();
        expect(column.focusedTileId).toBe(thirdId);
        column.focusDown(); // already at the bottom tile — no-op
        expect(column.focusedTileId).toBe(thirdId);

        column.focusUp();
        expect(column.focusedTileId).toBe(secondId);
    });

    it('resizeTile takes the delta from the neighbor on the moved edge side', () => {
        const column = new Column(1, 300, 900); // one tile: 900
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // 450 / 450

        column.resizeTile(bottomId, 500, 'top');
        expect(column.tiles().map((t) => t.height)).toEqual([400, 500]);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, bottomId]);
    });

    it('resizeTile is a no-op when there is no neighbor on the moved edge side', () => {
        const column = new Column(1, 300, 900);
        const onlyId = column.tiles()[0].id;
        column.resizeTile(onlyId, 700, 'top'); // no tile above the first one
        expect(column.tiles()[0].height).toBe(900);
    });

    it('resizeTile rejects a resize that would push the neighbor to zero or below', () => {
        const column = new Column(1, 300, 900);
        column.addTile(); // 450 / 450
        const bottomId = column.tiles()[1].id;
        expect(() => column.resizeTile(bottomId, 950, 'top')).toThrow();
    });

    it("tileRect derives each tile's y/height from the column rect, stacked with no gap", () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile(); // 300 / 300 / 300
        const columnRect = { x: 50, y: 0, width: 300, height: 900 };
        const [first, second, third] = column.tiles();
        expect(column.tileRect(first.id, columnRect)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
        expect(column.tileRect(second.id, columnRect)).toEqual({ x: 50, y: 300, width: 300, height: 300 });
        expect(column.tileRect(third.id, columnRect)).toEqual({ x: 50, y: 600, width: 300, height: 300 });
    });
});
