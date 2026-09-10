// Pure geometry: whether a drag's horizontal movement should pan the viewport instead of
// being left as real (reorder/stack-triggering) movement — the single mechanism shared by
// every drag, no KWin/Grid/Viewport dependency (docs: 2026-09-10-drag-viewport-pan-design).

/** Hard-threshold gate for whether this tick's horizontal drag movement should pan the
 * viewport rather than move the window's virtual position: `true` (pan) while cumulative
 * vertical drag movement (`dyTotal`) stays under `tolerancePx`, `false` (today's
 * reorder/stack behavior) once it reaches or exceeds it. A non-positive `tolerancePx`
 * always returns `false`, since `dyTotal` is never negative. */
export function dragPanShouldPan(dyTotal: number, tolerancePx: number): boolean {
    return dyTotal < tolerancePx;
}
