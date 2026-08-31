# Algorithms

See [`docs/architecture.md`](architecture.md) for the concepts referenced below (virtual coordinates, columns, viewport).

## Column Layout Math

Source: [`src/core/coordinates.ts`](../src/core/coordinates.ts).

A column's virtual position is never stored — it is always recomputed from the ordered list of column widths.
`columnOffsets(widths, gap, origin)` walks the widths left to right and accumulates: each column's offset is the running cursor, and the cursor advances by that column's width plus `gap`.

$$
\text{offset}_i = \text{origin} + \sum_{j=0}^{i-1} (\text{width}_j + \text{gap})
$$

`virtualWidth(widths, gap)` sums all widths plus `gap` between them (not after the last column), giving the strip's total extent.
Because both functions are pure derivations from the current width list, adding, removing, or resizing a column and recomputing these values is enough to keep the layout gapless — there is no separate "shift neighbors" step to keep in sync.

`columnRect(offset, width, height)` turns an offset into a full rect; height always equals the grid's configured height, so columns always span the full usable screen height.

## Resize-Edge Detection

Source: [`resizedEdge`](../src/core/coordinates.ts) in `coordinates.ts`, called from [`onWindowGeometryChanged`](../src/runtime/window-events.ts) in `window-events.ts`.

When a tiled window's frame geometry changes, Drift needs to know whether the user resized it from the left edge or the right edge, because only a left-edge resize should shift the strip's origin (`Grid.resizeColumn`'s `edge` parameter).
`resizedEdge(oldRect, newRect)` compares the rounded `x` of the old and new geometry: if `x` moved, the left edge moved; otherwise the right edge moved.
Rounding matters because KWin/Wayland can report fractional geometry for the same logical position (`rectsEqualRounded` uses the same rounding for the same reason).

`onWindowGeometryChanged` also filters out changes that are not real width changes before calling into the grid: pure moves/height-only changes (width unchanged) are ignored, and changes matching `GeometrySync.isEcho` (Drift's own last write) are ignored, so only genuine user-driven width changes reach `Grid.resizeColumn`.

## Drag-Reorder Insertion Index

Source: [`nearestInsertionIndex`](../src/core/coordinates.ts) in `coordinates.ts`, driven by [`registerDragReorder`](../src/input/drag.ts) in `drag.ts`.

While a window is being interactively moved, Drift does not touch the layout — the window moves freely under the cursor.
Only on `interactiveMoveResizeFinished` does `registerDragReorder` act: it converts the cursor's real screen x to a virtual x (`toVirtualX`), then asks `Grid.insertionIndexForX` for the closest valid insertion index among all *other* columns (the dragged column is excluded from the candidate list so it cannot "insert relative to itself").

`nearestInsertionIndex(offsets, widths, x)` builds the list of column boundaries — each column's left edge, plus one final boundary at the last column's right edge — and returns the index of the boundary closest to `x` by absolute distance.
That index is a valid `moveColumn` target: inserting at boundary `i` places the column immediately before the column currently at index `i` (or at the end, for the final boundary).

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

Live interactive gestures (border drag, window drag) stay fully instant: `Strip.render`'s `instant` flag makes `ColumnMotion` snap straight to the target instead of animating for those frames.
`Strip` forgets a column's motion state whenever it is hidden (minimized) or excluded (fullscreen), so that restoring it later snaps to its new position instead of animating in from a stale pre-hide value.

`SharedTicker` exists because a `Strip` is only ever given one real `Timer`, but the camera pan and per-column motion are independent animations that may need to tick at once.
It hands out independent `Timer`-shaped handles that share one real timer, starting it when any handle is active and stopping it only once every handle has stopped.
