# Pull-to-rearrange: threshold gesture + pull indicator — design

## Purpose

`2026-09-12-drag-pan-dwell-design.md` made dragging default to pan, with a pull-and-hold-past-a-dwell
gesture to "free" the window into today's normal reorder/stack/cross-strip mode. Live use surfaced two
problems: the dwell period makes the gesture feel laggy (you have to hold still after already pulling far
enough), and there's no visual feedback at all that pan mode is even active or that a pull is in progress —
users can't tell the feature exists.

This replaces the dwell with an instant threshold check, and adds a visual pull indicator so the gesture is
discoverable and gives feedback as it happens.

## Behavior

### Mechanism: threshold-only pull, no dwell

- **Default (pan) mode**: unchanged from `2026-09-12` — the dragged window's `y` stays pinned to `startY`,
  horizontal movement redirects into `Viewport.setOffset`, and reorder/edge-expel/stack/cross-strip logic
  never runs while pinned.
- **Freeing**: once cumulative vertical pull `dyTotal = |raw.y - startY|` reaches `dragPanVerticalTriggerPx`,
  the drag frees **immediately** — no hold, no dwell period. The window is re-seeded to the pointer's true
  position (same reseed-to-cursor write `2026-09-12`'s dwell-fire callback already does) and pan/pinning
  stops permanently for the rest of the drag.
- **Aborting**: if cumulative horizontal drift `dxTotal = |raw.x - startX|` (measured from drag start, not
  from a hold start — there's no hold anymore) reaches `dragPanHorizontalTolerancePx` *before* `dyTotal`
  reaches its trigger, the pull is **permanently disabled** for the rest of this drag: a latch
  (`pullAborted`), once set, is never re-checked or reset even if the pointer drifts back under tolerance.
  Panning itself keeps running as normal for the rest of the drag — only the chance to free is lost. The
  user must release the mouse button and start a new drag to try pulling again.
- **Tie-break**: `dyTotal` is checked before `dxTotal` each tick, so a tick that crosses both thresholds at
  once frees rather than aborts.
- **`dragPanEnabled: false`**: unchanged — fully inert, no pin/pan/pull/indicator at all.

### Pull indicator

A filled circular-segment overlay grows beneath the dragged window's top edge as the pull progresses,
fading out if the pull aborts and vanishing instantly if it succeeds.

- **Geometry**: the circle passing through the window's current top-left corner `(x0, 0)`, top-right corner
  `(x0+width, 0)`, and `(x0+width/2, dyTotal)` — all in window-local coordinates, `y` increasing downward
  from the window's top edge. The visible shape is the circular segment bounded above by the chord (the
  window's own top edge, left corner to right corner) and below by the arc through the third point.
- **Fill**: a radial gradient centered on that circle's own center, spanning its own radius. Because all
  three defining points sit exactly on the circle, this makes the *entire arc* sit at a single radial
  distance (`R`) from the gradient's center — so the arc reads as a uniform outer color band, fading toward
  transparent as you move inward toward the chord and the circle's center beyond it:
  - Outer stop (`r = R`, the arc): accent color (theme highlight), alpha `a · pullIndicatorOpacity`.
  - Inner stop (`r = 0`, the circle's center): alpha `0`.
  - `a = clamp(dyTotal / dragPanVerticalTriggerPx, 0, 1)`.
- **Lifecycle**:
  - Hidden whenever `dyTotal <= 0`, `freed`, `pullAborted` has fully faded, or `dragPanEnabled: false`.
  - Grows live, every drag tick, while pinned and not yet freed/aborted.
  - Vanishes **instantly** (no fade) the tick the drag frees.
  - Fades out over a short fixed duration (~150ms, not user-configurable) the tick `pullAborted` latches.
  - Hidden immediately on drag finish/cancel.

## Architecture

### `src/input/drag-pan.ts`

`dragPanHolding` (the hold/tolerance predicate) is removed — there's no more hold state to evaluate, just
two independent one-shot threshold checks against `dyTotal`/`dxTotal` computed inline in `drag.ts`.

### `src/input/pull-indicator.ts` (new)

Pure, KWin-free geometry module, parallel to `drag-pan.ts`:

```ts
/** Circumcircle of the three points a pull's indicator arc passes through — the window's own
 * top-left/top-right corners plus (x0+width/2, dyTotal). Both corners are symmetric about the
 * vertical line x = x0+width/2, which the third point also sits on, so the center lies on that
 * same line; solving |center-corner| = |center-thirdPoint| for cy along it gives:
 *   cy = (dyTotal² − (width/2)²) / (2 · dyTotal)
 * Undefined at dyTotal = 0 (the three points are collinear) — callers must not render then anyway,
 * since alpha is 0 at dyTotal = 0. */
export function pullIndicatorCircle(width: number, dyTotal: number): { cx: number; cy: number; r: number };

/** Alpha multiplier for the indicator's outer gradient stop: 0 at no pull, 1 once dyTotal reaches
 * triggerPx, clamped so a fast tick that jumps past the trigger in one frame can't overshoot. */
export function pullIndicatorAlpha(dyTotal: number, triggerPx: number): number;
```

### `drift/shaders/pull_indicator.frag` (new)

Same convention as `focus_glow.frag`: `qt_Matrix`/`qt_Opacity` plus uniforms for `center` (item-local,
vec2), `radius` (float), `color` (vec4, straight RGBA), `alpha` (float, the `a · pullIndicatorOpacity`
already computed on the TS side). Per fragment: inside the segment (below the chord at `y=0` and within
`radius` of `center`), mix alpha `0 → alpha` by `distance(p, center) / radius`; outside, alpha `0`. This is
simpler than the existing glow shader — a hard disk-∩-half-plane region with a linear radial mix, no
smoothstep falloff needed.

### `src/kwin/pull-indicator-overlay.ts` (new)

Mirrors `focus-flash-overlay.ts`: a `PlasmaCore.Dialog` (`OnScreenDisplay`, `outputOnly: true`, `NoBackground`)
built once via `Qt.createQmlObject`, whose `mainItem` is a `ShaderEffect` wired to `pull_indicator.frag.qsb`.
Exposes an interface like:

```ts
export interface PullIndicatorOverlay {
    /** Repositions/resizes to `win`'s current frame and updates the arc for this tick's `dyTotal`. */
    update(win: WindowAdapter, dyTotal: number, triggerPx: number): void;
    /** Vanishes instantly — used on free. */
    hide(): void;
    /** Fades out over the fixed abort duration — used when pullAborted latches. */
    fadeOut(): void;
}
```

Dialog geometry each tick: `x = win.x`, `y = win.y`, `width = win.width`, `height = max(dyTotal, 1)` — same
per-tick resize pattern `focus-flash-overlay.ts` already uses for its own bleed-padded frame.

### `src/input/drag.ts` (`registerDragReorder` / `DragReorderDeps`)

- `DragReorderDeps` gains `pullIndicator: PullIndicatorOverlay` (one shared instance threaded in, not built
  per-connection — the overlay itself is a single reusable dialog, like `focusFlashOverlay`) and loses
  `createPanFreeDwell`.
- New local state: `startX` (captured alongside `startY`/`grabOffsetY`), `pullAborted` (latch, reset to
  `false` in `onInteractiveMoveResizeStarted` alongside `freed`).
- The existing pan-pin block's dwell-arming logic is replaced with the inline threshold checks described
  above; `deps.pullIndicator.update(...)` / `.hide()` / `.fadeOut()` calls added at the same points.
- `holdStartX` and its drift-from-hold-start tracking are removed entirely (superseded by `dxTotal` from
  drag start).

### Wiring (`src/runtime/strip.ts` / `src/runtime/controller.ts`)

`PullIndicatorOverlay` is constructed once in `controller.ts` (parallel to `createFocusFlashOverlay`) from
`settings.pullIndicatorOpacity`/`settings.pullIndicatorEnabled`, then threaded down through `Strip`'s
constructor into each `wireTile`'s `DragReorderDeps`, replacing the removed `createPanFreeDwell` dependency
at that same call site.

### Settings (`src/config/settings.ts`, `settings-definitions.ts`, `drift/ui/config.ui`)

- **Removed**: `dragPanFreeDwellMs` (dwell is gone) — no back-compat, same convention `2026-09-12` set for
  this experimental feature's settings.
- **Kept, semantics updated in doc comments only** (no rename, so existing tuned values carry over):
  `dragPanVerticalTriggerPx` (now the immediate free threshold, not a hold-arm threshold),
  `dragPanHorizontalTolerancePx` (now the permanent-abort threshold measured from drag start, not a
  hold-cancel tolerance measured from hold start).
- **New**: `pullIndicatorEnabled` (`Bool`, default `true`), `pullIndicatorOpacity` (`Double`, default `0.5`)
  — same enabled+opacity shape as `focusFlashEnabled`/`focusFlashOpacity`. Both added next to the
  `dragPan*` group in `settings.ts`/`settings-definitions.ts`, and as a `QGroupBox`/`QDoubleSpinBox` pair in
  `drift/ui/config.ui`'s existing `tab_behavior` tab, next to the `dragPan*` widgets.

## Edge Cases

- **`dyTotal = 0`**: three defining points are collinear, no circle — `pullIndicatorAlpha` is `0` at this
  point anyway, so callers skip rendering rather than calling `pullIndicatorCircle`.
- **Very narrow window or a large `dragPanVerticalTriggerPx`** (`dyTotal` approaching or exceeding
  `width/2`): the arc can bulge past the window's left/right edges — an accepted consequence of the pure
  3-point circle definition, not specially clamped or handled.
- **`dragPanVerticalTriggerPx` or `dragPanHorizontalTolerancePx` set to `0`**: same as `2026-09-12` — degenerate
  but safe; a trigger of 0 frees on the very first tick, a tolerance of 0 aborts on the very first nonzero
  horizontal drift.
- **Abort fade interrupted by drag finish**: the indicator is hidden immediately and unconditionally on
  `finishedInner`, regardless of whether an abort fade was still in progress.
- **`pullIndicatorEnabled: false`**: mechanism behavior (free/abort thresholds) is unaffected — only the
  visual overlay is skipped, same independence `focusFlashEnabled` already has from the behavior it
  visualizes.

## Out of Scope

- No change to the pan mechanism itself (pinning, viewport redirect) beyond removing the dwell — `2026-09-12`'s
  pan behavior stands.
- No modifier-key-gated alternative trigger — same rationale as `2026-09-12` (KWin script sandbox can't
  detect modifier keys).
- No configurable abort-fade duration or indicator color — fixed fade duration, theme accent color only,
  consistent with keeping this addition minimal.
- No attempt to address `docs/known_bugs.md` entry 1 (unrelated pre-existing pan issue).

## Testing

- `src/input/pull-indicator.test.ts`: unit tests for `pullIndicatorCircle` (known 3-point cases, symmetry,
  radius sanity) and `pullIndicatorAlpha` (0/mid/at-trigger/past-trigger clamping).
- `src/config/settings.test.ts`: remove the `dragPanFreeDwellMs` default test; add default tests for
  `pullIndicatorEnabled`/`pullIndicatorOpacity`.
- `src/input/drag-pan.test.ts`: remove entirely (`dragPanHolding` is gone; its replacement threshold checks
  are simple inline comparisons in `drag.ts`, not separately-tested pure functions).
- Remove now-stale `panFreeDwell`/dwell-specific coverage in `drag.ts`-adjacent tests; `drag.ts`'s own
  wiring stays untested glue, consistent with the file's existing convention — verified by `make build` and
  manual live-testing: free-on-threshold feel, abort-permanence (pull can't be retried mid-drag after an
  abort), indicator growth/vanish/fade timing, `dragPanEnabled: false` and `pullIndicatorEnabled: false`
  both reproducing fully-inert behavior.
