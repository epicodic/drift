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
  and gates panning off it with a hard threshold (revised after initial live-testing — a linear blend was
  tried first and didn't feel as good as a clean cutoff):
  - `dyTotal < dragPanVerticalTolerancePx`: the drag is pure pan — the viewport scrolls to match the window's
    own horizontal movement 1:1, the dragged window's virtual position doesn't change, and reorder/stack never
    fire. The strip visibly slides past the window, which stays anchored under the cursor.
  - `dyTotal >= dragPanVerticalTolerancePx`: today's behavior, unchanged — the drag is a normal reorder/stack
    gesture, no panning at all.
  - There is no blending between the two: crossing the threshold switches modes outright, for the rest of the
    drag or until `dyTotal` drops back under it (it never does — `dyTotal` is cumulative from drag start —
    so in practice the switch from panning to reordering happens at most once per drag).
- The pan is a direct, unanimated 1:1 tracking of the window's own horizontal movement — it never lags or
  eases, matching how the dragged window itself already tracks the cursor exactly under KWin's own interactive
  move.
- Panning is **not** clamped to the strip's content bounds (revised after initial live-testing — clamping via
  `Viewport.scrollBy` made the leftmost/rightmost column impossible to pan past). It uses `Viewport.setOffset`
  directly, the same unclamped primitive the viewport's own pan *animation* already uses internally. On
  release, `revealFocused()` (called unconditionally at the end of every drag, see `finishedInner`) eases the
  viewport from wherever panning left it back to a valid, clamped position showing the dragged window's own
  column — so overscrolling past an edge springs back on release, for free, with no dedicated spring-back code.
- On release, nothing else changes: the dragged window settles into whatever column/slot it actually resolved
  to (usually unchanged, if `dyTotal` stayed under the threshold for the whole drag), exactly as today.
- Two new settings, following the existing `stripDrag*`/`reorderThresholdFraction` pattern:
  - `dragPanEnabled` (`Boolean`, default `true`) — when `false`, this feature is fully inert and dragging
    behaves exactly as it does today.
  - `dragPanVerticalTolerancePx` (`UInt`, default `40`) — the `dyTotal` at or past which panning stops.

## Architecture

### `src/input/drag-pan.ts` (new)

Pure, no KWin/Grid/Viewport dependency, mirrors the role of `resolveStackTarget` in `drag-hover.ts`.

```ts
/** Hard-threshold gate for whether this tick's horizontal drag movement should pan the
 * viewport rather than move the window's virtual position: true (pan) while dyTotal stays
 * under tolerancePx, false (today's reorder/stack behavior) once it reaches or exceeds it.
 * A non-positive tolerancePx always returns false, since dyTotal is never negative. */
export function dragPanShouldPan(dyTotal: number, tolerancePx: number): boolean {
    return dyTotal < tolerancePx;
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
`viewport.setOffset` call happens-before every other computation this tick, so `insertionIndexForEdges`,
`resolveCurrentTarget`, and everything else downstream already sees the post-pan virtual position, with zero
special-casing anywhere else in the file:

```ts
const raw = win.frameGeometry();
if (deps.dragPanEnabled) {
    const dyTotal = Math.abs(raw.y - startY);
    const dxTick = raw.x - lastX;
    if (dxTick !== 0 && dragPanShouldPan(dyTotal, deps.dragPanVerticalTolerancePx)) {
        deps.viewport.setOffset(deps.viewport.offset() - dxTick);
    }
}
lastX = raw.x;
```

`lastX` updates unconditionally (whether or not `dragPanEnabled`), so re-enabling the feature mid-session via
the settings dialog doesn't see a stale, arbitrarily large first-tick `dxTick`.

`setOffset` — not the clamped `scrollBy` — is deliberate: it lets panning go past the strip's content bounds,
matching `Viewport`'s own existing pan-animation tick callback (`Animator`'s tick already calls
`viewport.setOffset` directly, unclamped; only the *targets* animated toward are pre-clamped by their
callers). See Behavior above for why no explicit clamping/spring-back is needed here.

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

- **`dragPanVerticalTolerancePx <= 0`**: `dragPanShouldPan` returns `false` unconditionally (`dyTotal` is
  never negative, so `dyTotal < 0` never holds) — a clean, total disable with no special-casing needed in the
  function itself. Not the intended way to disable the feature (`dragPanEnabled: false` is), but doesn't crash
  or misbehave.
- **Cross-strip reparent mid-drag** (`initiallyDragging = true`): the new `Strip`'s `registerDragReorder`
  connection has no prior drag history, so `startY`/`lastX` seed from the window's *current* geometry rather
  than the original drag's start. In practice this is harmless: reaching the cross-strip edge-dwell trigger
  (`stripDragDwellMs` at the screen's top/bottom edge) requires far more vertical travel than the default
  40px tolerance, so panning has already switched off long before a reparent can happen. A reparent could in
  principle cause panning to resume briefly on the new connection before `dyTotal` grows past the threshold
  again; this is accepted as a minor cosmetic edge case, not solved by this design.
- **Panning past the strip's content bounds**: intentional (see Behavior) — `setOffset` is unclamped, and
  `revealFocused()` on release brings the viewport back to a valid position. Mid-drag, this means other
  windows can render arbitrarily far off to either side while overscrolled; nothing else in `Strip.render`
  assumes `viewport.offset()` stays within `[contentLeft(), maxOffset()]`, so this is safe.
- **Reorder/stack/edge-expel**: unaffected by construction — all three already resolve purely from the
  dragged window's virtual position (`toVirtualX`), which the pan step updates before they run. No changes
  needed to `insertionIndexForEdges`, `resolveCurrentTarget`, or `expelDirectionForEdges`.
- **Cross-row edge-dwell** (`StripStack.updateEdgeWatch`): unaffected — it reads the cursor's absolute
  screen-y position independently, unrelated to `dyTotal`-from-drag-start.

## Out of Scope

- No hysteresis around the tolerance threshold — a linear blend was tried first specifically to avoid needing
  this, but didn't feel as good as the hard threshold in live-testing; hysteresis remains a possible future
  refinement if the hard cutoff itself ever proves flickery in practice, but isn't needed to ship this.
- No attempt to preserve pan continuity (`startY`) across a cross-strip reparent mid-drag (see Edge Cases).
- No modifier-key-gated alternative trigger — consistent with the rest of Drift's drag gestures, which avoid
  modifier keys because the KWin script sandbox can't detect them.
- No dedicated spring-back/rubber-band animation for overscrolled panning — `revealFocused()`'s existing
  post-drag call already provides this for free (see Behavior).

## Testing

- `src/input/drag-pan.test.ts` (new): unit tests for `dragPanShouldPan` — `dyTotal = 0` → `true`, `dyTotal`
  just under `tolerancePx` → `true`, `dyTotal = tolerancePx` → `false`, `dyTotal > tolerancePx` → `false`,
  `tolerancePx <= 0` → `false` regardless of `dyTotal`.
- `drag.ts`'s wiring itself stays untested glue, consistent with the file's existing convention (per its own
  doc comment) — verified via `npm run build` and manual live-testing: pan feel at various drag angles,
  overscrolling past the strip's start/end and confirming the spring-back on release, and that
  `dragPanEnabled: false` reproduces today's behavior exactly.
