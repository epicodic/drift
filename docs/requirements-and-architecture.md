# Drift — Scrollable Tiling for KDE Plasma / KWin

**Status:** Pre-implementation design document
**Purpose:** Reference document to hand off to Claude Code for implementation

---

## 1. Motivation

[Niri](https://github.com/YaLTeR/niri) popularized a "scrollable tiling" window management model on Wayland: windows are arranged as columns on an infinite horizontal strip. Instead of a fixed grid that reflows when windows open/close, the viewport scrolls across a strip of columns that never resize existing windows arbitrarily.

Niri requires replacing the compositor entirely, which is not an option since KDE Plasma is the desired desktop environment. Existing KWin-based approaches (Karousel, inspired by PaperWM/Niri) get close but have real limitations — most notably no multi-monitor support, and reliance on an external companion script for animations.

**Drift** is a custom KWin script aiming to bring Niri-like scrollable tiling to KDE Plasma, built with a real architecture from day one rather than as a quick hack.

---

## 2. Requirements

### 2.1 Core behavior

1. KWin remains the window manager and compositor. Drift is a script/extension, not a replacement compositor.
2. No use of KWin virtual desktops. Everything happens on a single desktop with a dynamically growing/shrinking virtual area, tracked in Drift's own coordinate system.
3. There is a virtual 2D area larger than the physical screen(s). The visible viewport always shows only a portion of this area.
4. Windows are arranged in columns, side by side.
5. Resizing a window's width shifts neighboring windows sideways — it does **not** resize the neighbors. The virtual area grows at the edge if a window is widened beyond the current bounds.
6. Window height always equals the full available height (screen height minus panel/taskbar height). Vertical tiling *within* a single column (stacking multiple windows vertically in one column) is a desired feature but deferred — see [Open Decisions](#5-open-decisions--future-work).
7. Dragging a window only changes its order in the strip. Windows stay docked; there is no free-form repositioning while docked.
8. There can be an arbitrary number of rows above and below the current one. A new row is created outside the currently visible area, similar to Niri's model.
9. Windows can be undocked/redocked via a keyboard shortcut. Undocked windows switch to normal KWin floating-window behavior, but stay topmost (always on top of docked windows).
10. Navigation: mouse wheel, keyboard shortcuts, and possibly edge-hover (mouse resting at the screen edge). Exact behavior/thresholds to be defined later.
11. New windows: placement is configurable; default is to open to the right of the currently focused window.
12. When a window is closed, neighboring windows shift to fill the gap. There are never gaps in the layout.
13. Minimum/maximum window width is not manually enforced by Drift — it results naturally from each window's native minimum/maximum geometry constraints.
14. **Focus changes trigger a smooth, animated viewport scroll** so the newly focused window becomes fully visible. This is not a hard jump — it's an animated transition so the user retains their mental map of the layout. This applies equally to focus changes via shortcut and via mouse.

### 2.2 Multi-monitor

15. Multiple monitors form **one continuous horizontal strip** (not one independent virtual area per monitor, unlike Karousel and unlike Niri's per-output workspace model). Scrolling advances across the combined strip, and the visible viewport at any time is the union of all monitor areas.
16. The exact algorithm for how the viewport aligns to monitor boundaries during focus scrolling (avoiding a column being visually split across a bezel) is **deferred** — see Open Decisions.

### 2.3 Planned but deferred features

17. Persistence of layout (column positions/widths/rows) across restarts/logout — planned, implemented later.
18. Minimap showing the user's position within the overall grid — firmly planned, not optional.
19. Window rules — firmly planned, not optional. Auto-placement / auto-float for specific applications (e.g., always-float dialogs like Pavucontrol).

---

## 3. Naming

The project is called **Drift**.

Naming journey (for context, not needed by implementers): considered KDE/KWin-themed mashups (Kwiri, Krift, Kwift) and Plasma-themed mashups (Plift, Ionrift), but settled on the standalone word **Drift** — short, describes the gliding/scrolling motion well, easy to type and search in English, and avoids the harsher connotation of "Rift" (as in "a break/split"). The KDE/Plasma connection is carried by a tagline ("Drift — scrollable tiling for KDE Plasma"), not by the name itself, following the precedent of Niri, Karousel, etc.

---

## 4. Technical foundation (researched facts)

These are confirmed facts about the KWin scripting environment that directly shape the architecture:

- KWin scripts can be written in **JavaScript** (`X-Plasma-API: javascript`) or **QML** (`X-Plasma-API: declarativescript`). In practice, the established large tiling projects (Polonium, Krohnkite, Karousel) are written in **TypeScript**, transpiled to a single `main.js`. Drift follows this pattern.
- A KWin script package **must** follow the fixed structure `<scriptname>/contents/code/main.js` (or `main.qml`) plus a `metadata.json` in the top-level folder. This is not a convention — KWin looks for the script at this exact path.
- KWin scripts run inside a `QJSEngine` embedded **in the compositor process itself**. There is no sandbox, no separate process, no async I/O, and everything runs on KWin's own thread. A poorly written script can stall frame delivery — this is a real performance risk for anything continuous like scroll animation.
- **Window manipulation happens exclusively through the window's writable geometry property (`win.frameGeometry = Qt.rect(x, y, width, height)` in KWin 6; `geometry` remains as a related accessor).** There is no camera/viewport transform API exposed to normal window-management scripts. A separate, lower-level Effects API exists for true compositor-level visual transforms, but it has a different API surface and is a much larger undertaking (closer to a C++/QML compositor effect than a window-management script).
- **Consequence:** Drift's "viewport" is a pure software fiction. Scrolling is simulated by recomputing and re-setting `win.frameGeometry` for every affected window on every animation tick. There is no cheaper GPU-side camera pan available to us at the window-script level.
- Animation timing is driven by a Qt timer obtained from within the script (e.g. a QML `Timer`/Qt timer object — there is no first-class JS `QTimer` constructor guaranteed across versions, so the exact acquisition path must be pinned down in `viewport/animator.ts`). It provides repeated or delayed callbacks; there is no `requestAnimationFrame` equivalent — we drive our own tick rate and are responsible for keeping per-tick work cheap.
- `workspace.screens` exposes the list of monitors/outputs; `workspace.virtualScreenGeometry` exposes the combined coordinate space across all outputs. This combined space is pixel-continuous even though real monitors have physical bezels — a naive viewport calculation can visually "cut" a window across a monitor boundary.
- KWin 6 renamed/removed several APIs relative to KWin 5 (e.g., `Client` → `Window`, global `KWin.` prefix dropped from many functions like `registerShortcut`). Drift targets KWin 6 / Plasma 6 (Wayland) only.

### 4.1 What we learned from Karousel specifically

- Karousel's codebase is ~99% TypeScript — validates the language choice.
- Karousel explicitly **does not support multiple screens, windows on all desktops, or cross-activity placement**. Drift's multi-monitor requirement is precisely the gap we want to close.
- Karousel recommends a **separate, external KWin effect script** for animations rather than animating itself. Drift will implement its own animation (via the `QTimer`-based animator described above) instead of depending on an external companion plugin, to keep the smooth-scroll UX self-contained and guaranteed.
- Karousel depends on the `org.kde.notification` QML module for in-script notifications — worth keeping in mind if Drift ever needs to surface user-facing warnings/errors.

---

## 5. Open Decisions / Future Work

These are consciously deferred, not forgotten:

| Topic | Status |
|---|---|
| Multi-monitor focus-scroll alignment algorithm (how the viewport snaps so a focused column isn't visually split across a monitor bezel) | Sketched conceptually ("monitor slots" derived from `workspace.screens`), but the precise algorithm is to be worked out in a dedicated session before implementation. |
| Behavior when a column is wider than the narrowest monitor slot (must span a bezel) | Deferred — likely allowed as a conscious exception, but not decided. |
| Exact navigation feel: mouse wheel sensitivity, edge-hover thresholds/timing | Deferred — flagged as needing more detail once basic scrolling works. |
| Vertical tiling within a single column (multiple windows stacked in one column) | Deferred — noted as a near-certain future requirement, not part of the initial data model. |
| Persistence of layout across restarts | Deferred — no design work done yet. |
| Exact configuration format for "new window placement" and other user-facing settings | Deferred — default behavior (open right of focused window) is decided; the configuration mechanism itself is not. |
| Minimap rendering approach (QML overlay details) | Deferred — module is planned in the architecture (`ui/`), no implementation detail decided. |
| Window rules matching syntax/config (per-app auto-float, auto-placement) | Deferred — module is planned (`rules/`), no implementation detail decided. |

---

## 6. Architecture

Target module layout (KWin's mandatory `contents/code/` packaging structure applies):

```
drift/
├── metadata.json
├── contents/
│   └── code/
│       ├── main.ts                 # Entry point, wiring between modules
│       ├── core/
│       │   ├── grid.ts             # Pure data model: columns/rows, virtual positions — no KWin dependency
│       │   ├── column.ts           # Column logic: order, width (vertical tiling within a column: later)
│       │   └── coordinates.ts      # Virtual coordinate system; growth/shrink of the virtual area
│       ├── kwin/
│       │   ├── window-adapter.ts   # Wraps KWin Window objects (geometry get/set, signals)
│       │   ├── workspace-adapter.ts# Wraps the KWin workspace singleton (screens, virtual screen geometry)
│       │   └── geometry-sync.ts    # Translates virtual grid positions into real win.geometry calls
│       ├── viewport/
│       │   ├── viewport.ts         # Current visible offset into the virtual area
│       │   └── animator.ts         # QTimer-driven smooth-scroll animation
│       ├── input/
│       │   ├── shortcuts.ts        # registerShortcut() bindings
│       │   ├── mouse.ts            # Mouse wheel, edge-hover
│       │   └── drag.ts             # Window dragging → reorder events
│       ├── rules/
│       │   └── window-rules.ts     # Per-app auto-float / auto-placement rules
│       ├── ui/
│       │   ├── Minimap.qml         # Visual overlay
│       │   └── minimap-model.ts    # Data source for the minimap, reads from core/grid.ts
│       └── config/
│           └── settings.ts         # readConfig() wrapper, defaults
```

### 6.1 Design principles

- **`core/` has zero KWin dependency.** It's pure data structures and algorithms (grid, columns, coordinate math). This is the only layer that can realistically be unit-tested in isolation, since KWin scripts otherwise only run inside a live compositor process.
- **`kwin/` is the sole layer touching the real API.** All `win.geometry` access and KWin signal handling is isolated here, so the fragility/version-sensitivity of the KWin API (e.g., the `Client` → `Window` rename between KWin 5 and 6) is contained in one place.
- **`viewport/` is a standalone concept, deliberately not merged into `core/`.** The "camera" (what's currently visible) is separate from the layout (where things logically are). This mirrors how a real scrollable-tiling compositor like Niri separates layout state from camera state — except here, because there's no compositor-level camera API, `geometry-sync.ts` has to repeatedly translate virtual → real coordinates for every visible (and near-visible) window on every viewport change.
- **`input/` is split by input source** (shortcuts, mouse, drag), each translating raw input into the same set of high-level domain events (e.g., `focusMove`, `windowMove`, `viewportScroll`) consumed by `core/` and `viewport/`. This keeps input handling and domain logic decoupled — a deliberate contrast to Karousel's very large, flat shortcut table.
- **`rules/` and `ui/` exist as first-class modules from the start** of real feature work (not bolted on later), reflecting that window rules and the minimap are firm requirements, not nice-to-haves.

---

## 7. Spike / First Milestone

**Goal:** Get to a working, testable version of the core scrolling mechanism as fast as possible, in order to surface fundamental limitations early — most importantly, whether `QTimer`-driven geometry animation is smooth enough in practice with a realistic number of windows, given that scripts run synchronously in the compositor's own thread.

**Important constraint:** This is explicitly **not** throwaway/prototype code. It uses the target architecture from section 6, just with a reduced feature scope. Modules that aren't needed yet are simply not created (no empty placeholder folders).

### 7.1 In scope for the spike

- Minimal build/packaging setup: `metadata.json`, `main.ts`, TypeScript build chain, install workflow.
- `core/grid.ts` — full implementation: columns placed side by side, virtual positions.
- `core/coordinates.ts` — full implementation: growing/shrinking virtual area.
- `core/column.ts` — reduced: width + position only, no vertical tiling yet.
- `kwin/window-adapter.ts`, `kwin/workspace-adapter.ts`, `kwin/geometry-sync.ts` — full implementation. `workspace-adapter.ts` reads `workspace.screens` for later use, but no monitor-slot logic yet (see section 5).
- `viewport/viewport.ts`, `viewport/animator.ts` — full implementation. This is the actual subject under test.
- `input/shortcuts.ts` — minimal: 2–3 test shortcuts only (e.g., focus left/right).
- `config/settings.ts` — minimal: hardcoded defaults instead of a real `readConfig()`-backed settings system.

### 7.2 Explicitly out of scope for the spike

- `rules/` (window rules)
- `ui/` (minimap)
- `input/mouse.ts`, `input/drag.ts`
- Persistence
- Vertical tiling within a column
- Multi-monitor slot-aware scroll alignment (viewport spans the full `virtualScreenGeometry` naively for now)
- Undock/redock behavior

### 7.3 Success criteria

- Focus-move shortcuts trigger a visibly smooth (not jumpy) animated scroll across a realistic window count (target: 10–15 real windows open simultaneously).
- No noticeable stalling of the desktop (frame delivery, input responsiveness) while the animation runs, given the single-threaded compositor constraint.
- If jank appears: this tells us early whether we need tick-rate throttling, a cap on how many windows are animated at once, a cheaper interpolation strategy, or a fundamentally different approach before investing further.

---

## 8. Risks

- **Single-threaded compositor execution.** Everything Drift does runs on KWin's own thread with no sandboxing. Expensive per-tick work during animation is the most likely source of real-world problems — this is exactly what the spike is meant to catch early.
- **No native camera/viewport API.** Every scroll step means re-issuing `win.frameGeometry` for every affected window, not a single cheap transform. This is a structural cost, not something engineering can fully eliminate.
- **API fragility across KWin/Plasma versions.** The scripting API has already changed meaningfully between KWin 5 and 6 (renamed types, dropped global prefixes). Isolating all KWin API access in `kwin/` limits the blast radius of future breakage, but doesn't eliminate the maintenance burden.
- **Multi-monitor complexity.** Karousel's decision to simply not support multiple screens suggests this is a genuinely hard problem, not just unimplemented. The "monitor slot" concept sketched here is a starting point, not a validated solution.
- **No real automated testing for the `kwin/` layer.** Only `core/` is realistically unit-testable in isolation; everything touching the live KWin API can only be verified by hand, in a running Plasma session.

---

## 9. Development workflow notes

- Quick iteration during development: the KWin interactive scripting console (reachable via D-Bus, e.g. `qdbus org.kde.KWin /Scripting`, or the Plasma "Desktop Scripting Console") allows loading and running a script directly, though it's only active while KWin keeps running (not persisted).
- Debug output (`print()` calls) is no longer shown directly in the scripting console since Plasma 5.23 — it must be retrieved from the systemd journal instead.
- For a packaged script under active development, reload workflow is: rebuild TypeScript → reinstall/update via `kpackagetool6` → restart the Wayland session (or `kwin_x11 --replace` on X11, not relevant here since Drift targets Wayland only).

---

## 10. References

- Niri: https://github.com/YaLTeR/niri
- Karousel: https://github.com/peterfajdiga/karousel
- KWin Scripting API docs: https://develop.kde.org/docs/plasma/kwin/api/
- KWin Scripting tutorial: https://develop.kde.org/docs/plasma/kwin/
