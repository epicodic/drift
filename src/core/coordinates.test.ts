import { describe, it, expect } from 'vitest';
import {
    columnOffsets,
    virtualWidth,
    columnRect,
    resizedEdge,
    rectsEqualRounded,
    nearestInsertionIndex,
} from './coordinates';

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

describe('columnOffsets', () => {
    it('is empty for no columns', () => {
        expect(columnOffsets([], 0)).toEqual([]);
    });

    it('starts the first column at 0', () => {
        expect(columnOffsets([300], 0)).toEqual([0]);
    });

    it('accumulates widths without a gap', () => {
        expect(columnOffsets([300, 500, 200], 0)).toEqual([0, 300, 800]);
    });

    it('includes the gap between columns', () => {
        expect(columnOffsets([300, 500, 200], 10)).toEqual([0, 310, 820]);
    });

    it('starts the accumulation at the given origin', () => {
        expect(columnOffsets([300, 500, 200], 10, -100)).toEqual([-100, 210, 720]);
    });

    it('defaults the origin to 0', () => {
        expect(columnOffsets([300, 500], 0)).toEqual([0, 300]);
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

describe('nearestInsertionIndex', () => {
    it('returns 0 when there are no other columns', () => {
        expect(nearestInsertionIndex([], [], 999)).toBe(0);
    });

    it('picks the only boundary before a single column', () => {
        // one other column at [0, 300): boundaries are [0, 300]
        expect(nearestInsertionIndex([0], [300], 50)).toBe(0);
    });

    it('picks the only boundary after a single column', () => {
        expect(nearestInsertionIndex([0], [300], 250)).toBe(1);
    });

    it('picks the closest of several boundaries', () => {
        // three columns: [0,300), [310,810), [820,1020) -> boundaries [0, 310, 820, 1020]
        const offsets = [0, 310, 820];
        const widths = [300, 500, 200];
        expect(nearestInsertionIndex(offsets, widths, 150)).toBe(0); // closer to 0 than 310
        expect(nearestInsertionIndex(offsets, widths, 200)).toBe(1); // closer to 310 than 0
        expect(nearestInsertionIndex(offsets, widths, 1000)).toBe(3); // closer to 1020 than 820
    });

    it('keeps the earlier index on an exact tie', () => {
        const offsets = [0, 310];
        const widths = [300, 200];
        // boundaries [0, 310, 510]; midpoint between 0 and 310 is 155, equidistant
        expect(nearestInsertionIndex(offsets, widths, 155)).toBe(0);
    });
});
