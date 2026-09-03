# Drag-to-Stack — design

## Problem

Vertical tiling (`docs/agents/specs/2026-09-03-vertical-tiling-design.md`) shipped stacking as a keyboard-only
gesture (`absorbRight`/`expel`). That doc explicitly deferred mouse drag-to-stack, for two reasons: no
modifier-key detection is available in the KWin script sandbox, and a "center-zone-of-column drop target" needed
its own design pass. This is that pass.

Drift already supports drag-to-reorder (`docs/agents/specs/2026-08-28-window-drag-reorder-design.md`,
`docs/agents/specs/2026-08-31-drag-reorder-live-preview-design.md`): dragging a column swaps it with a neighbor,
live, whenever the dragged window's own edge crosses that neighbor's center. Drag-to-stack needs to coexist with
that without the two gestures fighting over the same pointer movement.

## Decision

Reuse the existing "edge crosses center" mental model, but subdivide the target column into zones: the outer
quarter on each side keeps triggering ordinary reorder-swap; the middle half becomes a **stack zone**. Hovering a
stack zone previews a live layout reflow — exactly like reorder's neighbor-slide, but opening a gap inside the
target column's tile stack instead of shuffling column order — and resolves the exact vertical slot from where
in the column you're hovering. On release, whatever is currently previewed is committed as one atomic model
change.

This generalizes cleanly to all four directions raised during scoping: a standalone column can be dragged into a
stack (new or existing), a tile can be dragged out of its stack to become standalone (expel-by-drag), a tile can
be dragged into a *different* stack, and a tile can be dragged to a new position within its own stack. All four
are instances of the same hover-resolution algorithm below; there is no special-cased code path per direction.

## Hover Resolution (every drag tick)

Resolved fresh from the dragged window's current geometry on every `frameGeometryChanged` tick — uniformly,
regardless of whether the dragged window is currently a standalone column or an existing stack tile:

1. **Target column** — whichever column's horizontal span currently contains the dragged window's virtual-x
   center. A new position→column lookup, extending the existing offset math `Grid.insertionIndexForEdges` /
   `toVirtualX` already use.
2. **Local fraction** — where that center falls within the target column's width, 0 (left edge) to 1 (right
   edge).
3. **Outer band** (`< 0.25` or `> 0.75`) → **reorder mode**, targeting a standalone-column position at/around
   that column. Because nothing is committed mid-drag (see Commit Model below), this resolves directly to a
   target index every tick rather than the current incremental immediate-neighbor stepping
   (`insertionIndexForEdges` only ever considers the immediate left/right neighbor) — a simplification that falls
   out for free from the commit model change, not a separate feature ask.
4. **Middle band** (`0.25`–`0.75`) → **stack mode**, targeting that column's tile list. The vertical slot is
   resolved by comparing the dragged window's y-center against the target column's *existing* tile midpoints
   (excluding the dragged tile itself, if it's already a member there) — the same edge-crosses-center logic as
   the horizontal case, walking a list of tiles instead of one left/right neighbor.

Whenever the resolved target differs from the dragged tile's current home (column or slot), the preview shows
**two** simultaneous reflows: the tiles it would leave behind close the gap it vacates, and the target opens a
gap for it. Same-column reorder-within-stack is the special case where both sides are the same tile list.
Reorder-mode's target side reuses today's existing column-order slide animation unmodified (`ColumnMotion`); only
a stack-tile's *source*-side gap-closing preview is new when the dragged item came from a stack.

## Commit Model: Preview Live, Commit Once On Release

The real model (`Grid`, `Column`, `ColumnRegistry`) is **not** mutated during the drag. Two approaches were
considered:

- Mutate the real model on every tick, mirroring how `Grid.moveColumn` is already committed live for horizontal
  reorder today. Rejected: a wobbling cursor near a zone boundary would repeatedly add/remove a real tile from a
  real column many times per second, churning `ColumnRegistry`, `fullScreenTiles`/`minimizedTiles`, and
  `ColumnMotion` bookkeeping far more than simple index arithmetic, with no natural notion of "cancel."
- **Chosen:** render-only live preview, with exactly one real mutation on `interactiveMoveResizeFinished`,
  matching whichever hover state is current at that instant. This mirrors how the keyboard `absorbRight`/`expel`
  operations already work — one atomic call — just previewed live instead of applied on a shortcut press. A
  useful side effect: a window closing/crashing mid-drag needs no special handling, since the model never left
  its pre-drag state until drop; existing `removeWindow` cleanup applies unchanged.

Horizontal reorder-swap is suppressed while a stack-hover is active, so the two gestures cannot fire on the same
tick.

## Core API Additions

- **`Column.insertTileAt(index, height?)`** — generalizes today's `addTile` (which always appends at the bottom)
  to insert at an arbitrary slot, same proportional-shrink height math. `addTile` becomes
  `insertTileAt(tiles.length)`.
- **`Column.moveTile(id, newIndex)`** — pure array reorder, no height redistribution — a tile's height is
  unchanged, only its position (and therefore derived y) changes. Used for same-stack drag-reorder.
- **Preview helpers on `Column`**, pure and non-mutating: `previewRectsWithGapAt(index, columnRect)` and
  `previewRectsWithoutTile(tileId, columnRect)`, feeding the two reflow sides from Hover Resolution. Directly
  unit-testable in isolation, no KWin glue involved.
- **Position→column lookup** (`Grid`), extending existing offset math, used to resolve "target column" in step 1
  above.
- No new `Grid` insert-at-index primitive is needed for expel: `Grid.addColumn(width)` (creates a standalone
  column with one full-`screenHeight()` tile, already today's behavior) followed by `Grid.moveColumn(id,
  targetIndex)` composes cleanly, both calls synchronous within the same commit — no visible intermediate frame.

## Wiring Changes

`registerDragReorder` (`src/input/drag.ts`) currently takes a fixed `columnId`, captured once at
`Strip.addWindow` time and never updated. `ColumnRegistry.moveWindow` (used by `absorbRight` today) relocates a
window's registry entry but never rewires its drag handler — so a window that later becomes a stacked tile keeps
a stale connection pointing at its original, since-removed column id. This is a pre-existing gap: grabbing an
already-stacked tile's title bar today hits that stale connection.

Fixing this is required to make stacked tiles draggable at all (approved scope), and is a strict improvement
independent of it. `registerDragReorder` stops taking a fixed `columnId` and instead resolves the window's
current location fresh via `registry.tileOf(win.id)` on every tick and at drop. `absorbRight`/`expel` (keyboard)
need no changes — the drag handler was the only thing depending on a frozen column id.

## Commit Mapping (on release)

One atomic operation, chosen by (source: standalone column | stack tile) × (target: standalone position | stack
slot):

| Source → Target | Operation |
|---|---|
| standalone → standalone position | `Grid.moveColumn` (unchanged, existing) |
| standalone → stack slot | remove column from `Grid`, `targetColumn.insertTileAt(slot)`, `registry.moveWindow` |
| stack tile → standalone position | `sourceColumn.removeTile(tileId)`, `Grid.addColumn` + `Grid.moveColumn`, `registry.moveWindow` |
| stack tile → different stack slot | `sourceColumn.removeTile(tileId)`, `targetColumn.insertTileAt(slot)`, `registry.moveWindow` |
| stack tile → same-stack different slot | `sourceColumn.moveTile(tileId, slot)` only — no registry change |

Every branch finishes with the same `fullScreenTiles`/`minimizedTiles`/`columnMotion` bookkeeping `absorbRight`
already performs today, generalized to whichever branch ran.

## Rendering

`Strip.render()` gains an optional hover-preview input describing the current drag's leaving/entering sides (e.g.
`{ leavingColumnId?, enteringColumnId?, enteringIndex? }`), computed by `drag.ts` each tick. When present, the
named column(s) render via the preview helpers above instead of their committed tile list; the dragged window's
own tile is excluded from geometry sync throughout, exactly as reorder does today (its real geometry keeps
following the cursor untouched).

## Edge Cases

- **Window closes/crashes mid-drag**: no special handling needed (see Commit Model) — the model was never
  mutated, so existing `removeWindow` cleanup applies as-is.
- **Dragging a single-tile column, or a stack tile, onto its own current slot**: resolves to "no change" — with
  the dragged tile excluded from its own hover computation, there's nothing left to reflow.
- **Expel's destination height**: `Grid.addColumn` already constructs a lone tile spanning full `screenHeight()`,
  so no extra height math is needed beyond what `removeTile` already does source-side (existing, tested).
- **Cross-row dragging** (`StripStack` paging between rows, `docs/agents/specs/2026-09-02-cross-row-drag-design.md`)
  is unaffected — it watches the dragged window's y-position near the *screen's* top/bottom edge, a different
  range and purpose than stack-slot detection (which looks at y *within* a column's own tile boundaries). The two
  features coexist without overlap.

## Out of Scope

Carried over unchanged from the original vertical-tiling design:

- No modifier-key gestures — still unavailable in the KWin script sandbox.
- No multi-tile minimap thumbnails.
- Stacks still don't survive a cross-row drag (a stacked column crossing rows still splits back into separate
  columns, per the existing documented MVP fallback).

## Testing

- The hover-resolution algorithm (position → reorder-index-or-stack-slot decision) lives as a **pure,
  directly-testable function**, separate from the KWin signal-wiring glue in `drag.ts` — fully unit-tested even
  though `drag.ts`'s tick-by-tick wiring itself stays untested glue, consistent with the precedent set by the
  live-preview design.
- `column.test.ts`: `insertTileAt` (boundary indices, height math), `moveTile` (position changes, heights
  untouched), the two pure preview-rect helpers.
- `strip.test.ts`: each of the four commit branches gets a direct test, mirroring how `absorbRight`/`expel` are
  tested today.
- A regression test proving a window's drag handler keeps working correctly after its column membership changes
  via absorb/expel/a prior drag — proves the stale-column-id bug is actually fixed.
