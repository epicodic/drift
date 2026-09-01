# Documentation Restructure — Design

**Status:** Approved
**Purpose:** Replace the single pre-implementation `docs/requirements-and-architecture.md` with a set of docs that describe Drift as it exists today, split for use by both human readers and AI agents.

---

## 1. Motivation

`docs/requirements-and-architecture.md` is a pre-implementation design document written before any code existed. Drift now has a working implementation (`core/`, `kwin/`, `viewport/`, `input/`, `config/`), so the document no longer matches reality: it describes goals and open decisions rather than the current architecture, and several described features (rules, minimap, persistence, multi-monitor slot logic) are still unimplemented.

We are replacing it with four focused documents, and keeping the original for historical reference.

## 2. New documents

### `docs/architecture.md`
1. **Overview** — scrollable-tiling KWin script, no compositor replacement, link to Niri/Karousel as prior art.
2. **Core concepts** — virtual coordinate system, columns, viewport vs. layout ("camera" analogy), focus model.
3. **Module map** — the `src/` tree (`core/`, `kwin/`, `viewport/`, `input/`, `config/`), one-line purpose per module, plus design principles (core is KWin-free/pure; KWin API access isolated to `kwin/`).
4. **Data flow** — a Mermaid diagram plus a short walkthrough: focus-shortcut → `Grid.focusRight()` → `Viewport.offsetToReveal()` → `Animator` ticks → `GeometrySync.apply()` → `win.frameGeometry`.

### `docs/algorithms.md`
One subsection per algorithm, each stating the problem, the approach, and a pointer to the exact function:
1. Column layout math (`src/core/coordinates.ts`)
2. Resize-edge detection (`src/input/drag.ts`)
3. Drag-reorder insertion index
4. Viewport reveal/animation easing (`src/viewport/animator.ts`)

### `docs/development.md`
1. Build (`npm run build`, Rollup bundling, `declarativescript` KWin packaging, why QML hosting is needed for timers)
2. Test (`npm test`, what's covered — pure `core`/logic — and what isn't)
3. Lint (`npm run lint`, JS/TS/QML incl. `qmllint`)
4. Dev/reload workflow, including the log-out/log-in caveat for KWin script reloads.

### `docs/roadmap.md`
Short bullet list of not-yet-implemented items: window rules, minimap, persistence, multi-monitor slot alignment, vertical tiling, undock/redock. Status + one-line description each, no prose.

## 3. Old document handling

- Move `docs/requirements-and-architecture.md` to `docs/archive/requirements-and-architecture.md`.
- Add a banner at the top of the archived file marking it historical/pre-implementation and superseded by the four docs above.
- Add a line to `AGENTS.md` noting that `docs/archive/` holds historical/superseded documents and must not be used as a source of truth for current behavior by agentic workers.

## 4. Out of scope

- `docs/coding-conventions.md` is unrelated and untouched.
- No changes to `docs/agents/plans/` or `docs/agents/specs/` beyond adding this file.
