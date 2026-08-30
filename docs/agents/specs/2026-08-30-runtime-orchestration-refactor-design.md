# Runtime orchestration refactor — design

Date: 2026-08-30

## Problem

The single `init()` function in [`src/main.ts`](../../../src/main.ts) has grown
into a ~200-line "god function" that mixes six unrelated responsibilities in one
scope: dependency wiring, the `render()` loop, debug-snapshot construction,
per-window event handlers, per-window connection lifecycle, and shortcut wiring.

The pure layers (`core/`, `viewport/`, `kwin/`, `input/`, `config/`) are already
well factored. The mess is concentrated in the orchestration that lives inside
`init()`:

- Window ↔ column mapping is hand-rolled across two loose `Map`s
  (`windowsByColumn`, `disconnectByColumn`) plus a linear-scan `columnOf()`.
- Per-window signal disconnects are aggregated by hand into `disconnectByColumn`.
- Event handlers (`onWindowGeometryChanged`, `onMinimizedChanged`) are closures
  that capture the entire `init()` scope, so they cannot be unit-tested.
- Debug presentation (`debugRows`, `debugCamera`) is tangled into orchestration.

Karousel ([`_playground/karousel`](../../../_playground/karousel)) solves the same
class of problem with a small orchestration layer: a tiny entry point, a root
orchestrator object, a `SignalManager` for connect/disconnect bookkeeping,
centralized signal registration, and a per-entity wrapper + manager for the
window↔slot mapping. Drift should adopt these patterns at its own scale.

A second driver: the **next** feature is Plasma Activities support. In Plasma,
Activity × Virtual Desktop × Screen are three orthogonal dimensions, and each
combination is a separate scrollable surface a window belongs to. Karousel
carries a `DesktopManager` + `ClientManager` split precisely for this. Drift's
current single-`Grid`/single-`Viewport` design has no seam for it. This refactor
introduces those seams without yet building the multiplicity.

## Decisions (confirmed with user)

- Approach B (a dedicated orchestration layer), not a minimal single-class
  extraction and not a full karousel port.
- The orchestration folder is named **`runtime/`** — it is the live wiring layer
  that runs over the pure `core/`/`viewport/` modules and the `kwin/` adapters.
  We deliberately avoid karousel's `world/` name.
- Naming map: `Controller` (root orchestrator), `Strip` (one scrollable
  surface), `StripManager` (context → strip), `WindowManager` (global window →
  strip router). `Strip` reuses Drift's own "infinite horizontal strip"
  metaphor from the architecture docs.
- **Two phases.** Phase 1 is a pure structural refactor: single strip, no
  behavior change, all existing tests stay green. Phase 2 (separate spec/plan)
  wires the Activity/Desktop/Screen dimension into `StripManager` /
  `WindowManager`. This document specifies the Phase 1 target structure and the
  seams Phase 2 will use.
- Design rule preserved and extended: `core/` and `viewport/` never import
  `kwin/`; only `runtime/` and `main.ts` perform wiring.

## Target module layout

```
src/
  main.ts                 # init() -> new Controller(loadSettings()).start()  (~5 lines)
  config/                 # unchanged
  core/                   # unchanged (Grid, Column, coordinates)
  viewport/               # unchanged (Viewport, Animator)
  kwin/                   # adapters unchanged
  input/                  # unchanged
  utils/
    signal-manager.ts     # NEW — connect/disconnect bookkeeping (SignalManager)
  runtime/                # NEW — orchestration
    controller.ts         # root: owns StripManager + WindowManager; wires signals & shortcuts
    strip-manager.ts      # context-key -> Strip  (key is a constant in Phase 1)
    strip.ts              # one surface: Grid + Viewport + Animator + ColumnRegistry; render(), revealFocused()
    column-registry.ts    # window<->column map within a strip
    window-manager.ts     # global window registry + strip routing (Activities-ready)
    window-events.ts      # onWindowGeometryChanged/onMinimizedChanged as testable fns
    workspace-signals.ts  # initWorkspaceSignals(controller, workspaceAdapter)
  debug/
    snapshot.ts           # debugRows()/debugCamera() extracted
```

Filenames are lowercase kebab-case per `docs/coding-conventions.md`; the exported
classes keep `PascalCase` names (`Controller`, `Strip`, `StripManager`,
`WindowManager`, `ColumnRegistry`, `SignalManager`).

## Components

### `utils/signal-manager.ts` — `SignalManager` (unit-tested)

A small helper that records `connect(signal, handler)` pairs and disconnects all
of them on `destroy()`, mirroring karousel's
[`SignalManager`](../../../_playground/karousel/src/lib/utils/SignalManager.ts).
Adapted to Drift's adapter callbacks: the `kwin/` adapters expose
`on...(cb): () => void` disconnect thunks rather than raw Qt signals, so Drift's
`SignalManager` tracks an array of disconnect thunks and calls them all on
`destroy()`. This replaces the manual `disconnectByColumn` aggregation.

### `runtime/strip.ts` — `Strip` (glue, thin)

One scrollable surface. Owns a `Grid`, a `Viewport`, an `Animator`, and a
`ColumnRegistry`. Absorbs today's `render()`, `revealFocused()`, and the
`viewport.setContentGeometry` / `geometrySync.apply` loop. Exposes the layout
operations the event handlers and shortcuts need (add/remove/resize/hide/show
column, focus stepping). Holds no KWin signal wiring itself.

### `runtime/column-registry.ts` — `ColumnRegistry` (unit-tested)

Encapsulates the window↔column mapping within one strip: the pair now expressed
as `windowsByColumn` plus the `columnOf()` linear scan becomes an object with
`set`, `get`, `columnOf`, `delete`, and iteration. Owns each managed window's
`SignalManager` so removal disconnects everything in one call. This is pure
enough to unit-test (no live KWin needed if the window is the `WindowAdapter`
interface).

### `runtime/window-events.ts` (unit-tested)

`onWindowGeometryChanged` and `onMinimizedChanged` become plain functions that
take their dependencies explicitly (the strip, the window, prior geometry)
instead of closing over `init()` scope, so they are unit-testable like `core/`.
The width-step / echo / interactive-resize guards move here unchanged.

### `runtime/workspace-signals.ts` (glue)

`initWorkspaceSignals(controller, workspaceAdapter)` centralizes the
`onWindowAdded` / `onWindowRemoved` / `onWindowActivated` registration currently
inline in `init()`, mirroring karousel's
[`workspace.ts`](../../../_playground/karousel/src/lib/workspace.ts). In Phase 2
this is where `currentActivityChanged` / `currentDesktopChanged` /
`screensChanged` handlers are added.

### `runtime/window-manager.ts` — `WindowManager` (glue, Activities seam)

The global registry of managed windows. Decides tileability, assigns each window
to the current strip via `StripManager`, and holds the per-window connection
lifecycle. In Phase 1 it always routes to the single strip. In Phase 2 it gains
the logic to move a window between strips when KWin reports its activity/desktop
changed. This is karousel's `ClientManager` role, renamed and scoped down.

### `runtime/strip-manager.ts` — `StripManager` (glue, Activities seam)

Caches one `Strip` per context key and tracks the active strip. In Phase 1 the
key is a single constant, so exactly one strip exists and behavior is identical
to today. In Phase 2 the key widens to `(activity, desktop, screen)` and the
manager reacts to the corresponding workspace signals to switch the active
strip. This is karousel's `DesktopManager` role, renamed.

### `runtime/controller.ts` — `Controller` (glue, root)

The root orchestrator constructed by `init()`. Settings are loaded by `main.ts`
and passed in; the `Controller` receives `settings` and the QML `root`,
constructs the `WorkspaceAdapter`, `StripManager`, `WindowManager`, the debug
console, and
the animator/timer, wires `workspaceSignals` and `registerShortcuts`, and
exposes `start()`. Contains coordination only, no layout math.

### `debug/snapshot.ts` (unit-tested where practical)

`debugRows()` and `debugCamera()` move here as functions that take a strip (grid
+ viewport + column registry) and return the debug row/camera structures fed to
`setDebugState` / `formatDebugState`. Keeps presentation out of orchestration.

### `main.ts`

Shrinks to roughly:

```ts
export function init(root: QmlObject): void {
    new Controller(root, loadSettings()).start();
}
```

## Non-goals (Phase 1)

- No behavior change. Focus, reveal, resize, drag-reorder, and minimize all
  behave exactly as today.
- No actual Activity / multi-desktop / multi-screen support — only the
  `StripManager` / `WindowManager` seams for it.
- No change to `core/`, `viewport/`, `kwin/`, `input/`, or `config/` module
  internals beyond import-path updates.

## Verification

- `npm run build`, `npm test`, and `npm run lint` all pass.
- Existing unit tests in `core/`, `viewport/`, and `kwin/` are unchanged and
  green. New unit tests cover `SignalManager`, `ColumnRegistry`, and
  `windowEvents`.
- Manual smoke test in a KWin session: add/remove/activate windows, focus
  left/right, resize, drag-reorder, minimize/restore, toggle debug console —
  all behave as before.
