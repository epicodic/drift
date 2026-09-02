import { describe, it, expect } from 'vitest';
import { virtualWidth, columnRect, resizedEdge, rectsEqualRounded, edgeDirection } from './coordinates';

describe('virtualWidth', () => {
    it('is 0 for an empty strip', () => {
        expect(virtualWidth([], 0)).toBe(0);
    });

    it('equals the single column width', () => {
        expect(virtualWidth([300], 0)).toBe(300);
    });

    it('sums widths with no gap', () => {
        expect(virtualWidth([300, 500, 200], 0)).toBe(1000);
    });

    it('adds gaps between columns only', () => {
        expect(virtualWidth([300, 500, 200], 10)).toBe(1020);
    });
});

describe('columnRect', () => {
    it('builds a full-height rect at the given offset', () => {
        expect(columnRect(820, 200, 1080)).toEqual({ x: 820, y: 0, width: 200, height: 1080 });
    });
});

describe('resizedEdge', () => {
    it('reports the left border when the x position changed', () => {
        const oldRect = { x: 100, y: 0, width: 300, height: 1080 };
        const newRect = { x: 60, y: 0, width: 340, height: 1080 };
        expect(resizedEdge(oldRect, newRect)).toBe('left');
    });

    it('reports the right border when x is unchanged', () => {
        const oldRect = { x: 100, y: 0, width: 300, height: 1080 };
        const newRect = { x: 100, y: 0, width: 360, height: 1080 };
        expect(resizedEdge(oldRect, newRect)).toBe('right');
    });

    it('ignores sub-pixel x jitter and reports the right border', () => {
        const oldRect = { x: 100, y: 0, width: 300, height: 1080 };
        const newRect = { x: 100.4, y: 0, width: 360, height: 1080 };
        expect(resizedEdge(oldRect, newRect)).toBe('right');
    });
});

describe('rectsEqualRounded', () => {
    it('treats rects equal after rounding each field', () => {
        const a = { x: 100.2, y: 0.4, width: 300.1, height: 1080.0 };
        const b = { x: 100, y: 0, width: 300, height: 1080 };
        expect(rectsEqualRounded(a, b)).toBe(true);
    });

    it('detects a real difference in any field', () => {
        const a = { x: 100, y: 0, width: 300, height: 1080 };
        const b = { x: 100, y: 0, width: 360, height: 1080 };
        expect(rectsEqualRounded(a, b)).toBe(false);
    });
});

describe('edgeDirection', () => {
    // area's vertical bounds: top = 100, bottom = 1100.
    const area = { x: 0, y: 100, width: 1920, height: 1000 };

    it('is null when the pointer is well within the area vertically', () => {
        expect(edgeDirection(600, area, 10)).toBeNull();
    });

    it('is null just outside the border on either side', () => {
        expect(edgeDirection(111, area, 10)).toBeNull(); // 11px from the top, border is 10px
        expect(edgeDirection(1089, area, 10)).toBeNull(); // 11px from the bottom
    });

    it('reports "above" once the pointer is within the border of the top edge', () => {
        expect(edgeDirection(110, area, 10)).toBe('above'); // exactly 10px from the top
    });

    it('reports "above" when the pointer is clamped exactly at the top edge', () => {
        // The pointer can never go past a screen edge - the OS clamps it there - so even a
        // zero-width border must still catch the pointer sitting exactly on the boundary.
        expect(edgeDirection(100, area, 0)).toBe('above');
    });

    it('reports "below" once the pointer is within the border of the bottom edge', () => {
        expect(edgeDirection(1090, area, 10)).toBe('below'); // exactly 10px from the bottom
    });

    it('reports "below" when the pointer is clamped exactly at the bottom edge', () => {
        expect(edgeDirection(1100, area, 0)).toBe('below');
    });
});
