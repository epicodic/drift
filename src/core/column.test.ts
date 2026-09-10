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

    it('rescaleHeight scales every tile to fit the new height, keeping their relative sizes', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile(); // three even tiles of 300 each

        column.rescaleHeight(600); // e.g. grid height dropped from 900 to 600

        expect(column.tiles().map((t) => t.height)).toEqual([200, 200, 200]);
    });

    it('rescaleHeight preserves an uneven split, not just an even one', () => {
        const column = new Column(1, 300, 900);
        const secondId = column.addTile(); // [450, 450]
        column.resizeTile(secondId, 600, 'top'); // [300, 600]

        column.rescaleHeight(1800); // e.g. grid height doubled

        expect(column.tiles().map((t) => t.height)).toEqual([600, 1200]);
    });

    it('rescaleHeight avoids floating-point drift when the scale ratio is a repeating fraction', () => {
        // oldBudget=600, newBudget=920 → 920/600 repeats in binary. Precomputing
        // factor = newBudget / oldBudget and then doing tile.height *= factor yields
        // 300 * (920 / 600) = 460.00000000000006 for each tile; computing
        // (tile.height * newBudget) / oldBudget directly lands on the exact 460.
        const column = new Column(1, 300, 620, 20); // rowGap = 20
        column.addTile(); // [300, 300] — (620 - 20) / 2

        column.rescaleHeight(940); // newBudget = 940 - 20 = 920

        expect(column.tiles().map((t) => t.height)).toEqual([460, 460]);
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

        expect(column.focusUp()).toBe(false); // already at the top tile — no-op
        expect(column.focusedTileId).toBe(firstId);

        expect(column.focusDown()).toBe(true);
        expect(column.focusedTileId).toBe(secondId);
        expect(column.focusDown()).toBe(true);
        expect(column.focusedTileId).toBe(thirdId);
        expect(column.focusDown()).toBe(false); // already at the bottom tile — no-op
        expect(column.focusedTileId).toBe(thirdId);

        expect(column.focusUp()).toBe(true);
        expect(column.focusedTileId).toBe(secondId);
    });

    it('resizeTile takes the delta from the neighbor on the moved edge side', () => {
        const column = new Column(1, 300, 900); // one tile: 900
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // 450 / 450

        const changed = column.resizeTile(bottomId, 500, 'top');
        expect(changed).toBe(true);
        expect(column.tiles().map((t) => t.height)).toEqual([400, 500]);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, bottomId]);
    });

    it('resizeTile is a no-op and returns false when there is no neighbor on the moved edge side', () => {
        const column = new Column(1, 300, 900);
        const onlyId = column.tiles()[0].id;
        const changed = column.resizeTile(onlyId, 700, 'top'); // no tile above the first one
        expect(changed).toBe(false);
        expect(column.tiles()[0].height).toBe(900);
    });

    it('resizeTile rejects a resize that would push the neighbor to zero or below', () => {
        const column = new Column(1, 300, 900);
        column.addTile(); // 450 / 450
        const bottomId = column.tiles()[1].id;
        expect(() => column.resizeTile(bottomId, 950, 'top')).toThrow();
    });

    it('insertTileAt inserts at an arbitrary index, splitting height evenly across the whole stack', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const newId = column.insertTileAt(0); // insert before the only existing tile
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.id)).toEqual([newId, firstId]);
        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]);
    });

    it('insertTileAt in the middle preserves the order of the tiles on either side', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        const middleId = column.insertTileAt(1);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, middleId, bottomId]);
        expect(column.tiles().map((t) => t.height)).toEqual([300, 300, 300]);
    });

    it('addTile is equivalent to insertTileAt at the end of the stack', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        expect(column.tiles().map((t) => t.id)).toEqual([firstId, secondId]);
    });

    it('moveTile reorders within the stack without touching any height', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        column.resizeTile(topId, 200, 'bottom'); // uneven heights: top=200, bottom=700

        column.moveTile(bottomId, 0); // move bottom to the top

        expect(column.tiles().map((t) => t.id)).toEqual([bottomId, topId]);
        expect(column.tiles().map((t) => t.height)).toEqual([700, 200]);
    });

    it('moveTile to the same index is a no-op', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        column.addTile();

        column.moveTile(firstId, 0);

        expect(column.tiles()[0].id).toBe(firstId);
    });

    it('moveTile throws on an unknown tile id', () => {
        const column = new Column(1, 300, 900);
        expect(() => column.moveTile(999, 0)).toThrow();
    });

    it('moveFocusedTileUp/Down reorder the focused tile within the stack and no-op at the ends', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const middleId = column.addTile();
        const bottomId = column.addTile();
        column.setFocusedTile(middleId);

        expect(column.moveFocusedTileUp()).toBe(true);
        expect(column.tiles().map((t) => t.id)).toEqual([middleId, topId, bottomId]);
        expect(column.focusedTileId).toBe(middleId); // focus follows the moved tile

        expect(column.moveFocusedTileUp()).toBe(false); // already at the top — no-op
        expect(column.tiles().map((t) => t.id)).toEqual([middleId, topId, bottomId]);

        expect(column.moveFocusedTileDown()).toBe(true);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, middleId, bottomId]);
        expect(column.moveFocusedTileDown()).toBe(true);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, bottomId, middleId]);
        expect(column.focusedTileId).toBe(middleId);

        expect(column.moveFocusedTileDown()).toBe(false); // already at the bottom — no-op
        expect(column.tiles().map((t) => t.id)).toEqual([topId, bottomId, middleId]);
    });

    it('moveFocusedTileUp/Down do not touch any tile heights', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        column.resizeTile(topId, 200, 'bottom'); // uneven heights: top=200, bottom=700
        column.setFocusedTile(bottomId);

        column.moveFocusedTileUp();

        expect(column.tiles().map((t) => t.id)).toEqual([bottomId, topId]);
        expect(column.tiles().map((t) => t.height)).toEqual([700, 200]);
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

    it('tileRect adds the vertical gap between stacked tiles', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        column.addTile();
        column.addTile(); // three even tiles of 300 each (budget 940 - 2*20 = 900)
        const columnRect = { x: 50, y: 0, width: 300, height: 940 };
        const [first, second, third] = column.tiles();
        expect(column.tileRect(first.id, columnRect)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
        expect(column.tileRect(second.id, columnRect)).toEqual({ x: 50, y: 320, width: 300, height: 300 });
        expect(column.tileRect(third.id, columnRect)).toEqual({ x: 50, y: 640, width: 300, height: 300 });
    });

    it('addTile splits the height budget evenly, minus the vertical gap between tiles', () => {
        const column = new Column(1, 300, 1020, 20); // rowGap = 20
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        expect(column.tiles().map((t) => t.height)).toEqual([500, 500]); // (1020 - 20) / 2
        expect(secondId).not.toBe(firstId);
    });

    it('removeTile redistributes height plus the freed gap to the rest', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        const secondId = column.addTile();
        column.addTile(); // three even tiles of 300 each
        column.removeTile(secondId);
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.height)).toEqual([460, 460]); // (940 - 20) / 2
    });

    it('rescaleHeight scales tiles to fit the new height, accounting for the vertical gap', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        column.addTile();
        column.addTile(); // three even tiles of 300 each

        column.rescaleHeight(640); // e.g. grid height dropped from 940 to 640

        expect(column.tiles().map((t) => t.height)).toEqual([200, 200, 200]); // budget 600, /3
    });

    it('rescaleHeight preserves an uneven split, not just an even one, with a vertical gap', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        const secondId = column.addTile(); // [460, 460]
        column.resizeTile(secondId, 600, 'top'); // [320, 600]

        column.rescaleHeight(1860); // e.g. grid height doubled the tile budget

        expect(column.tiles().map((t) => t.height)).toEqual([640, 1200]);
    });

    it('previewRectsWithGapAt adds the vertical gap around the reserved preview slot', () => {
        const column = new Column(1, 300, 920, 20); // rowGap = 20
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // top=450, bottom=450
        const columnRect = { x: 100, y: 0, width: 300, height: 920 };

        const preview = column.previewRectsWithGapAt(1, 200, columnRect); // gap between top and bottom

        expect(preview.get(topId)).toEqual({ x: 100, y: 0, width: 300, height: 450 });
        expect(preview.get(bottomId)).toEqual({ x: 100, y: 690, width: 300, height: 450 }); // 450 + 20 + 200 + 20
    });

    it('previewRectsWithGapAt at a trailing index also carves the vertical gap out of the preceding tile', () => {
        const column = new Column(1, 300, 920, 20); // rowGap = 20
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // [450, 450]
        column.resizeTile(topId, 600); // [600, 300]
        const columnRect = { x: 0, y: 0, width: 300, height: 920 };

        const preview = column.previewRectsWithGapAt(2, 100, columnRect); // append after bottom

        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 600 }); // untouched
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 620, width: 300, height: 180 }); // 300 - 100 - 20
    });

    it('previewRectsWithoutTile leaves exactly one vertical gap where the excluded tile was', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        const topId = column.tiles()[0].id;
        const middleId = column.addTile();
        const bottomId = column.addTile(); // three tiles, 300 each

        const preview = column.previewRectsWithoutTile(middleId, { x: 0, y: 0, width: 300, height: 940 });

        expect(preview.has(middleId)).toBe(false);
        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 320, width: 300, height: 300 }); // 300 + rowGap
    });

    it('previewRectsWithGapAt reserves gapHeight at index without mutating the column or resizing tiles', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // top=450, bottom=450
        const columnRect = { x: 100, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithGapAt(1, 200, columnRect); // gap between top and bottom

        expect(preview.get(topId)).toEqual({ x: 100, y: 0, width: 300, height: 450 });
        expect(preview.get(bottomId)).toEqual({ x: 100, y: 650, width: 300, height: 450 }); // shifted down by gapHeight
        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]); // unmutated
    });

    it('previewRectsWithGapAt at index 0 shifts every existing tile down', () => {
        const column = new Column(1, 300, 900);
        const onlyId = column.tiles()[0].id;
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithGapAt(0, 300, columnRect);

        expect(preview.get(onlyId)).toEqual({ x: 0, y: 300, width: 300, height: 900 });
    });

    it('previewRectsWithGapAt at a trailing index shrinks the preceding tile to reserve visible space', () => {
        // A gap at others.length (append after everything) has no later tile to shift down —
        // without shrinking the tile right before it, the preview would show no visible change
        // at all, which is exactly the "no live preview for the lower half of a neighboring
        // window" bug this guards against.
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // top=450, bottom=450
        column.resizeTile(topId, 600); // top=600, bottom=300
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithGapAt(2, 100, columnRect); // append after bottom

        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 600 }); // untouched
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 600, width: 300, height: 200 }); // shrunk by gapHeight
    });

    it('previewRectsWithGapAt excludes excludeTileId from consideration entirely', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        // Same-stack reorder preview: move "top" to slot 1 (after bottom), excluding it from the base list.
        // Trailing gap: the base list is [bottom] only, so bottom is the tile shrunk to reserve space.
        const preview = column.previewRectsWithGapAt(1, 450, columnRect, topId);

        expect(preview.has(topId)).toBe(false);
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 0, width: 300, height: 0 });
    });

    it('previewRectsWithoutTile closes the gap by shifting later tiles up, without redistributing height', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const middleId = column.addTile();
        const bottomId = column.addTile(); // three tiles, 300 each
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithoutTile(middleId, columnRect);

        expect(preview.has(middleId)).toBe(false);
        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 300, width: 300, height: 300 }); // shifted up
    });
});

describe('Column — growFocusedTile/shrinkFocusedTile', () => {
    it('grows the focused (top) tile by taking space from its neighbor below', () => {
        const column = new Column(1, 400, 1000);
        column.addTile(); // 500/500; focus stays on the top tile

        expect(column.growFocusedTile(100)).toBe(true);

        expect(column.tiles().map((t) => t.height)).toEqual([600, 400]);
    });

    it('shrinks the focused (top) tile, giving the space to its neighbor below', () => {
        const column = new Column(1, 400, 1000);
        column.addTile();

        expect(column.shrinkFocusedTile(100)).toBe(true);

        expect(column.tiles().map((t) => t.height)).toEqual([400, 600]);
    });

    it('falls back to the neighbor above when the focused tile is at the bottom of the stack', () => {
        const column = new Column(1, 400, 1000);
        column.addTile();
        column.setFocusedTile(column.tiles()[1].id);

        expect(column.growFocusedTile(100)).toBe(true);

        expect(column.tiles().map((t) => t.height)).toEqual([400, 600]);
    });

    it('is a no-op on a single-tile column', () => {
        const column = new Column(1, 400, 1000);

        expect(column.growFocusedTile(100)).toBe(false);
        expect(column.shrinkFocusedTile(100)).toBe(false);
        expect(column.tiles()[0].height).toBe(1000);
    });

    it('clamps growth to the floor when the requested step would go past it', () => {
        const column = new Column(1, 400, 120);
        column.addTile(); // 60/60
        column.resizeTile(column.tiles()[0].id, 90, 'bottom'); // 90/30

        expect(column.growFocusedTile(100)).toBe(true); // requested +100 clamps to the 60/60 floor

        expect(column.tiles().map((t) => t.height)).toEqual([60, 60]);
    });
});
