import { describe, expect, it } from 'vitest';
import { ColumnMotion } from './column-motion';

describe('ColumnMotion', () => {
    it('snaps to the target the first time an id is seen (no animation)', () => {
        const motion = new ColumnMotion();

        const value = motion.update(1, 500, 0, 200);

        expect(value).toBe(500);
        expect(motion.isAnimating()).toBe(false);
    });

    it('animates toward a new target when it changes', () => {
        const motion = new ColumnMotion();
        motion.update(1, 500, 0, 200); // establishes resting at 500

        const value = motion.update(1, 900, 1000, 200);

        expect(value).toBe(500); // valueAt(elapsed=0) === "from"
        expect(motion.isAnimating()).toBe(true);
    });

    it('interpolates partway through the animation', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animate 0 -> 100 over 200ms, started at t=0

        const value = motion.update(1, 100, 100, 200); // same target, 100ms later

        expect(value).toBeCloseTo(87.5); // easeOutCubic(0.5) = 0.875
    });

    it('settles exactly at the target once the duration has elapsed, and stops animating', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200);

        const value = motion.update(1, 100, 200, 200);

        expect(value).toBe(100);
        expect(motion.isAnimating()).toBe(false);
    });

    it('retargets from the current interpolated value, not the old target, when the target changes mid-flight', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating 0 -> 100
        motion.update(1, 100, 100, 200); // now at ~87.5, still mid-flight

        const value = motion.update(1, 200, 100, 200); // retarget to 200, starting now

        expect(value).toBeCloseTo(87.5); // valueAt(0) of the new animation === its "from"
    });

    it('snapTo cancels any in-flight animation and rests at the given value immediately', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating

        motion.snapTo(1, 250);

        expect(motion.isAnimating()).toBe(false);
        expect(motion.update(1, 250, 100, 200)).toBe(250); // same target: rests, no animation
    });

    it('forget makes a later update treat the id as brand new (snaps instead of animating)', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating 0 -> 100

        motion.forget(1);
        const value = motion.update(1, 999, 50, 200);

        expect(value).toBe(999);
        expect(motion.isAnimating()).toBe(false);
    });

    it('collapses to the target immediately with a zero duration', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);

        const value = motion.update(1, 500, 0, 0);

        expect(value).toBe(500);
        expect(motion.isAnimating()).toBe(false);
    });

    it('tracks multiple columns independently', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(2, 1000, 0, 200);

        motion.update(1, 100, 0, 200); // only column 1 retargets

        expect(motion.isAnimating()).toBe(true);
        expect(motion.update(2, 1000, 100, 200)).toBe(1000); // column 2 untouched, still resting
    });
});
