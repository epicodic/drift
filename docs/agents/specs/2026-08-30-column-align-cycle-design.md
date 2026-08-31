# Column align-cycle shortcuts — design

Date: 2026-08-30

## Problem

Drift has no keyboard way to move the viewport relative to the focused column, and no
keyboard way to jump focus to a neighboring column while also snapping it into view at a
specific position. `Meta+Left`/`Meta+Right` are already used by KWin for window docking
(which currently collides with Drift, a separate known issue), so they aren't available.

Add a pair of shortcuts that cycle the focused column through three horizontal
placements — left-aligned, centered, right-aligned — and, on a further press past the
last placement, move focus to the next/previous column and continue the cycle there.

## Decisions (confirmed with user)

- Shortcuts: `Meta+Shift+Left` (cycle left) / `Meta+Shift+Right` (cycle right).
- At the edge of the strip (already right-aligned with no next column, or already
  left-aligned with no previous column), a further press is a no-op — matches the
  existing non-wrapping behavior of `focusLeft`/`focusRight`.
- The cycle position is not stored as explicit state. Each press derives "where in the
  cycle we are" from the focused column's current viewport offset. This is simpler to
  reason about than tracking/invalidating a stored phase across every other
  focus-changing code path (window close, drag-reorder, activation, etc.), and
  self-corrects if anything else moved the viewport between presses.
- All keyboard shortcuts (the 2 new ones and the 3 existing ones) move into `Settings`
  and are read from `kwinrc` via `KWin.readConfig`, the same mechanism `bottomMargin`
  already uses. A settings UI (KCM) to edit them is explicitly out of scope for this
  session — only the storage/read path is added.

## Behavior

For the focused column's rect (`rectX`, `rectWidth`) and the current `viewportWidth`,
three candidate offsets exist:

- `left = rectX`
- `center = rectX + rectWidth / 2 - viewportWidth / 2`
- `right = rectX + rectWidth - viewportWidth`

`center` is always the arithmetic mean of `left` and `right` (`(left + right) / 2`), so
it always lies between them numerically — note that which one is *larger* flips
depending on whether the column is narrower or wider than the viewport (e.g. for a
narrow column, right-aligning it means scrolling further left than left-aligning it
does, so `right < center < left`; for an oversized column it's the reverse). Clamping
(`Viewport.clampOffset`) is monotonic non-decreasing, so it preserves "lies between":
the clamped `center` still lies between the clamped `left` and `right`, whichever order
they end up in.

**Degenerate case:** when the *clamped* `left` and `right` offsets are equal (e.g. the
whole strip already fits within the viewport, or this column is pinned against the
content's edge), there is no distinguishable "aligned" position to cycle through at all
— `center` clamps to the same value too, by the order-preservation above. In that case
a press immediately crosses to the neighbor instead of pretending to cycle in place.

Otherwise, comparing the viewport's current (rounded) offset against the three clamped
candidates tells us which one it currently matches, if any:

| direction | current offset matches | next target | crosses to neighbor? |
|---|---|---|---|
| right | `right` | (irrelevant — moves to neighbor's `left`) | **yes** |
| right | `center` | `right` | no |
| right | `left` | `center` | no |
| right | none of the three | `left` | no |
| left | `left` | (irrelevant — moves to neighbor's `right`) | **yes** |
| left | `center` | `left` | no |
| left | `right` | `center` | no |
| left | none of the three | `right` | no |

"None of the three" covers e.g. right after a plain `revealFocused()` scroll, which
doesn't target one of these three exactly — the first press in a given direction always
starts the cycle from that direction's near end (`left` for a right-press, `right` for a
left-press).

When a step crosses to a neighbor, focus moves to the next/previous visible column via
`Grid.focusRight`/`focusLeft`, which already skip hidden columns. At the strip's edge,
these methods don't return `null` — they return the *same* (unchanged) column, since
`Grid` always keeps some column focused once one exists. The no-op case from the
"Behavior" decision above is detected by comparing the focused column's id before and
after the call. The newly-focused column then animates to its left (crossing right) or
right (crossing left) offset.

Example walkthrough pressing `Meta+Shift+Right` repeatedly on a 3-column strip focused
on column 1: left-align col 1 → center col 1 → right-align col 1 → left-align col 2 →
center col 2 → right-align col 2 → left-align col 3 → center col 3 → right-align col 3
→ (no more columns) no-op on further presses.

## Pure logic — `src/viewport/align-cycle.ts` (new, unit-tested)

- `alignOffsets(rectX, rectWidth, viewportWidth): { left, center, right }` — unclamped
  geometry only; the caller clamps each field (via `Viewport.clampOffset`) before
  passing the result in below.
- `nextAlignStep(direction: 'left' | 'right', currentOffset: number, offsets: {left,
  center, right}): { targetOffset: number; crossToNeighbor: boolean }` — takes the
  *already-clamped* `offsets` and the viewport's current (clamped) offset, and
  implements the whole table above, including the degenerate case
  (`offsets.left === offsets.right`, compared rounded). `targetOffset` is meaningless
  when `crossToNeighbor` is true — the caller recomputes for the neighboring column.

## Viewport — `src/viewport/viewport.ts`

- Add a public `clampOffset(offset: number): number` wrapping the existing private
  `clamp`, so callers outside `Viewport` (the new `Strip` methods) can clamp a computed
  target before animating to it or comparing it, the same way `scrollTo` already clamps
  internally.

## Runtime — `src/runtime/strip.ts`

- Add `cycleAlignLeft()` / `cycleAlignRight()`, each delegating to a private
  `cycleAlign(direction)`:
  1. Bail if there's no focused column or it's hidden (same guard as `revealFocused`).
  2. Compute `alignOffsets` for the focused column, clamp each of its 3 fields via
     `viewport.clampOffset`, and pass those plus `viewport.offset()` and `direction`
     into `nextAlignStep`.
  3. If `crossToNeighbor`, record the focused column's id, call
     `grid.focusRight()`/`focusLeft()`, and compare the returned column's id to the
     recorded one; if unchanged (strip edge), return without animating (no-op).
     Otherwise compute+clamp `alignOffsets` for the newly-focused column and animate to
     its `left` (crossed right) or `right` (crossed left) field.
  4. Otherwise (no crossing), animate to `nextAlignStep`'s `targetOffset` directly (it's
     already one of the clamped candidates from step 2).
  5. Animate with `this.animator.animate(this.viewport.offset(), target,
     this.settings.animationDurationMs)` — the same call `revealFocused` uses.

## Settings — `src/config/settings.ts`

- `Settings` gains:
  - `shortcutFocusLeft: string` (default `'Meta+A'`)
  - `shortcutFocusRight: string` (default `'Meta+D'`)
  - `shortcutToggleDebugConsole: string` (default `'Meta+Shift+D'`)
  - `shortcutCycleAlignLeft: string` (default `'Meta+Shift+Left'`)
  - `shortcutCycleAlignRight: string` (default `'Meta+Shift+Right'`)
- `loadSettings()` reads each via a new `readStringConfig(key, defaultValue)` helper,
  mirroring `readNumberConfig`: validates the read value is a non-empty string, else
  falls back to the default, and never throws (same try/catch shape).
- Config key names match the field names above (unlike the existing
  `bottomMargin`/`marginBottom` mismatch — no reason to introduce a new one).

## Config schema — `drift/contents/config/main.xml`

- Add 5 `<entry type="String">` elements (one per shortcut above) alongside the
  existing `marginBottom` entry, each with its default as `<default>`.

## Input — `src/input/shortcuts.ts`

- `ShortcutActions` gains `cycleAlignLeft(): void` and `cycleAlignRight(): void`.
- `registerShortcuts(parent, settings: Settings, actions: ShortcutActions)` takes
  `Settings` and uses `settings.shortcut*` for every sequence instead of the current
  hardcoded literals; adds the two new `ShortcutHandler`s (names
  `DriftCycleAlignLeft`/`DriftCycleAlignRight`).

## Wiring — `src/runtime/controller.ts`

- Store the constructor's `settings` parameter as a field (currently passed through but
  not kept).
- `start()` passes `this.settings` to `registerShortcuts` and wires the two new actions
  to `this.stripManager.activeStrip().cycleAlignLeft()` /
  `cycleAlignRight()`.

## Testing

- `src/viewport/align-cycle.test.ts`: `alignOffsets` for columns narrower than, equal
  to, and wider than the viewport; every row of the `nextAlignStep` table above,
  including the degenerate (`left === right`) case for both directions and the
  "matches none of the three" fallback for both directions.
- `src/runtime/strip.test.ts`: unlike the existing smoke-test-only coverage of
  `focusLeft`/`focusRight`, `cycleAlignLeft`/`cycleAlignRight` can be asserted
  end-to-end precisely, by constructing the `Strip` with `animationDurationMs: 0` —
  `Animator.animate` already special-cases a non-positive duration to call `onUpdate`
  (and thus `render()`/`setFrameGeometry`) synchronously instead of waiting on the fake
  `Timer`. Cover: cycling through all 3 phases on one column, crossing to the next
  column and landing left-aligned, crossing backward to the previous column and landing
  right-aligned, and no-op at both strip edges.
- `shortcuts.ts`, `Controller`, and `main.xml` changes are glue per project convention
  (docs §8) — verified live rather than unit-tested, same as the existing shortcut
  wiring.

## Out of scope

- A settings UI (KCM module) for editing the shortcuts — only the storage/read path is
  added this session.
- Wrap-around navigation at the strip's edges.
- Any change to `Meta+Left`/`Meta+Right`'s existing docking collision.
- Vertical/stacked columns.
