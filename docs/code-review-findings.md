# Code Review Findings

This page tracks findings from a review of `src/` conducted on 2026-09-03.
Two findings from that review were already fixed and are not repeated here: the stale README shortcut/feature claims, and the missing disconnect thunks on `WorkspaceAdapter`'s activity/desktop signal methods.
Everything below is still open.

## KWin isolation violations

Convention requires KWin API access to stay inside `src/kwin/` adapter modules.
Two files break this rule.

- [src/config/settings.ts](../src/config/settings.ts) calls `KWin.readConfig` directly in `readNumberConfig`, `readStringConfig`, and `readBooleanConfig`.
- [src/input/shortcuts.ts](../src/input/shortcuts.ts) calls `Qt.createQmlObject` directly.

Proposal: extract a thin `kwin/config-adapter.ts` wrapping `KWin.readConfig`, and route `shortcuts.ts`'s QML object creation through a `kwin/` adapter, following the pattern already established by [src/kwin/qml-timer.ts](../src/kwin/qml-timer.ts).

## Test coverage gaps

`src/runtime/controller.ts` has no `controller.test.ts`.
It is the root orchestrator wiring `WindowManager`, `StripManager`, workspace signals, and shortcuts, and every other runtime module has matching tests.
Proposal: add tests covering `start()`, shortcut wiring, and minimap show/hide logic.

## Correctness issues

`Column.addTile()` in [src/core/column.ts](../src/core/column.ts) distributes `totalHeight / (stack.length + 1)` evenly across tiles.
Repeated add/remove cycles can let the summed heights drift away from `totalHeight` due to floating-point rounding.
Proposal: assign the last tile `totalHeight` minus the sum of the others, instead of the same evenly divided value everywhere.

`formatArgs()` in [src/debug.ts](../src/debug.ts) calls `JSON.stringify` without a guard.
A circular-reference argument would throw and propagate to the caller.
Proposal: wrap in try/catch with a `[non-serializable]` fallback string.

`adjacentScreenIndex()` in [src/viewport/align-cycle.ts](../src/viewport/align-cycle.ts) assumes its `screens` argument is sorted left-to-right, but this precondition is undocumented and unchecked.
A caller passing unsorted screens gets silently wrong results.
Proposal: add an assertion or a clearer doc comment stating the precondition.

## Resource lifecycle

[src/kwin/debug-console.ts](../src/kwin/debug-console.ts) and [src/kwin/minimap-overlay.ts](../src/kwin/minimap-overlay.ts) both create QML objects via `Qt.createQmlObject` but expose no `destroy()` method on their returned interfaces.
The QML objects are parented and will clean up with their parent, but callers have no explicit teardown path.
Proposal: add a `destroy()` method to each that stops any owned timer and calls `.destroy()` on the QML object.

`StripStack` (in [src/runtime/strip-stack.ts](../src/runtime/strip-stack.ts)) subscribes each row's `Strip` to a shared `SharedTicker`, but when a row is pruned there is no visible call to stop that subscription.
This needs verification against `SharedTicker`'s actual contract; if `subscribe()` returns a handle that must be stopped, `pruneIfEmpty()` is missing that call.
Proposal: confirm the cleanup contract and add the missing stop call if needed.

## Code smells and maintainability

`Strip` (in [src/runtime/strip.ts](../src/runtime/strip.ts)) is roughly 600 lines and owns layout, camera, geometry sync, animation, and several signal handlers.
This is acceptable for a core module today, but it is a God-object risk if it keeps growing.
Proposal: consider extracting a `FullScreenManager` or `TileVisibilityManager` in a future refactor if more responsibilities are added.

The same file tracks fullscreen and minimized tiles in `Set`s keyed by `tileKey()`, with no validation pass to catch a dangling entry if cleanup is ever missed.
Proposal: add a cheap consistency check during prune operations, or a test that exercises the add/remove/prune cycle directly.

`StripStack.beginEdgeWatch()` silently discards a prior edge watch instead of asserting that at most one watch is active at a time.
Proposal: consider throwing on the invariant violation instead of silently stopping the previous watch, to surface bugs earlier.

`StripManager.prune()` in [src/runtime/strip-manager.ts](../src/runtime/strip-manager.ts) is O(stacks × windows) because it scans `ownerByWindow` once per stack.
This is fine at current scale.
Proposal: invert `ownerByWindow` into a multi-map keyed by stack if this ever becomes a hot path.

`readNumberConfig`, `readStringConfig`, and `readBooleanConfig` in [src/config/settings.ts](../src/config/settings.ts) are near-identical copies differing only in the `typeof` check.
Proposal: collapse into one generic `readConfig<T>(key, defaultValue, isValid)` helper.

[src/config/shortcuts-consistency.test.ts](../src/config/shortcuts-consistency.test.ts) parses XML and shell files with regular expressions rather than a real parser.
This works today but is fragile against reformatting.
Proposal: acceptable to leave as-is for now; revisit if the parsed files change format.

[src/input/drag.ts](../src/input/drag.ts)'s `registerDragReorder()` accepts an `initiallyDragging` parameter used to seed state for mid-drag reparenting between rows.
This is a subtle API contract that is easy to miss when reading call sites.
Proposal: add a one-line comment at the call site(s) flagging why the flag is needed.

## Low severity / documentation clarity

`offsetToRevealOnScreen()` in [src/viewport/viewport.ts](../src/viewport/viewport.ts) has a docstring that says "unclamped" without clearly explaining that the fallback path (when no screen is eligible) delegates to the clamped `offsetToReveal()`.
Proposal: expand the docstring by one line to state the fallback is clamped.

`onWindowGeometryChanged()` in [src/runtime/window-events.ts](../src/runtime/window-events.ts) relies on being called for every geometry change to catch the moment KWin resizes a window to fullscreen geometry before flipping the `fullScreen` property.
Proposal: strengthen the top-of-function comment to state this requirement explicitly, so a future caller doesn't skip invocations as an optimization.

`Animator`, `ColumnMotion`, and `EdgeDwell` (in `src/viewport/`) all rely on wall-clock elapsed time and clamp progress to `[0, 1]`, which degrades gracefully if the system clock moves backward.
This scenario is not covered by a test.
Proposal: low priority; add a regression test only if this becomes an observed issue.

`layoutOffsets()` in [src/core/grid.ts](../src/core/grid.ts) only adds a gap after visible columns, which compacts runs of hidden columns into the surrounding gap.
The behavior is correct but subtle.
Proposal: expand the existing comment to spell out the compaction rule with an example.
