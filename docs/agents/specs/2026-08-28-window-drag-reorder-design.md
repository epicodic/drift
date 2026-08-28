# Window Drag Reorder

## Decision

Dragging a tiled window by any part of it (not just the titlebar — KWin's interactive-move flag does not
distinguish the grab point) only ever changes its position in the strip.
The window itself moves freely under the cursor while the drag is in progress; Drift does not fight KWin during
the drag.
On release, the column snaps into the slot whose border is closest to the mouse pointer, instantly (no
animation) and with no live preview while dragging.
The candidate slots are the borders between all *other* columns (their left edges, plus the right edge of the
last one) — the column's original slot is not special-cased, since it is naturally one of these borders whenever
nothing else moved.

## Detection

`Window.interactiveMoveResizeStarted` and `interactiveMoveResizeFinished` (verified against the installed
Karousel bundle) bracket every interactive move or resize.
`Window.move` is only reliable at `Started` time, so the handler remembers "this drag is a move, not a resize"
in a local flag rather than re-reading `move` at `Finished`.
The existing "width unchanged" guard in `onWindowGeometryChanged` already ignores `frameGeometryChanged` events
during a pure move, so no change is needed there.

## Nearest-Slot Math

`nearestInsertionIndex(offsets, widths, x)` (new, pure, in `core/coordinates.ts`) takes the offsets/widths of
every column except the dragged one, builds the list of boundaries (each column's left edge, plus the last
column's right edge), and returns the index of the closest boundary to `x`.
`Grid.insertionIndexForX(excludeId, virtualX)` (new, in `core/grid.ts`) builds that offsets/widths list from the
grid's own ordered columns and delegates to the pure function.
Its return value is already the exact `toIndex` shape `Grid.moveColumn` expects, since both operate over "all
columns except the one being moved."
`toVirtualX(realX, area, viewportOffsetX)` (new, pure, in `kwin/geometry-sync.ts`, the inverse of the existing
`toRealRect`) maps `Workspace.cursorPos.x` into strip coordinates.

## Module Layout

A new `src/input/drag.ts` (already earmarked in the architecture doc) owns the per-window wiring: it exports
`registerDragReorder(win, columnId, deps)`, called once per window from `main.ts`'s `onWindowAdded`, returning a
disconnect function alongside the existing `onFrameGeometryChanged` disconnect.
`deps` bundles the existing `Grid`, `Viewport`, `WorkspaceAdapter`, the screen `area` rect, and a `render()`
callback — the same shape of dependency bag `ShortcutActions` already uses for shortcuts.
`main.ts` combines the geometry-change and drag disconnect functions into the single function already stored per
column in `disconnectByColumn`.
This is a deliberate first step of pulling per-window wiring out of `main.ts`; the existing resize wiring stays
inline for now and can be revisited in a later, separate refactor.

## API Additions

`types/kwin.d.ts`: `QPoint { x, y }`; `WorkspaceApi.cursorPos: QPoint`; `Window.interactiveMoveResizeStarted` and
`interactiveMoveResizeFinished: Signal<() => void>`.
`WindowAdapter`: `isInteractiveMove()` (reads `window.move`), `onInteractiveMoveResizeStarted`/
`onInteractiveMoveResizeFinished` (same connect/disconnect wrapper shape as `onFrameGeometryChanged`).
`WorkspaceAdapter`: `cursorX(): number` (reads `Workspace.cursorPos.x`).

## On Release

`main.ts` (via `drag.ts`) computes `virtualX = toVirtualX(workspaceAdapter.cursorX(), area, viewport.offset())`,
then `targetIndex = grid.insertionIndexForX(columnId, virtualX)`, then `grid.moveColumn(columnId, targetIndex)`,
then `render()` with no exclusions — the drag has ended, so every window, including the dropped one, snaps fully
into place.
No `revealFocused()` call, consistent with resize's precedent: the cursor is by definition already on-screen.
Focus is not touched by the reorder itself — KWin already activates a window when the drag on it starts, which
the existing `onWindowActivated` handler turns into `grid.setFocus`.

## Testing

`nearestInsertionIndex` and `toVirtualX` get direct unit tests (boundary picking, degenerate cases: zero or one
remaining column).
`Grid.insertionIndexForX` gets tests in `grid.test.ts` alongside the existing `moveColumn` coverage.
`input/drag.ts`, the `kwin.d.ts` additions, and the `main.ts` wiring are untested glue, consistent with the rest
of `kwin/` and `main.ts` (docs §8).

## Out of Scope

Live preview while dragging (columns shifting before release).
Animating the post-drop reflow (columns snap instantly).
Cross-row dragging (only a single row/strip currently exists).
Undock/redock via drag (that remains the separate, keyboard-shortcut-driven feature already planned).
