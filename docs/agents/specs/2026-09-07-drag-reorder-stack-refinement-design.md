# Drag Reorder/Stack Refinement — design

## Problem

`docs/agents/specs/2026-09-04-drag-reorder-stack-priority-design.md` got reorder and stack coexisting
without fighting over the same tick, but live use surfaced two remaining problems:

1. **Reorder fires too eagerly.** `Grid.insertionIndexForEdges` swaps the moment the dragged column's
   edge crosses a neighbor's real *center* — for equal-width columns, that's the instant it's 50%
   displaced into the neighbor. A drag that merely grazes a neighbor on its way toward a deliberate
   stack gesture already commits a swap before the user meant one.
2. **Stack slot landing is imprecise.** `resolveStackSlot` (`src/input/drag-hover.ts`) walks every
   tile's midpoint fresh each tick with no memory of the previously-resolved slot, so hovering near a
   tile-height boundary flickers between adjacent slots. It's also driven by the real cursor position
   (`deps.cursorPos()`), a deliberate choice at the time to avoid a window's own edges overshooting or
   undershooting when grabbed off-center — but it means stack and reorder measure two fundamentally
   different things (pointer vs. window geometry), which is itself a source of the mechanism feeling
   inconsistent.

## Decision

### 1. Reorder: fire near the swap's final position, not at the halfway point

`insertionIndexForEdges` generalizes its implicit 50% center-crossing threshold to a configurable
fraction `reorderThresholdFraction` (default `0.85`) of the neighbor's width, measured as how far the
dragged column's entering edge has penetrated the neighbor from their shared boundary:

- Right neighbor: fires once `rightEdgeVirtualX > offsets[rightIndex] + widths[rightIndex] *
  reorderThresholdFraction`.
- Left neighbor: fires once `leftEdgeVirtualX < offsets[leftIndex] + widths[leftIndex] * (1 -
  reorderThresholdFraction)`.

`centerAt(index)` was exactly the `0.5` case of this and is superseded by the parameterized form.
Reorder still commits live, immediately, the instant the threshold crosses — this only changes *how
far* the drag has to commit before it fires, not the live/immediate nature of the commit itself
(preserving the project's existing "reorder happens live" commitment).

### 2. Stacking: one geometry-and-dwell algorithm, used identically for same-column and cross-column drags

Replaces `resolveStackSlot`'s continuous midpoint-walk and its `cursorPos()` dependency with a
discrete, window-edge-based test — the same measurement axis reorder already uses, and the same
algorithm regardless of whether the candidate tile is in the dragged tile's own column or a neighbor's:

1. **Candidate neighbor tile.** Only the dragged column's immediate left/right neighbor (via
   `Grid`'s existing `visibleNeighborIndex`, the same neighbors reorder itself considers) for
   cross-column, or the dragged tile's own column's other tiles for same-column — of that tile list,
   whichever tile the dragged window currently overlaps most vertically.
2. **Overlap gate.** Horizontal overlap between the dragged window's rect and the candidate tile's
   rect must exceed a threshold (`stackOverlapFraction`, default `0.5`) — for same-column candidates
   this is close to always-true (both share the column's width), so it mainly disambiguates
   cross-column: "genuinely hovering this neighbor" vs. "passing through it toward something else."
3. **Direction band.** If the gate passes, the dragged window's own top edge, expressed as a
   fraction of the candidate tile's height: top 25% → stack **above** the candidate, bottom 25% →
   stack **below**, middle 50% → **no action** this tick. The dead zone in the middle is deliberate:
   it's what keeps a near-boundary hover from flickering between adjacent slots, replacing the
   sticky-slot special-casing an earlier iteration of this design considered.
4. **Dwell.** The resolved `(tileId, direction)` pair must hold steady for `columnDragDwellMs` before
   it arms and a preview appears — reusing `EdgeDwell<T>` exactly as today, just keyed on the compound
   result instead of only a neighbor column id. Without this, a drag merely passing across another
   window while heading toward a farther destination would trigger a stack preview immediately on
   contact. `EdgeDwell<T>` compares directions with `===`, so `T` must stay a primitive — the compound
   key is encoded as a single string, e.g. `` `${tileId}:${direction}` ``, not a fresh object literal
   per tick.

Both same-column (reordering within your own current stack) and cross-column (stacking into a
different column) now resolve through this one function. The only difference between the two cases is
which tile list is searched in step 1 and, on commit, whether a "leaving" side needs to render
(unchanged from today's `renderStackPreview` split in `src/input/drag.ts`).

## Superseded

- `resolveStackSlot`'s continuous midpoint-walk (`src/input/drag-hover.ts`) — replaced by the
  overlap-gate + direction-band function above.
- `DragReorderDeps.cursorPos()` and its two call sites in `src/input/drag.ts` (stack-hover pointer
  position, pointer-to-column lookup) — no longer needed once stacking measures window geometry
  instead of the pointer. `Grid.columnAtVirtualX` (`src/core/grid.ts:150`) has no other caller in the
  codebase and becomes dead code, removable.
- `centerAt` (`src/core/grid.ts:315`) — superseded by the parameterized threshold in
  `insertionIndexForEdges`; still correct as the `reorderThresholdFraction = 0.5` special case, so it
  can either be deleted or kept as the (now-configurable) default depending on how the implementation
  reads more cleanly.
- The dead-zone-based direction band supersedes the "sticky slot" hysteresis idea raised earlier in
  this same design conversation — the dead zone already provides that hysteresis as a side effect, so
  no separate previous-slot memory is needed.

## Settings

Two new tunables, following the existing pattern (`src/config/settings-definitions.ts`,
`src/config/settings.ts`):

- `reorderThresholdFraction: number` — default `0.85`. Fraction of a neighbor's width the dragged
  column's edge must penetrate before a reorder swap fires.
- `stackOverlapFraction: number` — default `0.5`. Minimum horizontal overlap between the dragged
  window and a candidate tile before that tile is considered for stacking at all.

`columnDragDwellMs` (existing, default `400`) is reused unchanged — same-column drags now go through
the dwell path too, which they did not before.

Both new defaults are starting points, consistent with how every dwell/threshold value in this area of
the codebase has needed live-tuning after the first pass (`columnDragDwellMs`, `rowDragDwellMs`).

## Wiring Changes

- `src/core/grid.ts`: `insertionIndexForEdges` takes `reorderThresholdFraction` (from settings,
  threaded through the same way `columnDragDwellMs` already reaches `drag.ts`). `columnAtVirtualX` and
  `centerAt` removed per Superseded above.
- `src/input/drag-hover.ts`: `resolveStackSlot` is replaced by a new function (e.g.
  `resolveStackDirection`) taking the dragged window's rect and a candidate tile list, returning
  `{ tileId, direction: 'above' | 'below' } | null` per the overlap-gate + direction-band algorithm.
  Pure, no KWin dependency, same as today.
- `src/input/drag.ts`: `tickInner`'s same-column branch (today: no dwell, direct `resolveStackSlot`
  call) and cross-column branch (today: dwell-gated `resolveStackSlot` call) both route through the
  same new dwell-gated call, keyed on the compound `(tileId, direction)` string. `renderStackPreview`
  is adjusted to take a resolved `{ tileId, direction }` and translate it to a tile-list index itself
  (today's `resolveStackSlot` returned a raw index directly; the new function returns a tile-relative
  position instead). `DragReorderDeps.cursorPos` is dropped from the interface.

## Edge Cases

- **Dragging past both edges of a single-tile column with no neighbor** (edge-expel,
  `Grid.expelDirectionForEdges`): unaffected — that path doesn't go through either reorder's
  threshold or the new stack algorithm.
- **Neighbor tile shorter than the drag's vertical travel in one tick**: the direction band is
  evaluated fresh each tick against whichever tile currently has the most overlap, so a fast drag
  skipping past a short tile simply never dwells on it long enough to arm — consistent with the dwell
  gate's existing purpose.
- **Same-column drag with only one other tile**: the "above/below" band against that single tile is
  the entire resolution space — equivalent to today's two-tile stack reordering, just measured
  differently.

## Out of Scope

- No change to the commit model (preview live, one atomic mutation on release) — unaffected by this
  refinement.
- No change to cross-row drag (`docs/agents/specs/2026-09-02-cross-row-drag-design.md`) — different
  edge, different purpose, already coexists cleanly.
- No modifier-key gestures — still unavailable in the KWin script sandbox.

## Testing

- `grid.test.ts`: `insertionIndexForEdges` with non-default `reorderThresholdFraction` values,
  including the `0.5` boundary matching today's exact behavior for regression safety.
- `drag-hover.test.ts`: the new overlap-gate + direction-band function — gate threshold boundaries,
  each of the three bands (above/below/dead-zone), same-column vs. cross-column tile lists, a
  same-column candidate list of exactly one other tile.
- `drag.test.ts` (or equivalent glue-level coverage already established for this file): dwell now
  gates the same-column path too; a resolved direction changing before dwell elapses resets it, same
  as the existing cross-column case today.
