// Pure, KWin-free per-strip identity: a permanent label and color derived from a strip's
// signed `stripIndex` (docs: 2026-09-14-strip-navigation-hints-design). Consumed by both the
// minimap (src/ui/minimap.ts) and the strip-change OSD (src/kwin/strip-osd.ts), so the two
// surfaces always agree.

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;
const STRIP_COLOR_SATURATION = 0.65;
const STRIP_COLOR_VALUE = 0.9;

/** Permanent label for a strip. Digits count upward from home (`stripIndex <= 0`): `0` is
 * `"1"`, `-1` is `"2"`, and so on. Letters count downward from home (`stripIndex > 0`): `1`
 * is `"A"`, `26` is `"Z"`, `27` is `"AA"`, spreadsheet-column style beyond 26. */
export function stripLabel(stripIndex: number): string {
    if (stripIndex <= 0) {
        return String(1 - stripIndex);
    }
    return toBase26Letters(stripIndex);
}

function toBase26Letters(n: number): string {
    let letters = '';
    let value = n;
    while (value > 0) {
        const remainder = (value - 1) % 26;
        letters = String.fromCharCode(65 + remainder) + letters;
        value = Math.floor((value - 1) / 26);
    }
    return letters;
}

/** HSV hue in [0, 1) for a strip, spread via golden-ratio-conjugate stepping so adjacent and
 * distant strips alike stay visually distinct. Works for negative indices too. */
export function stripHue(stripIndex: number): number {
    const raw = stripIndex * GOLDEN_RATIO_CONJUGATE;
    return ((raw % 1) + 1) % 1;
}

export interface StripColor {
    r: number;
    g: number;
    b: number;
}

/** Converts a strip's hue into RGB (each channel in [0, 1]), at fixed saturation/value chosen
 * for visibility against both light and dark desktop backgrounds. */
export function stripColor(hue: number): StripColor {
    const h = hue * 6;
    const chroma = STRIP_COLOR_VALUE * STRIP_COLOR_SATURATION;
    const x = chroma * (1 - Math.abs((h % 2) - 1));
    const m = STRIP_COLOR_VALUE - chroma;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 1) {
        r = chroma;
        g = x;
    } else if (h < 2) {
        r = x;
        g = chroma;
    } else if (h < 3) {
        g = chroma;
        b = x;
    } else if (h < 4) {
        g = x;
        b = chroma;
    } else if (h < 5) {
        r = x;
        b = chroma;
    } else {
        r = chroma;
        b = x;
    }
    return { r: r + m, g: g + m, b: b + m };
}
