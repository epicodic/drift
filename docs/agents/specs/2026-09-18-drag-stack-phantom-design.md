# Drag-to-stack: phantom column + pointer slot — design

## Purpose

Mouse reorder feels natural, but mouse stacking is clunky and buggy in ways live use keeps surfacing.
Investigation of `drift/src/input/drag.ts`, `drift/src/input/drag-hover.ts`, and `drift/src/core/grid.ts` found four root causes.

1. Edge-expel has zero threshold (`Grid.expelDirectionForEdges`): one pixel of outward drift after the pull frees the drag creates a new standalone column, live, and the home column slides away.
   This is the "unstacking slips into a new column at the left" symptom, and the likely cause of `docs/known_bugs.md` entry 1.
2. There is no "unstack in place" gesture when neighbors exist on both sides.
   The only way out is the live reorder path, which expels *and* swaps, landing the window past the neighbor.
3. The vertical band is measured from the dragged window's *top edge*, top 25 % → above, bottom 25 % → below.
   A tiled window starts its drag at `y ≈ 0`, already inside a full-height neighbor's top band, so "above" is nearly free while "below" needs the window three quarters off-screen.
4. The middle-50 % dead zone plus a 400 ms dwell that restarts on every key change means flipping "above" → "below" on one tile collapses the preview, shows nothing, then waits again.

This design replaces the live edge-expel with a previewed standalone slot, measures the vertical slot from the pointer, and keys the dwell on the target column rather than the slot.

## Principle

A stack tile being dragged is previewed as if it were already a standalone column.
From there it behaves exactly like dragging a standalone column does today: it occupies layout space, it moves past neighbors by the reorder rule, and it stacks into a neighbor by the overlap rule.
Nothing about a stack tile's drag is committed before release.

## Behavior

### Target model

The spec's three-way target is realized as the mode decision in drag.ts (standalone, home, phantom) over the pure helpers resolveStackTarget, resolveSlotFromPointer, and initialPhantomIndex in drag-hover.ts, rather than one resolveDragTarget function, because the phantom-aware neighbor rects depend on the mode chosen that tick.

- `{ kind: 'stack', columnId, tileId, direction }` — a slot in a column, own or neighbor.
- `{ kind: 'phantom', index }` — the dragged tile becomes its own column at grid index `index`.
- `null` — only reachable for a dragged single-tile column that overlaps no neighbor.

### Resolution per tick

Runs on every `frameGeometryChanged` tick once the pan phase has freed the drag (`2026-09-16-drag-pull-threshold-indicator-design.md` is unchanged).

**Dragged window is a single-tile column** — unchanged from today.
Live reorder at `reorderThresholdFraction` fires first.
Otherwise a neighbor stack target resolves at `stackOverlapFraction` horizontal overlap.
Its own real column already occupies layout space, which is what makes "standalone between neighbors" trivially available for it today.

**Dragged window is a stack tile** — decided by its horizontal overlap with its home column's *committed* rect.

- Overlap ≥ `stackOverlapFraction` → same-column stack target among its siblings.
- Otherwise → **phantom mode**.
  A phantom column of the tile's width is inserted beside home, on the side the window's center is on.
  The phantom obeys the reorder rule as a preview: when the window's leading edge penetrates `reorderThresholdFraction` of a *previewed* neighbor, the phantom index moves past that neighbor.
  A neighbor stack target is layered on top, resolved at `stackOverlapFraction` overlap against the neighbor's *previewed* rect.
  The phantom stays open while a neighbor slot is previewed.

Keeping the phantom open is what keeps the measurement basis stable.
If the phantom closed whenever a neighbor slot previewed, the neighbor would snap back under the window, change the overlap by roughly the column gap, and oscillate at the threshold.
With the phantom always present, the previewed layout only changes when the phantom index moves, and that transition is governed by the 85 % rule, well away from the 50 % stack threshold.

Home overlap is measured against the committed grid, not the previewed one, for the same reason: entering phantom mode on the left shifts home to the right visually, and measuring against the shifted rect would flip the decision back.

**Vertical slot** — from the pointer, not the window's top edge.
The target column's tile under the pointer's area-relative y is found among the column's committed tile rects, positioned at the column's previewed x, clamped to the first tile above the column and the last tile below it.
Pointer above that tile's midline → `above`, otherwise → `below`.
There is no dead zone.
Resolving against committed rects, not the previewed ones, matters for the same stability reason home overlap is measured against the committed home rect: an armed gap moves the previewed tile rects, so resolving against them could flip the decision back and forth at the threshold instead of tracking the pointer.
The dragged window's height is irrelevant to a stack insertion, so this does not reintroduce the grab-offset problem `2026-09-07-drag-reorder-stack-refinement-design.md` avoided; horizontal resolution stays geometry-based.

### Cost worth naming

Stacking a tile into its right neighbor now needs about 1.7 window widths of travel instead of about 0.6, because the neighbor slides away to make room for the standalone slot.
That is the same distance a standalone column needs today, so it is consistent rather than new.

### Dwell and preview persistence

The dwell (`DwellTimer`, unchanged) is keyed on the target *column*: `stack:<columnId>` or `phantom`.
Entering a new column or phantom mode waits `columnDragDwellMs`.
Slot changes and phantom index changes inside an armed target preview live, with no further dwell.
While a new key is dwelling, the last armed preview stays on screen instead of collapsing.
A `null` target clears the preview immediately, as today.
`columnDragDwellMs` default drops from 400 to 200.

### Commit on release

| Target | Commit |
|---|---|
| stack, same column | `Column.moveTile` (existing) |
| stack, other column | `Strip.commitTileIntoStack` (existing) |
| phantom | new `Strip.commitTileToStandalone(fromColumnId, fromTileId, index)` |

`commitTileToStandalone` calls a new `Grid.expelTile(columnId, tileId, width)`, which generalizes `expelFocusedTile` to an explicit tile id, then `Grid.moveColumn(newId, index)`, then the same registry, `fullScreenTiles`, and `minimizedTiles` bookkeeping `commitTileIntoStack` performs.
The new column's width is the home column's width, matching keyboard `expel`.
`seedMotionFrom` on release is unchanged, so the dropped window still eases from where it was let go.

### Preview fix

`Column.previewRectsWithGapAt` gained one correction: with `excludeTileId` set (a same-column reorder preview), the trailing neighbor is no longer shrunk, because the excluded tile's own height already funds the gap — shrinking it too used to double-count the gap and collapse the trailing tile toward 0 height.

## Rendering

`StackPreview` becomes `DragPreview`.

```ts
interface DragPreview {
    phantom?: { index: number; width: number };
    leaving?: { columnId: number; tileId: number };
    entering?: { columnId: number; index: number; gapHeight: number; excludeTileId?: number };
}
```

`Grid` gains a pure `previewLayout(phantom?)` returning per-column rects, the virtual width, and the slot list (offset, width, hidden per position) with the phantom inserted at `phantom.index`.
Columns at or after the phantom index shift right by `phantom.width + gap`.
`Strip.render` uses it for every column rect and for `viewport.setContentGeometry`.
`drag.ts` uses the same call to build neighbor candidate rects and to run the phantom's reorder check, so hover resolution and rendering share one definition of "what is on screen".
The core math of `insertionIndexForEdges` is extracted into a function over an explicit layout, so it can run on the preview layout for the phantom and on the committed layout for a real column.

## Superseded

- `Grid.expelDirectionForEdges` and the live edge-expel branch in `drag.ts` — replaced by phantom mode.
- `expelToStandaloneColumn` and `resolveReorderColumn` in `drag.ts` — live reorder no longer applies to a stack tile mid-drag; the phantom is its reorder.
- `resolveDirection`'s top-edge 25 % banding and its dead zone — replaced by the pointer midline rule.
- The dwell keyed on `(columnId, tileId, direction)` — now keyed on the column alone.
- `docs/known_bugs.md` entry 1 — closed by removing the zero-threshold expel.

## Unchanged

- Live reorder for single-tile columns, including `reorderThresholdFraction`.
- Pan, pull-to-free, and the pull indicator.
- Cross-strip drag via the screen-edge dwell in `StripStack`.
- `Column.previewRectsWithoutTile`, `Column.insertTileAt`, `Column.moveTile`.
- No modifier-key gestures; still unavailable in the KWin script sandbox.

## Settings

No new settings.
`stackOverlapFraction` gates both home overlap and neighbor overlap.
`reorderThresholdFraction` drives phantom movement as well as live reorder.
`columnDragDwellMs` default changes from 400 to 200.

## Edge cases

- **Two-tile home column** — the leaving preview (`previewRectsWithoutTile`) shifts the remaining tile up at its own height, leaving empty space below it; the fill happens on release, when `removeTile` redistributes.
- **Home column at the grid boundary** — phantom mode on the outer side inserts the phantom at index 0 or at the end; nothing else shifts on that side.
- **Hidden (minimized) columns** — `previewLayout` treats them exactly as `layoutOffsets` does; the phantom is never hidden.
- **Window closes mid-drag** — the model was never mutated, so existing `removeWindow` cleanup applies unchanged.
- **Pointer outside every tile vertically** — clamped to the first or last tile, so a stack target never drops out because of the pointer's y alone.

## Testing

- `drag-hover.test.ts`: `resolveStackTarget`, `resolveSlotFromPointer`, and `initialPhantomIndex` for both dragged kinds, pointer slot resolution including clamping and the midline boundary, phantom side selection and index movement, neighbor overlap gate measured against previewed column rects, slot against committed tile rects.
- `grid.test.ts`: `previewLayout` offsets and virtual width with and without a phantom and with hidden columns, `expelTile`, the extracted insertion-index math on a preview layout.
- `strip.test.ts`: `commitTileToStandalone` at each index, including the registry and bookkeeping side effects.
- `drag.ts` stays untested glue, consistent with every prior drag design.

## Documentation

- `docs/algorithms.md` § Drag-to-Stack Hover Resolution rewritten for the phantom and pointer rules.
- `docs/features.md` § Drag-to-stack updated for the standalone slot gesture.
- `docs/known_bugs.md` entry 1 removed.
