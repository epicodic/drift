// Pure geometry: how much of a drag's horizontal movement should be absorbed into panning
// the viewport, vs. left as real (reorder/stack-triggering) movement — the single mechanism
// shared by every drag, no KWin/Grid/Viewport dependency (docs:
// 2026-09-10-drag-viewport-pan-design).

/** Linear blend factor for how much of the dragged window's horizontal movement this tick
 * should pan the viewport rather than move the window's virtual position. 1 at `dyTotal = 0`
 * (pure pan), 0 at `dyTotal >= tolerancePx` (today's reorder/stack behavior, unchanged),
 * linear in between. A non-positive `tolerancePx` returns 0 for any `dyTotal > 0` (panning
 * effectively off) and 1 only at exactly `dyTotal = 0`. */
export function dragPanBlend(dyTotal: number, tolerancePx: number): number {
    if (tolerancePx <= 0) {
        return dyTotal <= 0 ? 1 : 0;
    }
    return Math.min(Math.max(1 - dyTotal / tolerancePx, 0), 1);
}
