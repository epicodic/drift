# Responsive column height/width on screen geometry change — design

Date: 2026-09-09

## Problem

Drift computes the combined screen geometry (`WorkspaceAdapter.combinedGeometry()`, backed by `Workspace.virtualScreenGeometry`) exactly once, in `Controller`'s constructor.
That single `Rect` is threaded down as an immutable value: `Controller` → `StripManager` → `StripStack` → `Strip` → `Grid` / `Viewport` / `GeometrySync`.
Each of those classes captures it in its constructor and derives fixed state from it once — most importantly `Grid`'s height (`area.height - settings.bottomMargin`), which every column's tile heights are computed against.

Nothing in the codebase subscribes to KWin's screen-configuration signals (`Workspace.screensChanged`, `Workspace.virtualScreenGeometryChanged`).
`workspace-signals.ts` only wires window lifecycle and activity/desktop signals.
So when a monitor is unplugged, replugged, or its resolution changes, KWin's combined geometry changes but Drift never learns about it: every existing `StripStack`/`Strip` — and even ones created later, since `StripManager` still hands out the one frozen `area` it was constructed with — keeps laying out columns against the stale dimensions indefinitely.
This affects width as well as height, and every activity/virtual-desktop's strip stack, not only the currently visible one.

## Desired behavior

- All strip stacks (visible and backgrounded, across every activity/desktop) adopt the new combined geometry immediately when it changes, not lazily on next activation.
- The change is applied instantly (no animation) — a screen reconfiguration is an abrupt external event, not a layout change worth animating.
- Each stacked column's tiles keep their relative height split (e.g. a 30/70 stack stays 30/70) rather than snapping to some default distribution.
- No debouncing of the underlying KWin signals — reacting directly to each firing is acceptable since a full re-layout is cheap and idempotent.

## Approach

Add a `resize(area)` method at each layer that currently freezes `area` in its constructor, and call it top-down from a new workspace signal handler.

**`Grid.setHeight(newHeight)`** (new): rescales every column's tile heights by `newHeight / oldHeight` (the same proportional-redistribution technique `insertTileAt`/`removeTile` already use), then updates the stored height. Requires a new `Column.scaleTileHeights(scale)` helper that multiplies every tile's `height` by `scale`.

**`GeometrySync.setArea(area)`** (new): replaces the stored coordinate origin without touching the `pending` echo-tracking map, so in-flight writes are still correctly recognized as echoes after a resize.

**`Viewport.setViewportWidth(width)`** (existing): already supports being called after construction; reused as-is.

**`Strip.resize(area)`** (new): stores the new area, calls `grid.setHeight(area.height - settings.bottomMargin)`, `viewport.setViewportWidth(area.width)`, `geometrySync.setArea(area)`, then `render(undefined, true)` to snap every tile to its new geometry instantly.

**`StripStack.resize(area)`** (new): stores the new area, recalculates `cameraY` for the currently active strip index under the new per-strip spacing (`activeStripIndex * area.height`) and snaps the vertical animator to it (no in-flight animation survives a resize), calls `.resize(area)` on every existing `Strip` (not just the active one), then instant-renders each at its correct resting offset via the existing `restingOffset`/`render(undefined, true, offset)` pattern.

**`StripManager.resize(area)`** (new): stores the new area (so any strip stack created later also starts from the current geometry) and calls `.resize(area)` on every existing `StripStack`, covering every activity/desktop pair, not just the active one.

**Signal wiring:**
- `kwin.d.ts`: add `screensChanged: Signal<() => void>` and `virtualScreenGeometryChanged: Signal<() => void>` to `WorkspaceApi`.
- `WorkspaceAdapter.onCombinedGeometryChanged(handler)` (new): connects `handler` to both signals. Both are covered because a screen-count change (e.g. hotplug into a mirrored/cloned configuration) can occur without the combined geometry itself changing, and vice versa.
- `workspace-signals.ts`: `initWorkspaceSignals` wires `workspaceAdapter.onCombinedGeometryChanged(() => stripManager.resize(workspaceAdapter.combinedGeometry()))`.

## Fields becoming mutable

`Grid.height`, `GeometrySync.area`, `Strip.area`, `StripStack.area`, and `StripManager.area` lose their `readonly` modifier since each now has a corresponding setter/resize method that reassigns them.

## Testing

- `Column.scaleTileHeights`: multi-tile column keeps proportional split after scaling; single-tile column just scales.
- `Grid.setHeight`: columns' tile heights rescale proportionally; `screenHeight()`/`columnRect()` reflect the new height immediately.
- `GeometrySync.setArea`: geometry computed via `apply()` uses the new area; `isEcho` still recognizes pending writes made before the resize.
- `StripStack`/`StripManager` resize: constructing multiple strip stacks (simulating multiple activities/desktops) and confirming all of them — not only the active one — reflect the new area after a single `resize()` call; active strip's camera position stays consistent (no visible jump) across the resize.
- `WorkspaceAdapter.onCombinedGeometryChanged`: connects the handler to both underlying signals (mirroring the existing `onCurrentActivityChanged`-style tests, which use a fake `Workspace` singleton).

## Out of scope

- Animating the transition (explicitly rejected — see "Desired behavior").
- Debouncing rapid-fire signal bursts during hotplug (explicitly rejected).
- Per-window rules or overrides for how a window's height/width scales (e.g. clamping to a minimum) — beyond current scope, existing `assertPositiveHeight`/`assertPositiveWidth` invariants still apply unchanged.
