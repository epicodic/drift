// Pure, KWin-free geometry for the strip-change OSD's chevron frame (docs:
// 2026-09-14-strip-navigation-hints-design; ratios traced from drift_mock2.svg's actual path
// data, not eyeballed — see that design doc's OSD-redesign addendum for the derivation).
//
// A 9-slice model: corner geometry (tip, taper, and the left/right-only notch) is fixed-size
// regardless of screen resolution; only the flat run between the two corners on each edge
// stretches to fill the remaining length. Consumed by src/kwin/strip-osd.ts.

export interface Point {
    x: number;
    y: number;
}

export interface ChevronFrame {
    top: Point[];
    bottom: Point[];
    left: Point[];
    right: Point[];
}

/** Ratios against the source SVG's own top-bar thickness (27.769909), so `tipInset`/`flareRun`
 * scale correctly for any target `thickness`. */
const TIP_INSET_RATIO = 25.41 / 27.769909;
const FLARE_RUN_RATIO = 63.04688 / 27.769909;

/** The left bar's corner unit (tip at the origin, y increasing along the edge toward the
 * notch), scaled against the source SVG's own left-bar thickness (43.97624). Each row becomes
 * one named point in `chevronFramePoints` below. */
const NOTCH_SOURCE_THICKNESS = 43.97624;
const NOTCH_UNIT_RAW: ReadonlyArray<readonly [number, number]> = [
    [0, 0], // tip: the corner's outermost point, at the origin
    [43.97624, 44.15056], // flareVertex: where the outward flare/taper ends
    [44.07536, 122.731517], // notchStart: where the notch's outer step begins
    [29.53841, 133.991333], // notchInner: where the notch steps inward to meet the flat run
];

/** Computes the four chevron-frame bars for a `width`×`height` screen, at a given `thickness`.
 * Corner geometry depends only on `thickness`; the flat run between corners on each bar
 * stretches with `width`/`height`.
 *
 * Assumes `width`/`height` are large relative to `thickness` — specifically, that
 * `2 * (tipInset + flareRun)` does not exceed `width`, and the notch's vertical extent does not
 * exceed `height`. No runtime guard: a degenerate tiny rect silently produces a
 * self-intersecting/inverted polygon. */
export function chevronFramePoints(width: number, height: number, thickness: number): ChevronFrame {
    const tipInset = thickness * TIP_INSET_RATIO;
    const flareRun = thickness * FLARE_RUN_RATIO;
    const top: Point[] = [
        { x: tipInset, y: 0 },
        { x: tipInset + flareRun, y: thickness },
        { x: width - tipInset - flareRun, y: thickness },
        { x: width - tipInset, y: 0 },
    ];
    const bottom: Point[] = top.map((p) => ({ x: p.x, y: height - p.y }));

    const k = thickness / NOTCH_SOURCE_THICKNESS;
    const [tipRaw, flareVertexRaw, notchStartRaw, notchInnerRaw] = NOTCH_UNIT_RAW;
    const scale = ([x, y]: readonly [number, number]): Point => ({ x: x * k, y: y * k });
    const tip = scale(tipRaw);
    const flareVertex = scale(flareVertexRaw);
    const notchStart = scale(notchStartRaw);
    const notchInner = scale(notchInnerRaw);
    const unit: Point[] = [tip, flareVertex, notchStart, notchInner];
    const mirrored: Point[] = unit
        .slice()
        .reverse()
        .map((p) => ({ x: p.x, y: height - p.y }));
    const left: Point[] = unit.concat(mirrored);
    const right: Point[] = left.map((p) => ({ x: width - p.x, y: p.y }));

    return { top, bottom, left, right };
}
