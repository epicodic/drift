import { describe, it, expect } from 'vitest';
import { columnOffsets, virtualWidth, columnRect } from './coordinates';

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
});

describe('columnRect', () => {
    it('builds a full-height rect at the given offset', () => {
        expect(columnRect(820, 200, 1080)).toEqual({ x: 820, y: 0, width: 200, height: 1080 });
    });
});
