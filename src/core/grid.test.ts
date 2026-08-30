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
                { id: 1, width: 300, hidden: false },
                { id: 2, width: 500, hidden: false },
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
        expect(grid.virtualWidth()).toBe(521); // 300 + gap(10) + 1(hidden b) + gap(10) + 200
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(c.id).x).toBe(321); // c maintains proper gap with a via hidden b's 1px
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

    it('throws when asked for the rect of a hidden column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.hideColumn(a.id);
        expect(() => grid.columnRect(a.id)).toThrow();
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

describe('Grid — insertion index for a drag position', () => {
    it('returns 0 when the dragged column is the only column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.insertionIndexForX(a.id, 999)).toBe(0);
    });

    it('finds the closest boundary among the other columns', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.addColumn(200);
        // with b excluded: a at [0,300), c at [310,510) -> boundaries [0, 310, 510]
        expect(grid.insertionIndexForX(b.id, 50)).toBe(0);
        expect(grid.insertionIndexForX(b.id, 200)).toBe(1); // b's original slot
        expect(grid.insertionIndexForX(b.id, 450)).toBe(2);
    });

    it('combines with moveColumn to reorder based on a drop position', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500); // b
        const c = grid.addColumn(200);
        const targetIndex = grid.insertionIndexForX(c.id, 50);
        grid.moveColumn(c.id, targetIndex);
        expect(grid.columns().map((col) => col.id)).toEqual([3, 1, 2]);
        expect(grid.columnRect(a.id).x).toBe(210); // a shifted right to make room for c
    });
});

describe('Grid — insertion index skips hidden columns', () => {
    it('excludes a hidden column from boundary candidates and maps back to the full ordered index', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // visible, [0,300)
        const b = grid.addColumn(500); // hidden — contributes no space
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        // with c excluded and b hidden: only a occupies space, boundaries are [0, 300]
        expect(grid.insertionIndexForX(c.id, 50)).toBe(0); // before a -> ordered index 0
        expect(grid.insertionIndexForX(c.id, 400)).toBe(2); // past a -> ordered index 2 (end, after hidden b)
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
