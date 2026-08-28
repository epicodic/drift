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
