// Pure, KWin-free animation state for the strip-change OSD's top/bottom arcs (docs:
// 2026-09-14-strip-navigation-hints-design). Each arc is the same circular segment the drag pull
// indicator draws; its apex sweeps inward and back out while opacity rises and falls with it.
// Consumed by src/kwin/strip-osd.ts.

import { pullIndicatorCircle } from '../input/pull-indicator';
import { flashOpacity } from './focus-flash';

export interface StripOsdArc {
    /** Apex distance from the screen edge, in pixels. */
    depth: number;
    /** 0..1 envelope, rising and falling in lock-step with `depth`. */
    opacity: number;
    /** Circumcircle through both edge corners and the apex, in arc-local pixels (the chord is y = 0). */
    circle: { cx: number; cy: number; r: number };
}

/** The arc's state `elapsedMs` into a `durationMs` flash across a `width`-wide edge, or `null`
 * when nothing should be drawn (before the start, after the end, or a degenerate size). */
export function stripOsdArc(
    elapsedMs: number,
    durationMs: number,
    width: number,
    maxDepth: number,
): StripOsdArc | null {
    const opacity = flashOpacity(elapsedMs, durationMs);
    const depth = opacity * maxDepth;
    if (depth <= 0) {
        return null;
    }
    return { depth, opacity, circle: pullIndicatorCircle(width, depth) };
}
