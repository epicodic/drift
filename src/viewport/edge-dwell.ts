// Detects the pointer dragged past a screen edge and held there, firing after a dwell period —
// used to trigger a row-flip during cross-row drag (docs: 2026-09-02-cross-row-drag-design).
// Pure and KWin-free, driven entirely by an injected clock and Timer, like Animator/ColumnMotion.

import type { EdgeDirection } from '../core/coordinates';
import type { Timer } from './animator';

export class EdgeDwell {
    private armedDirection: EdgeDirection | null = null;
    private armedAt = 0;
    /** Set to the direction just fired, and cleared only once `update` reports `null` (the
     * pointer genuinely back within bounds). Blocks re-arming for that same direction from the
     * continued same-direction reports every later drag tick still sends while the pointer
     * keeps holding past the edge, unmoved — without this, one continuous hold would flip
     * through rows every `dwellMs` instead of just once. */
    private awaitingRelease: EdgeDirection | null = null;

    constructor(
        private readonly timer: Timer,
        private readonly now: () => number,
        private readonly tickIntervalMs: number,
        private readonly dwellMs: number,
        private readonly onFire: (direction: EdgeDirection) => void,
    ) {}

    /** Reports the dragged window's current edge state. Arms the dwell timer on a new
     * direction, disarms on `null` (back within bounds), and leaves an already-armed
     * direction alone — the dwell keeps counting from when it first armed, not restarting
     * on every tick. A direction that just fired is ignored until `null` is reported first. */
    update(direction: EdgeDirection | null): void {
        if (direction === null) {
            this.awaitingRelease = null;
            this.disarm();
            return;
        }
        if (direction === this.awaitingRelease || direction === this.armedDirection) {
            return;
        }
        this.armedDirection = direction;
        this.armedAt = this.now();
        this.timer.start(this.tickIntervalMs, () => this.tick());
    }

    /** Stops the dwell timer unconditionally — used when the drag itself ends. */
    stop(): void {
        this.disarm();
    }

    private disarm(): void {
        this.armedDirection = null;
        this.timer.stop();
    }

    private tick(): void {
        if (this.armedDirection === null || this.now() - this.armedAt < this.dwellMs) {
            return;
        }
        const direction = this.armedDirection;
        this.disarm();
        this.awaitingRelease = direction; // one fire per hold: the pointer must leave and re-enter to flip again
        this.onFire(direction);
    }
}
