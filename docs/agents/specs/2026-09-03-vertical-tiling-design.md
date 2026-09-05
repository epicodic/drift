# Vertical Tiling (Column Stacking)

## Problem

`Column` currently models one window per column only — identity and width, nothing else (`src/core/column.ts`).
`docs/architecture.md` calls this out explicitly ("there is no vertical tiling within a column yet"), the roadmap lists it as not yet implemented, and `docs/comparison-paperwm.md` already flags PaperWM's absorb/expel (`Super+I`/`Super+O`) as the interaction model to borrow "once Drift's `Column` supports more than one window."
Drift needs that: the ability to stack more than one window vertically inside a single column, so a user isn't forced to give every window its own horizontal slot.

## Decision

`Column` gains an ordered list of **tiles** — `{ id: number; height: number }` — plus `focusedTileId: number | null`.
A tile's height is an absolute pixel value, exactly like a column's `width`, but with a constraint widths don't have: a column's tile heights (plus inter-tile gaps) must always sum to `Grid.screenHeight()`, since the vertical axis is the fixed screen height, not a scrollable virtual space like the horizontal strip.
A column with exactly one tile behaves exactly as today; no migration is needed for existing single-window columns, they're just 1-tile columns.

`ColumnRegistry` changes from `Map<number, Entry>` to `Map<number, Entry[]>` keyed by column id, with each column's entries ordered to match its `Column`'s tile order — no separate tile-id lookup lives in the registry, position is the link, the same way `Grid` already treats column order (not a stored offset) as the source of truth for horizontal position.
`columnOf(windowId)` keeps returning a column id; a new `tileOf(windowId)` returns `{ columnId, tileId }`.

### Why not rename `Column` to `Tile` and introduce a new stack-owning `Column`

Considered and rejected. "Column" is used pervasively across docs and code to mean *the horizontal slot in the strip* — renaming it would ripple through `architecture.md`, `algorithms.md`, every comparison doc, and every call site, for no behavioral gain over nesting tiles inside the existing `Column`.

### Why not compute height-splitting in the runtime layer instead of `core/`

Considered and rejected. Height-splitting is pure layout math, exactly the kind of thing the project's architecture principle puts in `core/` (fully unit-tested, KWin-free) rather than runtime glue — it would duplicate the width/height split the codebase already deliberately makes between `core/` (pure) and `runtime/`/`kwin/` (glue).

## Core API (`src/core/column.ts`, `grid.ts`)

- `Column.addTile(height?)` — appends a tile, shrinking existing tiles proportionally to make room. Default: even split across all tiles including the new one.
- `Column.removeTile(id)` — removes a tile, redistributing its height to the remaining tiles proportionally.
- `Column.resizeTile(id, height, edge: 'top' | 'bottom')` — takes the height delta from the adjacent tile in that direction. Unlike `Grid.resizeColumn` (which shifts `originX` and grows/shrinks the strip's total virtual width), there is no "grow the container" option vertically — the container is fixed at `screenHeight()`, so a tile can only grow by taking space from its neighbor. This is the central asymmetry between the two axes.
- `Column.tileRect(id, columnRect): Rect` — derives a tile's `y`/`height` sub-rect from the column's own rect, mirroring `Grid.columnRect`.
- `Column.focusUp()` / `Column.focusDown()` — move `focusedTileId` to the adjacent tile, mirroring `Grid.focusLeft/Right`. No-op on a single-tile column.

## Focus & Navigation

`Grid.focusLeft`/`focusRight` are unchanged: they still move between columns and land on the target column's already-focused tile (or its first tile, the first time that column is focused). New `focusUp`/`focusDown` shortcuts move within the focused column's stack. Clicking any visible stacked window updates `focusedTileId` through the normal window-activation path — `Strip.activateWindow` resolves to `(columnId, tileId)` via `ColumnRegistry.tileOf`, not just a column id.

Both are wired as new global shortcuts (`shortcutFocusUp`/`shortcutFocusDown` settings), following the existing `registerShortcuts` pattern in `src/input/shortcuts.ts`.

## Absorb / Expel

Two new shortcuts, matching PaperWM's model exactly (absorb/expel from/to the right):

- **`absorbRight`**: take the column immediately to the right of the focused column. It must currently hold exactly one tile (absorbing an already-stacked column is out of scope this pass — see below). Remove that column from the grid entirely and append its window as a new tile at the bottom of the focused column's stack, taking an even share of height with the existing tiles.
- **`expel`**: remove the focused tile from the focused column's stack (redistributing its height to the rest of the stack) and create a brand-new column for it immediately to the right of the current column, at `settings.defaultColumnWidth`. If the focused column only has one tile, this is a no-op (there's nothing to expel — that's just the column itself).

Both reuse the existing `render()` → `revealFocused()` pipeline afterward, unchanged.

## Resize (mouse-driven, matching the existing width-resize model)

Column-width resize today isn't a Drift-initiated UI gesture: the user interactively resizes the window's edge via KWin itself, and `onWindowGeometryChanged` (`src/runtime/window-events.ts`) observes the resulting frame-geometry change and calls `Grid.resizeColumn`. A height-only change (width unchanged) is currently filtered out and ignored entirely.

Height resize follows the same passive-observation pattern: for a window that's part of a multi-tile stack (`ColumnRegistry.tileOf` returns non-null with a stack size > 1), a height-only geometry change now calls `Column.resizeTile` instead of being dropped. Which neighbor loses the height is decided the same way `resizedEdge` decides left/right today, but vertically — compare rounded `y` instead of `x` (a moved top edge means the tile above loses height, a moved bottom edge means the tile below does). No new vertical position-animation is introduced: a tile resize snaps immediately, matching how column-width resize already snaps rather than animates.

## Rendering (`Strip.render`, `GeometrySync`)

`Strip.render()` currently does one `grid.columnRect(id)` + one `geometrySync.apply()` per column, reading the column's single registered window from `ColumnRegistry.get(columnId)`. It changes to, per column, iterate `column`'s tiles in order, compute `column.tileRect(tileId, columnRect)`, and apply that rect to the corresponding registry entry's window. `columnMotion` (per-column horizontal position smoothing) stays column-scoped — all tiles in a column move together on the x-axis, since they share the column's virtual x/width.

## Out of Scope (documented limitations, not implemented this pass)

- **Drag-to-stack (mouse)**: no modifier-key detection is available in the KWin script sandbox (confirmed: nothing in `src/types/kwin.d.ts` or `src/input/` exposes keyboard-modifier state during a drag, consistent with the minimap design doc's note that a held-modifier overlay is impossible for the same reason), and a center-zone-of-column drop target was also deferred. Absorb/expel via keyboard covers stacking this pass.
- **Absorbing a column that's already a stack**: `absorbRight` requires the right-neighbor column to be a single tile. Stack-absorbs-stack is a straightforward follow-up (append all its tiles) but adds test surface without being asked for.
- ~~**Minimap**: a column's thumbnail shows its active tile only; no multi-tile thumbnail rendering.~~ Implemented 2026-09-03: `MinimapColumn` now carries a `tiles` array (one entry per stacked window, with its own position/icon/thumbnail/focus), and the minimap overlay renders each column as a stack of sub-rectangles separated by a divider line, with the focus ring on only the truly focused tile.
- ~~**Cross-row drag**: `Strip.detachFocusedColumn` currently returns a single `WindowAdapter`... preserving the stack across rows is follow-up work.~~ Implemented 2026-09-04: `detachFocusedColumn` already returned every window in the stack; `Strip.addWindowStack` now re-adds them as tiles of one new column in the target strip, so a stacked column dragged with the mouse past the top/bottom screen edge (`StripStack.onEdgeDwellFired` → `moveFocusedWindowToStrip`) stays one stacked column instead of splitting apart. Adapted 2026-09-05: the keyboard Meta+Ctrl+Up/Down shortcut no longer uses this whole-column path at all — `StripStack.moveWindowToStripAbove/Below` now tries `Strip.moveTileUp/moveTileDown` (reorder within the stack) first, and only expels the single focused tile to the strip above/below via the new `Strip.detachFocusedTile`/`StripStack.moveFocusedTileToStrip` when it's already at that edge of its stack (or the column has just one tile, same as before).
- **Fullscreen**: toggling fullscreen applies to the focused tile's window only, same as today's single-window behavior; other tiles in the stack stay where they are underneath.
- **Persisting stack layout across restart**: unaffected — same "not yet" as layout persistence generally (already on the roadmap).

## Testing

- `column.test.ts`: new coverage for `addTile`/`removeTile`/`resizeTile`/`tileRect`/`focusUp`/`focusDown`, including the height-sums-to-`screenHeight` invariant and the shared-pie resize math (resizing one tile always takes from/gives to its neighbor, never grows the total).
- `grid.test.ts`: unaffected column-level behavior stays covered as-is; any new column/grid interaction (e.g. `screenHeight()` feeding tile math) gets a thin integration case.
- `column-registry.test.ts`: `Map<number, Entry[]>` shape, `tileOf` resolution, ordering preserved across `set`/`delete`.
- `window-events.test.ts`: height-only geometry change now resizes a tile (for a stacked window) instead of being filtered out; single-tile columns keep the existing "ignored" behavior.
- `strip.test.ts`: `render()` applying per-tile rects for a multi-tile column; `absorbRight`/`expel` moving a window between column-hood and tile-hood and updating focus correctly; `focusUp`/`focusDown` shortcut wiring.
- Shortcut wiring tests for `absorbRight`, `expel`, `focusUp`, `focusDown`, following the existing pattern in `src/input/shortcuts.ts`.
