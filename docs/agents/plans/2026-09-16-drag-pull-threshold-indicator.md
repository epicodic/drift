# Drag Pull Threshold + Pull Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dwell-based pull-to-rearrange gesture with an instant threshold check (free on vertical pull, permanently abort on horizontal drift), and add a filled circular-segment overlay that grows beneath the dragged window as the pull progresses.

**Architecture:** Two pure geometry functions (`pull-indicator.ts`) feed a small new fragment shader driven from a KWin overlay module (`pull-indicator-overlay.ts`), following the exact `focus_glow.frag`/`focus-flash-overlay.ts` precedent already in the codebase. `drag.ts`'s pan/pin block loses its dwell timer in favor of inline one-shot threshold checks against cumulative drag-start-relative movement. The overlay instance is threaded through `Controller → StripManager → StripStack → Strip → registerDragReorder` as a defaulted constructor parameter, mirroring how `TransientLinks` is already threaded through the same chain — so no existing test call site breaks.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-16-drag-pull-threshold-indicator-design.md` — read before implementing

---

## Task 1: Pull indicator geometry (pure functions)

**Files:**
- Create: `drift/src/input/pull-indicator.ts`
- Test: `drift/src/input/pull-indicator.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { pullIndicatorAlpha, pullIndicatorCircle } from './pull-indicator';

describe('pullIndicatorCircle', () => {
    it('centers on the vertical midline of the window', () => {
        const { cx } = pullIndicatorCircle(200, 20);
        expect(cx).toBe(100);
    });

    it('places both top corners and the pull midpoint on the resulting circle', () => {
        const width = 200;
        const dyTotal = 20;
        const { cx, cy, r } = pullIndicatorCircle(width, dyTotal);
        const distanceTo = (x: number, y: number): number => Math.hypot(x - cx, y - cy);
        expect(distanceTo(0, 0)).toBeCloseTo(r, 6);
        expect(distanceTo(width, 0)).toBeCloseTo(r, 6);
        expect(distanceTo(width / 2, dyTotal)).toBeCloseTo(r, 6);
    });

    it('produces a much larger radius for a shallow pull than a deep one, at the same width', () => {
        const shallow = pullIndicatorCircle(200, 2);
        const deep = pullIndicatorCircle(200, 60);
        expect(shallow.r).toBeGreaterThan(deep.r);
    });
});

describe('pullIndicatorAlpha', () => {
    it('is 0 at no pull', () => {
        expect(pullIndicatorAlpha(0, 20)).toBe(0);
    });

    it('is 0.5 at half the trigger', () => {
        expect(pullIndicatorAlpha(10, 20)).toBe(0.5);
    });

    it('is 1 exactly at the trigger', () => {
        expect(pullIndicatorAlpha(20, 20)).toBe(1);
    });

    it('clamps to 1 past the trigger, never overshooting', () => {
        expect(pullIndicatorAlpha(50, 20)).toBe(1);
    });

    it('treats a zero trigger as immediately maxed once there is any pull at all', () => {
        expect(pullIndicatorAlpha(1, 0)).toBe(1);
        expect(pullIndicatorAlpha(0, 0)).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- pull-indicator`
Expected: FAIL — `./pull-indicator` module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- pull-indicator`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (`camelCase` functions, file under `drift/src/input/`)
- [ ] TypeScript-specific guidelines followed
- [ ] `npm test -- pull-indicator` passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: Remove the dwell-based hold predicate

The dwell/hold mechanism (`dragPanHolding`) is fully superseded by inline one-shot threshold
checks written directly in `drag.ts` (Task 9) — there's no replacement pure function, so this
file is deleted outright rather than edited.

**Files:**
- Delete: `drift/src/input/drag-pan.ts`
- Delete: `drift/src/input/drag-pan.test.ts`

- [ ] **Step 1: Delete both files**

```
rm drift/src/input/drag-pan.ts drift/src/input/drag-pan.test.ts
```

- [ ] **Step 2: Confirm nothing else imports the deleted module**

`grep -rn "drag-pan'" drift/src`
Expected: no matches (Task 9 removes `drag.ts`'s import in the same pass — if this step runs
before Task 9, one match in `drag.ts` is expected and will be cleaned up there).

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] No dangling imports of the deleted module outside `drag.ts` (which Task 9 fixes)
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: Settings — remove the dwell setting, add pull-indicator settings

**Files:**
- Modify: `drift/src/config/settings.ts:127-147`
- Modify: `drift/src/config/settings-definitions.ts:172-176`
- Modify: `drift/src/config/settings.test.ts:46-48`

- [ ] **Step 1: Update the `Settings` interface doc comments and fields**

In `drift/src/config/settings.ts`, replace:

```ts
    /** Whether dragging a window defaults to panning the viewport instead of immediately
     * reordering/stacking (docs: 2026-09-12-drag-pan-dwell-design). `false` disables panning
     * and the dwell-to-free gesture entirely — dragging behaves exactly as it would without
     * this feature. */
    dragPanEnabled: boolean;
    /** Whether a dialog/popup follows its tiled parent window's on-screen position (strip
     * scroll, column resize, park/unpark) instead of being left behind (docs:
     * 2026-09-13-popup-pinning-design). `false` fully restores pre-feature behavior: popups are
     * never touched by Drift. */
    popupPinningEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, before a hold-to-free gesture can start
     * counting at all (docs: 2026-09-12-drag-pan-dwell-design). */
    dragPanVerticalTriggerPx: number;
    /** Horizontal drift, in pixels, allowed since a hold-to-free gesture started before it's
     * canceled (docs: 2026-09-12-drag-pan-dwell-design) — measured cumulatively from where the
     * hold began, not per tick, so ordinary hand tremor doesn't cancel it. */
    dragPanHorizontalTolerancePx: number;
    /** How long a hold-to-free gesture must be sustained before the drag is freed from pan mode
     * into today's normal reorder/stack/cross-strip-drag behavior, in milliseconds (docs:
     * 2026-09-12-drag-pan-dwell-design). */
    dragPanFreeDwellMs: number;
```

with:

```ts
    /** Whether dragging a window defaults to panning the viewport instead of immediately
     * reordering/stacking (docs: 2026-09-16-drag-pull-threshold-indicator-design). `false`
     * disables panning and the pull-to-free gesture entirely — dragging behaves exactly as it
     * would without this feature. */
    dragPanEnabled: boolean;
    /** Whether a dialog/popup follows its tiled parent window's on-screen position (strip
     * scroll, column resize, park/unpark) instead of being left behind (docs:
     * 2026-09-13-popup-pinning-design). `false` fully restores pre-feature behavior: popups are
     * never touched by Drift. */
    popupPinningEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, that frees the drag from pan mode
     * immediately — no hold, no dwell (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    dragPanVerticalTriggerPx: number;
    /** Cumulative horizontal drift, in pixels, measured from drag start, that permanently
     * aborts the pull for the rest of the drag once reached before the vertical trigger is
     * (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    dragPanHorizontalTolerancePx: number;
    /** Whether the pull indicator (a filled arc that grows beneath the dragged window's top
     * edge as a pull progresses) is shown at all (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    pullIndicatorEnabled: boolean;
    /** Peak opacity of the pull indicator, reached once the pull reaches
     * `dragPanVerticalTriggerPx` (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    pullIndicatorOpacity: number;
```

- [ ] **Step 2: Update `SETTINGS_DEFINITIONS`**

In `drift/src/config/settings-definitions.ts`, replace:

```ts
    { name: 'dragPanEnabled', type: 'Bool', default: true },
    { name: 'dragPanVerticalTriggerPx', type: 'UInt', default: 20 },
    { name: 'dragPanHorizontalTolerancePx', type: 'UInt', default: 10 },
    { name: 'dragPanFreeDwellMs', type: 'UInt', default: 400 },
```

with:

```ts
    { name: 'dragPanEnabled', type: 'Bool', default: true },
    { name: 'dragPanVerticalTriggerPx', type: 'UInt', default: 20 },
    { name: 'dragPanHorizontalTolerancePx', type: 'UInt', default: 10 },
    { name: 'pullIndicatorEnabled', type: 'Bool', default: true },
    { name: 'pullIndicatorOpacity', type: 'Double', default: 0.5 },
```

(`buildDefaultSettings`/`loadSettings` in the same file are fully generic over `SETTINGS_DEFINITIONS` — no other code in `settings.ts` needs to change.)

- [ ] **Step 3: Write the updated settings tests**

In `drift/src/config/settings.test.ts`, replace:

```ts
    it('defaults dragPanFreeDwellMs to 400, matching the other drag dwells', () => {
        expect(DEFAULT_SETTINGS.dragPanFreeDwellMs).toBe(400);
    });
```

with:

```ts
    it('defaults pullIndicatorEnabled to true', () => {
        expect(DEFAULT_SETTINGS.pullIndicatorEnabled).toBe(true);
    });

    it('defaults pullIndicatorOpacity to 0.5, matching focusFlashOpacity', () => {
        expect(DEFAULT_SETTINGS.pullIndicatorOpacity).toBe(0.5);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- settings`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (`camelCase` settings fields)
- [ ] `npm test -- settings` passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: KCM config UI — remove the dwell spin box, add the pull-indicator group

**Files:**
- Modify: `drift/ui/config.ui:400-425` (remove)
- Modify: `drift/ui/config.ui` (insert new group after the `dragPanEnabled` group box, ~line 428)

- [ ] **Step 1: Remove the dwell spin box**

Delete this `<item>` block (currently rows 3/0 and 3/1 of `formLayout_dragPan`, immediately
before that layout's closing `</layout>`):

```xml
                                        <item row="3" column="0">
                                            <widget class="QLabel" name="label_dragPanFreeDwellMs">
                                                <property name="text">
                                                    <string>Hold dwell:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="3" column="1">
                                            <widget class="QSpinBox" name="kcfg_dragPanFreeDwellMs">
                                                <property name="toolTip">
                                                    <string>How long a hold-to-free gesture must be sustained before the drag is freed into normal reorder/stack/cross-strip-drag behavior</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> ms</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>2000</number>
                                                </property>
                                                <property name="value">
                                                    <number>400</number>
                                                </property>
                                            </widget>
                                        </item>
```

Also update `label_dragPanCaption`'s text (row 0/0-1 of the same layout) from:

```xml
                                                    <string>Hold-to-free gesture — pull trigger to switch into rearrange mode:</string>
```

to:

```xml
                                                    <string>Pull gesture — pull past the trigger to switch into rearrange mode:</string>
```

And the `kcfg_dragPanEnabled` group box's own `toolTip` from:

```xml
                                        <string>Dragging a window pans the viewport by default. Pull the window down or up and hold it steady to switch to normal reordering, stacking, or moving it to another strip.</string>
```

to:

```xml
                                        <string>Dragging a window pans the viewport by default. Pull the window down or up past the trigger to switch to normal reordering, stacking, or moving it to another strip.</string>
```

- [ ] **Step 2: Insert the pull-indicator group box**

Immediately after the `kcfg_dragPanEnabled` group box's closing `</widget>` and `</item>` (right
before the next `<item>` in the same `tab_behavior` layout), insert:

```xml
                            <item>
                                <widget class="QGroupBox" name="kcfg_pullIndicatorEnabled">
                                    <property name="title">
                                        <string>Show a pull indicator while dragging</string>
                                    </property>
                                    <property name="toolTip">
                                        <string>Show a filled arc growing beneath the dragged window's top edge as a pull-to-rearrange gesture progresses</string>
                                    </property>
                                    <property name="checkable">
                                        <bool>true</bool>
                                    </property>
                                    <property name="checked">
                                        <bool>true</bool>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_pullIndicator">
                                        <item row="0" column="0">
                                            <widget class="QLabel" name="label_pullIndicatorOpacity">
                                                <property name="text">
                                                    <string>Opacity:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="0" column="1">
                                            <widget class="QDoubleSpinBox" name="kcfg_pullIndicatorOpacity">
                                                <property name="toolTip">
                                                    <string>Peak opacity of the pull indicator, reached once the pull reaches its trigger</string>
                                                </property>
                                                <property name="decimals">
                                                    <number>2</number>
                                                </property>
                                                <property name="minimum">
                                                    <double>0.0</double>
                                                </property>
                                                <property name="maximum">
                                                    <double>1.0</double>
                                                </property>
                                                <property name="singleStep">
                                                    <double>0.05</double>
                                                </property>
                                                <property name="value">
                                                    <double>0.5</double>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
                                </widget>
                            </item>
```

- [ ] **Step 3: Verify the UI file is well-formed**

`make ui` (copies `drift/ui/*` into `.build/drift/contents/ui/` — fails loudly on malformed XML)
Expected: succeeds, no errors

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Widget naming matches existing `kcfg_<settingName>`/`label_<settingName>` convention
- [ ] `make ui` succeeds
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: Pull indicator fragment shader

**Files:**
- Create: `drift/shaders/pull_indicator.frag`

- [ ] **Step 1: Write the shader**

```glsl
#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 glowColor;  // accent color; only .rgb is read, straight (non-premultiplied)
    vec2 itemSize;   // effect item size in px — the item's own top edge (y=0) is always the
                      // window's top edge (the segment's chord), since the overlay dialog is
                      // positioned there every tick (see pull-indicator-overlay.ts)
    vec2 center;     // circumcircle center, item-local px (see pull-indicator.ts:pullIndicatorCircle)
    float radius;    // circumcircle radius, px
    float alpha;     // pullIndicatorAlpha(dyTotal, triggerPx) * pullIndicatorOpacity, computed
                      // on the TS side
};
// Filled circular segment: the region below the chord (item-local y >= 0) and within radius of
// center — every point on that region's curved boundary (the arc) sits at exactly `radius` from
// `center` by construction (docs: 2026-09-16-drag-pull-threshold-indicator-design), so a plain
// radial mix from 0 at the center to `alpha` at the radius reads as a uniform band along the
// whole arc, fading toward the chord.
void main() {
    vec2 p = qt_TexCoord0 * itemSize;
    float dist = distance(p, center);
    bool inSegment = p.y >= 0.0 && dist <= radius;
    float a = inSegment ? (dist / radius) * alpha * qt_Opacity : 0.0;
    fragColor = vec4(glowColor.rgb, 1.0) * a; // premultiplied
}
```

- [ ] **Step 2: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Shader follows `focus_glow.frag`'s existing uniform-buffer layout convention
- [ ] Any convention violations fixed before moving to next task

(Compilation to `.qsb` is wired in Task 6; this shader isn't runnable in isolation until then.)

---

## Task 6: Makefile — compile every shader in `drift/shaders/`, not just one

**Files:**
- Modify: `Makefile:20-21` and `Makefile:68-71`

- [ ] **Step 1: Generalize the shader build rule**

Replace:

```makefile
SHADER_SRC := drift/shaders/focus_glow.frag
SHADER_QSB := $(CONTENTS_DIR)/shaders/focus_glow.frag.qsb
```

with:

```makefile
SHADER_SRCS := $(shell find drift/shaders -type f -name '*.frag')
SHADER_QSBS := $(patsubst drift/shaders/%.frag,$(CONTENTS_DIR)/shaders/%.frag.qsb,$(SHADER_SRCS))
```

Replace:

```makefile
$(SHADER_QSB): $(SHADER_SRC) scripts/compile-shaders.sh
	scripts/compile-shaders.sh $(SHADER_SRC) $(SHADER_QSB)

shaders: $(SHADER_QSB)
```

with:

```makefile
$(CONTENTS_DIR)/shaders/%.frag.qsb: drift/shaders/%.frag scripts/compile-shaders.sh
	@mkdir -p $(dir $@)
	scripts/compile-shaders.sh $< $@

shaders: $(SHADER_QSBS)
```

- [ ] **Step 2: Run the shader build**

`make shaders`
Expected: both `.build/drift/contents/shaders/focus_glow.frag.qsb` and
`.build/drift/contents/shaders/pull_indicator.frag.qsb` are produced, no errors.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `make shaders` succeeds and produces both `.qsb` files
- [ ] Any convention violations fixed before moving to next task

---

## Task 7: QML dialog type declaration

**Files:**
- Modify: `drift/src/types/kwin.d.ts` (after `QmlFocusFlashDialog`, ~line 196)

- [ ] **Step 1: Add the type**

After the `QmlFocusFlashDialog` interface, insert:

```ts
/** The dynamically-created pull indicator overlay dialog: a filled circular-segment arc grown
 * beneath a dragged window's top edge while a pull-to-rearrange gesture is in progress (docs:
 * 2026-09-16-drag-pull-threshold-indicator-design). `centerX`/`centerY`/`radius` are the
 * circumcircle `pull-indicator.ts:pullIndicatorCircle` computes, in item-local px; `alpha` is
 * `pullIndicatorAlpha(...) * pullIndicatorOpacity`. */
interface QmlPullIndicatorDialog extends QmlObject {
    centerX: number;
    centerY: number;
    radius: number;
    alpha: number;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    visible: boolean;
}
```

- [ ] **Step 2: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (`PascalCase` interface, `camelCase` members)
- [ ] Any convention violations fixed before moving to next task

---

## Task 8: Pull indicator overlay (KWin glue)

No unit test — this is KWin-facing QML glue, same convention `focus-flash-overlay.ts` already
has no test file for. Verified by `make build` (Task 14) and manual live-testing.

**Files:**
- Create: `drift/src/kwin/pull-indicator-overlay.ts`

- [ ] **Step 1: Write the module**

```ts
// A filled circular-segment overlay grown beneath a dragged window's top edge while a
// pull-to-rearrange gesture is in progress (docs:
// 2026-09-16-drag-pull-threshold-indicator-design). Built via `Qt.createQmlObject`, the same
// pattern as `focus-flash-overlay.ts`.

import { pullIndicatorAlpha, pullIndicatorCircle } from '../input/pull-indicator';
import { createQmlTimer } from './qml-timer';
import type { WindowAdapter } from './window-adapter';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const PULL_INDICATOR_OVERLAY_WINDOW_TITLE = 'Drift Pull Indicator';

/** How long the abort fade-out takes, in milliseconds — fixed, not user-configurable (docs:
 * 2026-09-16-drag-pull-threshold-indicator-design, Out of Scope). */
const ABORT_FADE_MS = 150;

const PULL_INDICATOR_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
PlasmaCore.Dialog {
    id: dialog
    property real centerX: 0
    property real centerY: 0
    property real radius: 1
    property real alpha: 0
    title: "${PULL_INDICATOR_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: ShaderEffect {
        id: root
        width: dialog.width
        height: dialog.height
        implicitWidth: dialog.width
        implicitHeight: dialog.height
        property color glowColor: Kirigami.Theme.highlightColor
        property vector2d itemSize: Qt.vector2d(width, height)
        property vector2d center: Qt.vector2d(dialog.centerX, dialog.centerY)
        property real radius: dialog.radius
        property real alpha: dialog.alpha
        fragmentShader: Qt.resolvedUrl("../shaders/pull_indicator.frag.qsb")
    }
}`;

export interface PullIndicatorOverlay {
    /** Repositions/resizes to `win`'s current frame and grows the arc for this tick's
     * `dyTotal` — a pull distance in pixels measured from drag start, not the window's own
     * (pinned) rendered position. Hides immediately if `dyTotal <= 0` or the overlay is
     * disabled. */
    update(win: WindowAdapter, dyTotal: number, triggerPx: number): void;
    /** Vanishes instantly, no fade — used the tick a drag frees, and on drag finish/cancel. */
    hide(): void;
    /** Fades out over `ABORT_FADE_MS` — used the tick a pull latches aborted. */
    fadeOut(): void;
}

/** No-op stand-in used as the default `pullIndicator` dependency wherever a real KWin overlay
 * isn't wired up — every existing `Strip`/`StripStack`/`StripManager` test, and any construction
 * path that predates this feature. Plays the same role `TransientLinks`'s own defaulted
 * constructor parameter does one layer up (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
export const NOOP_PULL_INDICATOR: PullIndicatorOverlay = {
    update: () => {},
    hide: () => {},
    fadeOut: () => {},
};

/** `tickMs` reuses the viewport's own animation clock interval (`ANIMATION_TICK_MS`), same as
 * `createFocusFlashOverlay`. `enabled` is fixed at construction time, same as every other
 * setting in this codebase — Drift settings all take effect on restart, not live. */
export function createPullIndicatorOverlay(
    parent: QmlObject,
    tickMs: number,
    opacity: number,
    enabled: boolean,
): PullIndicatorOverlay {
    const dialog = Qt.createQmlObject(PULL_INDICATOR_QML, parent) as QmlPullIndicatorDialog;
    dialog.opacity = 0;
    dialog.visible = true;
    const fadeTimer = createQmlTimer(parent);
    let fadeStartedAt = 0;

    return {
        update(win: WindowAdapter, dyTotal: number, triggerPx: number): void {
            fadeTimer.stop();
            if (!enabled || dyTotal <= 0) {
                dialog.opacity = 0;
                return;
            }
            const frame = win.frameGeometry();
            const circle = pullIndicatorCircle(frame.width, dyTotal);
            dialog.x = frame.x;
            dialog.y = frame.y;
            dialog.width = frame.width;
            dialog.height = Math.max(dyTotal, 1);
            dialog.centerX = circle.cx;
            dialog.centerY = circle.cy;
            dialog.radius = circle.r;
            dialog.alpha = pullIndicatorAlpha(dyTotal, triggerPx) * opacity;
            dialog.opacity = 1;
        },
        hide(): void {
            fadeTimer.stop();
            dialog.opacity = 0;
        },
        fadeOut(): void {
            fadeTimer.stop();
            if (!enabled) {
                return;
            }
            fadeStartedAt = Date.now();
            const startOpacity = dialog.opacity;
            fadeTimer.start(tickMs, () => {
                const elapsed = Date.now() - fadeStartedAt;
                if (elapsed >= ABORT_FADE_MS) {
                    dialog.opacity = 0;
                    fadeTimer.stop();
                    return;
                }
                dialog.opacity = startOpacity * (1 - elapsed / ABORT_FADE_MS);
            });
        },
    };
}
```

- [ ] **Step 2: Lint the new file**

`$(NPM_BIN)/eslint drift/src/kwin/pull-indicator-overlay.ts`
Expected: no errors. (A full `npm run build`/`npm test` is deliberately **not** run yet — at this
point in the plan, Task 2 has already deleted `drag-pan.ts` but Task 9 hasn't yet removed
`drag.ts`'s import of it, so a full project build would fail for a reason unrelated to this
task's own code. The first full build/test after that transitional gap closes is Task 9's own
Step 11; the final end-to-end one is Task 14.)

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (`camelCase` functions, `PascalCase` interface/exported const casing as shown)
- [ ] Lint passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 9: `drag.ts` — threshold-only pull mechanism + indicator wiring

No unit test — `drag.ts`'s own wiring is untested glue, per the file's existing convention
(confirmed in the design doc's Testing section). Verified by `make build` (Task 14) and manual
live-testing.

**Files:**
- Modify: `drift/src/input/drag.ts`

- [ ] **Step 1: Remove the `dragPanHolding` import**

Delete:

```ts
import { dragPanHolding } from './drag-pan';
```

- [ ] **Step 2: Add the `PullIndicatorOverlay` import**

Add, alongside the other imports near the top of the file:

```ts
import type { PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
```

- [ ] **Step 3: Update `DragReorderDeps`**

Replace:

```ts
    /** Whether dragging defaults to pan mode with a dwell-to-free gesture, or is fully inert
     * (`settings.dragPanEnabled`) — see `dragPanHolding` (docs: 2026-09-12-drag-pan-dwell-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical pull, in pixels, before a hold can start counting
     * (`settings.dragPanVerticalTriggerPx`) — see `dragPanHolding`. */
    dragPanVerticalTriggerPx: number;
    /** Horizontal drift, in pixels, allowed since a hold started before it's canceled
     * (`settings.dragPanHorizontalTolerancePx`) — see `dragPanHolding`. */
    dragPanHorizontalTolerancePx: number;
    /** Read access to the real pointer position — used to re-seed the dragged window's geometry
     * to its true cursor-relative position the instant a hold-to-free gesture fires, closing the
     * gap left by pinning `y` during pan mode in one write instead of leaving KWin's own tracking
     * to close it incrementally (docs: 2026-09-12-drag-pan-dwell-design). */
    workspace: Pick<WorkspaceAdapter, 'cursorPos'>;
    /** Builds the dwell timer for the pan-to-drag-mode hold gesture, firing `onFire` once held
     * past `dragPanFreeDwellMs` — one instance per drag-reorder connection, reused across every
     * drag that window does, same pattern as `createStackDwell` (docs:
     * 2026-09-12-drag-pan-dwell-design). */
    createPanFreeDwell(onFire: () => void): DwellTimer<true>;
```

with:

```ts
    /** Whether dragging defaults to pan mode with a pull-to-free gesture, or is fully inert
     * (`settings.dragPanEnabled`) — see the threshold checks in `tickInner` below (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical pull, in pixels, that frees the drag immediately — no hold, no dwell
     * (`settings.dragPanVerticalTriggerPx`). */
    dragPanVerticalTriggerPx: number;
    /** Cumulative horizontal drift, in pixels, measured from drag start, that permanently aborts
     * the pull for the rest of this drag once reached before the vertical trigger is
     * (`settings.dragPanHorizontalTolerancePx`). */
    dragPanHorizontalTolerancePx: number;
    /** Read access to the real pointer position — used to re-seed the dragged window's geometry
     * to its true cursor-relative position the instant the pull frees, closing the gap left by
     * pinning `y` during pan mode in one write instead of leaving KWin's own tracking to close it
     * incrementally (docs: 2026-09-12-drag-pan-dwell-design). */
    workspace: Pick<WorkspaceAdapter, 'cursorPos'>;
    /** Grows/fades the pull indicator overlay while a pull is in progress — one shared instance
     * threaded through every drag-reorder connection, not built per-connection (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    pullIndicator: PullIndicatorOverlay;
```

- [ ] **Step 4: Update the connection-local state**

Replace:

```ts
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which stack target's compound key (`` `${columnId}:${tileId}:${direction}` ``) the
     * dwell has actually FIRED for — null while merely hovering, before the dwell elapses.
     * Only a fired key shows a preview. */
    let armedStackKey: string | null = null;
    /** The dragged window's real (screen) y at the start of the current drag — the baseline
     * `dragPanHolding`'s cumulative `dyTotal` is measured against. Seeded here (not just in
     * `onInteractiveMoveResizeStarted`) so an `initiallyDragging` connection — created
     * mid-drag by a cross-strip reparent — has a sane starting value even though it never
     * sees that signal fire (docs: 2026-09-12-drag-pan-dwell-design). */
    let startY = win.frameGeometry().y;
    /** The dragged window's real (screen) x as of the last tick — this tick's raw
     * horizontal delta (`dxTick`) is measured against it. */
    let lastX = win.frameGeometry().x;
    /** `startY` minus the real pointer's y at drag start — lets the freeing moment place the
     * window at exactly where an un-pinned drag would have put it (`cursorPos().y +
     * grabOffsetY`), instead of leaving KWin's own tracking to close the gap incrementally
     * (docs: 2026-09-12-drag-pan-dwell-design). */
    let grabOffsetY = startY - deps.workspace.cursorPos().y;
    /** The dragged window's real x when the current hold-to-free gesture started (null while
     * not holding) — horizontal drift is measured cumulatively from here, not per tick, so
     * ordinary hand tremor doesn't cancel the hold. */
    let holdStartX: number | null = null;
    /** Whether this drag has earned full reorder/stack/cross-strip-drag behavior. Starts at
     * `initiallyFreed` for a connection created mid-drag by a cross-strip reparent (see
     * `onEdgeDwellFired` in `strip-stack.ts`, which will thread `initiallyFreed: true` through
     * this path once wired up — by construction, since cross-strip moves can only ever fire
     * once already freed); every later genuinely new drag on this same window/connection starts
     * unfree again, same as `dragging` always starts fresh rather than reusing `initiallyDragging`. */
    let freed = initiallyFreed;
    /** Re-entrancy guard: `win.setFrameGeometry` below fires `onFrameGeometryChanged`
     * synchronously, before the call returns, which would otherwise re-enter `tickInner`
     * mid-tick and corrupt `lastX`/the hold state (docs: 2026-09-12-drag-pan-dwell-design). */
    let applyingPin = false;
```

with:

```ts
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which stack target's compound key (`` `${columnId}:${tileId}:${direction}` ``) the
     * dwell has actually FIRED for — null while merely hovering, before the dwell elapses.
     * Only a fired key shows a preview. */
    let armedStackKey: string | null = null;
    /** The dragged window's real (screen) y/x at the start of the current drag — the baseline
     * both the vertical free-threshold and horizontal abort-threshold are measured against,
     * cumulatively, for the whole drag. Seeded here (not just in `onInteractiveMoveResizeStarted`)
     * so an `initiallyDragging` connection — created mid-drag by a cross-strip reparent — has a
     * sane starting value even though it never sees that signal fire (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    let startY = win.frameGeometry().y;
    let startX = win.frameGeometry().x;
    /** The dragged window's real (screen) x as of the last tick — this tick's raw
     * horizontal delta (`dxTick`) is measured against it. */
    let lastX = win.frameGeometry().x;
    /** `startY` minus the real pointer's y at drag start — lets the freeing moment place the
     * window at exactly where an un-pinned drag would have put it (`cursorPos().y +
     * grabOffsetY`), instead of leaving KWin's own tracking to close the gap incrementally
     * (docs: 2026-09-12-drag-pan-dwell-design). */
    let grabOffsetY = startY - deps.workspace.cursorPos().y;
    /** Whether this drag has earned full reorder/stack/cross-strip-drag behavior. Starts at
     * `initiallyFreed` for a connection created mid-drag by a cross-strip reparent (see
     * `onEdgeDwellFired` in `strip-stack.ts`, which will thread `initiallyFreed: true` through
     * this path once wired up — by construction, since cross-strip moves can only ever fire
     * once already freed); every later genuinely new drag on this same window/connection starts
     * unfree again, same as `dragging` always starts fresh rather than reusing `initiallyDragging`. */
    let freed = initiallyFreed;
    /** Latches once cumulative horizontal drift exceeds `dragPanHorizontalTolerancePx` before
     * the pull frees — once set, never re-checked or reset for the rest of this drag, even if
     * the pointer drifts back under tolerance: the user has to release and start a new drag to
     * try pulling again (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    let pullAborted = false;
    /** Re-entrancy guard: `win.setFrameGeometry` below fires `onFrameGeometryChanged`
     * synchronously, before the call returns, which would otherwise re-enter `tickInner`
     * mid-tick and corrupt `lastX`/the pan state (docs: 2026-09-12-drag-pan-dwell-design). */
    let applyingPin = false;
```

- [ ] **Step 5: Reset `pullAborted` (and seed `startX`) on drag start**

Replace:

```ts
    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            lastX = rect.x;
            grabOffsetY = startY - deps.workspace.cursorPos().y;
            holdStartX = null;
            freed = false;
            deps.onDragStarted?.(win);
        }
    });
```

with:

```ts
    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            startX = rect.x;
            lastX = rect.x;
            grabOffsetY = startY - deps.workspace.cursorPos().y;
            freed = false;
            pullAborted = false;
            deps.onDragStarted?.(win);
        }
    });
```

- [ ] **Step 6: Replace the dwell-fire callback with a plain `freeFromPan` function**

Replace:

```ts
    // Fires once the hold-to-free gesture (dragPanHolding) has held steady past
    // dragPanFreeDwellMs. Re-seeds the window to its true pointer-relative position — closing
    // the gap `y`-pinning left behind in one write — then lets tickInner's normal reorder/stack
    // logic take over from the very next tick (docs: 2026-09-12-drag-pan-dwell-design).
    const panFreeDwell = deps.createPanFreeDwell(() => {
        freed = true;
        const raw = win.frameGeometry();
        const cursor = deps.workspace.cursorPos();
        applyingPin = true;
        win.setFrameGeometry({ x: raw.x, y: cursor.y + grabOffsetY, width: raw.width, height: raw.height });
        applyingPin = false;
    });
```

with:

```ts
    /** Frees the drag from pan mode: re-seeds the window to its true pointer-relative position —
     * closing the gap `y`-pinning left behind in one write — then lets tickInner's normal
     * reorder/stack logic take over from the very next tick (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    const freeFromPan = (): void => {
        freed = true;
        deps.pullIndicator.hide();
        const raw = win.frameGeometry();
        const cursor = deps.workspace.cursorPos();
        applyingPin = true;
        win.setFrameGeometry({ x: raw.x, y: cursor.y + grabOffsetY, width: raw.width, height: raw.height });
        applyingPin = false;
    };
```

- [ ] **Step 7: Rewrite the pan/pin block in `tickInner`**

Replace:

```ts
        // Pan step: while dragPanEnabled and not yet freed, the drag is pinned pan-only —
        // y stays at startY, x's movement redirects into the viewport instead of the window's
        // virtual position, and reorder/edge-expel/stack below never runs at all (the early
        // return, not just the offset math, is what makes that true — docs:
        // 2026-09-12-drag-pan-dwell-design). Gating on `deps.dragPanEnabled && !freed` together
        // (not `freed` alone) matters: `freed` never becomes true when the feature is disabled,
        // so gating on it alone would wrongly keep this block — and reorder/stack below —
        // blocked forever whenever dragPanEnabled is false.
        if (deps.dragPanEnabled && !freed) {
            const raw = win.frameGeometry();
            const dyTotal = Math.abs(raw.y - startY);
            const driftSinceHoldStartPx = holdStartX === null ? 0 : raw.x - holdStartX;
            if (
                dragPanHolding(
                    dyTotal,
                    driftSinceHoldStartPx,
                    deps.dragPanVerticalTriggerPx,
                    deps.dragPanHorizontalTolerancePx,
                )
            ) {
                holdStartX ??= raw.x;
                panFreeDwell.update(true);
            } else {
                holdStartX = null;
                panFreeDwell.update(null);
            }

            const dxTick = raw.x - lastX;
            if (dxTick !== 0) {
                deps.viewport.setOffset(deps.viewport.offset() - dxTick);
            }
            lastX = raw.x;

            applyingPin = true;
            win.setFrameGeometry({ x: raw.x, y: startY, width: raw.width, height: raw.height });
            applyingPin = false;
            // Every other tickInner exit path ends by calling deps.render(...) — this one must too,
            // or the viewport.setOffset() above only takes visible effect once finishedInner's
            // unconditional render() fires on release, instead of live during the drag.
            deps.render(win.id, false);
            return;
        }
```

with:

```ts
        // Pan step: while dragPanEnabled and not yet freed, the drag is pinned pan-only —
        // y stays at startY, x's movement redirects into the viewport instead of the window's
        // virtual position, and reorder/edge-expel/stack below never runs at all (the early
        // return, not just the offset math, is what makes that true). Freeing and aborting are
        // both instant, one-shot threshold checks against cumulative movement since drag start —
        // no dwell, no hold (docs: 2026-09-16-drag-pull-threshold-indicator-design). Gating on
        // `deps.dragPanEnabled && !freed` together (not `freed` alone) matters: `freed` never
        // becomes true when the feature is disabled, so gating on it alone would wrongly keep
        // this block — and reorder/stack below — blocked forever whenever dragPanEnabled is false.
        if (deps.dragPanEnabled && !freed) {
            const raw = win.frameGeometry();
            const dyTotal = Math.abs(raw.y - startY);
            const dxTotal = Math.abs(raw.x - startX);

            if (!pullAborted && dyTotal >= deps.dragPanVerticalTriggerPx) {
                freeFromPan();
                // Every other tickInner exit path ends by calling deps.render(...) — this one
                // must too, consistent with that invariant.
                deps.render(win.id, false);
                return;
            }

            if (!pullAborted && dxTotal >= deps.dragPanHorizontalTolerancePx) {
                // Latched, not reset: the user has to release and start a new drag to try
                // pulling again (docs: 2026-09-16-drag-pull-threshold-indicator-design).
                pullAborted = true;
                deps.pullIndicator.fadeOut();
            } else if (!pullAborted) {
                deps.pullIndicator.update(win, dyTotal, deps.dragPanVerticalTriggerPx);
            }

            const dxTick = raw.x - lastX;
            if (dxTick !== 0) {
                deps.viewport.setOffset(deps.viewport.offset() - dxTick);
            }
            lastX = raw.x;

            applyingPin = true;
            win.setFrameGeometry({ x: raw.x, y: startY, width: raw.width, height: raw.height });
            applyingPin = false;
            // Every other tickInner exit path ends by calling deps.render(...) — this one must too,
            // or the viewport.setOffset() above only takes visible effect once finishedInner's
            // unconditional render() fires on release, instead of live during the drag.
            deps.render(win.id, false);
            return;
        }
```

- [ ] **Step 8: Replace `panFreeDwell.stop()` with `deps.pullIndicator.hide()` in `finishedInner`**

Replace (inside `finishedInner`):

```ts
        dragging = false;
        stackDwell.stop();
        panFreeDwell.stop();
        armedStackKey = null;
```

with:

```ts
        dragging = false;
        stackDwell.stop();
        deps.pullIndicator.hide();
        armedStackKey = null;
```

- [ ] **Step 9: Do the same in `disconnectFinished`'s catch block**

Replace:

```ts
            dragging = false;
            stackDwell.stop();
            panFreeDwell.stop();
            armedStackKey = null;
            lastStackHover = null;
            deps.onDragFinished?.();
```

with:

```ts
            dragging = false;
            stackDwell.stop();
            deps.pullIndicator.hide();
            armedStackKey = null;
            lastStackHover = null;
            deps.onDragFinished?.();
```

- [ ] **Step 10: Do the same in the returned disconnect function**

Replace:

```ts
    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
        panFreeDwell.stop();
    };
```

with:

```ts
    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
        deps.pullIndicator.hide();
    };
```

- [ ] **Step 11: Narrow check only — full build is deferred**

`$(NPM_BIN)/eslint drift/src/input/drag.ts` and `npm test -- drag-hover`
Expected: no errors; `drag-hover.test.ts` (the one existing suite that imports from this same
directory) still passes. A full `npm run build`/`npm test` is deliberately **not** run yet:
`drag.ts`'s `DragReorderDeps` interface just changed (`createPanFreeDwell` removed,
`pullIndicator` now required), but `strip.ts` — the only place that builds a `DragReorderDeps`
object literal — isn't fixed to match until Task 10. Running a full build/test between these two
tasks would fail in `strip.ts` for a reason this task's own code doesn't have. The first full
build/test that exercises this file end-to-end is Task 10's Step 4.

- [ ] **Step 12: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm run build` and `npm test` passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 10: `Strip` — thread the pull indicator into `registerDragReorder`

No unit test for the wiring itself (glue code); existing `strip.test.ts` suites must keep passing
unchanged since the new parameter is defaulted.

**Files:**
- Modify: `drift/src/runtime/strip.ts`

- [ ] **Step 1: Import the overlay types**

Add, alongside `strip.ts`'s other imports:

```ts
import { NOOP_PULL_INDICATOR, type PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
```

- [ ] **Step 2: Add the defaulted constructor parameter**

Replace:

```ts
    constructor(
        area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly transientLinks: TransientLinks = new TransientLinks(),
    ) {
```

with:

```ts
    constructor(
        area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly transientLinks: TransientLinks = new TransientLinks(),
        private readonly pullIndicator: PullIndicatorOverlay = NOOP_PULL_INDICATOR,
    ) {
```

- [ ] **Step 3: Replace `createPanFreeDwell` with `pullIndicator` in `wireTile`'s `DragReorderDeps`**

Replace:

```ts
                    workspace: this.workspaceAdapter,
                    createPanFreeDwell: (onFire: () => void) =>
                        new DwellTimer<true>(
                            this.ticker.subscribe(),
                            () => Date.now(),
                            ANIMATION_TICK_MS,
                            this.settings.dragPanFreeDwellMs,
                            onFire,
                        ),
                    createStackDwell: (onFire: (key: string) => void) =>
```

with:

```ts
                    workspace: this.workspaceAdapter,
                    pullIndicator: this.pullIndicator,
                    createStackDwell: (onFire: (key: string) => void) =>
```

- [ ] **Step 4: Run the existing strip test suite**

`npm test -- strip.test`
Expected: PASS, unchanged — every `new Strip(...)` call site keeps compiling because the new
parameter is defaulted.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test -- strip.test` passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 11: `StripStack` — thread `pullIndicator` through to `Strip`

**Files:**
- Modify: `drift/src/runtime/strip-stack.ts`

- [ ] **Step 1: Import the overlay types**

Add, alongside `strip-stack.ts`'s other imports:

```ts
import { NOOP_PULL_INDICATOR, type PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
```

- [ ] **Step 2: Update the `StripFactory` type**

Replace:

```ts
export type StripFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
) => Strip;
```

with:

```ts
export type StripFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
    pullIndicator: PullIndicatorOverlay,
) => Strip;
```

- [ ] **Step 3: Update the constructor**

Replace:

```ts
    constructor(
        private area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (area, settings, timer, workspaceAdapter, transientLinks) =>
            new Strip(area, settings, timer, workspaceAdapter, transientLinks),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
    ) {
```

with:

```ts
    constructor(
        private area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (
            area,
            settings,
            timer,
            workspaceAdapter,
            transientLinks,
            pullIndicator,
        ) => new Strip(area, settings, timer, workspaceAdapter, transientLinks, pullIndicator),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
        private readonly pullIndicator: PullIndicatorOverlay = NOOP_PULL_INDICATOR,
    ) {
```

- [ ] **Step 4: Pass `this.pullIndicator` at the `createStrip` call site**

Replace (in the `strip(index)` method):

```ts
            strip = this.createStrip(
                this.area,
                this.settings,
                this.ticker.subscribe(),
                this.workspaceAdapter,
                this.transientLinks,
            );
```

with:

```ts
            strip = this.createStrip(
                this.area,
                this.settings,
                this.ticker.subscribe(),
                this.workspaceAdapter,
                this.transientLinks,
                this.pullIndicator,
            );
```

- [ ] **Step 5: Run the existing strip-stack test suite**

`npm test -- strip-stack.test`
Expected: PASS, unchanged.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test -- strip-stack.test` passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 12: `StripManager` — thread `pullIndicator` through to `StripStack`

**Files:**
- Modify: `drift/src/runtime/strip-manager.ts`

- [ ] **Step 1: Import the overlay types**

Add, alongside `strip-manager.ts`'s other imports:

```ts
import { NOOP_PULL_INDICATOR, type PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
```

- [ ] **Step 2: Update the `StripStackFactory` type**

Replace:

```ts
export type StripStackFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
) => StripStack;
```

with:

```ts
export type StripStackFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
    pullIndicator: PullIndicatorOverlay,
) => StripStack;
```

- [ ] **Step 3: Update the constructor**

Replace:

```ts
        // undefined skips StripStack's own createStrip parameter positionally so it falls back to
        // its default, while still supplying transientLinks (the parameter after it).
        private readonly createStripStack: StripStackFactory = (
            area,
            settings,
            timer,
            workspaceAdapter,
            transientLinks,
        ) => new StripStack(area, settings, timer, workspaceAdapter, undefined, transientLinks),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
    ) {}
```

with:

```ts
        // undefined skips StripStack's own createStrip parameter positionally so it falls back to
        // its default, while still supplying transientLinks/pullIndicator (the parameters after it).
        private readonly createStripStack: StripStackFactory = (
            area,
            settings,
            timer,
            workspaceAdapter,
            transientLinks,
            pullIndicator,
        ) => new StripStack(area, settings, timer, workspaceAdapter, undefined, transientLinks, pullIndicator),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
        private readonly pullIndicator: PullIndicatorOverlay = NOOP_PULL_INDICATOR,
    ) {}
```

- [ ] **Step 4: Pass `this.pullIndicator` at the `createStripStack` call site**

Replace (in the `stack(key)` method):

```ts
            stack = this.createStripStack(
                this.area,
                this.settings,
                this.timer,
                this.workspaceAdapter,
                this.transientLinks,
            );
```

with:

```ts
            stack = this.createStripStack(
                this.area,
                this.settings,
                this.timer,
                this.workspaceAdapter,
                this.transientLinks,
                this.pullIndicator,
            );
```

- [ ] **Step 5: Run the existing test suite**

`npm test`
Expected: PASS, unchanged — this is the last DI layer, so this is the point to run the full
suite rather than just one file.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing (full suite)
- [ ] Any convention violations fixed before moving to next task

---

## Task 13: `Controller` — construct the real overlay and thread it in

**Files:**
- Modify: `drift/src/runtime/controller.ts`

- [ ] **Step 1: Import the overlay factory/type**

Add, alongside the other overlay imports:

```ts
import { createPullIndicatorOverlay, type PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
```

- [ ] **Step 2: Add the field**

Replace:

```ts
    private readonly focusFlashOverlay: FocusFlashOverlay;
```

with:

```ts
    private readonly focusFlashOverlay: FocusFlashOverlay;
    private readonly pullIndicatorOverlay: PullIndicatorOverlay;
```

- [ ] **Step 3: Construct it in the constructor, and pass it into `StripManager`**

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
        this.transientLinks = new TransientLinks();
        this.stripManager = new StripManager(
            this.area,
            settings,
            createQmlTimer(root),
            this.workspaceAdapter,
            undefined,
            this.transientLinks,
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
        this.pullIndicatorOverlay = createPullIndicatorOverlay(
            root,
            ANIMATION_TICK_MS,
            settings.pullIndicatorOpacity,
            settings.pullIndicatorEnabled,
        );
        this.transientLinks = new TransientLinks();
        this.stripManager = new StripManager(
            this.area,
            settings,
            createQmlTimer(root),
            this.workspaceAdapter,
            undefined,
            this.transientLinks,
            this.pullIndicatorOverlay,
        );
```

- [ ] **Step 4: Verify it compiles**

`npm run build`
Expected: no type errors

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm run build` passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 14: Full build, full test, manual live-test

**Files:** none (verification only)

- [ ] **Step 1: Full build**

`make build`
Expected: lint, test, compile, ui, bin-scripts, shaders, and package assembly all succeed —
this is the first point both `.frag` shaders and the new `config.ui` group are exercised together.

- [ ] **Step 2: Install and restart KWin**

`make install && make restart-kwin`

- [ ] **Step 3: Manual live-test checklist**

- [ ] Dragging a window down past `dragPanVerticalTriggerPx` (default 20px) frees it into
      reorder/stack mode **immediately**, with no perceptible hold/wait.
- [ ] The pull indicator (a filled arc under the window's top edge, in the theme's accent color)
      grows visibly as the pull approaches the trigger, and vanishes instantly the moment the
      window frees.
- [ ] Dragging sideways past `dragPanHorizontalTolerancePx` (default 10px) before pulling far
      enough vertically: the indicator fades out over ~150ms, and the pull can **not** be
      retried for the rest of that same drag — panning continues, but pulling straight down
      again does nothing. Releasing the mouse and starting a new drag lets the pull work again.
- [ ] `dragPanEnabled: false` in Settings reproduces pre-feature behavior exactly: no pin, no
      pan, no indicator, immediate reorder/stack from the first pixel of movement.
- [ ] `pullIndicatorEnabled: false` in Settings hides the indicator entirely while leaving the
      free/abort mechanism itself unaffected (dragging still frees/aborts at the same
      thresholds, just with no visual).
- [ ] Cross-strip drag (dragging a freed window to the screen's top/bottom edge) still works,
      unaffected by this change.
- [ ] No regressions in ordinary reorder/stack dragging once freed.

- [ ] **Step 4: Report results**

Record PASS/FAIL for each checklist item above with any observed discrepancies before
considering this plan complete.
