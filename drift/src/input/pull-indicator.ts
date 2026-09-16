// Pure geometry: the circumcircle a pull indicator's arc traces through, and how far along
// its own pull threshold the current pull has gotten (docs:
// 2026-09-16-drag-pull-threshold-indicator-design).

/** Circumcircle of the three points a pull indicator's arc passes through — a window's own
 * top-left/top-right corners, `(0, 0)` and `(width, 0)` in window-local coordinates, plus the
 * pull's current midpoint `(width/2, dyTotal)`. The two corners are symmetric about the vertical
 * line `x = width/2`, which the third point also sits on, so the circle's center lies on that
 * same line too — solving `|center-corner| = |center-thirdPoint|` for `cy` along it gives a
 * closed form, no iterative fit needed. Undefined at `dyTotal = 0` (the three points are
 * collinear, no circle exists) — callers must not invoke this then; `pullIndicatorAlpha` is
 * already `0` at that point, so there's nothing to render regardless. */
export function pullIndicatorCircle(width: number, dyTotal: number): { cx: number; cy: number; r: number } {
    const cx = width / 2;
    const cy = (dyTotal * dyTotal - cx * cx) / (2 * dyTotal);
    const r = Math.sqrt(cx * cx + cy * cy);
    return { cx, cy, r };
}

/** How far the current pull has gotten toward `triggerPx`, as a 0..1 fraction — the indicator's
 * outer-gradient-stop alpha multiplier. Clamped so a single fast tick that jumps past the
 * trigger can't overshoot 1. A zero trigger is treated as maxed out the instant there's any pull
 * at all, matching the mechanism's own degenerate-but-safe handling of a zero threshold. */
export function pullIndicatorAlpha(dyTotal: number, triggerPx: number): number {
    if (triggerPx <= 0) {
        return dyTotal > 0 ? 1 : 0;
    }
    return Math.min(1, Math.max(0, dyTotal / triggerPx));
}
