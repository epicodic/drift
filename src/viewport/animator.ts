// Timer-driven smooth-scroll animation — the actual subject of the spike (docs §7.3).
// `Animation` is pure eased interpolation. `Animator` samples it against a real
// clock through an injected `Timer`, so it uses wall-clock elapsed time (skipping
// frames under load) rather than assuming ticks arrive on schedule. The concrete
// KWin timer is wired in at integration time (docs §6.2); everything here is testable.

export type Easing = (t: number) => number;

/** Ease-out cubic: fast start, gentle settle — keeps the viewport's mental map. */
export function easeOutCubic(t: number): number {
    const remaining = 1 - t;
    return 1 - remaining * remaining * remaining;
}

export class Animation {
    constructor(
        private readonly from: number,
        private readonly to: number,
        private readonly durationMs: number,
        private readonly easing: Easing = easeOutCubic,
    ) {}

    valueAt(elapsedMs: number): number {
        if (this.durationMs <= 0) {
            return this.to;
        }
        const progress = Math.min(Math.max(elapsedMs / this.durationMs, 0), 1);
        return this.from + (this.to - this.from) * this.easing(progress);
    }

    isComplete(elapsedMs: number): boolean {
        return elapsedMs >= this.durationMs;
    }
}

/** Abstraction over a repeating timer, so the animator stays independent of KWin. */
export interface Timer {
    start(intervalMs: number, onTick: () => void): void;
    stop(): void;
}

export class Animator {
    private animation: Animation | null = null;
    private startedAt = 0;

    constructor(
        private readonly timer: Timer,
        private readonly now: () => number,
        private readonly intervalMs: number,
        private readonly onUpdate: (value: number) => void,
    ) {}

    isAnimating(): boolean {
        return this.animation !== null;
    }

    animate(from: number, to: number, durationMs: number): void {
        if (from === to || durationMs <= 0) {
            this.finish(to);
            return;
        }
        this.animation = new Animation(from, to, durationMs);
        this.startedAt = this.now();
        this.timer.start(this.intervalMs, () => this.tick());
    }

    private tick(): void {
        if (this.animation === null) {
            return;
        }
        const elapsed = this.now() - this.startedAt;
        if (this.animation.isComplete(elapsed)) {
            this.finish(this.animation.valueAt(elapsed));
            return;
        }
        this.onUpdate(this.animation.valueAt(elapsed));
    }

    private finish(value: number): void {
        this.animation = null;
        this.timer.stop();
        this.onUpdate(value);
    }
}
