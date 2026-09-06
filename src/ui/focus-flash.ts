// Pure fade-in/fade-out opacity envelope for the focus-flash highlight (docs:
// 2026-09-05-focus-flash-highlight-design). KWin-free and fully unit-tested; the
// KWin-touching glue that samples this against a real clock lives in
// `kwin/focus-flash-overlay.ts`.

/** Sinusoidal envelope (first quadrant): ramps 0 -> 1 smoothly using sin(θ) where
 * θ ∈ [0, π/2]. Returns 0 once `elapsedMs > durationMs`, and 0 for a non-positive duration. */
export function flashOpacity(elapsedMs: number, durationMs: number): number {
    if (durationMs <= 0 || elapsedMs > durationMs) {
        return 0;
    }
    const progress = elapsedMs / durationMs;
    return Math.sin(progress * Math.PI);
}
