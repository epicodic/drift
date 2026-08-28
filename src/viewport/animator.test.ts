import { describe, it, expect } from 'vitest';
import { Animation, Animator, easeOutCubic, Timer } from './animator';

describe('easeOutCubic', () => {
    it('is pinned at both ends', () => {
        expect(easeOutCubic(0)).toBe(0);
        expect(easeOutCubic(1)).toBe(1);
    });

    it('is ahead of linear in the middle (fast start, slow end)', () => {
        expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    });
});

describe('Animation', () => {
    it('returns the start value at elapsed 0', () => {
        expect(new Animation(0, 100, 200).valueAt(0)).toBe(0);
    });

    it('returns the end value at the full duration', () => {
        expect(new Animation(0, 100, 200).valueAt(200)).toBe(100);
    });

    it('applies the easing curve between the endpoints', () => {
        // easeOutCubic(0.5) = 0.875 → 0 + 0.875 * 100
        expect(new Animation(0, 100, 200).valueAt(100)).toBeCloseTo(87.5);
    });

    it('supports a custom (linear) easing', () => {
        const linear = new Animation(0, 100, 200, (t) => t);
        expect(linear.valueAt(100)).toBe(50);
    });

    it('completes at or after the duration', () => {
        const animation = new Animation(0, 100, 200);
        expect(animation.isComplete(199)).toBe(false);
        expect(animation.isComplete(200)).toBe(true);
        expect(animation.isComplete(500)).toBe(true);
    });

    it('collapses a zero-duration animation to the end value', () => {
        expect(new Animation(0, 100, 0).valueAt(0)).toBe(100);
    });
});

class FakeTimer implements Timer {
    started = false;
    stopped = false;
    intervalMs = 0;
    private onTick: (() => void) | null = null;

    start(intervalMs: number, onTick: () => void): void {
        this.started = true;
        this.stopped = false;
        this.intervalMs = intervalMs;
        this.onTick = onTick;
    }

    stop(): void {
        this.stopped = true;
        this.onTick = null;
    }

    fire(): void {
        if (this.onTick) {
            this.onTick();
        }
    }
}

describe('Animator', () => {
    it('drives interpolated updates over time and finishes on the end value', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const updates: number[] = [];
        const animator = new Animator(
            timer,
            () => clock,
            16,
            (value) => updates.push(value),
        );

        animator.animate(0, 100, 200);
        expect(timer.started).toBe(true);
        expect(animator.isAnimating()).toBe(true);

        clock = 100;
        timer.fire();
        expect(updates[updates.length - 1]).toBeCloseTo(87.5);
        expect(animator.isAnimating()).toBe(true);

        clock = 200;
        timer.fire();
        expect(updates[updates.length - 1]).toBe(100);
        expect(animator.isAnimating()).toBe(false);
        expect(timer.stopped).toBe(true);
    });

    it('cancels without updating when start equals end', () => {
        const timer = new FakeTimer();
        const updates: number[] = [];
        const animator = new Animator(
            timer,
            () => 0,
            16,
            (value) => updates.push(value),
        );

        animator.animate(50, 50, 200);
        expect(timer.started).toBe(false);
        expect(updates).toEqual([]);
        expect(animator.isAnimating()).toBe(false);
    });

    it('does not update when an animation target is already at the current value', () => {
        const timer = new FakeTimer();
        const updates: number[] = [];
        const animator = new Animator(
            timer,
            () => 0,
            16,
            (value) => updates.push(value),
        );

        animator.animate(200, 200, 200);

        expect(timer.started).toBe(false);
        expect(updates).toEqual([]);
        expect(animator.isAnimating()).toBe(false);
    });
});
