// Pure geometry: whether a drag's current vertical pull and horizontal drift still qualify as
// "holding" for the dwell-to-free gesture — the single mechanism shared by every drag, no
// KWin/Grid/Viewport dependency (docs: 2026-09-12-drag-pan-dwell-design).

/** Whether this tick's cumulative vertical pull and horizontal drift-since-hold-started still
 * qualify as "holding" for the dwell-to-free gesture: true once `dyTotal` has crossed
 * `triggerPx`, as long as drift stays within `tolerancePx`. `driftSinceHoldStartPx` is 0 for
 * the tick that first arms the hold — there's no prior anchor yet to drift from. */
export function dragPanHolding(
    dyTotal: number,
    driftSinceHoldStartPx: number,
    triggerPx: number,
    tolerancePx: number,
): boolean {
    return dyTotal >= triggerPx && Math.abs(driftSinceHoldStartPx) <= tolerancePx;
}
