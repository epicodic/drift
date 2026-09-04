import { describe, it, expect } from 'vitest';
import { Grid } from './grid';

const HEIGHT = 1080;
const GAP = 10;

describe('Grid — empty state', () => {
    it('has no focused column, zero width, and no columns', () => {
        const grid = new Grid(HEIGHT, GAP);
        expect(grid.focusedColumn()).toBeNull();
        expect(grid.virtualWidth()).toBe(0);
        expect(grid.columns()).toEqual([]);
    });
});

describe('Grid — screenHeight', () => {
    it('reports the constant height passed to the constructor', () => {
        const grid = new Grid(HEIGHT, GAP);

        expect(grid.screenHeight()).toBe(HEIGHT);
    });
});

describe('Grid — debugState', () => {
    it('reports focus, id counter, origin, and columns with widths', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500);
        grid.setFocus(a.id);
        expect(grid.debugState()).toEqual({
            focusedColumnId: 1,
            nextId: 3,
            originX: 0,
            columns: [
                { id: 1, width: 300, hidden: false, tileCount: 1 },
                { id: 2, width: 500, hidden: false, tileCount: 1 },
            ],
        });
    });
});

describe('Grid — adding columns', () => {
    it('adds a column, focuses it, and assigns increasing ids', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        expect(a.id).toBe(1);
        expect(b.id).toBe(2);
        expect(grid.focusedColumn()).toBe(b);
        expect(grid.columns().map((c) => c.id)).toEqual([1, 2]);
    });

    it('inserts the new column to the right of the focused one', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500); // b, now focused
        grid.setFocus(a.id);
        const c = grid.addColumn(200);
        expect(grid.columns().map((col) => col.id)).toEqual([1, 3, 2]);
        expect(grid.focusedColumn()).toBe(c);
    });
});

describe('Grid — geometry', () => {
    it('places columns side by side with the gap and full height', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        expect(grid.columnRect(a.id)).toEqual({ x: 0, y: 0, width: 300, height: HEIGHT });
        expect(grid.columnRect(b.id)).toEqual({ x: 310, y: 0, width: 500, height: HEIGHT });
        expect(grid.virtualWidth()).toBe(810);
    });

    it('throws when asked for the rect of an unknown column', () => {
        const grid = new Grid(HEIGHT, GAP);
        expect(() => grid.columnRect(999)).toThrow();
    });
});

describe('Grid — hiding and showing columns', () => {
    it('hides a column with 1px hidden gap to prevent taskbar confusion', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        expect(grid.virtualWidth()).toBe(511); // 300 + gap(10) + 1(hidden b) + 200 — single merged gap
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(c.id).x).toBe(311); // c sits right after a's gap + b's 1px, no doubled gap
    });

    it('keeps the hidden column in columns() at its original position', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        expect(grid.columns().map((col) => col.id)).toEqual([a.id, b.id, c.id]);
    });

    it('restores a shown column to its original layout position', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.hideColumn(b.id);
        grid.showColumn(b.id);
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(b.id).x).toBe(310);
        expect(grid.virtualWidth()).toBe(810);
    });

    it("returns a hidden column's rect at its 1px-slot offset with its real (unshrunk) width", () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.addColumn(200);
        grid.hideColumn(b.id);
        expect(grid.columnRect(b.id)).toEqual({ x: 310, y: 0, width: 500, height: HEIGHT });
    });

    it('reports hidden state via isHidden', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.isHidden(a.id)).toBe(false);
        grid.hideColumn(a.id);
        expect(grid.isHidden(a.id)).toBe(true);
        grid.showColumn(a.id);
        expect(grid.isHidden(a.id)).toBe(false);
    });

    it('does not change focus when hiding or showing the focused column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500);
        grid.setFocus(a.id);
        grid.hideColumn(a.id);
        expect(grid.focusedColumn()).toBe(a);
        grid.showColumn(a.id);
        expect(grid.focusedColumn()).toBe(a);
    });
});

describe('Grid — insertion index for drag edges', () => {
    it('returns its own index when the dragged column is the only column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.insertionIndexForEdges(a.id, -999, 999)).toBe(0);
    });

    it("swaps with the right neighbor once the dragged window's right edge crosses its center", () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300), center 150
        const b = grid.addColumn(500); // b (dragged): [310,810)
        grid.addColumn(200); // c: [820,1020), center 920
        // left edge stays well short of a's center throughout (b is 500 wide), so
        // only the right edge crossing c's center matters here.
        expect(grid.insertionIndexForEdges(b.id, 400, 900)).toBe(1); // short of c's center -> stays put
        expect(grid.insertionIndexForEdges(b.id, 420, 920)).toBe(1); // exactly at the center -> not yet crossed
        expect(grid.insertionIndexForEdges(b.id, 430, 930)).toBe(2); // past c's center -> swap with c
    });

    it("swaps with the left neighbor once the dragged window's left edge crosses its center", () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300), center 150
        const b = grid.addColumn(500); // b (dragged): [310,810)
        grid.addColumn(200); // c: [820,1020)
        // right edge stays well short of c's center throughout (b is 500 wide), so
        // only the left edge crossing a's center matters here.
        expect(grid.insertionIndexForEdges(b.id, 160, 660)).toBe(1); // short of a's center -> stays put
        expect(grid.insertionIndexForEdges(b.id, 150, 650)).toBe(1); // exactly at the center -> not yet crossed
        expect(grid.insertionIndexForEdges(b.id, 140, 640)).toBe(0); // past a's center -> swap with a
    });

    it('combines with moveColumn to reorder based on a drop position', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500); // b: [310,810), center 560
        const c = grid.addColumn(200); // c (dragged): [820,1020), immediate left neighbor is b
        const targetIndex = grid.insertionIndexForEdges(c.id, 500, 999); // left edge past b's center (560)
        grid.moveColumn(c.id, targetIndex);
        expect(grid.columns().map((col) => col.id)).toEqual([1, 3, 2]);
        expect(grid.columnRect(c.id).x).toBe(310); // c moved into b's old slot
        expect(grid.columnRect(b.id).x).toBe(520); // b shifted right to make room for c
    });
});

describe('Grid — columnAtVirtualX', () => {
    it('returns the column whose span contains virtualX', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300); // 0..300
        const b = grid.addColumn(300); // 300..600

        expect(grid.columnAtVirtualX(150)).toBe(a.id);
        expect(grid.columnAtVirtualX(450)).toBe(b.id);
    });

    it('clamps to the first column for virtualX before the strip', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        grid.addColumn(300);

        expect(grid.columnAtVirtualX(-500)).toBe(a.id);
    });

    it('clamps to the last visible column for virtualX past the strip', () => {
        const grid = new Grid(1000, 0);
        grid.addColumn(300);
        const b = grid.addColumn(300);

        expect(grid.columnAtVirtualX(9999)).toBe(b.id);
    });

    it('skips hidden columns', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300); // 0..300
        const hidden = grid.addColumn(300); // 300..600
        const c = grid.addColumn(300); // 600..900
        grid.hideColumn(hidden.id);

        expect(grid.columnAtVirtualX(150)).toBe(a.id);
        // 300 falls inside hidden's own span [300,600), not a's [0,300) or c's [600,900).
        // Only the skip logic prevents this from matching hidden itself; without it, this
        // would wrongly return hidden.id instead of falling through to c.
        expect(grid.columnAtVirtualX(300)).toBe(c.id);
    });

    it('returns null for an empty grid', () => {
        const grid = new Grid(1000, 0);
        expect(grid.columnAtVirtualX(0)).toBeNull();
    });
});

describe('Grid — insertion index skips hidden columns', () => {
    it('skips a hidden neighbor and swaps with the next visible one instead', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: visible, [0,300), center 150
        const b = grid.addColumn(500); // hidden — contributes no space
        const c = grid.addColumn(200); // c (dragged)
        grid.hideColumn(b.id);
        // with b hidden, c's only visible left neighbor is a.
        expect(grid.insertionIndexForEdges(c.id, 160, 999)).toBe(2); // short of a's center -> stays put (own index)
        expect(grid.insertionIndexForEdges(c.id, 140, 999)).toBe(0); // past a's center -> swap with a
    });
});

describe('Grid — expel direction for drag edges', () => {
    it('returns null on both sides for the only column until an edge crosses its own boundary', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // a: [0,300), no neighbor on either side

        expect(grid.expelDirectionForEdges(a.id, 0, 300)).toBeNull(); // exactly at its own edges -> not crossed
        expect(grid.expelDirectionForEdges(a.id, -10, 310)).toBe('right'); // right checked first
    });

    it("returns 'left' once the left edge crosses past a column with no left neighbor", () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // a: [0,300), no left neighbor

        expect(grid.expelDirectionForEdges(a.id, -1, 300)).toBe('left');
    });

    it("returns 'right' once the right edge crosses past the rightmost column's own boundary", () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300)
        const b = grid.addColumn(500); // b (dragged): [310,810), no right neighbor

        expect(grid.expelDirectionForEdges(b.id, 310, 811)).toBe('right');
    });

    it("returns 'left' once the left edge crosses past the leftmost column's own boundary", () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // a (dragged): [0,300), no left neighbor
        grid.addColumn(500); // b: [310,810)

        expect(grid.expelDirectionForEdges(a.id, -1, 300)).toBe('left');
    });

    it('returns null when a visible neighbor exists on both sides, regardless of the edges', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500); // b (dragged), has a neighbor on both sides
        grid.addColumn(200); // c

        expect(grid.expelDirectionForEdges(b.id, -999, 999)).toBeNull();
    });

    it('ignores a hidden column when checking for a visible neighbor', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // a (dragged): [0,300)
        const hidden = grid.addColumn(500); // hidden — contributes no visible neighbor
        grid.hideColumn(hidden.id);

        expect(grid.expelDirectionForEdges(a.id, -1, 300)).toBe('left');
    });
});

describe('Grid — resizing shifts neighbors', () => {
    it('shifts downstream columns when a column widens', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.resizeColumn(a.id, 400);
        expect(grid.columnRect(b.id).x).toBe(410);
        expect(grid.virtualWidth()).toBe(910);
    });
});

describe('Grid — content origin and edge-aware resizing', () => {
    it('starts with a content-left of 0', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300);
        expect(grid.contentLeft()).toBe(0);
    });

    it('right-border resize grows rightward and shifts only right neighbors', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.resizeColumn(a.id, 400, 'right');
        expect(grid.contentLeft()).toBe(0);
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(b.id).x).toBe(410);
    });

    it('left-border resize holds the right edge and slides the strip left', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // a.x = 0
        const b = grid.addColumn(500); // b.x = 310, right edge = 810
        grid.resizeColumn(b.id, 600, 'left'); // +100 on the left border
        expect(grid.contentLeft()).toBe(-100);
        expect(grid.columnRect(a.id).x).toBe(-100); // left neighbor slid left
        const rectB = grid.columnRect(b.id);
        expect(rectB.x).toBe(210);
        expect(rectB.x + rectB.width).toBe(810); // right edge unchanged
        expect(grid.virtualWidth()).toBe(910);
    });

    it('defaults to right-border semantics when no edge is given', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500);
        grid.resizeColumn(a.id, 400);
        expect(grid.contentLeft()).toBe(0);
    });
});

describe('Grid — removing columns closes the gap', () => {
    it('shifts neighbors left to fill the gap', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.removeColumn(b.id);
        expect(grid.columns().map((col) => col.id)).toEqual([1, 3]);
        expect(grid.columnRect(c.id).x).toBe(310);
    });

    it('moves focus to the right neighbor when the focused column is removed', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.setFocus(b.id);
        grid.removeColumn(b.id);
        expect(grid.focusedColumn()).toBe(c);
    });

    it('moves focus to the left neighbor when the last column is removed', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const c = grid.addColumn(200);
        grid.setFocus(c.id);
        grid.removeColumn(c.id);
        expect(grid.focusedColumn()).toBe(a);
    });

    it('leaves focus unchanged when a non-focused column is removed', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.setFocus(a.id);
        grid.removeColumn(b.id);
        expect(grid.focusedColumn()).toBe(a);
    });

    it('clears focus when the only column is removed', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.removeColumn(a.id);
        expect(grid.focusedColumn()).toBeNull();
    });
});

describe('Grid — removing a column skips hidden neighbors when reassigning focus', () => {
    it('moves focus past a hidden right neighbor to the next visible column', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        const d = grid.addColumn(150);
        grid.hideColumn(c.id);
        grid.setFocus(b.id);
        grid.removeColumn(b.id);
        expect(grid.focusedColumn()).toBe(d);
    });

    it('falls back to a visible left neighbor when every right neighbor is hidden', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(c.id);
        grid.setFocus(b.id);
        grid.removeColumn(b.id);
        expect(grid.focusedColumn()).toBe(a);
    });
});

describe('Grid — focus navigation', () => {
    it('moves focus left and right without wrapping', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.setFocus(a.id);
        expect(grid.focusLeft()).toBe(a); // clamped at the left edge
        expect(grid.focusRight()).toBe(b);
        expect(grid.focusRight()).toBe(c);
        expect(grid.focusRight()).toBe(c); // clamped at the right edge
    });

    it('returns null when navigating an empty grid', () => {
        const grid = new Grid(HEIGHT, GAP);
        expect(grid.focusLeft()).toBeNull();
        expect(grid.focusRight()).toBeNull();
    });
});

describe('Grid — focus navigation skips hidden columns', () => {
    it('skips a hidden column when moving focus right', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        grid.setFocus(a.id);
        expect(grid.focusRight()).toBe(c);
    });

    it('skips a hidden column when moving focus left', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        grid.setFocus(c.id);
        expect(grid.focusLeft()).toBe(a);
    });

    it('leaves focus unchanged when every column in that direction is hidden', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.hideColumn(b.id);
        grid.setFocus(a.id);
        expect(grid.focusRight()).toBe(a);
    });
});

describe('Grid — reordering', () => {
    it('moves a column to a new index and recomputes positions', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.moveColumn(c.id, 0);
        expect(grid.columns().map((col) => col.id)).toEqual([3, 1, 2]);
        expect(grid.columnRect(c.id).x).toBe(0);
        expect(grid.columnRect(a.id).x).toBe(210);
        expect(grid.columnRect(b.id).x).toBe(520);
    });
});

describe('Grid — column()', () => {
    it('returns the Column instance for a known id, or null for an unknown one', () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        expect(grid.column(column.id)).toBe(column);
        expect(grid.column(9999)).toBeNull();
    });

    it("seeds a new column's first tile with the grid's screen height", () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        expect(column.tiles()[0].height).toBe(1000);
    });
});

describe('Grid — absorbColumnRight', () => {
    it('merges the right-neighbor column into the focused column as a new tile, removing it from the strip', () => {
        const grid = new Grid(1000, 8);
        const left = grid.addColumn(300);
        const right = grid.addColumn(300);
        grid.setFocus(left.id);

        const result = grid.absorbColumnRight(left.id);

        expect(result).toEqual({
            fromColumnId: right.id,
            fromTileId: right.tiles()[0].id,
            toTileId: expect.any(Number),
        });
        expect(grid.columns().map((c) => c.id)).toEqual([left.id]);
        expect(left.tileCount()).toBe(2);
    });

    it('returns null when there is no right neighbor', () => {
        const grid = new Grid(1000, 8);
        const only = grid.addColumn(300);
        expect(grid.absorbColumnRight(only.id)).toBeNull();
    });

    it('returns null when the right neighbor is already a stack', () => {
        const grid = new Grid(1000, 8);
        const left = grid.addColumn(300);
        const right = grid.addColumn(300);
        right.addTile();
        expect(grid.absorbColumnRight(left.id)).toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([left.id, right.id]);
    });
});

describe('Grid — expelFocusedTile', () => {
    it('removes the focused tile and gives it a new column to the right, focused', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(300);
        column.addTile();
        grid.setFocus(column.id);

        const result = grid.expelFocusedTile(column.id, 250);

        expect(column.tileCount()).toBe(1);
        expect(result).not.toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([column.id, result!.toColumnId]);
        expect(grid.focusedColumn()?.id).toBe(result!.toColumnId);
        expect(grid.column(result!.toColumnId)?.width).toBe(250);
    });

    it('returns null (no-op) when the column only has one tile', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(300);
        expect(grid.expelFocusedTile(column.id, 250)).toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([column.id]);
    });
});

describe('Grid — moveTileIntoColumn', () => {
    it("moves a standalone column's tile into another column, removing the now-empty source column", () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const aTileId = a.tiles()[0].id;
        const bTileId = b.tiles()[0].id;

        const newTileId = grid.moveTileIntoColumn(a.id, aTileId, b.id, 0);

        expect(grid.columns().map((c) => c.id)).toEqual([b.id]); // a was removed entirely
        expect(b.tiles().map((t) => t.id)).toEqual([newTileId, bTileId]);
        expect(b.tileCount()).toBe(2);
    });

    it('moves one tile out of a multi-tile source column, leaving the rest', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const aTopId = a.tiles()[0].id;
        const aBottomId = a.addTile(); // a now has 2 tiles

        grid.moveTileIntoColumn(a.id, aBottomId, b.id, 1);

        expect(grid.columns().map((c) => c.id)).toEqual([a.id, b.id]); // a still exists
        expect(a.tiles().map((t) => t.id)).toEqual([aTopId]);
        expect(a.tiles()[0].height).toBe(1000); // redistributed to full height
        expect(b.tileCount()).toBe(2);
    });

    it('inserts at the requested slot within the target column', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const bTopId = b.tiles()[0].id;
        const aTileId = a.tiles()[0].id;

        const newTileId = grid.moveTileIntoColumn(a.id, aTileId, b.id, 0); // insert above b's existing tile

        expect(b.tiles().map((t) => t.id)).toEqual([newTileId, bTopId]);
    });

    it('throws when fromColumnId and toColumnId are the same', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        a.addTile(); // a now has 2 tiles, so the single-tile removeColumn path can't hide the missing guard
        const tileId = a.tiles()[0].id;

        expect(() => grid.moveTileIntoColumn(a.id, tileId, a.id, 1)).toThrow();
    });
});
