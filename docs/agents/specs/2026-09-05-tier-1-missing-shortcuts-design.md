# Tier 1 Missing Shortcuts

## Problem

`docs/comparison-keybindings.md` lists a "Drift Target" column alongside "Drift" for each action.
Seven target bindings have no current Drift shortcut.
Two of them (toggle floating, cycle column width presets) need a feature or model that doesn't exist yet and are out of scope here.
The remaining five action pairs — ten shortcuts total — can be built entirely on primitives that already exist in `Grid`, `Column`, `Viewport`, and `Strip`.
This design covers those five.

## Decision

Every existing Drift shortcut follows the same six-layer pattern: a `Settings` field and default, a matching `<entry>` in `drift/contents/config/main.xml`, a `ShortcutActions` method and `registerShortcuts` registration in `src/input/shortcuts.ts`, a delegating method on `StripStack`, and the real implementation on `Strip` (calling into `Grid`/`Column`).
All five additions below follow that same pattern with no changes to the pattern itself.
None require a new `Grid`/`Column` primitive — each reuses one that already exists for mouse-driven behavior (drag-resize, drag-reorder) and gives it a keyboard entry point.

## Focus First/Last Column

`Grid.moveFocus(step)` already walks the `ordered` array one column at a time from the current focus, skipping hidden columns, stopping at whichever end it reaches.
`focusFirst()`/`focusLast()` run the same skip-hidden scan from the array's own start/end instead of from the current focus, so they reach the edge in one call instead of degenerating into a long `moveFocus` walk.
`Strip.focusFirst()`/`focusLast()` call `this.activateColumn(this.grid.focusFirst())`, mirroring `focusLeft`/`focusRight` exactly.

- Settings: `shortcutFocusFirst` (default `Meta+Home`), `shortcutFocusLast` (default `Meta+End`).

## Move Column To Start/End

`Grid.moveColumn(id, toIndex)` already accepts an arbitrary target index — it's what `moveWindowLeft`/`moveWindowRight` call with `currentIndex ∓ 1`.
`moveWindowToStart()`/`moveWindowToEnd()` call it with `toIndex = 0` / `toIndex = ordered.length - 1` instead, then run the same `snapColumn` + `render` + `revealFocused` sequence `moveWindowLeft` already does.
As with the existing `moveWindowLeft`/`Right` naming, "window" here means "the focused column" (Drift moves columns, not individual windows, in the strip) — this collapses Karousel's four separate column/window start/end bindings into Drift's existing one-name-per-action-pair convention.

- Settings: `shortcutMoveWindowToStart` (default `Meta+Ctrl+Home`), `shortcutMoveWindowToEnd` (default `Meta+Ctrl+End`).

## Viewport To Start/End

`Strip.shiftViewport(delta)` animates the camera with `this.animator.animate(this.viewport.offset(), target, ...)` where `target` is a *relative* offset (`current + delta`).
`shiftViewportToStart()`/`shiftViewportToEnd()` need an *absolute* target instead: refactor `shiftViewport` to take the target directly (`animateViewportTo(target)`), with the existing relative callers computing `offset() + delta` before calling it.
Start's target is `viewport.contentLeft()`.
End's target is `Math.max(viewport.contentLeft(), viewport.contentLeft() + viewport.contentWidth() - viewport.viewportWidth())` — the same formula `Viewport`'s own private `maxOffset()` uses, computed from `Viewport`'s existing public getters so `Viewport` itself doesn't need a new method.

- Settings: `shortcutViewportShiftToStart` (default `Meta+Alt+Home`), `shortcutViewportShiftToEnd` (default `Meta+Alt+End`).

## Column Width Step

`Grid.resizeColumn(id, width, edge)` already exists and backs mouse drag-resize.
`increaseColumnWidth()`/`decreaseColumnWidth()` call it with `focused.width ± columnWidthStep`, mirroring how `shiftViewportLeft`/`Right` step by the existing `viewportShiftStep` setting.
`Column.setWidth` throws on a non-positive width, so `decreaseColumnWidth` clamps its target to `columnWidthStep` as a floor rather than letting the resize go non-positive.

- New setting: `columnWidthStep` (default `80`, pixels — open to adjustment, same tuning knob as `viewportShiftStep`).
- Settings: `shortcutIncreaseColumnWidth` (default `Meta+Plus`), `shortcutDecreaseColumnWidth` (default `Meta+Minus`).

## Window Height Step

`Column.resizeTile(id, height, edge)` already exists and backs drag-resize between two stacked tiles; it's already a documented no-op when there's no neighbor on the resized edge (single-tile column).
Add `Column.growFocusedTile(step)`/`shrinkFocusedTile(step)`: each resolves the focused tile's neighbor (`edge: 'bottom'` first, falling back to `'top'` if there's no tile below), computes a target height clamped so neither tile goes below `step` itself, and calls `resizeTile`.
`Strip.increaseWindowHeight()`/`decreaseWindowHeight()` reuse the existing private `moveTile(move: (column: Column) => boolean)` helper — the same one `moveTileUp`/`moveTileDown` already use — so `render`/`revealFocused` come for free: `increaseWindowHeight(): boolean { return this.moveTile((column) => column.growFocusedTile(this.settings.windowHeightStep)); }`.

- New setting: `windowHeightStep` (default `80`, pixels).
- Settings: `shortcutIncreaseWindowHeight` (default `Meta+Shift+Plus`), `shortcutDecreaseWindowHeight` (default `Meta+Shift+Minus`).

## Config Key Naming Note

`comparison-keybindings.md`'s Drift Target column has a markdown formatting glitch on the width/height rows (`` Meta++` / `Meta+- `` and `Meta+Shift++ / Meta+Shift--`, stray backtick and doubled dash).
The increase defaults above use the named key `Plus` rather than a literal `+` or the unshifted `=`: `+` in a `QKeySequence` string is the modifier separator, so the key itself must be spelled out as `Plus` (`Meta+Plus`, `Meta+Shift+Plus`).
The decrease defaults keep the literal `-`, which isn't ambiguous with the separator the way `+` is.
Worth fixing the doc's formatting alongside this work, not blocking on it.

## Out Of Scope

- **Cycle column width presets** (`Meta+R`) — needs a preset-width list and per-column state tracking which preset is active; `resizeColumn` alone doesn't provide that. Separate follow-on design.
- **Toggle floating** (`Meta+Space`) — blocked on the floating/undock feature itself, which doesn't exist yet (tracked on the roadmap already).

## Testing

- `grid.test.ts`: `focusFirst`/`focusLast` — skip-hidden behavior, no-op when already at the reachable edge, `null` focus case.
- `column.test.ts`: `growFocusedTile`/`shrinkFocusedTile` — neighbor selection (`bottom` then `top` fallback), no-op on a single-tile column, clamping at the `step` floor.
- `strip.test.ts`: all ten new methods — `moveWindowToStart`/`End` reusing `moveColumn`, `shiftViewportToStart`/`End` target computation (including the narrower-than-viewport content case), `increaseColumnWidth`/`decreaseColumnWidth` clamping.
- Shortcut wiring tests in `input/shortcuts.test.ts`, following the existing pattern for the ten new entries.
- `main.xml` gets ten new `<entry name="shortcut...">` blocks plus `columnWidthStep`/`windowHeightStep`; no dedicated test, matches how existing entries are covered only by `settings.test.ts`'s `loadSettings` round-trip.
