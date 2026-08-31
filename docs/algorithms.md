# Algorithms

See [`docs/architecture.md`](architecture.md) for the concepts referenced below (virtual coordinates, columns, viewport).

## Column Layout Math

Source: [`virtualWidth`, `columnRect`](../src/core/coordinates.ts) in `coordinates.ts`, and `Grid`'s private `layoutOffsets`/`layoutWidths` in [`grid.ts`](../src/core/grid.ts).

A column's virtual position is never stored — it is always recomputed from the ordered list of column widths.
`layoutOffsets()` walks the columns left to right and accumulates: each column's offset is the running cursor, and the cursor advances by that column's width plus `gap` (a hidden column contributes a fixed, tiny `HIDDEN_COLUMN_WIDTH` and no trailing gap, so a run of hidden columns fits inside the single surrounding gap).

$$
\text{offset}_i = \text{origin} + \sum_{j=0}^{i-1} (\text{width}_j + \text{gap})
$$

`virtualWidth(widths, gap)` sums all widths plus `gap` between them (not after the last column), giving the strip's total extent.
Because both are pure derivations from the current column list, adding, removing, or resizing a column and recomputing these values is enough to keep the layout gapless — there is no separate "shift neighbors" step to keep in sync.

`columnRect(offset, width, height)` turns an offset into a full rect; height always equals the grid's configured height, so columns always span the full usable screen height.

## Resize-Edge Detection

Source: [`resizedEdge`](../src/core/coordinates.ts) in `coordinates.ts`, called from [`onWindowGeometryChanged`](../src/runtime/window-events.ts) in `window-events.ts`.

When a tiled window's frame geometry changes, Drift needs to know whether the user resized it from the left edge or the right edge, because only a left-edge resize should shift the strip's origin (`Grid.resizeColumn`'s `edge` parameter).
`resizedEdge(oldRect, newRect)` compares the rounded `x` of the old and new geometry: if `x` moved, the left edge moved; otherwise the right edge moved.
Rounding matters because KWin/Wayland can report fractional geometry for the same logical position (`rectsEqualRounded` uses the same rounding for the same reason).

`onWindowGeometryChanged` also filters out changes that are not real width changes before calling into the grid: pure moves/height-only changes (width unchanged) are ignored, and changes matching `GeometrySync.isEcho` (Drift's own last write) are ignored, so only genuine user-driven width changes reach `Grid.resizeColumn`.

## Drag-Reorder Insertion Index

Source: [`Grid.insertionIndexForEdges`](../src/core/grid.ts) in `grid.ts`, driven by [`registerDragReorder`](../src/input/drag.ts) in `drag.ts`.

While a window is being interactively moved, Drift never writes its real geometry — it moves freely under the cursor — but the *order* of the other columns updates live: on every `frameGeometryChanged` tick during the drag, `registerDragReorder` converts the dragged window's own left and right edges (not the cursor) to virtual x coordinates (`toVirtualX`), then asks `Grid.insertionIndexForEdges` whether it should trade places with its current immediate left or right neighbor.
If the returned index differs from the column's current position, the swap is committed immediately via `Grid.moveColumn`, and the displaced neighbor slides into its new position through the normal per-column position animation (see "Layout-Change Position Animation" below) rather than jumping.
Using the window's own edges, rather than the cursor, means the vote reflects where the dragged window itself sits, regardless of where within it the user grabbed to start the drag.

The criterion is intentionally directional and edge-based, matching how a user visually judges a swap: the dragged window trades places with its right neighbor once its own *right* edge crosses that neighbor's center, and with its left neighbor once its own *left* edge crosses that neighbor's center.
`insertionIndexForEdges(excludeId, leftEdgeVirtualX, rightEdgeVirtualX)` finds only the current immediate left and right neighbor (skipping hidden columns), reading each one's real center — its actual current offset plus half its width, taken straight from the grid's live layout — and checks the matching edge against it: the right edge against the right neighbor's center, the left edge against the left neighbor's center.
It returns that neighbor's index once its center is crossed, or `excludeId`'s own current index (i.e. no move) when neither immediate neighbor has been crossed.
Because centers are read from the real, undisturbed layout, the two directions are symmetric: crossing a neighbor's center costs the same distance whether that neighbor is to the left or to the right.
Checking only the *immediate* neighbor, rather than voting across every other column at once, keeps each reorder step a single swap — consecutive ticks during a fast drag simply keep re-evaluating against whatever the new immediate neighbor becomes after each swap.

On `interactiveMoveResizeFinished`, the same edge-based computation runs once more, then the dragged column itself is forced to snap instantly into its final slot (`Strip.snapColumn`) while its neighbor keeps whatever slide it was already mid-flight on.

## Viewport Reveal and Animation Easing

Source: [`Viewport.offsetToReveal`](../src/viewport/viewport.ts) in `viewport.ts` and [`Animation`](../src/viewport/animator.ts)/[`Animator`](../src/viewport/animator.ts) in `animator.ts`.

`offsetToReveal(rectX, rectWidth)` computes the minimal scroll offset such that the given rect is fully visible, without scrolling at all if it already is:
- If the content is narrower than the viewport, no scroll is needed.
- If the rect itself is wider than the viewport (can never be fully shown), it scrolls just enough to show as much of the near edge as possible, without overshooting past the rect's own bounds.
- Otherwise, it scrolls left/right by the minimal amount to bring the rect's near edge into view.

The result is clamped to `[contentLeft, contentLeft + contentWidth - viewportWidth]` so the camera never scrolls past the strip's bounds.

Animating to that offset is a plain, injectable-clock interpolation, split into two pieces so the math is unit-testable without a real timer:
- `Animation.valueAt(elapsedMs)` computes the eased value at a given elapsed time, independent of any timer.
  Easing defaults to `easeOutCubic` — $1 - (1-t)^3$ — a fast start with a gentle settle.
- `Animator` drives an `Animation` from a real timer: each tick it reads wall-clock elapsed time (via an injected `now()`), computes `valueAt(elapsed)`, and calls the `onUpdate` callback (which scrolls the viewport and re-renders).
  Using elapsed wall-clock time rather than counting ticks means a dropped/delayed tick under load does not slow the animation down — the value simply catches up on the next tick.

## Layout-Change Position Animation

Source: [`ColumnMotion`](../src/viewport/column-motion.ts) in `column-motion.ts`, driven by [`Strip.render`](../src/runtime/strip.ts) in `strip.ts`, sharing a `Timer` with the camera's `Animator` via [`SharedTicker`](../src/viewport/shared-ticker.ts).

Whenever a column's logical x changes for a reason other than the user actively dragging or resizing it — adding, removing, or minimizing/restoring a window, a resize pushing a neighbor, or a drag-reorder settling on release — `ColumnMotion` animates that column's real x from wherever it currently visually is to the new logical x, using the same eased duration as the camera (`settings.animationDurationMs` / `easeOutCubic`).
A column is never animated on its own first appearance (add, restore, returning from fullscreen): `ColumnMotion` snaps a never-seen-before column straight to its target, so only *already-visible* neighbors slide.

Border-drag resize stays fully instant: `Strip.render`'s `instant` flag makes `ColumnMotion` snap straight to the target instead of animating for those frames.
Window drag-reorder is the exception: neighbors displaced by a live reorder tick, or by the settle on release, animate like any other layout change; only the dragged column itself is forced instant, via `Strip.snapColumn` on release.
`Strip` forgets a column's motion state whenever it is hidden (minimized) or excluded (fullscreen), so that restoring it later snaps to its new position instead of animating in from a stale pre-hide value.

`SharedTicker` exists because a `Strip` is only ever given one real `Timer`, but the camera pan and per-column motion are independent animations that may need to tick at once.
It hands out independent `Timer`-shaped handles that share one real timer, starting it when any handle is active and stopping it only once every handle has stopped.
