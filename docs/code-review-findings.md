# Code Review Findings

This page tracks findings from a review of the addon sources conducted on 2026-09-03.
The review ran against an older layout, so every finding was re-checked against `main` on 2026-09-26.
Findings that `main` already fixed, or that refer to code that no longer exists, are dropped.
Everything below is still open.

## KWin isolation violations

Convention requires KWin API access to stay inside `drift/src/kwin/` adapter modules.
Two files break this rule.

- [drift/src/config/settings.ts](../drift/src/config/settings.ts) calls `KWin.readConfig` directly in `readNumberConfig`, `readStringConfig`, and `readBooleanConfig`.
- [drift/src/input/shortcuts.ts](../drift/src/input/shortcuts.ts) calls `Qt.createQmlObject` directly.

Proposal: extract a thin `kwin/config-adapter.ts` wrapping `KWin.readConfig`, and route `shortcuts.ts`'s QML object creation through a `kwin/` adapter, following the pattern already established by [drift/src/kwin/qml-timer.ts](../drift/src/kwin/qml-timer.ts).

## Test coverage gaps

`drift/src/runtime/controller.ts` has no `controller.test.ts`.
It is the root orchestrator wiring `WindowManager`, `StripManager`, workspace signals, and shortcuts, and every other runtime module has matching tests.
Proposal: add tests covering `start()`, shortcut wiring, and minimap show/hide logic.

## Correctness issues

`Column.insertTileAt()` in [drift/src/core/column.ts](../drift/src/core/column.ts) resets every tile to the same evenly divided height.
Repeated insert/remove cycles can let the summed heights drift away from the column's total height due to floating-point rounding.
Proposal: assign the last tile the total height minus the sum of the others, instead of the same evenly divided value everywhere.

`formatArgs()` in [drift/src/debug.ts](../drift/src/debug.ts) calls `JSON.stringify` without a guard.
A circular-reference argument would throw and propagate to the caller.
Proposal: wrap in try/catch with a `[non-serializable]` fallback string.

## Resource lifecycle

The `on*Changed` methods on `WorkspaceAdapter` in [drift/src/kwin/workspace-adapter.ts](../drift/src/kwin/workspace-adapter.ts) return `void`, so the signal connections cannot be disconnected.
`WindowAdapter` already returns disconnect functions for the same kind of signal, and `initWorkspaceSignals` has no teardown path.
This is harmless while the `Controller` lives for the whole KWin session.
Proposal: return disconnect functions from the `WorkspaceAdapter` methods only when `Controller` gains a teardown path that calls them.

[drift/src/kwin/debug-console.ts](../drift/src/kwin/debug-console.ts) and [drift/src/kwin/minimap-overlay.ts](../drift/src/kwin/minimap-overlay.ts) both create QML objects via `Qt.createQmlObject` but expose no `destroy()` method on their returned interfaces.
The QML objects are parented and will clean up with their parent, but callers have no explicit teardown path.
Proposal: add a `destroy()` method to each that stops any owned timer and calls `.destroy()` on the QML object.

`StripStack` (in [drift/src/runtime/strip-stack.ts](../drift/src/runtime/strip-stack.ts)) subscribes to a shared `SharedTicker`, but when a strip is pruned there is no visible call to stop that subscription.
This needs verification against `SharedTicker`'s actual contract; if `subscribe()` returns a handle that must be stopped, pruning is missing that call.
Proposal: confirm the cleanup contract and add the missing stop call if needed.

## Code smells and maintainability

`Strip` (in [drift/src/runtime/strip.ts](../drift/src/runtime/strip.ts)) is now roughly 1000 lines and owns layout, camera, geometry sync, animation, and several signal handlers.
This is a God-object risk that has grown since the review.
Proposal: extract a `FullScreenManager` or `TileVisibilityManager` in a future refactor.

The same file tracks fullscreen and minimized tiles in `Set`s keyed by `tileKey()`, with no validation pass to catch a dangling entry if cleanup is ever missed.
Proposal: add a cheap consistency check during prune operations, or a test that exercises the add/remove/prune cycle directly.

`StripManager.prune()` in [drift/src/runtime/strip-manager.ts](../drift/src/runtime/strip-manager.ts) is O(stacks × windows) because it scans `ownerByWindow` once per stack.
This is fine at current scale.
Proposal: invert `ownerByWindow` into a multi-map keyed by stack if this ever becomes a hot path.

`readNumberConfig`, `readStringConfig`, and `readBooleanConfig` in [drift/src/config/settings.ts](../drift/src/config/settings.ts) are near-identical copies differing only in the `typeof` check.
Proposal: collapse into one generic `readConfig<T>(key, defaultValue, isValid)` helper.
