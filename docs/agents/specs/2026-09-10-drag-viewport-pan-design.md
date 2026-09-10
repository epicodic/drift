# Drag viewport pan — design

## Purpose

Today, dragging a window horizontally always feeds `Grid.insertionIndexForEdges` and can trigger a live
column reorder as soon as the dragged edge crosses a neighbor's `reorderThresholdFraction`. There is no way
to use a drag purely to look further along the strip — you have to release, use a keyboard shortcut
(`shiftViewportLeft`/`shiftViewportRight`), or accept a reorder as a side effect.

This adds a fifth mode of drag behavior: an almost-perfectly-horizontal drag pans the viewport instead of
reordering the dragged window's column. It's explicitly an experimental mode to try out, gated by its own
setting so it can be disabled instantly if it doesn't feel right.

## Behavior

- While dragging, Drift tracks the window's cumulative vertical movement since the drag started (`dyTotal`)
  and blends between two behaviors based on it:
  - `dyTotal = 0`: the drag is pure pan — the viewport scrolls to match the window's own horizontal movement,
    the dragged window's virtual position barely changes, and reorder/stack never fire. The strip visibly
    slides past the window, which stays anchored under the cursor.
  - `dyTotal >= dragPanVerticalTolerancePx`: today's behavior, unchanged — the drag is a normal reorder/stack
    gesture, no panning at all.
  - In between: a linear blend of the two. There is no hard mode switch and no snap — introducing vertical
    movement partway through a drag smoothly hands off from panning to reordering, and easing back toward
    horizontal smoothly resumes panning.
- The pan is a direct, unanimated 1:1 tracking of the window's own horizontal movement (scaled by the blend
  factor) — it never lags or eases, matching how the dragged window itself already tracks the cursor exactly
  under KWin's own interactive move.
- Panning is clamped to the strip's existing content bounds (via `Viewport.scrollBy`) — dragging further past
  the strip's start/end simply stops panning, it does not overscroll.
- On release, nothing changes: the dragged window settles into whatever column/slot it actually resolved to
  (usually unchanged, if `dyTotal` stayed near 0 for the whole drag), exactly as today. The viewport offset
  simply stays wherever the drag panned it to.
- Two new settings, following the existing `stripDrag*`/`reorderThresholdFraction` pattern:
  - `dragPanEnabled` (`Boolean`, default `true`) — when `false`, this feature is fully inert and dragging
    behaves exactly as it does today.
  - `dragPanVerticalTolerancePx` (`UInt`, default `40`) — the `dyTotal` at which the blend reaches 0.

## Architecture

### `src/input/drag-pan.ts` (new)

Pure, no KWin/Grid/Viewport dependency, mirrors the role of `resolveStackTarget` in `drag-hover.ts`.

```ts
/** Linear blend factor for how much of the dragged window's horizontal movement should be
 * absorbed into panning the viewport, vs. left as real (reorder/stack-triggering) movement.
 * 1 at dyTotal = 0 (pure pan), 0 at dyTotal >= tolerancePx (today's behavior, unchanged),
 * linear in between. A non-positive tolerancePx returns 0 (panning off) for any dyTotal > 0. */
export function dragPanBlend(dyTotal: number, tolerancePx: number): number {
    if (tolerancePx <= 0) {
        return dyTotal <= 0 ? 1 : 0;
    }
    return Math.min(Math.max(1 - dyTotal / tolerancePx, 0), 1);
}
```

### `src/input/drag.ts` (`registerDragReorder`)

Gains two new closure variables tracking the current drag's raw geometry, alongside the existing `dragging`/
`lastStackHover`/`armedStackKey`:

```ts
let startY = win.frameGeometry().y;
let lastX = win.frameGeometry().x;
```

Reseeded in the existing `onInteractiveMoveResizeStarted` handler (same place `dragging` is set), so each new
drag starts a fresh `dyTotal` count:

```ts
const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
    dragging = win.isInteractiveMove();
    if (dragging) {
        const rect = win.frameGeometry();
        startY = rect.y;
        lastX = rect.x;
        deps.onDragStarted?.(win);
    }
    // ...existing debug log unchanged
});
```

The construction-time initialization covers `initiallyDragging` connections (a cross-strip reparent
mid-drag, docs: `2026-09-02-cross-row-drag-design.md`), which never see `onInteractiveMoveResizeStarted` fire
on the new connection — see Edge Cases below.

`tickInner` gains a pan step as its first action, before it reads `winEdges` for reorder — the resulting
`viewport.scrollBy` call happens-before every other computation this tick, so `insertionIndexForEdges`,
`resolveCurrentTarget`, and everything else downstream already sees the post-pan virtual position, with zero
special-casing anywhere else in the file:

```ts
if (deps.dragPanEnabled) {
    const raw = win.frameGeometry();
    const dyTotal = Math.abs(raw.y - startY);
    const dxTick = raw.x - lastX;
    lastX = raw.x;
    const blend = dragPanBlend(dyTotal, deps.dragPanVerticalTolerancePx);
    if (dxTick !== 0 && blend > 0) {
        deps.viewport.scrollBy(-blend * dxTick);
    }
} else {
    lastX = win.frameGeometry().x;
}
```

(The `else` branch keeps `lastX` current even while the feature is disabled, so re-enabling it mid-session
via the settings dialog doesn't see a stale, arbitrarily large first-tick `dxTick`.)

No explicit re-render is needed for the pan itself: every `tickInner` branch already ends by calling
`deps.render(win.id, ...)`, and `Strip.render` always reads the live `viewport.offset()` when placing every
non-dragged window (`geometrySync.apply(..., this.viewport.offset(), ...)`), unanimated — the offset itself is
never eased, only a column's *virtual* rect is. So the pan is picked up by whichever render call the rest of
`tickInner` was already going to make this tick.

### `DragReorderDeps`

Gains two fields, threaded from `Strip`'s settings the same way `reorderThresholdFraction`/
`stackOverlapFraction` already are:

```ts
dragPanEnabled: boolean;
dragPanVerticalTolerancePx: number;
```

### Settings

`Settings`/`DEFAULT_SETTINGS`/`loadSettings` (`src/config/settings.ts`) and `src/config/settings-definitions.ts`
gain:

```ts
{ name: 'dragPanEnabled', type: 'Boolean', default: true },
{ name: 'dragPanVerticalTolerancePx', type: 'UInt', default: 40 },
```

### KConfigXT / KCM

- `drift/contents/config/main.xml`: two new `<entry>` elements next to `reorderThresholdFraction`/
  `stackOverlapFraction` — `dragPanEnabled` (`Bool`, default `true`), `dragPanVerticalTolerancePx` (`UInt`,
  default `40`).
- `drift/contents/ui/config.ui`: a checkbox (`kcfg_dragPanEnabled`) and spin box (`kcfg_dragPanVerticalTolerancePx`,
  `px` suffix) in the existing `tab_behavior` tab, alongside `kcfg_reorderThresholdFraction`/
  `kcfg_stackOverlapFraction`.

## Edge Cases

- **`dragPanVerticalTolerancePx = 0`**: `dragPanBlend` returns 1 only for `dyTotal` exactly 0, 0 otherwise —
  degenerates to "pan only on a pixel-perfect straight sideways drag," effectively off. Not the intended way
  to disable the feature (`dragPanEnabled: false` is), but doesn't crash or misbehave.
- **Cross-strip reparent mid-drag** (`initiallyDragging = true`): the new `Strip`'s `registerDragReorder`
  connection has no prior drag history, so `startY`/`lastX` seed from the window's *current* geometry rather
  than the original drag's start. In practice this is harmless: reaching the cross-strip edge-dwell trigger
  (`stripDragDwellMs` at the screen's top/bottom edge) requires far more vertical travel than the default
  40px tolerance, so panning is already fully faded out (`blend = 0`) long before a reparent can happen. A
  reparent could in principle cause one or two ticks of partial pan resuming on the new connection before
  `dyTotal` grows again; this is accepted as a minor cosmetic edge case, not solved by this design.
- **Reorder/stack/edge-expel**: unaffected by construction — all three already resolve purely from the
  dragged window's virtual position (`toVirtualX`), which the pan step updates before they run. No changes
  needed to `insertionIndexForEdges`, `resolveCurrentTarget`, or `expelDirectionForEdges`.
- **Cross-row edge-dwell** (`StripStack.updateEdgeWatch`): unaffected — it reads the cursor's absolute
  screen-y position independently, unrelated to `dyTotal`-from-drag-start.

## Out of Scope

- No eased/smoothstep blend curve — linear only, per the recommendation to start simple and revisit if
  live-testing shows a need.
- No hysteresis around the tolerance threshold — the blend is continuous by construction, so flicker risk at
  the boundary is expected to be low without it.
- No attempt to preserve pan continuity (`startY`) across a cross-strip reparent mid-drag (see Edge Cases).
- No modifier-key-gated alternative trigger — consistent with the rest of Drift's drag gestures, which avoid
  modifier keys because the KWin script sandbox can't detect them.

## Testing

- `src/input/drag-pan.test.ts` (new): unit tests for `dragPanBlend` — `dyTotal = 0` → 1, `dyTotal = tolerancePx`
  → 0, `dyTotal > tolerancePx` → 0 (clamped), `dyTotal` at the midpoint → 0.5, `tolerancePx <= 0` for both
  `dyTotal = 0` and `dyTotal > 0`.
- `drag.ts`'s wiring itself stays untested glue, consistent with the file's existing convention (per its own
  doc comment) — verified via `npm run build` and manual live-testing: pan feel at various drag angles,
  clamping at the strip's start/end, and that `dragPanEnabled: false` reproduces today's behavior exactly.
