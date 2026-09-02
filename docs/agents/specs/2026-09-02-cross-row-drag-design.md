# Cross-Row Drag

## Problem

Rows (`StripStack`, see [`2026-09-01-row-navigation-design.md`](2026-09-01-row-navigation-design.md)) already support
moving a window between rows via keyboard (`moveWindowToRowAbove`/`Below`), but mouse drag was explicitly deferred:
"Drag-to-move a window between rows with the mouse — only the keyboard shortcuts ship this round." Only the active
row is ever visible on screen — inactive rows sit off-screen and rows page discretely, not via continuous scroll — so
there is no visible drop target for "the row above" the way there is for a column boundary within a strip.

## Decision

Dragging a window's top or bottom edge past the screen's top/bottom boundary arms a dwell timer. If the window is
still past the edge when the dwell completes, it triggers the same row-flip animation `rowUp`/`rowDown` already use,
and the window is reparented into that row — width preserved, still following the cursor exactly as it does within a
strip today. If the window is dragged back within bounds before the dwell completes, nothing happens. If it is still
held past the edge after a flip, the dwell re-arms and can flip again, so one continuous drag can cross multiple
rows. There is no extra visual feedback during the dwell itself — the row-page slide is the feedback. At row 0,
dragging above the top edge is a no-op, same as `rowUp` today.

Once in the new row, the window keeps behaving exactly like an in-strip drag: its horizontal position among that
row's columns follows the cursor live, and release snaps it to the nearest slot — reusing the existing live-preview
drag-reorder logic (`docs/agents/specs/2026-08-31-drag-reorder-live-preview-design.md`), just now running against the
new row's grid instead of the old one.

## Drag-State Continuity Across Reparenting

A window's drag state (the local `dragging` flag and its live signal connections) lives inside `registerDragReorder`
(`src/input/drag.ts`), wired once per-window inside `Strip.addWindow`. Moving a window between rows removes its
column from the old row's `Grid` — which destroys that column's `SignalManager`, tearing down the old drag
connections (`column-registry.ts`'s `delete()` calls `signals.destroy()`) — and adds it to the new row's `Grid`,
wiring a *fresh* `registerDragReorder` that starts with `dragging = false`. Left as-is, a mid-drag reparent would
silently kill live reordering and release-snapping in the new row: the fresh connection never sees the
`interactiveMoveResizeStarted` signal, since it already fired once, on the old connection, at the start of the drag.

Fix: thread an `initiallyDragging` flag through the chain so a mid-drag reparent seeds the new connection as already
dragging:

- `registerDragReorder(win, columnId, deps, initiallyDragging = false)` seeds the local `dragging` flag instead of
  always starting `false`.
- `Strip.addWindow(win, initiallyDragging = false)` passes it through to `registerDragReorder`.
- The drag-triggered row-move passes `initiallyDragging: true` when adding the window to the target row's `Strip`.

## Excluding the Dragged Window From Row-Transition Rendering

`StripStack`'s row-transition rendering (`applyVerticalOffset`, `snapRestingRows`, and the priming render in
`switchToRow`) always calls `strip.render(undefined, ...)` — no exclusion. That is correct for keyboard-triggered row
switches, where nothing is being dragged, but a row-flip triggered mid-drag would otherwise apply the vertical
transition offset to the dragged window's real geometry too, fighting the cursor — something every other drag path
in this codebase deliberately avoids (see the drag-reorder designs' "Drift does not fight KWin during the drag").

Fix: thread an optional `excludeWindowId` through `switchToRow`, `applyVerticalOffset`, and `snapRestingRows`,
mirroring the exclusion `Strip.render` already supports horizontally. The drag-triggered row-move path passes the
dragged window's id; the existing keyboard-driven callers (`rowUp`, `rowDown`, `moveWindowToRowAbove`/`Below`) pass
nothing, unchanged.

The same problem exists one level down: `Strip.addWindow`'s own trailing `this.render()` call (unconditional, no
exclusion) would apply the new column's geometry to the just-reparented window on every add — including a mid-drag
one. `Strip.addWindow` gains the same `initiallyDragging` flag already needed for drag-state continuity below, and
uses it to decide whether its own trailing render excludes the window it just added.

## Dwell Timer

Dwell cannot be driven purely off `frameGeometryChanged` events: a user who drags past the edge and then holds still
(no further mouse movement) would never generate another event to check elapsed time against. Dwell needs an actual
ticking timer, reusing the existing `Timer`/`SharedTicker` pattern `StripStack` already owns for its vertical
`Animator`.

A new pure-logic unit, `EdgeDwell`, owns this: armed when the window's edge crosses past the screen boundary,
disarmed when it returns within bounds, and fires once armed continuously for `rowDragDwellMs`. After firing it
re-arms immediately (still armed, since the window may still be past the edge), so a window held past the edge keeps
flipping at a steady cadence — "keep flipping while held," not "one flip per push." This follows the same
testable-pure-logic-plus-thin-glue split as `Animator`/`ColumnMotion`.

## Ownership

The edge-watch lives in `StripStack`, not `Strip` — `Strip` has no notion of rows. `StripStack.addWindow` supplies an
additional callback threaded into `DragReorderDeps` so `drag.ts`'s existing `frameGeometryChanged` handler can also
report the dragged window's vertical position upward on every tick, without `Strip` itself needing any row-awareness.
`StripStack` uses that position, together with its own `EdgeDwell` instance for the in-progress drag, to decide when
to trigger a reparent-and-flip (reusing the same detach/`switchToRow`/add sequence `moveWindowToRowAbove`/`Below`
already use, extended with `excludeWindowId` and `initiallyDragging` as above).

## Accepted Nuance

A reparented window's column is appended at the end of the new row's grid (`Grid.addColumn`'s existing behavior),
then self-corrects to the cursor's actual horizontal slot on the very next drag tick via the existing live-reorder
logic. This may produce a barely-visible instant of "appears at the end, then slides over." This reuses existing
infrastructure as-is rather than adding special-casing to avoid a sub-frame visual nuance.

## Settings

One new setting, following the existing timing-config pattern (`animationDurationMs`, `minimapAutoHideMs`):

- `rowDragDwellMs: number` — how long a window must stay past the screen edge before the row flips. Default `400`.

No new shortcuts; this is mouse-only.

## Testing

- `EdgeDwell` (new pure-logic unit, mirroring `Animator`'s test shape): arms on crossing, fires once dwell elapses,
  disarms on returning within bounds, re-arms for repeat flips while held past the edge, no-op when armed but never
  reaching the dwell duration.
- `StripStack`: extend existing move/prune/transition tests to cover the drag-triggered path — `excludeWindowId` is
  honored through `switchToRow`/`applyVerticalOffset`/`snapRestingRows` (the dragged window's row-transition render
  calls never include it), row-0 "above" stays a no-op mid-drag, multiple sequential flips while held.
- `registerDragReorder`: new case for `initiallyDragging = true` — a connection seeded already-dragging reacts to
  `frameGeometryChanged` and `interactiveMoveResizeFinished` without ever seeing `Started` fire.
- `Strip.addWindow`: `initiallyDragging` param is plumbed through to `registerDragReorder` (thin glue, consistent
  with existing coverage level for this file).
- Everything else under `input/`/`kwin/` glue stays untested per existing precedent (docs §8) — only the new
  pure-logic piece (`EdgeDwell`) and the `StripStack`/`Strip` behavior changes get direct tests.

## Out of Scope

- Visual feedback during the dwell period (an edge highlight, etc.) — the row-page slide itself is the only
  feedback.
- Cross-`StripStack` dragging (different activity/desktop/monitor) — rows are a single-`StripStack` concept, the
  same boundary the keyboard shortcuts already respect.
- Dragging to a specific row by number (e.g. a drop-zone per row) — only adjacent-row stepping, matching keyboard
  parity.
- Continuous/rubber-band vertical drag scroll — rows stay discrete pages, consistent with the row-navigation
  design's existing "no continuous scroll" decision.
