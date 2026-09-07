# Stack and drag-release motion — design

Date: 2026-09-07

## Problem

`ColumnMotion` (`src/viewport/column-motion.ts`) already animates a column's
real *x* whenever its logical x changes for a reason other than the user
actively dragging it (docs/algorithms.md, "Layout-Change Position
Animation"). Two things still snap instantly:

1. **Stacking within a column.** A tile's *y*/*height* comes straight from
   `Column.tileRect(...)` with no smoothing at all — adding, removing, or
   reordering a tile in a stack (live drag-hover preview included) redraws
   every sibling's position/size in one jump, unlike the horizontal case.
2. **The dragged window's own release.** By deliberate prior design
   (docs/algorithms.md: "only the dragged column itself is forced instant,
   via `Strip.snapColumn` on release"), the window being dragged is excluded
   from rendering for the whole gesture and then snapped straight to its
   final resolved rect the instant it's dropped — for both a reorder settle
   and a stack commit. This spec reverses that specific choice: the dropped
   window should ease into its final slot instead of jumping there.

## Approaches considered

**A — Generalize `ColumnMotion`'s key type, add two more instances (chosen).**
`ColumnMotion`'s logic (snap-on-first-sight, retarget-from-current-value,
`forget`, `isAnimating`) is already exactly what a per-tile y/height tracker
needs — only the key type (`number` column id) is column-specific. Widen it
to `AxisMotion<K>` (rename `column-motion.ts` → `axis-motion.ts`) and give
`Strip` two more instances, keyed by **window id** (not tile id — a tile
id is only stable within one column, and a stack move reassigns it in the
target column), driving each rendered tile's y and height in `render()`
exactly like `x` already drives the column.

**B — A separate, purpose-built `StackMotion` class for y/height.**
Rejected: would duplicate `ColumnMotion`'s logic almost verbatim (same
snap/retarget/forget/isAnimating shape) for no behavioral difference — the
two axes have identical requirements.

**C — Model release as a one-shot four-channel animation, decoupled from
`AxisMotion`.** Capture the drop-time rect and separately interpolate
x/y/width/height directly against the `WindowAdapter`, independent of the
virtual-layout render loop. Rejected: it would fight the `render()` calls
that keep firing during and after the release (keyboard-driven moves, other
tiles' own animations, a second drag starting immediately) with a second,
uncoordinated write path to the same window's geometry. Approach A already
gives the released window a motion entry for free — the release problem is
just *seeding* that entry correctly (see below), not a new mechanism.

## Confirmed decisions

| Case | Behavior |
|---|---|
| Live stack-hover preview (siblings opening/closing a gap) | Animates, same duration/easing as column x |
| Stack commit (drop, or keyboard move-up/down within a column) | Animates |
| Dragged window's own release — reorder (same column, x only changes) | Animates, eased in from its drop position |
| Dragged window's own release — same-column stack (y/height only) | Animates, eased in from its drop position |
| Dragged window's own release — cross-column stack (x *and* y/height change) | y/height animate; **x snaps** to the target column's x (see Out of scope) |
| New tile's first appearance (add, restore, un-minimize, exit fullscreen) | Instant snap — unchanged, matches `ColumnMotion`'s existing "never animate a first sighting" rule |
| Border-drag resize | Instant — unchanged, uses `render()`'s existing `instant` flag |

## New/changed components

### `viewport/axis-motion.ts` (renamed from `column-motion.ts`)

Same public shape as today's `ColumnMotion`, just parameterized:

```ts
class AxisMotion<K> {
    update(id: K, target: number, nowMs: number, durationMs: number): number
    snapTo(id: K, value: number): void
    forget(id: K): void
    isAnimating(): boolean
}
```

No behavioral change to the existing column-x usage. Test file renames to
`axis-motion.test.ts` alongside it.

### `runtime/strip.ts`

- Two new fields: `tileYMotion = new AxisMotion<string>()`,
  `tileHeightMotion = new AxisMotion<string>()`, keyed by `win.id`.
- `render()`'s per-tile loop: instead of taking `rect.y`/`rect.height`
  straight from `column.tileRect(...)`/preview rects, run them through
  `tileYMotion.update`/`tileHeightMotion.update` (or `.snapTo` when
  `instant` is set), the same way `x` already goes through `columnMotion`.
- The "keep ticking while animating" check (`columnMotion.isAnimating()`)
  gains the two new motions as additional conditions.
- **Forget on exit**, mirroring every existing `columnMotion.forget(columnId)`
  call site, but per affected *window* instead of per column:
  - `removeWindow` (both the single-tile-column path via `detachColumn` and
    the multi-tile path that currently has no equivalent forget at all).
  - `detachColumn`'s existing `for (const win of windows)` loop.
  - `hideTile` (minimizing one stack tile) / `setFullScreen` entering
    fullscreen for one stack tile — both already exclude that specific tile
    from the per-tile render loop without excluding its column.
  - Deliberately *not* forgotten on `absorbRight`/`commitTileIntoStack`: the
    moving window's old y/height are exactly the animation's intended
    starting point for the stack-entry motion, not a stale value to discard.
- New method, e.g. `seedDraggedTileMotion(win, columnId)`: reads
  `win.frameGeometry()` (same virtual-x/area-relative-y conversion
  `windowRectVirtual` in `drag.ts` already does), and calls
  `columnMotion.snapTo(columnId, virtualX)`, `tileYMotion.snapTo(win.id,
  virtualY)`, `tileHeightMotion.snapTo(win.id, height)` — i.e. "the window is
  currently *here*", with no animation of its own. The next `render()`
  computing a different target then naturally animates from that seeded
  point.

### `input/drag.ts`

In `finishedInner()`, replace the unconditional `deps.snapColumn(location.columnId)`
call with the new seed step, called for every release path (reorder settle,
same-column stack, cross-column stack) right before the commit + final
`render()` — not just the reorder branch. For cross-column stack, only the
y/height seeding actually changes anything (per the table above, x still
snaps to the target column's position).

## Testing

- `axis-motion.test.ts`: carry over `column-motion.test.ts`'s existing
  coverage unchanged (renamed, generic key), no new cases needed — logic is
  untouched.
- `strip.test.ts`: new cases for tile y/height animating on stack
  add/remove/reorder (mirroring existing column-x reorder tests), and for
  the various forget-on-exit paths.
- `drag.test.ts`: new/updated cases asserting the seed step runs on release
  for all three settle paths (reorder, same-column stack, cross-column
  stack) instead of the old hard `snapColumn` call.

## Documentation

`docs/algorithms.md` ("Layout-Change Position Animation") and
`docs/glossary.md` (`ColumnMotion` entry) both currently name
`ColumnMotion`/`column-motion.ts` specifically and describe drag-release as
forced-instant. Both need updating to reflect the `AxisMotion` rename, the
new tile y/height tracking, and the reversed release behavior.

## Out of scope

- The cross-column stack x-snap noted above: giving the arriving tile its
  own transient, independent x catch-up (falling back to the shared column
  x once converged) so *every* axis eases in even when crossing into a
  different column. Confirmed with user as a deliberate simplification, not
  an oversight.
- Animating a tile's *width* — stack tiles always span their full column
  width; nothing currently changes it independent of the (unanimated, per
  existing docs) column-width resize path.
- Any new configurable duration/easing — reuses
  `settings.animationDurationMs` / `easeOutCubic` throughout, same as every
  other motion in the codebase.
