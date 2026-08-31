// Smooths a column's real x position toward wherever `Grid` says it now belongs, so a
// neighbor pushed by an add/remove/resize/minimize slides instead of jumping. Pure and
// KWin-free, like `Animation`/`Animator` — driven entirely by an injected clock.

import { Animation } from './animator';

export class ColumnMotion {
    private readonly targets = new Map<number, number>();
    private readonly resting = new Map<number, number>();
    private readonly animations = new Map<number, Animation>();
    private readonly startedAt = new Map<number, number>();

    /** Call once per column per render. Returns the x to actually draw at `nowMs`.
     * The first time an id is seen, it snaps straight to `targetX` — a brand-new or
     * just-restored column appears instantly, it never animates itself in. */
    update(id: number, targetX: number, nowMs: number, durationMs: number): number {
        if (!this.targets.has(id)) {
            this.snapTo(id, targetX);
            return targetX;
        }
        if (this.targets.get(id) !== targetX) {
            const from = this.currentValue(id, nowMs);
            this.targets.set(id, targetX);
            this.animations.set(id, new Animation(from, targetX, durationMs));
            this.startedAt.set(id, nowMs);
        }
        return this.currentValue(id, nowMs);
    }

    /** Forces column `id` to rest at `x` immediately, cancelling any in-flight
     * animation. Used for columns that must track their logical position with zero
     * lag (e.g. a live interactive resize's neighbors). */
    snapTo(id: number, x: number): void {
        this.targets.set(id, x);
        this.resting.set(id, x);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    /** Drops all tracked state for a column id, so a later reappearance (e.g.
     * un-minimizing, or returning from fullscreen) is treated as brand new and snaps
     * instead of animating from a stale pre-hide position. */
    forget(id: number): void {
        this.targets.delete(id);
        this.resting.delete(id);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    isAnimating(): boolean {
        return this.animations.size > 0;
    }

    private currentValue(id: number, nowMs: number): number {
        const animation = this.animations.get(id);
        if (!animation) {
            return this.resting.get(id) as number;
        }
        const elapsed = nowMs - (this.startedAt.get(id) as number);
        const value = animation.valueAt(elapsed);
        if (animation.isComplete(elapsed)) {
            this.animations.delete(id);
            this.startedAt.delete(id);
            this.resting.set(id, value);
        }
        return value;
    }
}
