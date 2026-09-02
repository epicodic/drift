// Detects a window dragged past a screen edge and held there, firing after a dwell period —
// used to trigger a row-flip during cross-row drag (docs: 2026-09-02-cross-row-drag-design).
// Pure and KWin-free, driven entirely by an injected clock and Timer, like Animator/ColumnMotion.

import type { EdgeDirection } from '../core/coordinates';
import type { Timer } from './animator';

export class EdgeDwell {
    private armedDirection: EdgeDirection | null = null;
    private armedAt = 0;

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
     * on every tick. */
    update(direction: EdgeDirection | null): void {
        if (direction === this.armedDirection) {
            return;
        }
        if (direction === null) {
            this.disarm();
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
        this.armedAt = this.now(); // re-arm: a window held past the edge keeps flipping
        this.onFire(direction);
    }
}
