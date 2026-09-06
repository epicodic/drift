// A `Strip` only gets one real KWin-provided `Timer`, but the camera pan (`Animator`)
// and column-position smoothing (`ColumnMotion`) are independent concerns that may both
// need to tick at once. `SharedTicker` hands out independent Timer-shaped handles: the
// real timer starts once any handle is active, and stops only once every handle has
// stopped.

import type { Timer } from './animator';

/** Internal render-tick rate driving every `SharedTicker`/`Animator`/`EdgeDwell` in the
 * codebase — an implementation detail (~60fps), not user-tunable behavior, so it lives here
 * as a constant rather than in `Settings` (docs/agents/specs/2026-09-06-settings-consolidation-design.md). */
export const ANIMATION_TICK_MS = 16;

export class SharedTicker {
    private readonly callbacks = new Map<number, () => void>();
    private nextId = 1;

    constructor(
        private readonly timer: Timer,
        private readonly intervalMs: number,
    ) {}

    subscribe(): Timer {
        const id = this.nextId++;
        return {
            start: (_intervalMs, onTick) => {
                const isFirstActiveSubscriber = this.callbacks.size === 0;
                this.callbacks.set(id, onTick);
                if (isFirstActiveSubscriber) {
                    this.timer.start(this.intervalMs, () => {
                        for (const callback of this.callbacks.values()) {
                            callback();
                        }
                    });
                }
            },
            stop: () => {
                this.callbacks.delete(id);
                if (this.callbacks.size === 0) {
                    this.timer.stop();
                }
            },
        };
    }
}
