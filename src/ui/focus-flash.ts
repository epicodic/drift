// Pure fade-in/fade-out opacity envelope for the focus-flash highlight (docs:
// 2026-09-05-focus-flash-highlight-design). KWin-free and fully unit-tested; the
// KWin-touching glue that samples this against a real clock lives in
// `kwin/focus-flash-overlay.ts`.

/** Triangular envelope: ramps 0 -> 1 over the first half of `durationMs`, then 1 -> 0 over
 * the second half. Returns 0 once `elapsedMs >= durationMs`, and 0 for a non-positive duration. */
export function flashOpacity(elapsedMs: number, durationMs: number): number {
    if (durationMs <= 0 || elapsedMs >= durationMs) {
        return 0;
    }
    const half = durationMs / 2;
    if (elapsedMs <= half) {
        return elapsedMs / half;
    }
    return 1 - (elapsedMs - half) / half;
}
