// Smooths a value toward wherever it should now rest, keyed by an arbitrary id — used both for
// a column's real x (reorder/layout changes, keyed by column id) and a tile's real y/height
// (stack changes, keyed by window id), so neighbors slide instead of jumping. Pure and
// KWin-free, driven entirely by an injected clock, like `Animation`/`Animator`.

import { Animation } from './animator';

export class AxisMotion<K> {
    private readonly targets = new Map<K, number>();
    private readonly resting = new Map<K, number>();
    private readonly animations = new Map<K, Animation>();
    private readonly startedAt = new Map<K, number>();

    /** Call once per id per render. Returns the value to actually draw at `nowMs`.
     * The first time an id is seen, it snaps straight to `target` — a brand-new or
     * just-restored id appears instantly, it never animates itself in. */
    update(id: K, target: number, nowMs: number, durationMs: number): number {
        if (!this.targets.has(id)) {
            this.snapTo(id, target);
            return target;
        }
        if (this.targets.get(id) !== target) {
            const from = this.currentValue(id, nowMs);
            this.targets.set(id, target);
            this.animations.set(id, new Animation(from, target, durationMs));
            this.startedAt.set(id, nowMs);
        }
        return this.currentValue(id, nowMs);
    }

    /** Forces `id` to rest at `value` immediately, cancelling any in-flight animation.
     * Used both to keep something tracking its logical value with zero lag (e.g. a live
     * interactive resize's neighbors), and to seed the *starting point* of a fresh
     * animation before the next `update()` call retargets it. */
    snapTo(id: K, value: number): void {
        this.targets.set(id, value);
        this.resting.set(id, value);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    /** Drops all tracked state for an id, so a later reappearance is treated as brand
     * new and snaps instead of animating from a stale pre-hide value. */
    forget(id: K): void {
        this.targets.delete(id);
        this.resting.delete(id);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    isAnimating(): boolean {
        return this.animations.size > 0;
    }

    private currentValue(id: K, nowMs: number): number {
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
