import { describe, expect, it } from 'vitest';
import { pullIndicatorAlpha, pullIndicatorCircle } from './pull-indicator';

describe('pullIndicatorCircle', () => {
    it('centers on the vertical midline of the window', () => {
        const { cx } = pullIndicatorCircle(200, 20);
        expect(cx).toBe(100);
    });

    it('places both top corners and the pull midpoint on the resulting circle', () => {
        const width = 200;
        const dyTotal = 20;
        const { cx, cy, r } = pullIndicatorCircle(width, dyTotal);
        const distanceTo = (x: number, y: number): number => Math.hypot(x - cx, y - cy);
        expect(distanceTo(0, 0)).toBeCloseTo(r, 6);
        expect(distanceTo(width, 0)).toBeCloseTo(r, 6);
        expect(distanceTo(width / 2, dyTotal)).toBeCloseTo(r, 6);
    });

    it('produces a much larger radius for a shallow pull than a deep one, at the same width', () => {
        const shallow = pullIndicatorCircle(200, 2);
        const deep = pullIndicatorCircle(200, 60);
        expect(shallow.r).toBeGreaterThan(deep.r);
    });
});

describe('pullIndicatorAlpha', () => {
    it('is 0 at no pull', () => {
        expect(pullIndicatorAlpha(0, 20)).toBe(0);
    });

    it('is 0.5 at half the trigger', () => {
        expect(pullIndicatorAlpha(10, 20)).toBe(0.5);
    });

    it('is 1 exactly at the trigger', () => {
        expect(pullIndicatorAlpha(20, 20)).toBe(1);
    });

    it('clamps to 1 past the trigger, never overshooting', () => {
        expect(pullIndicatorAlpha(50, 20)).toBe(1);
    });

    it('treats a zero trigger as immediately maxed once there is any pull at all', () => {
        expect(pullIndicatorAlpha(1, 0)).toBe(1);
        expect(pullIndicatorAlpha(0, 0)).toBe(0);
    });
});
