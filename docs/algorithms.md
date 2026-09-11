# Algorithms

See [`docs/architecture.md`](architecture.md) for the concepts referenced below (virtual coordinates, columns, viewport).

## Column Layout Math

Source: [`virtualWidth`, `columnRect`](../drift/src/core/coordinates.ts) in `coordinates.ts`, and `Grid`'s private `layoutOffsets`/`layoutWidths` in [`grid.ts`](../drift/src/core/grid.ts).

A column's virtual position is never stored — it is always recomputed from the ordered list of column widths.
`layoutOffsets()` walks the columns left to right and accumulates: each column's offset is the running cursor, and the cursor advances by that column's width plus `gap` (a hidden column contributes a fixed, tiny `HIDDEN_COLUMN_WIDTH` and no trailing gap, so a run of hidden columns fits inside the single surrounding gap).

$$
\text{offset}_i = \text{origin} + \sum_{j=0}^{i-1} (\text{width}_j + \text{gap})
$$

`virtualWidth(widths, gap)` sums all widths plus `gap` between them (not after the last column), giving the strip's total extent.
Because both are pure derivations from the current column list, adding, removing, or resizing a column and recomputing these values is enough to keep the layout gapless — there is no separate "shift neighbors" step to keep in sync.

`columnRect(offset, width, height)` turns an offset into a full rect; height always equals the grid's configured height, so columns always span the full usable screen height.

## Resize-Edge Detection

Source: [`resizedEdge`](../drift/src/core/coordinates.ts) in `coordinates.ts`, called from [`onWindowGeometryChanged`](../drift/src/runtime/window-events.ts) in `window-events.ts`.

When a tiled window's frame geometry changes, Drift needs to know whether the user resized it from the left edge or the right edge, because only a left-edge resize should shift the strip's origin (`Grid.resizeColumn`'s `edge` parameter).
`resizedEdge(oldRect, newRect)` compares the rounded `x` of the old and new geometry: if `x` moved, the left edge moved; otherwise the right edge moved.
Rounding matters because KWin/Wayland can report fractional geometry for the same logical position (`rectsEqualRounded` uses the same rounding for the same reason).

`onWindowGeometryChanged` also filters out changes that are not real width changes before calling into the grid: pure moves/height-only changes (width unchanged) are ignored, and changes matching `GeometrySync.isEcho` (Drift's own last write) are ignored, so only genuine user-driven width changes reach `Grid.resizeColumn`.

## Drag-Reorder Insertion Index

Source: [`Grid.insertionIndexForEdges`](../drift/src/core/grid.ts) in `grid.ts`, driven by [`registerDragReorder`](../drift/src/input/drag.ts) in `drag.ts`.

While a window is being interactively moved, Drift never writes its real geometry — it moves freely under the cursor — but the *order* of the other columns updates live.
On every `frameGeometryChanged` tick during the drag, `registerDragReorder` converts the dragged window's own left and right edges (not the cursor) to virtual x coordinates (`toVirtualX`), then asks `Grid.insertionIndexForEdges` whether it should trade places with its current immediate left or right neighbor.
If the returned index differs from the column's current position, the swap is committed immediately via `Grid.moveColumn`, and the displaced neighbor slides into its new position through the normal per-column position animation (see "Layout-Change Position Animation" below) rather than jumping.
Using the window's own edges, rather than the cursor, means the vote reflects where the dragged window itself sits, regardless of where within it the user grabbed to start the drag.

The criterion is directional, edge-based, and threshold-driven: the dragged window trades places with its right neighbor once its own *right* edge has penetrated `reorderThresholdFraction` of the way across that neighbor (measured from their shared boundary), and with its left neighbor symmetrically.
`insertionIndexForEdges(excludeId, leftEdgeVirtualX, rightEdgeVirtualX, thresholdFraction)` finds only the current immediate left and right neighbor (skipping hidden columns), computes each one's threshold x position — its real offset plus a fraction of its width, taken straight from the grid's live layout — and checks the matching edge against it: the right edge against `offset + width * thresholdFraction` for the right neighbor, the left edge against `offset + width * (1 - thresholdFraction)` for the left neighbor.
It returns that neighbor's index once its threshold is crossed, or `excludeId`'s own current index (i.e. no move) when neither immediate neighbor has been crossed.

`thresholdFraction = 0.5` reproduces a plain center-crossing swap; the shipped default (`settings.reorderThresholdFraction`, `0.85`) requires the drag to travel most of the way across the neighbor — near where the dragged column will actually end up post-swap — rather than firing the instant it's merely half displaced, so a drag that only grazes a neighbor while aiming for something else no longer commits an unintended swap.
Because both thresholds are read from the real, undisturbed layout, the two directions stay symmetric: penetrating a neighbor by the configured fraction costs the same distance whether that neighbor is to the left or to the right.
Checking only the *immediate* neighbor, rather than voting across every other column at once, keeps each reorder step a single swap — consecutive ticks during a fast drag simply keep re-evaluating against whatever the new immediate neighbor becomes after each swap.

On `interactiveMoveResizeFinished`, the order has already settled live; the dragged window is then seeded at its actual drop rect via `Strip.seedMotionFrom` and eases into its resolved slot across all four dimensions (see "Layout-Change Position Animation" below) rather than snapping there, while its neighbor keeps whatever slide it was already mid-flight on.

## Drag-to-Stack Hover Resolution

Source: [`resolveStackTarget`, `stackTargetIndex`](../drift/src/input/drag-hover.ts) in `drag-hover.ts`, candidates gathered by [`registerDragReorder`](../drift/src/input/drag.ts) in `drag.ts` via `Grid.visibleNeighborColumnIds`/`Column.tileRect`.

Stacking is resolved purely from the dragged window's own geometry — never the cursor position — using the same measurement axis reorder already uses.
Every tick that reorder does *not* fire, `registerDragReorder` gathers a list of candidate tiles: the dragged tile's own column's other tiles (if it's currently in a multi-tile stack) plus every tile in both immediate neighbor columns.
`resolveStackTarget(draggedRect, candidates, overlapFraction)` filters those candidates to ones whose horizontal overlap with the dragged window (as a fraction of the *narrower* of the dragged window's and the candidate's own width) clears `overlapFraction` (`settings.stackOverlapFraction`, default `0.5`) — dividing by the narrower width, rather than always the candidate's, so a dragged window that is itself narrower than the candidate can still clear the gate when it's fully contained inside it horizontally.

Each gate-passing candidate is then banded purely from the dragged window's own top-left corner y (never its height, so a tall or short dragged window reaches the same band the same way): the corner falling in the candidate's own top 25% resolves to `'above'` (insert before that tile), the bottom 25% resolves to `'below'` (insert after it); the middle 50%, or the corner falling outside the candidate's own y-range entirely, excludes that candidate rather than returning a dead zone. Among the candidates that both clear the gate and band into a direction, the one with the most horizontal overlap wins.
`stackTargetIndex(target, tiles)` then translates the `{ tileId, direction }` result into a tile-list index for the eventual commit (`Column.insertTileAt`/`Column.moveTile`).

The resolved target must hold steady — the same `(columnId, tileId, direction)` triple, encoded as one string key — for `columnDragDwellMs` before a preview actually appears, reusing the same `EdgeDwell` dwell timer cross-row drag uses; this applies uniformly whether the candidate is in the dragged tile's own column or a neighbor's, so a drag merely passing across another window on its way elsewhere never flashes a stack preview.
Because `resolveStackTarget`/`stackTargetIndex` take only already-resolved rects and tile lists, they need no `Grid` or KWin dependency and are directly unit-testable.

## Focus-Flash Opacity Envelope

Source: [`flashOpacity`](../drift/src/ui/focus-flash.ts) in `focus-flash.ts`, sampled each tick by [`FocusFlashOverlay`](../drift/src/kwin/focus-flash-overlay.ts) in `focus-flash-overlay.ts`.

`flashOpacity(elapsedMs, durationMs)` is a pure sinusoidal envelope: $\sin(\theta)$ for $\theta = \pi \cdot \text{elapsedMs}/\text{durationMs} \in [0, \pi]$, which ramps smoothly from 0 up to 1 at the envelope's midpoint and back down to 0, rather than a linear fade or an instant on/off. It returns exactly `0` once `elapsedMs` exceeds `durationMs` (so the overlay knows when to stop ticking) and for any non-positive duration.

The glow's actual rendering — the inward-only edge falloff itself — is a separate concern handled entirely in the SDF fragment shader (`drift/shaders/focus_glow.frag`); this function only ever produces the *time-varying* overall opacity multiplier applied on top of that shader's output, keeping the "when" and the "what it looks like" independently testable.

## Viewport Reveal and Animation Easing

Source: [`Viewport.offsetToReveal`](../drift/src/viewport/viewport.ts) in `viewport.ts` and [`Animation`](../drift/src/viewport/animator.ts)/[`Animator`](../drift/src/viewport/animator.ts) in `animator.ts`.

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

Source: [`AxisMotion`](../drift/src/viewport/axis-motion.ts) in `axis-motion.ts`, driven by [`Strip.render`](../drift/src/runtime/strip.ts) in `strip.ts`, sharing a `Timer` with the camera's `Animator` via [`SharedTicker`](../drift/src/viewport/shared-ticker.ts).
`Strip` owns four independent `AxisMotion` instances, one per rect dimension: x, y, width, and height.
All four are keyed by *window* id, never column id.
A tile id is only stable within one column, since a stack move reassigns it in the target column.
Window keying is also what lets a single window be seeded independently — for a drag release or a keyboard move — without disturbing the siblings sharing its column.
Tiles of the same column resolve identical x and width targets from the layout, so a stack still moves as one.

Whenever a window's logical rect changes for a reason other than the user actively dragging or resizing it — adding, removing, or minimizing/restoring a window, a resize pushing a neighbor, a keyboard column move, a drag-reorder settling on release, or a stack composition change — `AxisMotion` animates the real value from wherever it currently visually is to the new logical value, using the same eased duration as the camera (`settings.animationDurationMs` / `easeOutCubic`).
This covers stacking a window into a column, removing one from a stack, and reordering within a stack, live-hover preview and commit alike.
Because width is an animated channel too, a keyboard column resize eases rather than jumping.
A window is never animated on its own first appearance (add, restore, returning from fullscreen): `AxisMotion` snaps a never-seen-before id straight to its target, so only *already-visible* neighbors slide.

Keyboard column moves (`moveWindowLeft`/`moveWindowRight`/`moveWindowToStart`/`moveWindowToEnd`) need no special casing at all.
They mutate the grid and re-render, and the moved column eases from wherever it was last drawn.

Border-drag resize stays fully instant: `Strip.render`'s `instant` flag makes `AxisMotion` snap straight to the target instead of animating for those frames.
`Strip.seedMotionFrom(windowId, rect)` is the general primitive for everything else: it rests any subset of a window's four channels at a given start value, so the next `render` eases from there into whatever the layout resolves.
`Strip.seedMotionFromCurrentGeometry(win)` is the common case, seeding from the window's own live on-screen rect.
Drag release uses it so a dropped window eases from exactly where it was let go, in all four dimensions including a cross-column stack drop's x and width.
A window rule's width goes the other way, seeding the *target* width so the rule applies instantly — it is part of the window's first appearance, which never animates.
`Strip` forgets a window's motion state whenever it is hidden (minimized) or excluded (fullscreen), so that restoring it later snaps to its new position instead of animating in from a stale pre-hide value.
It deliberately does *not* forget motion when a window moves into or out of a stack (`absorbRight`/`commitTileIntoStack`): its old rect is exactly the intended starting point for the stack-entry animation.

`SharedTicker` exists because a `Strip` is only ever given one real `Timer`, but the camera pan and the per-window motions are independent animations that may need to tick at once.
It hands out independent `Timer`-shaped handles that share one real timer, starting it when any handle is active and stopping it only once every handle has stopped.

## Align-Cycle Phase Stepping

Source: [`alignOffsets`/`nextAlignStep`](../drift/src/viewport/align-cycle.ts) in `align-cycle.ts`, driven by `Strip.cycleAlign` in [`strip.ts`](../drift/src/runtime/strip.ts).

Pressing `cycleAlignLeft`/`cycleAlignRight` never changes which column is focused — it steps the *already-focused* column through three candidate scroll offsets that place it flush against the viewport's left edge, centered, or flush against its right edge.
`alignOffsets(rectX, rectWidth, viewportWidth)` computes those three offsets directly from the column's rect, deliberately unclamped by content bounds (unlike `offsetToReveal`), so a column can be placed flush against either viewport edge even when the whole strip already fits within it.

`nextAlignStep(direction, currentOffset, offsets)` derives which of the three phases the viewport is currently in by comparing the rounded current offset against the three rounded candidates, rather than storing a phase — so it self-corrects if anything else moved the viewport between presses.
Each key drives the column toward its own edge and stops there instead of looping: `left` cycles right → centered → left, `right` cycles left → centered → right; pressing the same key again once already at that edge is a no-op.
If a column has no room to move within the viewport (`offsets.left === offsets.right`, e.g. the whole strip already fits), the cycle is a no-op regardless of direction.

## Viewport Shift

Source: `Strip.shiftViewport` in [`strip.ts`](../drift/src/runtime/strip.ts).

`shiftViewportLeft`/`shiftViewportRight` pan the camera by a fixed `settings.viewportShiftStep` without touching focus or the focused column's alignment — a plain `Animator.animate` call from the current offset to `offset ± step`.
Unlike focus-driven reveals and align-cycle, this is deliberately unclamped: the user can keep panning past either end of the content.
