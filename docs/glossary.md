# Glossary

Concepts used across Drift's source, docs, and build tooling, with a short description and a source pointer where useful.

## Scrollable Tiling Model

- **Scrollable tiling** — a layout model where windows sit in columns on an infinite horizontal strip and the viewport scrolls sideways instead of reflowing a fixed grid, popularized by [niri](https://github.com/YaLTeR/niri).
- **Strip** — the virtual, unbounded horizontal sequence of columns managed by one `Grid`/`Viewport`/`Animator`/`GeometrySync`/`ColumnRegistry` combination; a `StripStack` holds one or more strips, addressed by an integer index that can be positive, negative, or zero (see the `Strip` entry under Runtime & Orchestration for the implementing class).
- **Column** — one tiled window's slot in the strip, ordered left to right, always spanning the full usable screen height.
- **Tile** — one window within a column's vertical stack; a column can hold an ordered list of tiles stacked vertically, each with its own height.
- **Absorb** (`Meta+I`) — pulls the column to the right into the focused column's stack as a new tile.
- **Expel** (`Meta+O`) — pops the focused tile back out into its own column to the right, matching PaperWM's model.
- **Activity / virtual desktop** — Plasma workspace dimensions; each `(activity, virtual desktop)` pair gets its own independent `StripStack`, so unrelated workspaces never affect each other's layout.
- **Align-cycle** — a shortcut that steps the already-focused column through three viewport positions: flush left, centered, flush right.
- **Drag-reorder** — dragging a window past a neighbor's center swaps their column order live, with the displaced column sliding into place.
- **Neighbor push** — resizing a column's width shifts every column to its right without resizing them, growing or shrinking the strip's total virtual width.
- **Focus model** — exactly one column is focused at a time, tracked by the grid as a column id; every focus change triggers a reveal.
- **Reveal** (`revealFocused`) — scrolling the viewport to the minimal offset that brings the focused column fully into view.

## Layout & Coordinates

- **Virtual coordinate system** — Drift's own 1D horizontal coordinate space for column layout, independent of screen pixels.
- **Grid** — the pure layout model: column order, width, and focus, with no notion of what is currently visible ([`src/core/grid.ts`](../src/core/grid.ts)).
- **Origin (`originX`)** — the virtual x of the strip's leftmost column's left edge; can go negative after a left-edge resize.
- **`columnRect` / `virtualWidth`** — pure derivations that turn column widths and gap into virtual rects and the strip's total extent ([`src/core/coordinates.ts`](../src/core/coordinates.ts)).
- **Resize edge** — whether a width change came from the left or right edge of a window, determined by comparing the old and new rect's `x` (`resizedEdge`).
- **Echo** — a `frameGeometryChanged` event caused by Drift's own write, distinguished via `GeometrySync.isEcho` so it is not mistaken for a user-driven resize.
- **Gap** — the fixed spacing kept between adjacent columns in the strip.

## Runtime & Orchestration

- **Controller** — the root runtime object that composes the whole application ([`src/runtime/controller.ts`](../src/runtime/controller.ts)).
- **Strip** — one strip: `Grid` + `Viewport` + `Animator` + `GeometrySync` + `ColumnRegistry` ([`src/runtime/strip.ts`](../src/runtime/strip.ts)).
- **StripStack** — one or more strips for a given activity+desktop; owns strip creation/pruning and the active strip index ([`src/runtime/strip-stack.ts`](../src/runtime/strip-stack.ts)).
- **StripManager** — creates and prunes one `StripStack` per activity+desktop pair ([`src/runtime/strip-manager.ts`](../src/runtime/strip-manager.ts)).
- **WindowManager** — routes and reassigns each window to the `StripStack` for its current activity+desktop ([`src/runtime/window-manager.ts`](../src/runtime/window-manager.ts)).
- **ColumnRegistry** — maps `(columnId, tileId)` pairs to the live `WindowAdapter` tiled there ([`src/runtime/column-registry.ts`](../src/runtime/column-registry.ts)).
- **window-events** — handlers for KWin window signals (geometry changed, minimized, fullscreen) that dispatch into the grid/viewport ([`src/runtime/window-events.ts`](../src/runtime/window-events.ts)).
- **workspace-signals** — registers workspace-level KWin signal listeners such as `windowAdded`/`windowRemoved`/`windowActivated` ([`src/runtime/workspace-signals.ts`](../src/runtime/workspace-signals.ts)).

## Viewport & Animation

- **Viewport** — a pure "camera": tracks the current scroll offset and visible/content width, never the layout itself ([`src/viewport/viewport.ts`](../src/viewport/viewport.ts)).
- **`offsetToReveal`** — computes the minimal scroll offset that brings a given rect fully into view.
- **Animator / Animation** — drives an eased, clock-driven interpolation from a current offset to a target offset ([`src/viewport/animator.ts`](../src/viewport/animator.ts)).
- **`easeOutCubic`** — the default easing function: a fast start with a gentle settle.
- **ColumnMotion** — animates a column's real x from wherever it currently sits to its new logical x whenever the layout changes for a reason other than the user actively dragging or resizing it ([`src/viewport/column-motion.ts`](../src/viewport/column-motion.ts)).
- **SharedTicker** — hands out independent `Timer`-shaped handles that share one real timer, so the camera pan and per-column motion can tick independently ([`src/viewport/shared-ticker.ts`](../src/viewport/shared-ticker.ts)).
- **EdgeDwell** — detects the pointer held past a screen edge (or other identified zone) for a dwell period and fires once, used for strip-flip during cross-strip drag and for drag-to-stack ([`src/viewport/edge-dwell.ts`](../src/viewport/edge-dwell.ts)).
- **`alignOffsets` / `nextAlignStep`** — computes the three align-cycle candidate offsets and steps between them ([`src/viewport/align-cycle.ts`](../src/viewport/align-cycle.ts)).

## Input Handling

- **Shortcuts** — global keybindings wired to grid/viewport actions via a QML `ShortcutHandler` ([`src/input/shortcuts.ts`](../src/input/shortcuts.ts)).
- **Drag reorder** (`registerDragReorder`) — converts a dragged window's own edges to virtual x and asks `Grid.insertionIndexForEdges` whether it should swap with a neighbor ([`src/input/drag.ts`](../src/input/drag.ts)).
- **Stack hover** (`resolveStackSlot`) — pure geometry that resolves which vertical tile slot within a target column a drag should land in ([`src/input/drag-hover.ts`](../src/input/drag-hover.ts)).

## KWin & Plasma Integration

- **KWin script** — the plain KWin scripting mechanism Drift runs as, alongside the compositor rather than replacing it.
- **declarativescript** — the KWin script type (`X-Plasma-API`) that hosts the script's logic inside a QML root, giving access to `Timer`/`ShortcutHandler`/`PlasmaCore.Dialog`.
- **WindowAdapter** — the only code that wraps a live KWin `Window` ([`src/kwin/window-adapter.ts`](../src/kwin/window-adapter.ts)).
- **WorkspaceAdapter** — wraps the live KWin `Workspace` global ([`src/kwin/workspace-adapter.ts`](../src/kwin/workspace-adapter.ts)).
- **GeometrySync** — converts virtual rects to real screen geometry and writes them via `WindowAdapter`, tracking echoes ([`src/kwin/geometry-sync.ts`](../src/kwin/geometry-sync.ts)).
- **`toRealRect` / `toVirtualX`** — pure conversions between virtual layout coordinates and real screen coordinates.
- **`qmlBase` / `QmlObject`** — the QML root `Item` exposed to the bundle's JS, used as the parent for dynamically created QML objects (`Timer`, `ShortcutHandler`, `Dialog`).
- **Timer** — a QML `Timer` wrapped behind a small interface, since KWin's `QJSEngine` has no native `setTimeout`/`setInterval`.

## Debugging & UI

- **Debug console** — an on-screen `PlasmaCore.Dialog` overlay showing the live layout/camera state ([`src/kwin/debug-console.ts`](../src/kwin/debug-console.ts)).
- **Minimap** — an overview visualization of all columns, tiles, strips, and the current viewport ([`src/ui/minimap.ts`](../src/ui/minimap.ts), [`src/kwin/minimap-overlay.ts`](../src/kwin/minimap-overlay.ts)).
- **Snapshot** (`debugRows`/`debugCamera`) — builds the plain data fed into the debug console and minimap from the live `Grid`/`Viewport` ([`src/debug/snapshot.ts`](../src/debug/snapshot.ts)).
- **Debug sink** — a pluggable output channel for `debug()`/`setDebugState()` log lines ([`src/debug.ts`](../src/debug.ts)).

## Configuration

- **Settings** — the typed configuration object with defaults, loaded from `kwinrc` via `KWin.readConfig` ([`src/config/settings.ts`](../src/config/settings.ts)).
- **KConfigXT** — KDE's declarative config-schema mechanism (`config/main.xml` + `ui/config.ui`) that powers the script's "Configure..." dialog in System Settings.

## Build & Tooling

- **Rollup** — bundles the TypeScript/JavaScript sources into the single plain script (`main.js`) that KWin's `QJSEngine` can load (`rollup.config.mjs`).
- **Vitest** — the test runner for the JavaScript/TypeScript test suite (`npm test`).
- **ESLint / Prettier** — JavaScript/TypeScript lint and formatting tools (`npm run lint`).
- **qmllint** — validates the QML sources as part of `npm run lint`.
- **kpackagetool6** — installs or upgrades the built script as a KWin script package (`make install`).
- **metadata.json** — the KWin script package manifest: name, API type, main QML file, and minimum Plasma version.

## Related Projects

- **niri** — the Wayland compositor that popularized scrollable tiling; Drift draws on its model without requiring a compositor swap.
- **Karousel** — the other scrollable-tiling KWin script; more mature and keybinding-rich, but lacks multi-monitor/Activities support and needs a companion animation effect.
- **PaperWM** — the GNOME extension whose stacking model (absorb/expel) Drift's vertical tiling matches.
