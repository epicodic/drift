import { describe, expect, it } from 'vitest';
import { chevronFramePoints } from './chevron-frame';

const TIP_INSET_RATIO = 25.41 / 27.769909;
const FLARE_RUN_RATIO = 63.04688 / 27.769909;

describe('chevronFramePoints', () => {
    it('places the top bar tips at the tip-inset ratio times thickness, at y=0', () => {
        const { top } = chevronFramePoints(400, 250, 18);
        expect(top[0]).toEqual({ x: 18 * TIP_INSET_RATIO, y: 0 });
        expect(top[3].y).toBe(0);
        expect(top[3].x).toBeCloseTo(400 - 18 * TIP_INSET_RATIO, 5);
    });

    it('places the top bar flare vertices at thickness depth', () => {
        const { top } = chevronFramePoints(400, 250, 18);
        expect(top[1].y).toBe(18);
        expect(top[2].y).toBe(18);
        expect(top[1].x).toBeCloseTo(18 * TIP_INSET_RATIO + 18 * FLARE_RUN_RATIO, 5);
    });

    it('mirrors the bottom bar from the top bar vertically', () => {
        const { top, bottom } = chevronFramePoints(400, 250, 18);
        for (let i = 0; i < top.length; i += 1) {
            expect(bottom[i].x).toBeCloseTo(top[i].x, 5);
            expect(bottom[i].y).toBeCloseTo(250 - top[i].y, 5);
        }
    });

    it('gives the left bar 8 points: tip, flare, notch-in, flat run, notch-out, flare, tip', () => {
        const { left } = chevronFramePoints(400, 250, 18);
        expect(left).toHaveLength(8);
        expect(left[0]).toEqual({ x: 0, y: 0 });
        expect(left[7]).toEqual({ x: 0, y: 250 });
    });

    it('mirrors the right bar from the left bar horizontally', () => {
        const { left, right } = chevronFramePoints(400, 250, 18);
        for (let i = 0; i < left.length; i += 1) {
            expect(right[i].x).toBeCloseTo(400 - left[i].x, 5);
            expect(right[i].y).toBeCloseTo(left[i].y, 5);
        }
    });

    it('keeps corner geometry identical across different screen sizes — only the flat run changes', () => {
        const small = chevronFramePoints(1600, 900, 18);
        const large = chevronFramePoints(3840, 2160, 18);
        // The first two points of `top` (left tip + left flare vertex) depend only on
        // thickness, not on width/height — they must match exactly.
        expect(small.top[0]).toEqual(large.top[0]);
        expect(small.top[1]).toEqual(large.top[1]);
        // The left bar's TOP corner unit (its first 4 points: tip down to the notch) is
        // anchored to y=0 and depends only on thickness, so it must match exactly regardless
        // of height. The last 4 points are mirrored from the bottom (anchored to y=height
        // instead), so they necessarily differ between a 900px-tall and 2160px-tall screen —
        // only the top unit is asserted here.
        expect(small.left.slice(0, 4)).toEqual(large.left.slice(0, 4));
        // But the top bar's right-side points (which depend on width) must differ between sizes.
        expect(small.top[2]).not.toEqual(large.top[2]);
    });

    it('scales the notch geometry with thickness', () => {
        const thin = chevronFramePoints(400, 250, 9);
        const thick = chevronFramePoints(400, 250, 18);
        expect(thick.left[1].x).toBeCloseTo(thin.left[1].x * 2, 5);
        expect(thick.left[1].y).toBeCloseTo(thin.left[1].y * 2, 5);
    });
});
