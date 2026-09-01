# Row Navigation

## Problem

Every `Strip` today is one scrollable surface: a single `Grid` of columns, viewed through one horizontal `Viewport`.
A `(activity, virtualDesktop)` pair gets exactly one `Strip`, so all its windows compete for the same horizontal strip regardless of how unrelated they are.
PaperWM's "workspace stack" and niri's vertical-scroll-of-workspaces are both prior art for a second, vertical axis: multiple independent strips stacked below each other, paged between rather than all sharing one row.
Drift needs its own version of that axis without reusing KWin virtual desktops for it — the desktop dimension already means something else in Drift (see [`docs/architecture.md`](../../architecture.md#activities-and-virtual-desktops)) and PaperWM's model conflates "workspace" and "row" in a way that doesn't fit Drift's existing per-activity/per-desktop `Strip` partition.

## Decision

Introduce `StripStack`, a new layer between `StripManager` and `Strip`.
`StripManager` now maps `(activity, desktop)` to one `StripStack` instead of one `Strip` directly.
`StripStack` owns an ordered set of rows, each row being exactly the `Strip` that exists today (unchanged: `Grid` + `Viewport` + `Animator` + `GeometrySync` + `ColumnRegistry`), plus its own `activeRowIndex` and a second, vertical `Animator` for row-paging transitions.
Rows are addressed by a non-negative integer index; row `0` is the default, topmost row and always exists.
Rows are created lazily (paging past the last existing row, or explicitly moving a window into a new row) and pruned automatically once empty, except row `0`, which is never pruned — the same lazy-create/prune shape `StripManager` already applies to activity/desktop keys.

## Vertical Geometry

Extend `toRealRect` and `GeometrySync.apply` with a `viewportOffsetY` parameter, mirroring the existing `viewportOffsetX` handling: `y: area.y + virtualRect.y - viewportOffsetY`.
Each row has a virtual y position `rowIndex * area.height` in a vertical coordinate space that parallels the existing horizontal one.
`StripStack`'s vertical `Animator` interpolates a single vertical camera offset between the old and new active row's virtual y, exactly as the horizontal `Animator` interpolates `Viewport`'s offset today.
On each tick, `StripStack` renders only the outgoing and incoming row's `Strip` with their respective `viewportOffsetY`; every other row sits at a fixed resting offset and is repositioned once (on creation or when the active row changes past it), not on every tick.
A full page transition therefore reads as a one-row-height vertical slide, matching the horizontal viewport's existing animated-scroll feel.

## Navigation & Shortcuts

Four new shortcuts, parallel to the existing `focusLeft`/`focusRight`/`cycleAlignLeft`/`cycleAlignRight` set:

- `rowUp` / `rowDown` — page `StripStack.activeRowIndex` by one and animate the vertical transition. `rowUp` is a no-op at row `0`. `rowDown` creates a new empty row if the next index doesn't exist yet.
- `moveWindowToRowAbove` / `moveWindowToRowBelow` — move the focused column's window out of the active row's `Strip` into the row above/below (creating it if needed), preserving its width. Focus follows the window, so the shortcut also pages `StripStack` to the target row. A no-op at row `0` for "above".

Unlike activity/desktop reassignment, nothing in KWin ever moves a window between rows on its own — rows are a Drift-only concept — so these shortcuts are the only way a window changes row after being opened.

## Cross-Row Activation

A window parked in an inactive row is positioned off-screen — chosen over minimizing so row-paging can animate as a real vertical slide — with `skipTaskbar` toggled per row-activation to keep the taskbar from listing every row's windows at once.
If that window is activated externally — clicked in the taskbar, reached via Alt-Tab, focused by a notification — it must not silently receive KWin focus while sitting off-screen.
`StripStack.activateWindow(win)` extends the existing "every focus change triggers a reveal" model ([`docs/architecture.md`](../../architecture.md#focus-model)) up one level: it looks up which row owns the window, switches `activeRowIndex` if needed (animating the page transition), then delegates to that row's `Strip.activateWindow()` exactly as today.
`skipTaskbar` is safe to toggle this way because `WindowAdapter.isTileable()` — the only place that reads it — is checked once, at the moment a window is first picked up by `WindowManager`, never on a live-changed signal (`window-manager.ts:16`); toggling it later on an already-tiled window cannot cause Drift to un-tile it.

## New Window Placement

An opened window always lands in `StripStack`'s currently active row, matching how new windows already land in the currently active `Strip` today.
There is no per-window row-targeting in this pass.

## Out Of Scope

Deferred to follow-up work, not part of this design:

- **Minimap row indicator** — the minimap already shows the active row's column layout for free today (it snapshots the active `Strip`, unchanged by this design), but a dedicated "which row am I on" visual is separate follow-up work.
- **Drag-to-move a window between rows** with the mouse — only the keyboard shortcuts ship this round.
- **Free/continuous vertical scroll** — row transitions are discrete pages (old row out, new row in), not a continuous drag like the horizontal viewport's `shiftViewportLeft`/`shiftViewportRight`.
- **Persisting row assignment across restart** — same "not yet" as layout persistence generally (already on the roadmap).
- **Off-screen windows appearing correctly in Alt-Tab/Overview** — flagged during design and knowingly accepted: off-screen-positioned windows in inactive rows will still appear in KWin's Alt-Tab switcher and Overview/Present Windows, positioned oddly, since neither is affected by `skipTaskbar`. Revisit if this proves disruptive in practice.

## Testing

- `StripStack` (new, pure-logic unit tests mirroring `StripManager`'s and `Strip`'s existing test shape): lazy row creation, row-0-never-pruned, prune-when-empty for rows 1+, `activeRowIndex` transitions and clamping, `rowUp`/`rowDown` no-ops at bounds, `moveWindowToRowAbove`/`Below` moving a column and updating focus/active row, `activateWindow` paging to the owning row.
- `coordinates.test.ts` / `geometry-sync.test.ts`: extend `toRealRect`/`GeometrySync.apply` coverage for `viewportOffsetY`, parallel to the existing `viewportOffsetX` cases.
- `Strip` tests: `render()` accepting a vertical offset and writing the expected `y`.
- `StripManager` tests: updated to key `(activity, desktop)` to a `StripStack` instead of a `Strip` directly; existing activity/desktop routing behavior unchanged.
- Shortcut wiring tests for the four new shortcuts, following the existing pattern in `input/shortcuts`.
- `window-adapter.test.ts`: `skipTaskbar` toggling round-trips correctly and doesn't affect `isTileable()` once a window is already managed.
