# Layout margins and gaps — design

Date: 2026-09-09

## Problem

The layout only exposes two of the six spacing knobs a tiling layout needs: `columnGap` (horizontal space between columns) and `bottomMargin` (space reserved at the bottom of the screen, default 0px — added for a taskbar, never wired to any other edge).
There's no way to reserve space at the top, left, or right of the screen, and no way to put a gap between tiles stacked vertically inside one column.

## Decisions (confirmed with user)

- Six settings cover the full margin/gap surface, all `UInt`, all pixels, all default `8`:
  - `topMargin` (new)
  - `bottomMargin` (existing; default changes `0` → `8`, a deliberate behavior change for upgrading users)
  - `leftMargin` (new)
  - `rightMargin` (new)
  - `horizontalGap` (renamed from `columnGap`, same meaning: gap between columns)
  - `verticalGap` (new: gap between stacked tiles within one column)
- `config.ui`'s Layout tab gets four new spin-box rows (Top/Left/Right margin, Vertical gap) alongside the renamed Horizontal gap row, following the existing `label_<name>` / `kcfg_<name>` pattern.

## Margins: content-area inset

Today only `bottomMargin` is wired, and narrowly: `Strip` subtracts it from the height passed into `Grid`, but the screen origin used everywhere else (`GeometrySync`'s `area`, the `Viewport`'s width, drag-reorder's virtual-coordinate math, `screenBounds()`) stays the raw work area. All four margins need to shift/shrink that same origin consistently, or drag math and rendering will disagree about where the grid actually starts.

`src/core/coordinates.ts` already has `shrinkRect(rect: Rect, inset: Inset): Rect`, used today to turn a screen's raw geometry into its panel-trimmed work area (`WorkspaceAdapter.workingArea()`). It does exactly what margins need — no new function required. `Strip` gets a private `marginedArea(area)` that calls `shrinkRect(area, { top: topMargin, bottom: bottomMargin, left: leftMargin, right: rightMargin })`, and calls it once in its constructor and once in `updateArea()`, using the result — not the raw work area — as `this.area`, and to build `Grid`'s height (floored at 1px, matching today's `bottomMargin`-only floor), `Viewport`'s width, and `GeometrySync`'s area. Everything downstream that already reads `this.area` (drag-reorder's coordinate conversions, `seedMotionFromCurrentGeometry`, `screenBounds()`) needs no further change: they already treat `this.area` as the grid's coordinate origin, which is exactly what it becomes.

`StripStack`'s own use of the raw work area (paging distance between strips, top/bottom edge-drag detection) is unaffected — that's physical screen geometry, unrelated to one strip's content margins — and is not touched.

## Vertical gap: column height budget

A `Column`'s stacked-tile heights currently always sum to exactly the column's total height — `insertTileAt`, `removeTile`, `resizeTile`, and `rescaleHeight` all lean on that invariant. Introducing a gap between stacked tiles means the tile-height *budget* is `columnHeight - verticalGap × (tileCount − 1)`, which shrinks by one gap when a tile is added and grows by one when a tile is removed.

- `Column` gains a `rowGap` constructor parameter (mirroring how it already takes `width`/`height`), forwarded from `Grid`'s own new constructor parameter, in turn forwarded from `Strip`'s `settings.verticalGap`. `Grid.addColumn` and `Grid.expelFocusedTile` (both call `new Column(...)`) pass it through.
- `tileRect` adds `index × rowGap` to the y offset.
- `insertTileAt` computes the new even split as `(totalHeight - rowGap × (newCount - 1)) / newCount`, where `totalHeight` is derived as `sum(tile.height) + rowGap × (oldCount - 1)`.
- `removeTile` computes the freed budget as `totalHeight - rowGap × (newCount - 1)` (one gap's worth more than today's `remainingHeight + removed.height`, since one fewer gap is needed) and scales remaining tiles to fill it.
- `resizeTile`/`resizeFocusedTile` are unaffected — they only transfer height between two existing adjacent tiles, which doesn't change the tile count or gap count.
- `rescaleHeight` changes signature from a `factor` to the new absolute column height (`Grid.setHeight` already computes this; it stops precomputing a single `factor` and instead calls `column.rescaleHeight(newHeight)` per column), because the right factor depends on each column's own tile count, not just old/new height.
- `previewRectsWithGapAt`/`previewRectsWithoutTile` (drag-to-stack preview rects) add `rowGap` between consecutive tiles' y positions the same way `tileRect` does, so the live preview matches the post-drop layout.

## Testing

Following `test-driven-development`: extend the existing suites rather than rewrite them.

- `grid.test.ts` / `column.test.ts`: extend construction/insert/remove/resize/rescale cases with a non-zero `rowGap`, asserting `tileRect` y-offsets and that the height-budget invariant (`sum(heights) + rowGap × (count - 1) === columnHeight`) holds after every operation.
- `strip.test.ts`: assert that `Grid`/`Viewport`/`GeometrySync` all receive the margin-inset area, not the raw one, from both the constructor and `updateArea()`.
- `geometry-sync.test.ts`: unaffected in behavior (it already just reads whatever `area` it's given) — no new cases expected beyond incidental ones already covered above.
