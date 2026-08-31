# Drag-Reorder Live Preview and Anchor Fix — design

Date: 2026-08-31

## Problem

Drag-reorder (`docs/agents/specs/2026-08-28-window-drag-reorder-design.md`) only acts on release: the
dragged window moves freely under the cursor with no visual feedback, then snaps everything — including
neighbors — instantly into place. Two things should change now that per-column position animation exists
(`docs/agents/specs/2026-08-31-window-position-animation-design.md`):

1. Neighbors displaced by a drag-reorder should slide out of the way live, as the window is dragged, not only
   jump into place on release.
2. The insertion point itself is wrong: it is computed from the raw cursor position
   (`workspaceAdapter.cursorX()`), not from the dragged window. Grabbing a wide window near one edge and
   dropping it can vote for a different boundary than the window itself is actually closest to.

## Decision

Replace the cursor-position anchor with the dragged window's own center (`frameGeometry().x + width / 2`,
mapped through the existing `toVirtualX`), and recompute/commit the insertion index continuously while
dragging, not only on release. The dragged window itself still snaps instantly into its final slot on release
(unchanged feel); only its neighbors animate, both live during the drag and at settle.

No hysteresis around boundaries: the existing `nearestInsertionIndex` picks whichever boundary is closest, and
the vote flips exactly at each candidate column's midpoint. This is left as pure closest-boundary logic; watched
for jitter live rather than solved preemptively (consistent with how the animation design left minimize's
"no deliberate delay" as a watch-item).

The placement math itself — `nearestInsertionIndex` / `Grid.insertionIndexForX` / `toVirtualX` — needs no
changes; both are anchor-agnostic (they operate on whatever real x they're given) and were confirmed correct by
audit: hidden columns are correctly excluded from candidates and correctly skipped when mapping back to a real
index, and boundary selection already produces the "left half votes before, right half votes after" property for
any column regardless of width.

## Anchor Change

`registerDragReorder` (`src/input/drag.ts`) stops reading `deps.workspaceAdapter.cursorX()`. Both the live-drag
recomputation and the final release computation instead read `win.frameGeometry()` and use its center:

```
virtualX = toVirtualX(win.frameGeometry().x + win.frameGeometry().width / 2, deps.area, deps.viewport.offset())
```

This makes `WorkspaceAdapter.cursorX()` unused — it was added solely for this call site. Remove it, along with
`WorkspaceApi.cursorPos` and the now-unused `QPoint` type in `types/kwin.d.ts`. `DragReorderDeps` drops
`workspaceAdapter`.

## Live Preview Wiring

`registerDragReorder` adds a third signal connection, `win.onFrameGeometryChanged`, active only while the local
`dragging` flag (already recorded at `interactiveMoveResizeStarted`, per the original drag-reorder doc) is true.
On each tick:

1. Compute `virtualX` from the window's current center (above).
2. Ask `deps.grid.insertionIndexForX(columnId, virtualX)`.
3. If that differs from the column's current index (`deps.grid.indexOf(columnId)`), call
   `deps.grid.moveColumn(columnId, targetIndex)` then `deps.render(win.id, false)`.

Skipping the commit+render when the index hasn't changed avoids retriggering neighbor animations on every
geometry tick — only an actual reorder does. `render(win.id, false)` keeps the existing exclusion (the dragged
window's own geometry is never written mid-drag — it keeps following the cursor untouched) while `instant=false`
lets displaced neighbors slide via the existing `ColumnMotion`, instead of jumping.

This reuses the same underlying `frameGeometryChanged` KWin signal that `onWindowGeometryChanged` already
listens to for resize handling — a second independent connection on the same signal, gated by the local
`dragging` flag, so it does not interact with the existing resize/fullscreen logic in `window-events.ts`.

## Settle on Release

`interactiveMoveResizeFinished` does one final center-based commit (same three steps as a live tick), then
settles the dragged column instantly while letting neighbors keep whatever slide they're already mid-flight on:

1. `deps.snapColumn(columnId)` — new, forces just this column's `ColumnMotion` entry to rest at its final
   position with no animation.
2. `deps.render()` — no exclusion, `instant=false`.

Because `snapColumn` already set the dragged column's `ColumnMotion` target/resting value to match, `render()`'s
call into `ColumnMotion.update` for that column sees no target change and returns the resting value unanimated.
Every other column's animation is unaffected — it either keeps sliding toward whatever target it already had, or
is already at rest.

`Strip` gains `snapColumn(columnId: number): void`, wrapping `this.columnMotion.snapTo(columnId,
this.grid.columnRect(columnId).x)`, exposed to `drag.ts` via a new `DragReorderDeps.snapColumn` function
(same shape as the existing `render` dep).

## API Changes Summary

- `src/input/drag.ts`: `DragReorderDeps` drops `workspaceAdapter`, gains `snapColumn(columnId: number): void`.
  Adds the live-preview `onFrameGeometryChanged` connection, included in the returned disconnect function.
- `src/runtime/strip.ts`: adds `snapColumn(columnId)`; passes it (not `workspaceAdapter`) into
  `registerDragReorder`'s deps.
- `src/kwin/workspace-adapter.ts`: removes `cursorX()`.
- `src/types/kwin.d.ts`: removes `WorkspaceApi.cursorPos` and `QPoint`.

## Testing

`nearestInsertionIndex` / `Grid.insertionIndexForX` / `toVirtualX` are unchanged and already covered.
`Strip.snapColumn` gets a direct test: snap one column mid-animation, verify it reports its final x with no
further animation while a separate still-animating column is untouched. The rest of `drag.ts`'s live-preview
wiring (the new signal connection, the index-changed guard, the release sequencing) stays untested glue,
consistent with the rest of `input/`/`kwin/` (docs §8) and the existing precedent for this file.

## Out of Scope

- Viewport auto-scroll/edge-panning while dragging a window near the strip's visible edge.
- Hysteresis/dead-zone around insertion boundaries (watch-item, not solved here).
- Cross-row dragging (single strip only, unchanged).
- Any change to how a live interactive *resize* behaves (unaffected by this design).
