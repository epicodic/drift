# Window motion primitive and keyboard move animation — design

Date: 2026-09-08

## Problem

Dragging a window and dropping it produces a smooth drift into the resolved slot.
Moving a window with the keyboard (`Ctrl+Meta+Left`, `Ctrl+Meta+Right`, and the move-to-start/move-to-end variants) makes the moved window teleport, while its neighbours slide.
The asymmetry is not intentional design, it is a leftover.

Two concrete gaps:

1. **No reusable primitive.**
   There is no "take this window, drift it into this rect" function.
   Smooth motion is emergent from `Strip.render()` plus three `AxisMotion` trackers, and the two existing entry points into it (`Strip.seedReorderRelease`, `Strip.seedStackRelease`) are drag-specific in both name and signature.
2. **Keyboard column moves opt out of it.**
   `Strip.moveWindowLeft`, `moveWindowRight`, `moveWindowToStart`, and `moveWindowToEnd` each call `Strip.snapColumn(focusedId)` immediately after `Grid.moveColumn`.
   That forces the moved column's x tracker to rest *at its new logical x*, so it jumps.
   `snapColumn` dates from the original drag-reorder design, where the dragged column had to settle instantly on release; drag no longer uses it, and these four keyboard actions are its only remaining production callers.

A third gap falls out of fixing the first two: **width is not an animated channel at all**.
`Strip.render()` passes x, y, and height through `AxisMotion` but writes width straight from the target rect.
A primitive that accepts a target rect must animate all four dimensions or it is lying about its own signature.

## Approaches considered

**A — Seed the existing render loop, generalized (chosen).**
Keep `Strip.render()` as the single writer of window geometry.
Expose a primitive that *seeds* a window's motion trackers at a given start rect; the next `render()` sees a target mismatch and eases from there into whatever the layout resolves.
This is exactly the mechanism drag release already proved out, just generalized and renamed.

**B — A standalone `WindowMotion` with its own timer.**
`animateTo(win, targetRealRect, durationMs)`, four `Animation` channels, writing `setFrameGeometry` directly.
Rejected: it is a second, uncoordinated writer to the same window's geometry and would fight the `render()` calls that keep firing during and after any layout change.
This is the same reasoning that rejected approach C in [2026-09-07-stack-and-release-motion-design.md](2026-09-07-stack-and-release-motion-design.md).
The door stays open for windows that the render loop does not touch at all (floating windows, overlays), but that is out of scope here.

**C — Approach A, but keep x and width keyed by column id.**
Rejected.
See "Channel keying" below: it would leave two of the primitive's four channels unusable in the cross-column stack case.

## Channel keying

Today `Strip` owns three `AxisMotion` instances:

| Channel | Key | Rationale |
|---|---|---|
| x | column id | A column's x is shared by every tile in its stack. |
| y | window id | A tile id is only stable within one column; a stack move reassigns it. |
| height | window id | Same. |

A column-keyed channel cannot be seeded from a single tile's own rect without corrupting its siblings for a frame.
That is precisely why `Strip.seedReorderRelease` seeds x only when the source column turned out to be standalone, and why a cross-column stack drop currently snaps horizontally instead of drifting.

**Decision: key all four channels by window id.**

`columnMotion` becomes `tileXMotion`, and a new `tileWidthMotion` joins it, alongside the existing `tileYMotion` and `tileHeightMotion`.
Every tile of a column resolves the *same* target x and width from the layout, so tiles in a stack stay visually locked in the ordinary case — they animate identical trajectories from identical resting values.
But each window can now be seeded independently, which is what makes the primitive general.

Consequences:

- A cross-column stack drop now animates x and width too.
  This supersedes the "x snaps to the target column's x" row in [2026-09-07-stack-and-release-motion-design.md](2026-09-07-stack-and-release-motion-design.md).
- Column width changes (`increaseColumnWidth`, `decreaseColumnWidth`) now animate rather than jump.
- `Strip.render()`'s `allTilesExcluded` guard exists only to stop a shared column tracker from re-establishing a stale x while nothing is drawn for it.
  With per-window keying that hazard does not exist, and the guard becomes a plain per-tile skip.
- The `columnMotion.forget(fromColumnId)` calls in `Strip.absorbRight` and `Strip.commitTileIntoStack` drop out.
  They exist to discard a dying column's tracked x; a per-window tracker belongs to a window that keeps existing, and its old x is the correct animation start point.
- Tracker entries go from two-per-window plus two-per-column to four-per-window.
  Negligible.

## New/changed components

### `Strip` — the primitive

```ts
/** Seeds `windowId`'s motion channels to start from `rect`, in virtual strip
 * coordinates (area-relative y). The next render() eases from there into whatever
 * the layout resolves for that window. Omitted fields leave that channel alone. */
seedMotionFrom(windowId: string, rect: Partial<Rect>): void

/** Same, seeded from the window's own current on-screen geometry — "wherever it is
 * right now, drift it to where the layout says it belongs." */
seedMotionFromCurrentGeometry(win: WindowAdapter): void
```

`seedMotionFrom` replaces `seedReorderRelease`, `seedStackRelease`, and `snapColumn`, all of which are removed.
`columnId` disappears from the signature: it was only ever needed to address the shared x key.

`seedMotionFromCurrentGeometry` folds in the real-to-virtual conversion that `windowRectVirtual` in `src/input/drag.ts` does by hand today, using the strip's own `area` and `viewport.offset()`.

### `src/input/drag.ts`

`DragReorderDeps` collapses its two seed hooks into one `seedMotionFrom`.
The release path in `finishedInner` becomes a single unconditional seed of all four channels from the drop rect — the standalone-vs-stack branch existed only to protect the shared column x key, and is no longer needed.

### `Strip.render()`

Width joins the animated channels, using the same `instant` handling as the other three.
The `allTilesExcluded` early-continue is replaced by a per-tile skip.

### Keyboard column moves

`moveWindowLeft`, `moveWindowRight`, `moveWindowToStart`, and `moveWindowToEnd` each drop their `snapColumn(focused.id)` line.
Nothing replaces it: the tracker keeps its old resting x, `render()` retargets to the new slot, and the shared motion timer drives it to completion.
`Strip`'s `columnMotionTimer` field is renamed to `motionTimer`, since it no longer drives a column-keyed channel.

## Confirmed behaviour

| Case | Behaviour |
|---|---|
| Keyboard move left/right/to-start/to-end | Animates, from the window's current position into its new slot |
| Keyboard column width change | Animates (new) |
| Cross-column stack drop | All four channels animate (previously x and width snapped) |
| Same-column reorder drop, same-column stack drop | Animates, unchanged |
| Live stack-hover preview | Animates, unchanged |
| A window's first appearance (add, restore, un-minimize, exit fullscreen) | Instant snap, unchanged — `AxisMotion` never animates a first sighting |
| A window rule's `width` applied at creation (`setFocusedColumnWidth`) | Instant — it seeds the *target* width, since a rule is part of the first appearance |
| Border-drag resize | Instant, unchanged — `render()`'s `instant` flag |
| Cross-strip moves (`moveWindowToStripAbove`/`Below`) | Unchanged — they ride `StripStack`'s vertical transition |

The moved column animates concurrently with `revealFocused()`'s camera pan.
Both use `settings.animationDurationMs` and the same easing, so they read as one motion.

## Out of scope

- A standalone `WindowMotion` for windows the render loop does not manage (floating windows, overlays).
  Approach B remains available if that need appears.
- Any change to `AxisMotion` itself.
  It is already generic over its key type and needs nothing new.
- Any new setting.
  All four channels use the existing `animationDurationMs`.

## Testing

- `AxisMotion`: unchanged, existing tests stand.
- `Strip`: a moved column's rendered x is strictly between its old and new slot x on an intermediate tick, and lands exactly on the new slot x at completion, for each of the four keyboard move actions.
- `Strip`: a column width change animates width across ticks.
- `Strip`: `seedMotionFrom` with a partial rect leaves the omitted channels resting where they were.
- `Strip`: tiles of a multi-tile stack render identical x and width while their column moves.
- `src/input/drag.ts` stays untested glue, as it already documents about itself; the release behaviour is covered at the `Strip` level via `seedMotionFrom`.

## Documentation

[docs/algorithms.md](../../algorithms.md) "Layout-Change Position Animation" needs updating: it still describes three trackers with mixed keying, and the drag-reorder section still names `seedReorderRelease`/`seedStackRelease`.
