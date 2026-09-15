# Chevron Frame OSD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the strip-change OSD's shader-based full-screen glow with a vector "chevron frame" — four tapered bars hugging the screen edges, matching a reference asset (`~/Documents/drift_mock2.svg`) the user provided and iterated on live via an Artifact mockup this session (final version: https://claude.ai/artifact/DHVD5tAy3zqCGbJjXrnGcj, "Concept E").

**Architecture:** A new pure module, `src/ui/chevron-frame.ts`, computes the four bars' polygon points from `(width, height, thickness)`. Corner geometry (tip, taper, and the left/right-only notch) is fixed-size regardless of resolution; only the flat run between corners stretches — a 9-slice model, verified against the mockup at multiple aspect ratios. `src/kwin/strip-osd.ts` is rewritten to render these as `QtQuick.Shapes` `ShapePath`s (linear gradient fill for top/bottom, radial for left/right) instead of the current `ShaderEffect`, dropping the `focus_glow.frag` dependency for this one overlay (`focus-flash-overlay.ts` keeps using that shader, untouched).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Source of truth for the geometry ratios:** derived from `drift_mock2.svg`'s actual path data (not eyeballed) during this session's design iteration:
- Top/bottom bars: plain 4-point taper. `tip_inset = thickness × 0.91534`, `flare_run = thickness × 2.27035` (both ratios computed against the source's own top-bar thickness of 27.769909).
- Left/right bars: 8-point taper with an extra mid-length notch (top/bottom bars do NOT have this notch — keep that asymmetry, it's in the source). Local unit (tip at origin, scaled by `k = thickness / 43.97624`, the source's own left-bar thickness): `[(0,0), (43.97624,44.15056), (44.07536,122.731517), (29.53841,133.991333)] × k`.
- Color: single accent color, fading by **opacity only** (not a color-to-white gradient) — solid (opacity 1) at the edge facing desktop content, ~0.35 opacity at the outer/screen edge. This applies uniformly along the whole bar (thickness-direction fade), not lengthwise toward the tips.

---

## Task 1: `chevron-frame.ts` — pure geometry

**Files:**
- Create: `drift/src/ui/chevron-frame.ts`
- Test: `drift/src/ui/chevron-frame.test.ts`

- [x] **Step 1: Write the failing tests**

Create `drift/src/ui/chevron-frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chevronFramePoints } from './chevron-frame';

const TIP_INSET_RATIO = 25.41 / 27.769909;
const FLARE_RUN_RATIO = 63.04688 / 27.769909;

describe('chevronFramePoints', () => {
    it('places the top bar tips at the tip-inset ratio times thickness, at y=0', () => {
        const { top } = chevronFramePoints(400, 250, 18);
        expect(top[0]).toEqual({ x: 18 * TIP_INSET_RATIO, y: 0 });
        expect(top[3].y).toBe(0);
        expect(top[3].x).toBeCloseTo(400 - 18 * TIP_INSET_RATIO, 5);
    });

    it('places the top bar flare vertices at thickness depth', () => {
        const { top } = chevronFramePoints(400, 250, 18);
        expect(top[1].y).toBe(18);
        expect(top[2].y).toBe(18);
        expect(top[1].x).toBeCloseTo(18 * TIP_INSET_RATIO + 18 * FLARE_RUN_RATIO, 5);
    });

    it('mirrors the bottom bar from the top bar vertically', () => {
        const { top, bottom } = chevronFramePoints(400, 250, 18);
        for (let i = 0; i < top.length; i += 1) {
            expect(bottom[i].x).toBeCloseTo(top[i].x, 5);
            expect(bottom[i].y).toBeCloseTo(250 - top[i].y, 5);
        }
    });

    it('gives the left bar 8 points: tip, flare, notch-in, flat run, notch-out, flare, tip', () => {
        const { left } = chevronFramePoints(400, 250, 18);
        expect(left).toHaveLength(8);
        expect(left[0]).toEqual({ x: 0, y: 0 });
        expect(left[7]).toEqual({ x: 0, y: 250 });
    });

    it('mirrors the right bar from the left bar horizontally', () => {
        const { left, right } = chevronFramePoints(400, 250, 18);
        for (let i = 0; i < left.length; i += 1) {
            expect(right[i].x).toBeCloseTo(400 - left[i].x, 5);
            expect(right[i].y).toBeCloseTo(left[i].y, 5);
        }
    });

    it('keeps corner geometry identical across different screen sizes — only the flat run changes', () => {
        const small = chevronFramePoints(1600, 900, 18);
        const large = chevronFramePoints(3840, 2160, 18);
        // The first two points of `top` (left tip + left flare vertex) depend only on
        // thickness, not on width/height — they must match exactly.
        expect(small.top[0]).toEqual(large.top[0]);
        expect(small.top[1]).toEqual(large.top[1]);
        // The left bar's TOP corner unit (its first 4 points: tip down to the notch) is
        // anchored to y=0 and depends only on thickness, so it must match exactly regardless
        // of height. The last 4 points are mirrored from the bottom (anchored to y=height
        // instead), so they necessarily differ between a 900px-tall and 2160px-tall screen —
        // only the top unit is asserted here.
        expect(small.left.slice(0, 4)).toEqual(large.left.slice(0, 4));
        // But the top bar's right-side points (which depend on width) must differ between sizes.
        expect(small.top[2]).not.toEqual(large.top[2]);
    });

    it('scales the notch geometry with thickness', () => {
        const thin = chevronFramePoints(400, 250, 9);
        const thick = chevronFramePoints(400, 250, 18);
        expect(thick.left[1].x).toBeCloseTo(thin.left[1].x * 2, 5);
        expect(thick.left[1].y).toBeCloseTo(thin.left[1].y * 2, 5);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

```sh
make test
```

Expected: FAIL — `drift/src/ui/chevron-frame.ts` doesn't exist yet.

- [x] **Step 3: Write the implementation**

Create `drift/src/ui/chevron-frame.ts`:

```ts
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
 * notch), scaled against the source SVG's own left-bar thickness (43.97624). */
const NOTCH_SOURCE_THICKNESS = 43.97624;
const NOTCH_UNIT_RAW: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [43.97624, 44.15056],
    [44.07536, 122.731517],
    [29.53841, 133.991333],
];

/** Computes the four chevron-frame bars for a `width`×`height` screen, at a given `thickness`.
 * Corner geometry depends only on `thickness`; the flat run between corners on each bar
 * stretches with `width`/`height`. */
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
    const unit: Point[] = NOTCH_UNIT_RAW.map(([x, y]) => ({ x: x * k, y: y * k }));
    // .slice()/.concat() instead of spread — KWin's JS engine doesn't support SpreadElement
    // (enforced by this project's eslint no-restricted-syntax rule).
    const mirrored: Point[] = unit.slice().reverse().map((p) => ({ x: p.x, y: height - p.y }));
    const left: Point[] = unit.concat(mirrored);
    const right: Point[] = left.map((p) => ({ x: width - p.x, y: p.y }));

    return { top, bottom, left, right };
}
```

- [x] **Step 4: Run test to verify it passes**

```sh
make test
```

Expected: PASS

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` function/params, `UPPER_SNAKE_CASE` module constants, `PascalCase` interfaces)
- [ ] Lowercase kebab-case filename (`chevron-frame.ts`)
- [ ] No KWin imports — this module stays pure, matching `strip-identity.ts`'s pattern
- [ ] Step 4's command executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: Rewrite `strip-osd.ts` to render the chevron frame via `QtQuick.Shapes`

**Files:**
- Modify: `drift/src/kwin/strip-osd.ts`
- Modify: `drift/src/types/kwin.d.ts`

No test file — this is QML glue, untestable without a live compositor, same as the rest of this file and `minimap-overlay.ts`/`focus-flash-overlay.ts`. Verified structurally here (typecheck/lint) and live in Task 3.

**Important — you have latitude on exact QML syntax here.** The geometry and gradient *intent* below (which points, which gradient type, which direction) is fixed by Task 1's module and the design doc; the *exact* `QtQuick.Shapes` property names/structure should be checked against Qt 6's actual `ShapePath`/`PathPolyline`/`LinearGradient`/`RadialGradient` API if anything here doesn't `qmllint` cleanly or doesn't compile — fix the QML, not the geometry or gradient direction. If you hit a wall you can't resolve, report BLOCKED with specifics rather than guessing indefinitely.

- [x] **Step 1: Add points/color plumbing to the QML dialog type**

In `drift/src/types/kwin.d.ts`, replace the `QmlStripOsdDialog` interface's `glowRgb`/`glowRadius` fields (keep `label`/`x`/`y`/`width`/`height`/`opacity`/`visible` as-is):

```ts
interface QmlStripOsdDialog extends QmlObject {
    frameColor: unknown;
    topPoints: unknown;
    bottomPoints: unknown;
    leftPoints: unknown;
    rightPoints: unknown;
    thickness: number;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    visible: boolean;
}
```

- [x] **Step 2: Rewrite `strip-osd.ts`**

Replace the whole file's content with (adjust QML property names inside `STRIP_OSD_QML` if `qmllint`/compilation says otherwise, per the note above — keep the TS-side function signatures and exported names exactly as shown):

```ts
// A vector "chevron frame" hugging the screen edges, flashed whenever the active strip
// actually changes (docs: 2026-09-14-strip-navigation-hints-design). Geometry comes from
// ui/chevron-frame.ts (pure, tested); this file only turns that into QtQuick.Shapes QML. Built
// via Qt.createQmlObject, the same pattern as focus-flash-overlay.ts/minimap-overlay.ts.

import type { Rect } from '../core/coordinates';
import { chevronFramePoints, type Point } from '../ui/chevron-frame';
import { flashOpacity } from '../ui/focus-flash';
import { stripColor } from '../ui/strip-identity';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const STRIP_OSD_WINDOW_TITLE = 'Drift Strip OSD';

const STRIP_OSD_QML = `import QtQuick 6.0
import QtQuick.Shapes
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property real thickness: 18
    property var frameColor: ({ r: 1, g: 1, b: 1 })
    property var topPoints: []
    property var bottomPoints: []
    property var leftPoints: []
    property var rightPoints: []
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
        function toQmlPoints(pts) {
            return pts.map(function (p) { return Qt.point(p.x, p.y); });
        }
        function frameQColor(alpha) {
            return Qt.rgba(dialog.frameColor.r, dialog.frameColor.g, dialog.frameColor.b, alpha);
        }
        Shape {
            anchors.fill: parent
            ShapePath {
                fillGradient: LinearGradient {
                    x1: 0; y1: thickness; x2: 0; y2: 0
                    GradientStop { position: 0.0; color: frameQColor(1.0) }
                    GradientStop { position: 1.0; color: frameQColor(0.35) }
                }
                strokeWidth: -1
                PathPolyline { path: toQmlPoints(dialog.topPoints) }
            }
            ShapePath {
                fillGradient: LinearGradient {
                    x1: 0; y1: height - thickness; x2: 0; y2: height
                    GradientStop { position: 0.0; color: frameQColor(1.0) }
                    GradientStop { position: 1.0; color: frameQColor(0.35) }
                }
                strokeWidth: -1
                PathPolyline { path: toQmlPoints(dialog.bottomPoints) }
            }
            ShapePath {
                fillGradient: RadialGradient {
                    centerX: thickness; centerY: height / 2
                    focalX: centerX; focalY: centerY
                    centerRadius: height * 1.6
                    GradientStop { position: 0.0; color: frameQColor(1.0) }
                    GradientStop { position: 1.0; color: frameQColor(0.35) }
                }
                strokeWidth: -1
                PathPolyline { path: toQmlPoints(dialog.leftPoints) }
            }
            ShapePath {
                fillGradient: RadialGradient {
                    centerX: width - thickness; centerY: height / 2
                    focalX: centerX; focalY: centerY
                    centerRadius: height * 1.6
                    GradientStop { position: 0.0; color: frameQColor(1.0) }
                    GradientStop { position: 1.0; color: frameQColor(0.35) }
                }
                strokeWidth: -1
                PathPolyline { path: toQmlPoints(dialog.rightPoints) }
            }
        }
        Text {
            anchors {
                top: parent.top
                left: parent.left
                margins: 40
            }
            text: dialog.label
            color: frameQColor(1.0)
            font.bold: true
            font.pixelSize: 48
        }
    }
}`;

export interface StripOsd {
    show(label: string, hue: number, screenGeometry: Rect): void;
}

/** `tickMs` reuses the viewport's own animation clock interval, same as
 * `createFocusFlashOverlay`. `thickness` and `enabled` are fixed at construction time, same as
 * every other setting here — Drift settings all take effect on restart, not live. */
export function createStripOsd(
    parent: QmlObject,
    tickMs: number,
    thickness: number,
    durationMs: number,
    peakOpacity: number,
    enabled: boolean,
): StripOsd {
    const dialog = Qt.createQmlObject(STRIP_OSD_QML, parent) as QmlStripOsdDialog;
    dialog.thickness = thickness;
    dialog.opacity = 0;
    dialog.visible = true;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    const toPlain = (points: Point[]): unknown => points.map((p) => ({ x: p.x, y: p.y }));

    return {
        show(label: string, hue: number, screenGeometry: Rect): void {
            if (!enabled) {
                return;
            }
            const width = Math.round(screenGeometry.width);
            const height = Math.round(screenGeometry.height);
            const frame = chevronFramePoints(width, height, thickness);
            dialog.frameColor = stripColor(hue);
            dialog.topPoints = toPlain(frame.top);
            dialog.bottomPoints = toPlain(frame.bottom);
            dialog.leftPoints = toPlain(frame.left);
            dialog.rightPoints = toPlain(frame.right);
            dialog.label = label;
            dialog.x = Math.round(screenGeometry.x);
            dialog.y = Math.round(screenGeometry.y);
            dialog.width = width;
            dialog.height = height;
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

Note the `createStripOsd` signature changed shape: `glowRadius` became `thickness` (same argument position, renamed to match its new meaning — no other callers' argument order changes).

- [x] **Step 3: Update the `Controller` call site's parameter name context**

In `drift/src/runtime/controller.ts`, the existing call:

```ts
        this.stripOsd = createStripOsd(
            root,
            ANIMATION_TICK_MS,
            settings.stripOsdGlowRadius,
            settings.stripOsdDurationMs,
            settings.stripOsdGlowOpacity,
            settings.stripOsdEnabled,
        );
```

stays exactly as-is — `settings.stripOsdGlowRadius` now feeds `thickness` positionally, which is correct (same setting, reinterpreted as the frame's thickness rather than a shader glow radius; no setting rename needed, no `controller.ts` diff needed for this task).

- [x] **Step 4: Run typecheck, tests, and lint**

```sh
make test && make lint
```

Expected: both pass.

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] QML property names actually used match what's bound in `ShapePath`/`PathPolyline`/gradients — fix any mismatch from the draft above rather than leaving a silently-broken binding
- [ ] `qmllint` clean where it can check this (it only validates `main.qml`, not inline template strings — same known limitation as the rest of this file; note this explicitly in your report rather than treating a clean `make lint` as proof the QML itself is correct)
- [ ] Lowercase kebab-case filename unchanged (`strip-osd.ts`), `camelCase` function/params
- [ ] KWin API access stays isolated in `kwin/strip-osd.ts` (no leakage into `ui/chevron-frame.ts`)
- [ ] Step 4's commands executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: Live verification in a KWin session

**Files:** none (manual verification only)

`make test`/`make lint` cannot see rendered output, and `qmllint` doesn't parse the inline `STRIP_OSD_QML` template at all — this is the only real check for whether `QtQuick.Shapes`/`PathPolyline`/`RadialGradient` behave as expected in KWin's actual QML engine. This is new API surface for this codebase (no prior file used `QtQuick.Shapes`), so treat this as higher-risk than a typical live-check, closer to the original shader-path-resolution risk from the first strip-OSD implementation.

- [ ] **Step 1: Install and reload the addon**

```sh
make install
```

- [ ] **Step 2: Trigger a strip change and inspect the frame**

Page between strips (keybinding or drag). Confirm:
- Four tapered bars appear hugging the screen edges, not a diffuse blur.
- Top/bottom bars are a plain 4-point taper; left/right bars additionally show the small notch step partway along their length.
- Corner size looks the same regardless of which screen/resolution you test on, if more than one is available — the flat run in the middle should be the only part that visibly differs in length.
- Left/right bars show a soft radial/elliptical falloff along their length, not a flat linear one — compare against the top/bottom bars' more uniform fade.
- The label still reads correctly in the top-left, unobscured.

- [ ] **Step 3: If nothing renders (or renders wrong), check for QML errors**

```sh
journalctl --user -b 0 | grep -i kwin | tail -80
```

Look specifically for `QtQuick.Shapes`, `PathPolyline`, or `RadialGradient`-related warnings/errors — e.g. an unknown property name, a type not being recognized, or `path` rejecting the point array shape. If `PathPolyline.path` rejects the plain-object-to-`Qt.point()` mapping from Step 2 of Task 2, that mapping function (`toQmlPoints`) is the first place to adjust — try passing `{x, y}` objects directly (without `Qt.point()`) as a fallback if `Qt.point()` itself is unavailable in this context, since that's a real, precedented ambiguity in this codebase (see `strip-identity.ts`'s `glowRgb`/color-object pattern, which works via plain objects plus an in-QML `Qt.rgba()` call).

- [ ] **Step 4: Record the outcome and file a follow-up if needed**

If Step 2 confirms correct rendering: done.

If Step 3 surfaces a specific, unresolved QML API mismatch after a reasonable attempt to fix it (per Task 2's "you have latitude on exact QML syntax" note): report back with the specific error and what was tried, rather than continuing to guess indefinitely — this is the one part of the plan with genuine external-API uncertainty.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Step 2's live check performed and outcome recorded (pass, or specific failure mode observed)
- [ ] Step 3 performed if Step 2 showed no frame or a visibly wrong one
- [ ] Any follow-up task filed (not implemented) if a QML API fix beyond reasonable adjustment is needed

---

## Self-Review

**Spec coverage:**
- 9-slice model (fixed corners, stretchy flat run) → Task 1, with an explicit test asserting identical corner points across different screen sizes.
- Notch kept only on left/right, not homogenized → Task 1's `chevronFramePoints` structurally only applies the notch unit to left/right; a test asserts `left`'s length (8 points) vs `top`'s (4 points).
- Opacity-only fade, thickness-direction, not lengthwise-to-tip → Task 2's `LinearGradient`/`RadialGradient` definitions use the bar's own thickness/height axis, same color at both gradient stops (only opacity changes).
- Elliptical gradient for left/right → Task 2 uses `RadialGradient` with a large `centerRadius` relative to the bar's height, approximating the ellipse the SVG mockup achieved via `objectBoundingBox` auto-stretch (QML's Shapes `RadialGradient` has no equivalent auto-stretch, so this is a deliberate, flagged approximation — see Task 2's inline comment intent and the design-doc addendum below).
- Shader dependency dropped for this one overlay, `focus-flash-overlay.ts` untouched → Task 2 removes `ShaderEffect`/`focus_glow.frag` references from `strip-osd.ts` only.

**Placeholder scan:** none found. Task 2 explicitly flags the one area of real external-API uncertainty (exact `QtQuick.Shapes` syntax) as implementer latitude rather than hiding it as false certainty — this is a deliberate, bounded exception to "no placeholders," not an escape hatch for vagueness elsewhere.

**Type consistency:** `chevronFramePoints(width, height, thickness): ChevronFrame` (Task 1) is consumed with the exact same signature in Task 2's `strip-osd.ts`. `createStripOsd`'s parameter list changes `glowRadius` → `thickness` at the same position — `controller.ts`'s existing call site needs no change since it already passes `settings.stripOsdGlowRadius` positionally there.

## Execution Choice

Plan complete and saved to `docs/agents/plans/2026-09-15-chevron-frame-osd.md`. Proceeding with subagent-driven-development, consistent with how the rest of this feature was built.
