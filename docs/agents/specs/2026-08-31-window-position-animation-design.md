# Animated window repositioning — design

Date: 2026-08-31

## Problem

The camera (viewport) already scrolls smoothly (`viewport/animator.ts`).
Column *layout* changes do not: when a window is added, removed, minimized,
restored, or a neighbor is pushed by a resize, every affected window's real
geometry jumps to its new position in a single `render()` call — no
animation.

Goal: animate a column's on-screen x position whenever its *logical* x
changes for a reason other than the user actively dragging/resizing it, so
neighbors visibly slide instead of jumping.

## Approaches considered

**A — Per-column "visual x" tracker, diffed every render (chosen).**
A new pure class remembers, per column id, the last logical x `Grid`
reported and an in-flight eased animation toward it. Every `render()`, a
column whose logical x changed gets its animation retargeted *from wherever
it currently visually is* (not from the old logical value) *to* the new
logical value. This handles overlapping/rapid layout changes for free: a
column mid-slide that gets asked to move again just retargets, it never
jumps or restarts from scratch.

**B — Explicit one-shot transition per call site** (`addColumn` /
`removeColumn` / `hideColumn` / `resizeColumn` each compute "who moved by how
much").
Rejected: duplicates diff logic at every mutation site, and breaks down when
changes overlap in time (e.g. add immediately followed by remove) — without
a shared "where is this column visually right now" record, a second
mutation before the first animation finishes would clobber or jump instead
of smoothly retargeting.

**C — Physics/spring-based motion** instead of duration+easing.
Rejected: a second animation paradigm (stiffness/damping) alongside the
existing tested duration/easing `Animation` class, for no behavior the user
asked for. Reuses `settings.animationDurationMs` / `easeOutCubic` instead,
consistent with the camera's existing animation.

## Trigger behavior (confirmed with user)

| Trigger | The window itself | Its neighbors |
|---|---|---|
| Add | instant, full size | animate (slide to make room) |
| Remove | instant (disappears) | animate (slide to close gap) |
| Minimize | instant (KWin's own effect; column already skipped in `render()`) | animate immediately, no deliberate delay |
| Restore | instant, full size (symmetric with add) | animate |
| Programmatic resize (neighbor push) | instant (its own width change is not animated) | animate |
| Live interactive resize/drag | instant, no animation, for the duration of the gesture (unchanged from today — the window being dragged is already excluded from `render()`'s write) | instant, no animation, until the gesture ends |
| Drag-reorder settle (on release) | **instant** — no special handling, same as today | animate |

Live gestures (interactive resize, interactive drag) stay fully instant
throughout — for a resize this is unchanged existing behavior; for
drag-reorder, "instant on release" is a deliberate choice to keep the
reordering feel exactly as it is today. Only the *neighbors* pushed around by
these events animate.

## New component — `viewport/column-motion.ts`

Pure, unit-tested like `Animation`/`Animator`. Owns a
`Map<columnId, Animation>` (reusing the existing `Animation` class) plus the
last logical target seen per column.

- `update(id: number, targetX: number, nowMs: number): number` — call once
  per column per tick.
  - First time an id is seen: record the target, return it unchanged (no
    animation — a brand-new or just-restored column appears instantly at its
    real position, per the table above).
  - Target unchanged since last call: keep advancing (or resting on) the
    existing animation, return `valueAt(elapsed)`.
  - Target changed: retarget a new `Animation` running `settings.animationDurationMs`,
    starting from the column's *current* interpolated value (whatever
    `update` last returned for it), not from the old target. Return the
    freshly-computed `valueAt(0)`.
- `forget(id: number): void` — drop all state for a column id (called on
  `removeColumn`; ids are never reused so no collision risk, but leaving
  stale entries around is unnecessary growth).
- `isAnimating(): boolean` — true while any column is mid-flight; used to
  decide whether the driving timer needs to keep running.

## Driving the ticks — `runtime/strip.ts`

Today `Strip` owns one `Timer` wired to one `Animator` (camera offset only).
That `Timer`'s `start`/`stop` cannot safely be shared unmodified by two
independent `Animator` instances — each `start()` call replaces the previous
`onTick` callback, and either instance's `stop()` would kill the one shared
timer out from under the other. `Strip` needs a single coordinating tick
driver that, each tick:

1. Advances the camera offset animation (existing behavior).
2. Advances `ColumnMotion` and calls `render()` using its interpolated x
   values instead of `Grid.columnRect(id).x` directly.
3. Keeps the shared timer running as long as *either* the camera or
   `ColumnMotion` is still in flight; stops it only once both are settled.

The exact class boundary (fold this into `viewport/animator.ts`'s `Animator`,
or a small new coordinator that `Strip` owns and that wraps the existing
`Animator` for the camera piece) is left to the implementation plan — this
is a wiring detail, not a behavioral one.

`Strip.render(excludeWindowId?)` changes: for each visible column that is
not `excludeWindowId` and not fullscreen-excluded (both exclusions already
exist today), compute `grid.columnRect(id)`, ask `ColumnMotion.update(id,
rect.x, now)` for the animated x, and pass a rect with that x (width/height
unchanged) into `geometrySync.apply`. Hidden columns are already skipped
entirely before this point — they need no motion tracking while hidden.

`Strip.removeWindow` calls `columnMotion.forget(columnId)` alongside its
existing `geometrySync.forget`/`fullScreenColumns.delete` cleanup.

## Testing

- `column-motion.ts` is TDD'd like `animator.ts`: snap-on-first-sight,
  retarget-from-current-value-not-old-target, settle/`isAnimating()`
  transitions, `forget`.
- `Strip`'s tick-coordination and `render()` wiring are glue (per docs §8,
  consistent with how `Strip` itself is treated) — verified live rather than
  unit-tested, aside from any pure helper it delegates to.

## Out of scope

- Animating a column's *width* (only x position animates; the actively
  resized/dragged window's own geometry write stays exactly as it is today).
- Any configurable duration/easing separate from the existing
  `settings.animationDurationMs` / `easeOutCubic`.
- Revisiting minimize's "no deliberate delay" choice — noted as something to
  watch for live, not solved preemptively.
