# Minimized window support — design

Date: 2026-08-30

## Problem

Drift has no concept of a minimized window today. Minimizing a window currently
leaves its column in the layout, occupying space, and also causes the camera
viewport to shift slightly — an unintended side effect.

Two goals:

1. Minimizing a window should close the gap in the strip, exactly as if the
   window had been closed — right-hand columns shift left to fill the space.
2. Fix the spurious camera shift that currently happens on minimize.
3. Restoring (un-minimizing) a window should bring its column back at its
   original position, without changing focus or forcing a scroll.

## Decisions (confirmed with user)

- The column for a minimized window is **not removed** from `Grid`'s internal
  ordered list. It stays in place, flagged hidden, so restoring it reinserts
  it at its original position for free — no bookkeeping of "where did this
  come from" is needed.
- Minimizing the focused window does **not** trigger Drift's own
  fallback-focus logic (the one `removeColumn` uses for a real close). KWin
  itself activates another window when the focused one minimizes, and Drift's
  existing `windowActivated` handler already reacts to that — no new focus
  logic needed for the minimize path itself.
- Restoring a minimized window does **not** change focus or scroll it into
  view. Focus only changes if/when KWin's own `windowActivated` signal fires.

## Data model — `core/column.ts`, `core/grid.ts`, `core/coordinates.ts` (pure, unit-tested)

- `Column` gains a `hidden` flag, mirroring the existing `width` field:
  `column.hidden` getter + `setHidden(hidden: boolean)`.
- `Grid.columns()` keeps returning **every** column, in insertion order,
  hidden or not. Nothing is ever spliced out of the ordered list for a
  minimize — only `removeColumn` (a real window close) does that.
- Layout math treats hidden columns as contributing **zero width and zero
  gap** — the same visual effect as a closed window:
  - `virtualWidth()` sums only visible columns' widths (+ gaps between them).
  - `columnRect(id)` computes the offset among visible columns only. It
    throws if `id` refers to a currently-hidden column (mirrors the existing
    "unknown id" guard) — callers must check `column.hidden` before calling.
  - `insertionIndexForX(excludeId, virtualX)` (drag-reorder) finds the
    nearest boundary among visible columns only, then maps that back to a
    real index in the full ordered list (needed by `moveColumn`), so
    dragging a visible column while another one is hidden still lands in the
    right slot.
- `Grid.hideColumn(id)` / `showColumn(id)`: pure flag toggles. Neither
  touches `focusedColumnId` nor triggers any reveal — per the decisions
  above.
- `Grid.isHidden(id): boolean` — convenience accessor for `main.ts`.
- `focusLeft()` / `focusRight()` skip hidden columns when stepping. If no
  visible column exists in that direction, focus is unchanged (same
  edge-clamp semantics as today).
- `removeColumn()`'s existing "reassign focus to a neighbor" fallback now
  skips hidden neighbors, searching outward (right first, then left) for the
  nearest visible column. This is a latent gap in today's code (unreachable
  since nothing is ever hidden yet) that becomes reachable once a window can
  be closed while minimized.
- `debugState()` includes each column's `hidden` flag.

## Wiring — `kwin.d.ts`, `window-adapter.ts`, `main.ts` (glue, not unit-tested per docs §8)

- `kwin.d.ts`: add `minimized: boolean` and `minimizedChanged: Signal<() =>
void>` to the `Window` interface (verified against the installed Karousel
  bundle: `kwinClient.minimized` / `kwinClient.minimizedChanged`).
- `WindowAdapter`: `isMinimized(): boolean` and
  `onMinimizedChanged(handler: () => void): () => void`.
- `main.ts`, on `windowAdded`:
  - If the window is already minimized at add-time, hide its column
    immediately (covers windows/apps that start minimized).
  - Connect a `minimizedChanged` listener with the same lifetime as the
    existing geometry/drag listeners for that column (torn down only on the
    matching `windowRemoved`, not on hide/show).
  - Handler: minimized → `grid.hideColumn(id)`; restored →
    `grid.showColumn(id)`; then `render()`. No focus change, no
    `revealFocused()` call, in either direction.
- `render()` still calls `geometrySync.apply` for a hidden column, using its
  1px-slot virtual offset (`Grid.columnRect`) and real (unshrunk) width, with
  no position-animation smoothing — just enough to keep the minimized
  window's real on-screen x tracking viewport pans. Without this, a taskbar
  sorted by real x would see a minimized window drift out of order as soon
  as the viewport scrolled after it was minimized (its real x used to freeze
  at whatever it was the instant it was hidden). Superseded 2026-09-01; see
  `columnRect`'s doc comment in `core/grid.ts`.
- **Camera-shift fix**: `onWindowGeometryChanged` bails out early if the
  window's column is currently hidden. Whatever geometry change a given
  app/compositor reports while minimizing, Drift now ignores it while the
  window is hidden, instead of potentially misreading it as a user resize
  and reshuffling the strip.
- Debug console rows for hidden columns show a `[minimized]` marker instead
  of a virtual rect (computing one would require calling the now-guarded
  `columnRect` on a hidden id).

## Testing

- Pure logic (`Column`, `Grid`, `coordinates.ts`) is TDD'd with vitest:
  hide/show toggles, layout math excluding hidden columns, focus-skip
  navigation, `removeColumn`'s skip-hidden-neighbor fallback,
  `insertionIndexForX` with a hidden column present.
- KWin adapter and `main.ts` wiring changes are glue, per project convention
  (docs §8) — verified live rather than unit-tested.

## Out of scope

- Maximized windows (explicitly deferred to a follow-up per the user's
  request — "let's begin with minimized windows").
- Any UI/indicator for minimized columns beyond the debug console.
