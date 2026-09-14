# Strip Navigation Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every strip a permanent label (digits upward from home, letters downward) and a permanent golden-ratio-spread color, shown as a chip on the minimap and as a full-screen glow + badge OSD whenever the active strip changes, per [`docs/agents/specs/2026-09-14-strip-navigation-hints-design.md`](../specs/2026-09-14-strip-navigation-hints-design.md).

**Architecture:** A new pure module, `src/ui/strip-identity.ts`, derives a strip's label/hue/color from its existing signed `stripIndex` — no new identity state. `src/ui/minimap.ts` and `src/kwin/minimap-overlay.ts` thread `label`/`hue`/`color` through the existing minimap snapshot/render pipeline as a chip per strip row. A new `src/kwin/strip-osd.ts` overlay reuses the existing `drift/shaders/focus_glow.frag` shader (already used by `focus-flash-overlay.ts`) to draw a full-screen inward glow plus a large label badge, triggered from `Controller.focusAndShowMinimap` whenever `StripStack.activeIndex()` actually changes.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## Task 1: `strip-identity.ts` — permanent label, hue, and color

**Files:**
- Create: `drift/src/ui/strip-identity.ts`
- Test: `drift/src/ui/strip-identity.test.ts`

This is the foundational pure module every other task builds on: `stripLabel`, `stripHue`, and `stripColor`, all pure functions of a strip's signed `stripIndex`.

- [ ] **Step 1: Write the failing tests**

Create `drift/src/ui/strip-identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stripColor, stripHue, stripLabel } from './strip-identity';

describe('stripLabel', () => {
    it('labels the home strip (index 0) "1"', () => {
        expect(stripLabel(0)).toBe('1');
    });

    it('labels strips upward from home with digits counting from 1', () => {
        expect(stripLabel(-1)).toBe('2');
        expect(stripLabel(-2)).toBe('3');
        expect(stripLabel(-9)).toBe('10');
    });

    it('labels strips downward from home with letters starting at A', () => {
        expect(stripLabel(1)).toBe('A');
        expect(stripLabel(2)).toBe('B');
        expect(stripLabel(26)).toBe('Z');
    });

    it('continues the letter sequence spreadsheet-column style past Z', () => {
        expect(stripLabel(27)).toBe('AA');
        expect(stripLabel(28)).toBe('AB');
        expect(stripLabel(52)).toBe('AZ');
        expect(stripLabel(53)).toBe('BA');
    });
});

describe('stripHue', () => {
    it('returns 0 for the home strip', () => {
        expect(stripHue(0)).toBe(0);
    });

    it('spreads hues via the golden-ratio conjugate for positive indices', () => {
        expect(stripHue(1)).toBeCloseTo(0.6180339887498949, 10);
        expect(stripHue(2)).toBeCloseTo(0.2360679774997898, 10);
    });

    it('spreads hues for negative indices too, staying within [0, 1)', () => {
        const hue = stripHue(-1);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(1);
        expect(hue).toBeCloseTo(0.3819660112501051, 10);
    });
});

describe('stripColor', () => {
    it('renders hue 0 as red-dominant', () => {
        const { r, g, b } = stripColor(0);
        expect(r).toBeCloseTo(0.9, 5);
        expect(g).toBeCloseTo(0.315, 5);
        expect(b).toBeCloseTo(0.315, 5);
    });

    it('renders hue 1/3 as green-dominant', () => {
        const { r, g, b } = stripColor(1 / 3);
        expect(g).toBeCloseTo(0.9, 5);
        expect(r).toBeCloseTo(0.315, 5);
        expect(b).toBeCloseTo(0.315, 5);
    });

    it('renders hue 2/3 as blue-dominant', () => {
        const { r, g, b } = stripColor(2 / 3);
        expect(b).toBeCloseTo(0.9, 5);
        expect(r).toBeCloseTo(0.315, 5);
        expect(g).toBeCloseTo(0.315, 5);
    });

    it('keeps every channel within [0, 1] across the full hue range', () => {
        for (let i = 0; i < 12; i += 1) {
            const { r, g, b } = stripColor(i / 12);
            for (const channel of [r, g, b]) {
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThanOrEqual(1);
            }
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```sh
make test
```

Expected: FAIL — `drift/src/ui/strip-identity.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `drift/src/ui/strip-identity.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```sh
make test
```

Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` functions, `UPPER_SNAKE_CASE` module constants, `PascalCase` interface)
- [ ] Lowercase kebab-case filename (`strip-identity.ts`)
- [ ] Step 4's command executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: New settings — `stripHintsEnabled`, `stripOsdEnabled`, `stripOsdDurationMs`, `stripOsdGlowOpacity`

**Files:**
- Modify: `drift/src/config/settings.ts`
- Modify: `drift/src/config/settings-definitions.ts`
- Test: `drift/src/config/settings.test.ts`

Adding a setting in this codebase means adding it in exactly two places (`settings.ts`'s `Settings` interface, `settings-definitions.ts`'s `SETTINGS_DEFINITIONS` array) — `DEFAULT_SETTINGS`/`loadSettings()` derive generically from the array, and the generated `.kcfg` XML is a build step, not something to hand-edit.

- [ ] **Step 1: Write the failing tests**

In `drift/src/config/settings.test.ts`, insert after the existing `'defaults the focus flash peak opacity to 0.5'` test (before `'keeps undocked windows above others by default'`):

```ts
    it('enables strip hints (minimap labels/colors) by default', () => {
        expect(DEFAULT_SETTINGS.stripHintsEnabled).toBe(true);
    });

    it('enables the strip-change OSD by default', () => {
        expect(DEFAULT_SETTINGS.stripOsdEnabled).toBe(true);
    });

    it('defaults the strip OSD duration to 500ms', () => {
        expect(DEFAULT_SETTINGS.stripOsdDurationMs).toBe(500);
    });

    it('defaults the strip OSD glow peak opacity to 0.5', () => {
        expect(DEFAULT_SETTINGS.stripOsdGlowOpacity).toBe(0.5);
    });

```

- [ ] **Step 2: Run test to verify it fails**

```sh
make test
```

Expected: FAIL — TypeScript compile error, `stripHintsEnabled`/etc. don't exist on `Settings`.

- [ ] **Step 3: Add the fields to the `Settings` interface**

In `drift/src/config/settings.ts`, insert after the existing `focusFlashOpacity: number;` field (before `undockKeepAbove: boolean;`):

```ts
    /** Whether the minimap's per-strip label/color chips are shown at all (docs:
     * 2026-09-14-strip-navigation-hints-design). */
    stripHintsEnabled: boolean;
    /** Whether the strip-change OSD (label badge + screen-edge glow) is shown at all (docs:
     * 2026-09-14-strip-navigation-hints-design). */
    stripOsdEnabled: boolean;
    /** Total duration of the strip-change OSD's fade-in-then-fade-out, in milliseconds. */
    stripOsdDurationMs: number;
    /** Peak opacity of the strip-change OSD's screen-edge glow at the midpoint of its
     * fade-in-then-fade-out. */
    stripOsdGlowOpacity: number;
```

- [ ] **Step 4: Add the definitions**

In `drift/src/config/settings-definitions.ts`, insert after the existing `{ name: 'focusFlashOpacity', type: 'Double', default: 0.5 },` line (before `{ name: 'undockKeepAbove', ... }`):

```ts
    { name: 'stripHintsEnabled', type: 'Bool', default: true },
    { name: 'stripOsdEnabled', type: 'Bool', default: true },
    { name: 'stripOsdDurationMs', type: 'UInt', default: 500 },
    { name: 'stripOsdGlowOpacity', type: 'Double', default: 0.5 },
```

- [ ] **Step 5: Run test to verify it passes**

```sh
make test
```

Expected: PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] New setting names are `camelCase`, matching every existing entry
- [ ] `settings.ts` field order matches `settings-definitions.ts` array order (both inserted in the same place)
- [ ] Step 5's command executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: `MinimapStrip` gains `label`/`hue`

**Files:**
- Modify: `drift/src/ui/minimap.ts`
- Test: `drift/src/ui/minimap.test.ts`

- [ ] **Step 1: Write the failing test**

In `drift/src/ui/minimap.test.ts`, add the import and update the existing test:

```ts
import { stripHue, stripLabel } from './strip-identity';
```

(add this line alongside the existing imports at the top of the file)

Replace the existing test:

```ts
    it('merges every strip, tagging each with its own stripIndex', () => {
        const stripMinus1 = strip(-1, [{ id: 1, x: 0, width: 400, tiles: [tile(false)] }]);
        const strip0 = strip(0, [{ id: 2, x: 0, width: 600, tiles: [tile(true)] }]);

        const combined = combineStripStackSnapshot([stripMinus1, strip0], 0, 1000);

        expect(combined.strips).toEqual([
            { stripIndex: -1, columns: stripMinus1.snapshot.columns },
            { stripIndex: 0, columns: strip0.snapshot.columns },
        ]);
    });
```

with:

```ts
    it('merges every strip, tagging each with its own stripIndex, label, and hue', () => {
        const stripMinus1 = strip(-1, [{ id: 1, x: 0, width: 400, tiles: [tile(false)] }]);
        const strip0 = strip(0, [{ id: 2, x: 0, width: 600, tiles: [tile(true)] }]);

        const combined = combineStripStackSnapshot([stripMinus1, strip0], 0, 1000);

        expect(combined.strips).toEqual([
            { stripIndex: -1, label: stripLabel(-1), hue: stripHue(-1), columns: stripMinus1.snapshot.columns },
            { stripIndex: 0, label: stripLabel(0), hue: stripHue(0), columns: strip0.snapshot.columns },
        ]);
    });
```

- [ ] **Step 2: Run test to verify it fails**

```sh
make test
```

Expected: FAIL — `combined.strips` entries don't have `label`/`hue` yet.

- [ ] **Step 3: Implement**

In `drift/src/ui/minimap.ts`, add the import:

```ts
import { stripHue, stripLabel } from './strip-identity';
```

Replace the `MinimapStrip` interface:

```ts
export interface MinimapStrip {
    stripIndex: number;
    columns: MinimapColumn[];
}
```

with:

```ts
export interface MinimapStrip {
    stripIndex: number;
    label: string;
    hue: number;
    columns: MinimapColumn[];
}
```

Replace `combineStripStackSnapshot`'s body:

```ts
    return {
        strips: strips.map((strip) => ({
            stripIndex: strip.stripIndex,
            columns:
                strip.stripIndex === activeStripIndex
                    ? strip.snapshot.columns
                    : strip.snapshot.columns.map((column) =>
                          Object.assign({}, column, {
                              tiles: column.tiles.map((tile) => Object.assign({}, tile, { focused: false })),
                          }),
                      ),
        })),
        viewport: Object.assign({ stripIndex: activeStripIndex }, active.snapshot.viewport),
        gridHeight: active.snapshot.gridHeight,
        stripPitch,
    };
```

with:

```ts
    return {
        strips: strips.map((strip) => ({
            stripIndex: strip.stripIndex,
            label: stripLabel(strip.stripIndex),
            hue: stripHue(strip.stripIndex),
            columns:
                strip.stripIndex === activeStripIndex
                    ? strip.snapshot.columns
                    : strip.snapshot.columns.map((column) =>
                          Object.assign({}, column, {
                              tiles: column.tiles.map((tile) => Object.assign({}, tile, { focused: false })),
                          }),
                      ),
        })),
        viewport: Object.assign({ stripIndex: activeStripIndex }, active.snapshot.viewport),
        gridHeight: active.snapshot.gridHeight,
        stripPitch,
    };
```

- [ ] **Step 4: Run test to verify it passes**

```sh
make test
```

Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming/import style matches the rest of `minimap.ts`
- [ ] Step 4's command executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: `StripStack.activeIndex()`

**Files:**
- Modify: `drift/src/runtime/strip-stack.ts`
- Test: `drift/src/runtime/strip-stack.test.ts`

`Controller` (Task 7) needs to read the active strip index before and after a navigation action, to decide whether the OSD should fire. `StripStack` has no public accessor for it today.

- [ ] **Step 1: Write the failing test**

In `drift/src/runtime/strip-stack.test.ts`, add to the `'StripStack strip paging'` describe block (alongside the existing `stripUp`/`stripDown` tests):

```ts
    it('activeIndex starts at 0 and tracks stripUp/stripDown', () => {
        const { stack } = makeStack();
        expect(stack.activeIndex()).toBe(0);

        stack.stripUp();
        expect(stack.activeIndex()).toBe(-1);

        stack.stripDown();
        expect(stack.activeIndex()).toBe(0);

        stack.stripDown();
        expect(stack.activeIndex()).toBe(1);
    });
```

- [ ] **Step 2: Run test to verify it fails**

```sh
make test
```

Expected: FAIL — TypeScript compile error, `activeIndex` doesn't exist on `StripStack`.

- [ ] **Step 3: Implement**

In `drift/src/runtime/strip-stack.ts`, insert a new public method right before the existing `private activeStrip(): Strip {` method:

```ts
    /** The currently active strip's permanent index — what `strip-identity.ts`'s
     * `stripLabel`/`stripHue` derive a strip's label/color from (docs:
     * 2026-09-14-strip-navigation-hints-design). */
    activeIndex(): number {
        return this.activeStripIndex;
    }

```

- [ ] **Step 4: Run test to verify it passes**

```sh
make test
```

Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Method placed with the other public methods, matching the file's existing public/private grouping
- [ ] Step 4's command executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: Minimap label/color chip

**Files:**
- Modify: `drift/src/kwin/minimap-overlay.ts`
- Modify: `drift/src/runtime/controller.ts`

`toPanelStrips` is not exported and has no dedicated test today (only `panelLayout` and `toPanelViewportBox` are — confirmed in `drift/src/kwin/minimap-overlay.test.ts`); this task keeps that boundary and is verified structurally (typecheck/test/lint) plus Task 8's live check, same as the QML-touching parts of the existing minimap/focus-flash overlays.

- [ ] **Step 1: Add the `stripColor` import and `showStripHints` toggle**

In `drift/src/kwin/minimap-overlay.ts`, add the import:

```ts
import { stripColor } from '../ui/strip-identity';
```

In the `MINIMAP_QML` template string, add a new dialog property alongside `showThumbnails`:

```qml
    property bool showThumbnails: false
    property bool showStripHints: true
```

- [ ] **Step 2: Add the label chip to the strip-row delegate**

In the `MINIMAP_QML` template string, the strip-row delegate currently reads:

```qml
            Repeater {
                model: dialog.strips
                delegate: Item {
                    x: 0
                    y: modelData.y
                    width: parent.width
                    height: dialog.stripHeight
                    Repeater {
                        model: modelData.columns
```

Add a label chip as the first child of that `Item` delegate, right after the `height: dialog.stripHeight` line and before the inner `Repeater`:

```qml
                    Rectangle {
                        id: labelChip
                        visible: dialog.showStripHints
                        x: 4
                        y: 4
                        z: 1
                        width: labelText.implicitWidth + 8
                        height: labelText.implicitHeight + 4
                        radius: 3
                        color: Qt.rgba(modelData.color.r, modelData.color.g, modelData.color.b, 0.9)
                        Text {
                            id: labelText
                            anchors.centerIn: parent
                            text: modelData.label
                            color: "black"
                            font.bold: true
                            font.pixelSize: 12
                        }
                    }
```

- [ ] **Step 3: Thread `label`/`color` through `PanelStrip`/`toPanelStrips`**

Replace the `PanelStrip` interface:

```ts
interface PanelStrip {
    y: number;
    columns: PanelColumn[];
}
```

with:

```ts
interface PanelStrip {
    y: number;
    label: string;
    color: { r: number; g: number; b: number };
    columns: PanelColumn[];
}
```

Replace `toPanelStrips`:

```ts
function toPanelStrips(snapshot: StripStackMinimapSnapshot): PanelStrip[] {
    const { stripLefts, top, scale } = panelLayout(snapshot);
    return snapshot.strips.map((strip) => {
        const left = stripLefts.get(strip.stripIndex) ?? 0;
        return {
            y: (strip.stripIndex * snapshot.stripPitch - top) * scale,
            columns: strip.columns.map((column) => ({
                x: (column.x - left) * scale,
                width: column.width * scale,
                tiles: column.tiles.map((tile) => ({
                    y: tile.y * scale,
                    height: tile.height * scale,
                    focused: tile.focused,
                    icon: tile.icon,
                    thumbnail: tile.thumbnail,
                })),
            })),
        };
    });
}
```

with:

```ts
function toPanelStrips(snapshot: StripStackMinimapSnapshot): PanelStrip[] {
    const { stripLefts, top, scale } = panelLayout(snapshot);
    return snapshot.strips.map((strip) => {
        const left = stripLefts.get(strip.stripIndex) ?? 0;
        return {
            y: (strip.stripIndex * snapshot.stripPitch - top) * scale,
            label: strip.label,
            color: stripColor(strip.hue),
            columns: strip.columns.map((column) => ({
                x: (column.x - left) * scale,
                width: column.width * scale,
                tiles: column.tiles.map((tile) => ({
                    y: tile.y * scale,
                    height: tile.height * scale,
                    focused: tile.focused,
                    icon: tile.icon,
                    thumbnail: tile.thumbnail,
                })),
            })),
        };
    });
}
```

- [ ] **Step 4: Thread the toggle through `createMinimapOverlay`**

Replace:

```ts
export function createMinimapOverlay(parent: QmlObject, autoHideMs: number, showThumbnails: boolean): MinimapOverlay {
    const dialog = Qt.createQmlObject(MINIMAP_QML, parent) as QmlMinimapDialog;
    dialog.showThumbnails = showThumbnails;
```

with:

```ts
export function createMinimapOverlay(
    parent: QmlObject,
    autoHideMs: number,
    showThumbnails: boolean,
    showStripHints: boolean,
): MinimapOverlay {
    const dialog = Qt.createQmlObject(MINIMAP_QML, parent) as QmlMinimapDialog;
    dialog.showThumbnails = showThumbnails;
    dialog.showStripHints = showStripHints;
```

Add `showStripHints: boolean;` to the `QmlMinimapDialog` interface in `drift/src/types/kwin.d.ts`, alongside the existing `showThumbnails: boolean;` field.

- [ ] **Step 5: Update the call site**

In `drift/src/runtime/controller.ts`, replace:

```ts
        this.minimapOverlay = createMinimapOverlay(root, settings.minimapAutoHideMs, settings.minimapShowThumbnails);
```

with:

```ts
        this.minimapOverlay = createMinimapOverlay(
            root,
            settings.minimapAutoHideMs,
            settings.minimapShowThumbnails,
            settings.stripHintsEnabled,
        );
```

- [ ] **Step 6: Run typecheck, tests, and lint**

```sh
make test && make lint
```

Expected: both pass. These are structural checks only — they cannot see rendered output (confirmed live in Task 8).

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] QML: 4-space indent, one property/handler per line, `lowerCamelCase` IDs/properties
- [ ] `qmllint` clean (via `make lint`)
- [ ] Step 6's commands executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 6: `strip-osd.ts` — full-screen glow + label badge

**Files:**
- Modify: `drift/src/types/kwin.d.ts`
- Create: `drift/src/kwin/strip-osd.ts`

No test file — like `focus-flash-overlay.ts` and `minimap-overlay.ts`'s own QML glue, this isn't exercisable without a live compositor. Verified structurally here (typecheck/lint) and live in Task 8.

- [ ] **Step 1: Add the `QmlStripOsdDialog` type**

In `drift/src/types/kwin.d.ts`, add a new interface after `QmlFocusFlashDialog`:

```ts
/** The dynamically-created strip-change OSD dialog: a full-screen edge glow plus a large
 * label badge, flashed whenever the active strip actually changes (docs:
 * 2026-09-14-strip-navigation-hints-design). `glowRgb` is plain data (see `StripColor` in
 * `ui/strip-identity.ts`), typed loosely here since this file has no app-specific types. */
interface QmlStripOsdDialog extends QmlObject {
    glowRgb: unknown;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    visible: boolean;
}
```

- [ ] **Step 2: Write `strip-osd.ts`**

Create `drift/src/kwin/strip-osd.ts`:

```ts
// A full-screen inward glow plus a large label badge, flashed whenever the active strip
// actually changes (docs: 2026-09-14-strip-navigation-hints-design). Reuses the same
// drift/shaders/focus_glow.frag shader as focus-flash-overlay.ts, sized to the screen instead
// of a window frame. Built via Qt.createQmlObject, the same pattern as
// focus-flash-overlay.ts/minimap-overlay.ts.

import type { Rect } from '../core/coordinates';
import { flashOpacity } from '../ui/focus-flash';
import { stripColor } from '../ui/strip-identity';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const STRIP_OSD_WINDOW_TITLE = 'Drift Strip OSD';

const STRIP_OSD_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property real glowRadius: 60
    property real bleedRadius: 8
    property var glowRgb: ({ r: 1, g: 1, b: 1 })
    property string label: ""
    title: "${STRIP_OSD_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Item {
        width: dialog.width
        height: dialog.height
        ShaderEffect {
            id: glow
            anchors.fill: parent
            property color glowColor: Qt.rgba(dialog.glowRgb.r, dialog.glowRgb.g, dialog.glowRgb.b, 1.0)
            property vector2d itemSize: Qt.vector2d(width, height)
            property real glow: dialog.glowRadius
            property real sharpness: 1.5
            property real bleed: dialog.bleedRadius
            fragmentShader: Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")
        }
        Text {
            anchors.centerIn: parent
            text: dialog.label
            color: Qt.rgba(dialog.glowRgb.r, dialog.glowRgb.g, dialog.glowRgb.b, 1.0)
            font.bold: true
            font.pixelSize: 120
        }
    }
}`;

export interface StripOsd {
    show(label: string, hue: number, screenGeometry: Rect): void;
}

/** `tickMs` reuses the viewport's own animation clock interval, same as
 * `createFocusFlashOverlay`. `enabled` is fixed at construction time, same as every other
 * setting here — Drift settings all take effect on restart, not live. */
export function createStripOsd(
    parent: QmlObject,
    tickMs: number,
    durationMs: number,
    peakOpacity: number,
    enabled: boolean,
): StripOsd {
    const dialog = Qt.createQmlObject(STRIP_OSD_QML, parent) as QmlStripOsdDialog;
    dialog.opacity = 0;
    dialog.visible = true;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    return {
        show(label: string, hue: number, screenGeometry: Rect): void {
            if (!enabled) {
                return;
            }
            dialog.glowRgb = stripColor(hue);
            dialog.label = label;
            dialog.x = Math.round(screenGeometry.x);
            dialog.y = Math.round(screenGeometry.y);
            dialog.width = Math.round(screenGeometry.width);
            dialog.height = Math.round(screenGeometry.height);
            startedAt = Date.now();
            timer.start(tickMs, () => {
                const elapsed = Date.now() - startedAt;
                dialog.opacity = flashOpacity(elapsed, durationMs) * peakOpacity;
                if (elapsed >= durationMs) {
                    timer.stop();
                }
            });
        },
    };
}
```

- [ ] **Step 3: Run typecheck, tests, and lint**

```sh
make test && make lint
```

Expected: both pass.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] QML property names (`glowRgb`, `label`, `glowRadius`, `bleedRadius`) match the shader uniform names (`glowColor`, `itemSize`, `glow`, `sharpness`, `bleed`) correctly bound in the `ShaderEffect`
- [ ] Lowercase kebab-case filename (`strip-osd.ts`), `PascalCase` interface, `camelCase` function
- [ ] KWin API access stays isolated in `kwin/strip-osd.ts` (no leakage into `ui/strip-identity.ts`)
- [ ] Step 3's commands executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 7: Wire `StripOsd` into `Controller`

**Files:**
- Modify: `drift/src/runtime/controller.ts`

No test file — `Controller` has none today; it's untestable KWin-orchestration glue (no live compositor/workspace in the test environment), same as every other piece of wiring in this file. Verified structurally (typecheck/lint) and live in Task 8.

- [ ] **Step 1: Add imports**

In `drift/src/runtime/controller.ts`, add:

```ts
import { createStripOsd, type StripOsd } from '../kwin/strip-osd';
import { stripHue, stripLabel } from '../ui/strip-identity';
```

- [ ] **Step 2: Add the `stripOsd` field and construct it**

Replace:

```ts
    private readonly minimapOverlay: MinimapOverlay;
    private readonly focusFlashOverlay: FocusFlashOverlay;
```

with:

```ts
    private readonly minimapOverlay: MinimapOverlay;
    private readonly focusFlashOverlay: FocusFlashOverlay;
    private readonly stripOsd: StripOsd;
```

Replace:

```ts
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            ANIMATION_TICK_MS,
            settings.focusFlashBlurRadius,
            settings.focusFlashDurationMs,
            settings.focusFlashOpacity,
            settings.focusFlashEnabled,
        );
```

with:

```ts
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            ANIMATION_TICK_MS,
            settings.focusFlashBlurRadius,
            settings.focusFlashDurationMs,
            settings.focusFlashOpacity,
            settings.focusFlashEnabled,
        );
        this.stripOsd = createStripOsd(
            root,
            ANIMATION_TICK_MS,
            settings.stripOsdDurationMs,
            settings.stripOsdGlowOpacity,
            settings.stripOsdEnabled,
        );
```

- [ ] **Step 3: Diff `activeIndex()` around the move and fire the OSD**

Replace `focusAndShowMinimap`:

```ts
    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        move(stack);
        const snapshot = stack.minimapSnapshot();
        this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    }
```

with:

```ts
    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        const beforeIndex = stack.activeIndex();
        move(stack);
        const afterIndex = stack.activeIndex();
        const snapshot = stack.minimapSnapshot();
        const screen = this.workspaceAdapter.screenGeometryAtCursor();
        this.minimapOverlay.show(snapshot, screen);
        if (afterIndex !== beforeIndex) {
            this.stripOsd.show(stripLabel(afterIndex), stripHue(afterIndex), screen);
        }
    }
```

- [ ] **Step 4: Run typecheck, tests, and lint**

```sh
make test && make lint
```

Expected: both pass.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming/import ordering matches the rest of `controller.ts`
- [ ] Step 4's commands executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 8: Live verification in a KWin session

**Files:** none (manual verification only)

`make test`/`make lint` cannot see rendered output — this is the only check for the actual visual behavior of the minimap chip and the strip-change OSD, and for whether the reused shader resolves correctly at its new (screen-sized) scale.

- [ ] **Step 1: Install and reload the addon**

```sh
make install
```

- [ ] **Step 2: Trigger strip navigation**

Use `Meta+Page_Down`/`Meta+Page_Up` (or whatever `shortcutStripDown`/`shortcutStripUp` are bound to) repeatedly. Confirm:
- The minimap shows a small colored chip on each visible strip row, with the expected label: the home strip is `1`, one strip below is `A`, two strips below is `B`, one strip above home is `2`, and so on.
- Each strip's chip color is visibly distinct from its immediate neighbors.
- Every time the active strip changes, a full-screen glow flashes inward from the screen edges in that strip's color, alongside a large centered label badge, then fades out over roughly half a second.
- Pressing a key that does NOT change strips (e.g. `Meta+Left`/`Meta+Right`) shows the minimap but does **not** trigger the full-screen OSD.

- [ ] **Step 3: Confirm chip labels stay stable**

Page up two strips, then back down to home, then down past home into the letter side. Confirm each strip's label is exactly the same every time you return to it (this exercises `stripLabel`/`stripHue` purity plus the strip-pruning behavior already covered by `strip-stack.test.ts`).

- [ ] **Step 4: If nothing renders, check for shader-load errors**

```sh
journalctl --user -b 0 | grep -i kwin | tail -50
```

Also check KWin's support information (`kwin_support_information`, or the "Support Information" action in KWin's own settings) for shader-compile or file-not-found warnings — the same `Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")` relative-path pattern `focus-flash-overlay.ts` already uses successfully.

- [ ] **Step 5: Record the outcome**

If Step 2 confirms correct chips and a correct full-screen glow+badge: done, no further action needed.

If Step 4 shows a file-not-found/shader-load error specific to `strip-osd.ts`: since `focus-flash-overlay.ts` already resolves the identical relative path successfully, first double-check `strip-osd.ts` is created at `drift/src/kwin/strip-osd.ts` (same directory depth as `focus-flash-overlay.ts`) before considering a path-resolution fallback.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Step 2's live check performed and outcome recorded (pass, or specific failure mode observed)
- [ ] Step 3's stability check performed
- [ ] Step 4 performed if Step 2 showed no glow or no chips
- [ ] Any follow-up task filed (not implemented) if a fix beyond this plan's scope is needed

---

## Self-Review

**Spec coverage:**
- Permanent label/color from `stripIndex`, never reassigned → Task 1 (pure functions), no new mutable identity state anywhere.
- Digit/letter split and home-strip labeling → Task 1 tests pin the exact boundary values from the spec (`0`→`"1"`, `26`→`"Z"`, `27`→`"AA"`).
- Golden-ratio hue spread, works for negative indices → Task 1.
- Minimap shows every strip's label/color → Tasks 3 and 5.
- OSD fires only when the active strip actually changes, shows label + screen-edge glow → Tasks 4, 6, 7.
- Reuses the existing shader, no new shader/build wiring → Task 6 (confirmed against `Makefile`'s single-shader `SHADER_SRC`/`SHADER_QSB` variables — no changes needed there).
- Settings for enabling/disabling and tuning duration/opacity → Task 2, consumed in Tasks 5 and 7.

**Placeholder scan:** none found — every step has complete code, or is explicitly manual/live verification (Task 8) with concrete pass/fail criteria.

**Type consistency:** `StripColor` (Task 1) → consumed as `stripColor(hue)`'s return type in both `toPanelStrips` (Task 5, structurally typed inline as `{ r, g, b }` to match `kwin.d.ts`'s existing "no app-specific types" convention) and `strip-osd.ts` (Task 6, assigned to `glowRgb: unknown`). `stripLabel`/`stripHue` signatures (`(stripIndex: number) => string` / `(stripIndex: number) => number`) are identical everywhere they're called (Tasks 3, 7). `StripStack.activeIndex(): number` (Task 4) matches its one call site's usage in Task 7.

**Corrections made during planning (vs. the design doc's first draft):**
- The design doc originally said the OSD would live in `drift/ui/StripOsd.qml` — checked `drift/ui/` and found it holds only `main.qml`/`config.ui`; every overlay dialog (minimap, focus-flash) is an inline QML template string inside its `.ts` file. The design doc was corrected, and this plan follows the inline-template pattern.
- The design doc originally proposed `src/runtime/controller.test.ts` tests for the OSD-triggering logic — `Controller` has no test file in this codebase (confirmed: no such file exists, and no other orchestration-root file has one either). The design doc was corrected; the testable piece (`activeIndex()`) is covered in `strip-stack.test.ts` (Task 4), and the `Controller` diff itself stays untested glue like the rest of that file.
- Added a third pure function, `stripColor`, not fully specced originally: needed because the outer KWin declarativescript `Qt` global (`drift/src/types/kwin.d.ts`'s `QtNamespace`) has no `rgba`/`hsva` — only the QML engine's own `Qt` (usable *inside* an embedded QML template string) does. So RGB conversion happens in testable TypeScript, and the QML side only does `Qt.rgba(dialog.glowRgb.r, ...)` inside the template, mirroring how `minimap-overlay.ts` already passes plain numeric fields into its QML template today.

---

## Execution Choice

Plan complete and saved to `docs/agents/plans/2026-09-14-strip-navigation-hints.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
