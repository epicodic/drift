import { describe, it, expect } from 'vitest';
import { adjacentScreenIndex, alignOffsets, currentScreenIndex, nextAlignStep } from './align-cycle';

describe('alignOffsets', () => {
    it('computes candidates for a column narrower than the screen', () => {
        expect(alignOffsets(100, 400, { left: 0, width: 1000 })).toEqual({ left: 100, center: -200, right: -500 });
    });

    it('computes candidates for a column exactly as wide as the screen', () => {
        expect(alignOffsets(50, 1000, { left: 0, width: 1000 })).toEqual({ left: 50, center: 50, right: 50 });
    });

    it('computes candidates for a column wider than the screen', () => {
        expect(alignOffsets(0, 1500, { left: 0, width: 1000 })).toEqual({ left: 0, center: 250, right: 500 });
    });

    it('accounts for a non-zero screen left, e.g. a second physical monitor', () => {
        expect(alignOffsets(1100, 400, { left: 1000, width: 1000 })).toEqual({
            left: 100,
            center: -200,
            right: -500,
        });
    });
});

describe("nextAlignStep — direction 'right'", () => {
    const offsets = { left: 0, center: 100, right: 200 };

    it('starts at left when the current offset matches none of the three', () => {
        expect(nextAlignStep('right', 999, offsets)).toEqual({ targetOffset: 0 });
    });

    it('advances from left to center', () => {
        expect(nextAlignStep('right', 0, offsets)).toEqual({ targetOffset: 100 });
    });

    it('advances from center to right', () => {
        expect(nextAlignStep('right', 100, offsets)).toEqual({ targetOffset: 200 });
    });

    it('stays at right — its own edge — instead of looping back', () => {
        expect(nextAlignStep('right', 200, offsets)).toEqual({ targetOffset: 200 });
    });

    it('tolerates sub-pixel rounding when matching the current offset', () => {
        expect(nextAlignStep('right', -0.4, offsets)).toEqual({ targetOffset: 100 });
    });
});

describe("nextAlignStep — direction 'left'", () => {
    const offsets = { left: 0, center: 100, right: 200 };

    it('starts at right when the current offset matches none of the three', () => {
        expect(nextAlignStep('left', 999, offsets)).toEqual({ targetOffset: 200 });
    });

    it('advances from right to center', () => {
        expect(nextAlignStep('left', 200, offsets)).toEqual({ targetOffset: 100 });
    });

    it('advances from center to left', () => {
        expect(nextAlignStep('left', 100, offsets)).toEqual({ targetOffset: 0 });
    });

    it('stays at left — its own edge — instead of looping back', () => {
        expect(nextAlignStep('left', 0, offsets)).toEqual({ targetOffset: 0 });
    });

    it('tolerates sub-pixel rounding when matching the current offset', () => {
        expect(nextAlignStep('left', 200.4, offsets)).toEqual({ targetOffset: 100 });
    });
});

describe('nextAlignStep — degenerate column (no room to realign)', () => {
    const offsets = { left: 50, center: 50, right: 50 };

    it('stays put, regardless of the current offset or direction', () => {
        expect(nextAlignStep('right', 50, offsets)).toEqual({ targetOffset: 50 });
        expect(nextAlignStep('right', 999, offsets)).toEqual({ targetOffset: 999 });
        expect(nextAlignStep('left', 50, offsets)).toEqual({ targetOffset: 50 });
        expect(nextAlignStep('left', 999, offsets)).toEqual({ targetOffset: 999 });
    });
});

describe('currentScreenIndex', () => {
    const screens = [
        { left: 0, width: 1000 },
        { left: 1000, width: 1000 },
    ];

    it('picks the screen whose candidate exactly matches the current offset', () => {
        // Column at rectX=1100, width=400 on the right screen: left candidate = 100.
        expect(currentScreenIndex(1100, 400, 100, screens)).toBe(1);
    });

    it('picks the nearest screen when the offset matches no candidate exactly', () => {
        // Column at rectX=100, width=400: left-screen candidates are 100/-200/-500;
        // right-screen candidates are -900/-1200/-1500. Offset 90 is closest to the
        // left screen's `left` candidate (100).
        expect(currentScreenIndex(100, 400, 90, screens)).toBe(0);
    });

    it('skips a screen the column does not fit on', () => {
        expect(currentScreenIndex(0, 1200, 0, screens)).toBeNull();
    });

    it('returns null when the column fits no screen at all', () => {
        const narrowScreens = [{ left: 0, width: 200 }];
        expect(currentScreenIndex(0, 400, 0, narrowScreens)).toBeNull();
    });

    it('breaks a distance tie toward the first eligible screen in the given order', () => {
        // rectX=100, width=400: left screen's nearest candidate is right=-500 (distance
        // 200 from offset -700); right screen's nearest candidate is left=-900 (also
        // distance 200) — an exact tie, which should resolve to the left screen (index 0).
        expect(currentScreenIndex(100, 400, -700, screens)).toBe(0);
    });
});

describe('adjacentScreenIndex', () => {
    const screens = [
        { left: 0, width: 1000 },
        { left: 1000, width: 1000 },
        { left: 2000, width: 1000 },
    ];

    it('moves to the next screen to the right', () => {
        expect(adjacentScreenIndex('right', 0, 400, screens)).toBe(1);
    });

    it('moves to the next screen to the left', () => {
        expect(adjacentScreenIndex('left', 1, 400, screens)).toBe(0);
    });

    it('wraps from the last screen to the first when crossing right', () => {
        expect(adjacentScreenIndex('right', 2, 400, screens)).toBe(0);
    });

    it('wraps from the first screen to the last when crossing left', () => {
        expect(adjacentScreenIndex('left', 0, 400, screens)).toBe(2);
    });

    it('returns null on a single-screen setup instead of wrapping to itself', () => {
        expect(adjacentScreenIndex('right', 0, 400, [{ left: 0, width: 1000 }])).toBeNull();
    });

    it('returns null when the column does not fit on the neighboring screen', () => {
        const narrowNeighbor = [
            { left: 0, width: 1000 },
            { left: 1000, width: 300 },
        ];
        expect(adjacentScreenIndex('right', 0, 400, narrowNeighbor)).toBeNull();
    });
});
