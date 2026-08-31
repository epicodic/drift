import { describe, it, expect } from 'vitest';
import { alignOffsets, nextAlignStep } from './align-cycle';

describe('alignOffsets', () => {
    it('computes candidates for a column narrower than the viewport', () => {
        expect(alignOffsets(100, 400, 1000)).toEqual({ left: 100, center: -200, right: -500 });
    });

    it('computes candidates for a column exactly as wide as the viewport', () => {
        expect(alignOffsets(50, 1000, 1000)).toEqual({ left: 50, center: 50, right: 50 });
    });

    it('computes candidates for a column wider than the viewport', () => {
        expect(alignOffsets(0, 1500, 1000)).toEqual({ left: 0, center: 250, right: 500 });
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
