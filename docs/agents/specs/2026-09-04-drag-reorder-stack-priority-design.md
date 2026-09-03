# Drag Reorder/Stack Priority — design

## Problem

`docs/agents/specs/2026-09-03-drag-to-stack-design.md` split a dragged-over column into three
horizontal bands: outer quarters for reorder, the middle half for stack.
Live testing showed this was hard to use.
Reorder fired the instant a drag grazed a neighbor's near edge, before the user could ever
deliberately aim for the stack zone.
Fixing that unreachability required deferring reorder's commit to release, which also broke the
project's earlier commitment to "reorder happens live, exactly like it always did."

## Decision

Go back to two independent, differently-measured triggers, checked in priority order every tick:

1. **Reorder** — the dragged window's own left/right edge crossing a neighbor's center
   (`Grid.insertionIndexForEdges`, unchanged since `docs/agents/specs/2026-08-28-window-drag-reorder-design.md`).
   Live commit, exactly as before drag-to-stack existed: `Grid.moveColumn` runs immediately, every
   tick it fires.
2. **Stack** — only checked when reorder did *not* fire this tick. Whichever column the real mouse
   pointer (not the dragged window's geometry) currently sits over, if it's a neighbor rather than
   home. Needs a dwell: hovering must persist past `columnDragDwellMs` before a preview appears at
   all, so a fast drag that's only passing through on its way to a genuine reorder swap never
   flashes one. Preview-until-release, unchanged from the prior design — only the trigger changed.

Because the two triggers use different measurements (window edges vs. real pointer) and different
timing (immediate vs. dwell-gated), they don't fight over the same pointer movement: reorder claims
the tick the instant its threshold crosses; stack only ever gets a look on ticks reorder skipped.

## Same-column drag

Unaffected. Hovering the dragged tile's own column (by pointer position) still resolves a vertical
slot among its existing tiles and previews a same-stack move, with no dwell — this was never part of
the reorder/stack ambiguity, since there's no neighbor column in play.

## Mechanics

- `Grid.insertionIndexForEdges` — reused unchanged.
- `resolveStackSlot` (`src/input/drag-hover.ts`) — pure vertical-slot resolution given an
  already-identified target column and a y position. Replaces `resolveStackHover`, which used to
  also resolve the target column and gate on a horizontal fraction band; both of those
  responsibilities move to the tick logic in `src/input/drag.ts`, since they now depend on the
  pointer and the reorder-priority check.
- `EdgeDwell<T>` (`src/viewport/edge-dwell.ts`) — generalized from its original `EdgeDirection`-only
  form (used for cross-row drag) to a generic type parameter, reused here armed on a neighbor
  column id instead of an edge direction. Same arm/fire/disarm semantics.
- `columnDragDwellMs` (`src/config/settings.ts`, default 400ms) — new setting, mirroring
  `rowDragDwellMs`.

## Superseded

`resolveReorderTarget` and the fraction-band gating in the old `resolveStackHover` are deleted —
both were specific to the abandoned "unify reorder and stack on the same window-center measurement"
approach. `ReorderPreview`/`Grid.previewOffsetsWithColumnAt` are deleted too: reorder commits live
again, so `Strip.render()` reflects the real, already-mutated `Grid` layout — the same
`ColumnMotion`-driven slide that visualized every other live commit already handles it, with no
synthetic preview offsets needed.
