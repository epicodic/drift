# Strip navigation hints — design

## Purpose

Give the user a stable, at-a-glance way to identify which strip they are on and how it relates to neighboring strips.
Two ideas prompted this: a per-strip label and a per-strip color, both surfaced on the minimap and via a dedicated OSD.

## Requirements

- Every strip gets a permanent label and a permanent color, assigned once and never reassigned while the strip lives.
- Strips upward from home (`stripUp`, `stripIndex <= 0`) are labeled with digits: `stripIndex === 0` is `"1"`, `stripIndex === -1` is `"2"`, `stripIndex === -2` is `"3"`, and so on.
- Strips downward from home (`stripDown`, `stripIndex > 0`) are labeled with letters: `"A", "B", "C", …, "Z", "AA", "AB", …`.
- Every strip, including the home strip, also gets a color: an HSV hue derived from `stripIndex` via golden-ratio-conjugate stepping, so hues stay maximally spread apart regardless of how many strips exist or in which direction.
- The minimap shows every currently-existing strip's label and color alongside its row.
- A new, separate OSD appears whenever the active strip actually changes (not on left/right column navigation within a strip). It shows the new active strip's label as a large badge and tints a glow around the whole screen edge in that strip's color.
- Both surfaces derive label and color from the same pure functions, so they always agree.

## Numbering and color scheme

New module: `drift/src/ui/strip-identity.ts`, pure and KWin-free, mirroring `minimap.ts`.

```ts
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

/** Permanent label for a strip. Digits count upward from home (`stripIndex <= 0`); letters
 * count downward from home (`stripIndex > 0`), spreadsheet-column style beyond 26. */
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

/** HSV hue in [0, 1) for a strip, spread via golden-ratio-conjugate stepping so adjacent
 * and distant strips alike stay visually distinct. Works for negative indices too. */
export function stripHue(stripIndex: number): number {
    const raw = stripIndex * GOLDEN_RATIO_CONJUGATE;
    return ((raw % 1) + 1) % 1;
}
```

Saturation and value are fixed constants, tuned at implementation time for visibility against both light and dark desktop backgrounds.
Their exact values are not decided in this document.

A third pure function, `stripColor(hue: number): { r: number; g: number; b: number }`, converts a hue into RGB (each channel in `[0, 1]`, ready for `Qt.rgba()`) at those fixed saturation/value constants.
Both the minimap chip and the OSD glow call this instead of each re-implementing HSV-to-RGB conversion in QML.

## Minimap changes

### `src/ui/minimap.ts`

`MinimapStrip` gains two fields, computed once per strip inside `combineStripStackSnapshot`:

```ts
export interface MinimapStrip {
    stripIndex: number;
    label: string;
    hue: number;
    columns: MinimapColumn[];
}
```

### `src/kwin/minimap-overlay.ts` and QML

The per-strip row delegate gains a small label chip, positioned at the row's left edge, showing `modelData.label` on a background tinted from `modelData.hue`.
No layout/scale math changes are needed — the chip sits within the existing row height.

## OSD (new)

### `src/kwin/strip-osd.ts`

New thin overlay class, `StripOsd`, following the exact same shape as `focus-flash-overlay.ts`: a `PlasmaCore.Dialog` built from an inline QML template string (`STRIP_OSD_QML`, the sibling of `FOCUS_FLASH_QML`/`MINIMAP_QML`) via `Qt.createQmlObject`, no separate `.qml` file — `drift/ui/` only holds `main.qml` and `config.ui`, never per-overlay dialogs.
It drives a fading `opacity` off a timer using the existing `flashOpacity` curve from `src/ui/focus-flash.ts`, rather than a flat auto-hide.
It exposes `show(label: string, hue: number, screenGeometry: Rect)`.

Reuses the existing `drift/shaders/focus_glow.frag` shader for the inward screen-edge glow — the same shader `focus-flash-overlay.ts` already uses to hug a window's frame — via a `ShaderEffect` with the same uniform set (`glowColor`, `itemSize`, `glow`, `sharpness`, `bleed`).
The only difference from the focus-flash usage is what the effect is sized to: the active screen's geometry instead of a window's frame, so the glow hugs the screen edge inward rather than a window's border.
`glowColor` comes from `stripHue(afterIndex)` converted to an RGBA color (fixed saturation/value, decided at implementation time) instead of `Kirigami.Theme.highlightColor`.
A large centered `Text` badge (the label, tinted by the same color) is layered on top of the same dialog, fading with it.
Since `focus_glow.frag` is already compiled by the Makefile's `shaders` target, no build wiring changes — Drift builds only that one shader file today, and this reuses it as-is.
Untested at the unit level, consistent with `minimap-overlay.ts`'s and `focus-flash-overlay.ts`'s own untested status — none of the three is exercisable without a live compositor.

### `src/runtime/strip-stack.ts`

New public getter:

```ts
activeIndex(): number {
    return this.activeStripIndex;
}
```

### `src/runtime/controller.ts`

`focusAndShowMinimap` gains a before/after comparison and triggers the OSD only when the active strip actually changed:

```ts
private focusAndShowMinimap(move: (stack: StripStack) => void): void {
    const stack = this.stripManager.activeStripStack();
    const beforeIndex = stack.activeIndex();
    move(stack);
    const afterIndex = stack.activeIndex();
    const snapshot = stack.minimapSnapshot();
    this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    if (afterIndex !== beforeIndex) {
        this.stripOsd.show(stripLabel(afterIndex), stripHue(afterIndex), this.workspaceAdapter.screenGeometryAtCursor());
    }
}
```

This reuses the single existing chokepoint through which every strip-changing action (`stripUp`, `stripDown`, `moveColumnToStripAbove`, `moveColumnToStripBelow`, `moveWindowToStripAbove`, `moveWindowToStripBelow`) already passes.
No new keybinding wiring is needed.

## Settings

New entries in `src/config/settings-definitions.ts`:

- `stripHintsEnabled` (`Bool`, default `true`) — master toggle for the minimap's per-strip label/color chips.
- `stripOsdEnabled` (`Bool`, default `true`) — master toggle for the OSD (label badge + glow together), independent of `stripHintsEnabled`.
- `stripOsdDurationMs` (`UInt`, default `500`) — total fade duration, mirroring `focusFlashDurationMs` and plugged into the same `flashOpacity` curve.
- `stripOsdGlowOpacity` (`Double`, default `0.5`) — peak opacity of the glow, mirroring `focusFlashOpacity`.

## Testing

- `src/ui/strip-identity.test.ts`: `stripLabel` boundary cases (`0` → `"1"`, `-1` → `"2"`, `1` → `"A"`, `26` → `"Z"`, `27` → `"AA"`); `stripHue` stays within `[0, 1)` for both positive and negative indices and matches the golden-ratio formula.
- `src/ui/minimap.test.ts`: `combineStripStackSnapshot` sets `label`/`hue` per strip matching `strip-identity.ts`.
- `src/runtime/strip-stack.test.ts`: new `activeIndex()` getter reflects `0` initially and tracks `stripUp`/`stripDown`/`switchToStrip` correctly — this is the piece `Controller` will diff before/after to decide whether to show the OSD.
- `src/runtime/controller.ts` itself has no test file today (no KWin-glue orchestration file in this codebase does — it's untestable without a live compositor/workspace). The before/after `activeIndex()` diff added to `focusAndShowMinimap` stays untested glue, consistent with the rest of `Controller`.
- `src/kwin/strip-osd.ts` stays untested, consistent with `minimap-overlay.ts` and `focus-flash-overlay.ts`'s existing approach. The fade curve itself needs no new tests — it reuses the already-tested `flashOpacity` from `src/ui/focus-flash.ts`.

## Explicitly out of scope

- Any "jump directly to strip `<label>`" keybinding — this iteration is orientation-only, per explicit requirement.
- Colorblind-safe palette tuning or configurable saturation/value — deferred to implementation.
- A pruned-and-recreated strip is expected to get the same label and color as before, since both are deterministic functions of `stripIndex` — this is intended, not a bug to guard against.
- Localizing the letter sequence (always Latin `A`–`Z`).
