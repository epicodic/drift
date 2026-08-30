# Runtime Orchestration Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the `init()` god-function in `src/main.ts` into a dedicated `runtime/` orchestration layer, preserving current behavior and adding the seams for future Plasma Activities support.

**Architecture:** A tiny `init()` constructs a `Controller` that owns a `StripManager` (context → `Strip`) and a `WindowManager` (window → strip router). Each `Strip` owns one `Grid` + `Viewport` + `Animator` + `ColumnRegistry` and holds all per-strip rendering and window lifecycle. Signal/disconnect bookkeeping moves to a shared `SignalManager`; debug-snapshot building moves to `debug/snapshot.ts`.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing. Key rules: 4-space indent, single quotes, semicolons, trailing commas, 120-char lines, lowercase kebab-case filenames, `PascalCase` classes/types, `camelCase` functions/vars, no default exports.

**Design spec:** `docs/agents/specs/2026-08-30-runtime-orchestration-refactor-design.md`

---

## Ground rules

- `npm run typecheck` (`tsc --noEmit`) compiles **every** file in `src/`, so each new
  file must be self-consistent and typecheck standalone the moment it is created.
  Tasks are ordered leaves-first so no file ever imports a not-yet-created module.
- The old `src/main.ts` stays fully intact and is the live entry point through
  Tasks 1–8; it is only rewired in Task 9. Behavior must not change at any point.
- Per-task verification is `npm run typecheck`, `npm test`, and `npm run lint`
  (eslint + prettier + qmllint). All must pass before a task is complete.
- No behavior change anywhere: focus, reveal, resize, drag-reorder, and
  minimize/restore must behave exactly as today.

## File structure

| File | Responsibility |
|---|---|
| `src/utils/signal-manager.ts` | `SignalManager`: collects disconnect thunks, disconnects all on `destroy()` |
| `src/utils/signal-manager.test.ts` | Unit tests for `SignalManager` |
| `src/runtime/column-registry.ts` | `ColumnRegistry`: column-id ↔ window map within one strip, owns each window's `SignalManager` |
| `src/runtime/column-registry.test.ts` | Unit tests for `ColumnRegistry` |
| `src/runtime/window-events.ts` | `onWindowGeometryChanged` / `onMinimizedChanged` as pure functions taking `WindowEventDeps` |
| `src/runtime/window-events.test.ts` | Unit tests for the event handlers |
| `src/debug/snapshot.ts` | `debugRows(grid, registry)` / `debugCamera(viewport)` |
| `src/debug/snapshot.test.ts` | Unit tests for the snapshot builders |
| `src/runtime/strip.ts` | `Strip`: owns Grid/Viewport/Animator/GeometrySync/ColumnRegistry; `render`, `revealFocused`, window lifecycle |
| `src/runtime/strip-manager.ts` | `StripManager`: context-key → `Strip` (single constant key in Phase 1) |
| `src/runtime/window-manager.ts` | `WindowManager`: tileability check + routes windows to the active strip |
| `src/runtime/workspace-signals.ts` | `initWorkspaceSignals(windowManager, workspaceAdapter)` |
| `src/runtime/controller.ts` | `Controller`: constructs everything, wires signals + shortcuts, `start()` |
| `src/main.ts` | Shrinks to `new Controller(root, loadSettings()).start()` |

---

### Task 1: SignalManager

**Files:**
- Create: `src/utils/signal-manager.ts`
- Test: `src/utils/signal-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/signal-manager.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SignalManager } from './signal-manager';

describe('SignalManager', () => {
    it('calls every registered disconnect on destroy', () => {
        const a = vi.fn();
        const b = vi.fn();
        const signals = new SignalManager();
        signals.add(a);
        signals.add(b);

        signals.destroy();

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('does not call disconnects again on a second destroy', () => {
        const a = vi.fn();
        const signals = new SignalManager();
        signals.add(a);

        signals.destroy();
        signals.destroy();

        expect(a).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `signal-manager.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/signal-manager.ts`:

```ts
// Collects the disconnect thunks returned by the kwin/ adapters' on...() methods,
// so a whole window's signal connections can be torn down in one call. Replaces the
// hand-maintained disconnect maps that used to live in main.ts.

export class SignalManager {
    private disconnects: (() => void)[] = [];

    /** Register a disconnect thunk (e.g. the return value of `win.onMinimizedChanged(...)`). */
    add(disconnect: () => void): void {
        this.disconnects.push(disconnect);
    }

    /** Call every registered disconnect once, then forget them. */
    destroy(): void {
        for (const disconnect of this.disconnects) {
            disconnect();
        }
        this.disconnects = [];
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run and record PASS/FAIL with file evidence:
- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] Naming: `SignalManager` (PascalCase class), `add`/`destroy`/`disconnects` (camelCase); filename kebab-case
- [ ] No default export; `private` field used
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 2

---

### Task 2: ColumnRegistry

**Files:**
- Create: `src/runtime/column-registry.ts`
- Test: `src/runtime/column-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/column-registry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import { SignalManager } from '../utils/signal-manager';
import { ColumnRegistry } from './column-registry';

function fakeWindow(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

describe('ColumnRegistry', () => {
    it('maps a column id to its window', () => {
        const registry = new ColumnRegistry();
        const win = fakeWindow('w1');

        registry.set(1, win, new SignalManager());

        expect(registry.get(1)).toBe(win);
    });

    it('finds the column id for a window id', () => {
        const registry = new ColumnRegistry();
        registry.set(1, fakeWindow('w1'), new SignalManager());
        registry.set(2, fakeWindow('w2'), new SignalManager());

        expect(registry.columnOf('w2')).toBe(2);
        expect(registry.columnOf('missing')).toBeNull();
    });

    it('destroys the window signals when a column is deleted', () => {
        const registry = new ColumnRegistry();
        const signals = new SignalManager();
        const disconnect = vi.fn();
        signals.add(disconnect);
        registry.set(1, fakeWindow('w1'), signals);

        registry.delete(1);

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(registry.get(1)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `column-registry.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/runtime/column-registry.ts`:

```ts
// The column-id <-> window mapping for a single strip, plus ownership of each
// window's SignalManager. Replaces main.ts's loose `windowsByColumn` map and the
// linear-scan `columnOf()`; deleting a column tears down its signals in one call.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { SignalManager } from '../utils/signal-manager';

interface Entry {
    window: WindowAdapter;
    signals: SignalManager;
}

export class ColumnRegistry {
    private readonly byColumn = new Map<number, Entry>();

    set(columnId: number, window: WindowAdapter, signals: SignalManager): void {
        this.byColumn.set(columnId, { window, signals });
    }

    get(columnId: number): WindowAdapter | undefined {
        return this.byColumn.get(columnId)?.window;
    }

    columnOf(windowId: string): number | null {
        for (const [columnId, entry] of this.byColumn) {
            if (entry.window.id === windowId) {
                return columnId;
            }
        }
        return null;
    }

    delete(columnId: number): void {
        const entry = this.byColumn.get(columnId);
        if (entry === undefined) {
            return;
        }
        entry.signals.destroy();
        this.byColumn.delete(columnId);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] Naming: `ColumnRegistry` class, `byColumn` private field, `columnOf`/`set`/`get`/`delete` methods; filename kebab-case
- [ ] `type`-only imports use `import type`; no default export
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 3

---

### Task 3: window-events

**Files:**
- Create: `src/runtime/window-events.ts`
- Test: `src/runtime/window-events.test.ts`

This ports the two handler closures from `src/main.ts` (`onWindowGeometryChanged`, `onMinimizedChanged`) verbatim, replacing their captured scope with an explicit `WindowEventDeps` object.

- [ ] **Step 1: Write the failing test**

Create `src/runtime/window-events.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import { onMinimizedChanged, onWindowGeometryChanged, type WindowEventDeps } from './window-events';

function fakeWindow(
    id: string,
    frame: Rect,
    overrides: { interactiveResize?: boolean; minimized?: boolean } = {},
): WindowAdapter {
    return {
        id,
        frameGeometry: () => frame,
        isInteractiveResize: () => overrides.interactiveResize ?? false,
        isMinimized: () => overrides.minimized ?? false,
    } as unknown as WindowAdapter;
}

function fakeDeps(overrides: Partial<WindowEventDeps> = {}): WindowEventDeps {
    return {
        columnOf: () => 1,
        isHidden: () => false,
        isEcho: () => false,
        resizeColumn: vi.fn(),
        hideColumn: vi.fn(),
        showColumn: vi.fn(),
        render: vi.fn(),
        ...overrides,
    };
}

describe('onWindowGeometryChanged', () => {
    it('resizes the column on a width change and re-renders', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.resizeColumn).toHaveBeenCalledWith(1, 900, 'right');
        expect(deps.render).toHaveBeenCalledWith(undefined);
    });

    it('excludes the resized window from render during an interactive resize', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 }, { interactiveResize: true });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.render).toHaveBeenCalledWith('w1');
    });

    it('ignores a pure move (no width change)', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 50, y: 0, width: 800, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.resizeColumn).not.toHaveBeenCalled();
        expect(deps.render).not.toHaveBeenCalled();
    });

    it('ignores an echo of Drift\'s own geometry write', () => {
        const deps = fakeDeps({ isEcho: () => true });
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.resizeColumn).not.toHaveBeenCalled();
    });

    it('ignores geometry changes for an unknown or hidden column', () => {
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, fakeDeps({ columnOf: () => null }));
        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, fakeDeps({ isHidden: () => true }));
    });
});

describe('onMinimizedChanged', () => {
    it('hides the column when the window is minimized', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 800, height: 600 }, { minimized: true });

        onMinimizedChanged(win, deps);

        expect(deps.hideColumn).toHaveBeenCalledWith(1);
        expect(deps.render).toHaveBeenCalledTimes(1);
    });

    it('shows the column when the window is restored', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 800, height: 600 }, { minimized: false });

        onMinimizedChanged(win, deps);

        expect(deps.showColumn).toHaveBeenCalledWith(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `window-events.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/runtime/window-events.ts`:

```ts
// KWin window-signal handlers, extracted from main.ts's init() closures into pure
// functions that take their dependencies explicitly (a Strip satisfies WindowEventDeps),
// so the guard logic is unit-testable without a live compositor.

import { rectsEqualRounded, resizedEdge, type Rect, type ResizeEdge } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';

export interface WindowEventDeps {
    columnOf(windowId: string): number | null;
    isHidden(columnId: number): boolean;
    isEcho(windowId: string, rect: Rect): boolean;
    resizeColumn(columnId: number, width: number, edge: ResizeEdge): void;
    hideColumn(columnId: number): void;
    showColumn(columnId: number): void;
    render(excludeWindowId?: string): void;
}

export function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect, deps: WindowEventDeps): void {
    const columnId = deps.columnOf(win.id);
    if (columnId === null || deps.isHidden(columnId)) {
        return;
    }
    const newReal = win.frameGeometry();
    if (rectsEqualRounded(oldReal, newReal)) {
        return;
    }
    if (deps.isEcho(win.id, newReal)) {
        return;
    }
    if (Math.round(newReal.width) === Math.round(oldReal.width)) {
        return; // width-only step: ignore pure moves and height-only changes
    }
    deps.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
    deps.render(win.isInteractiveResize() ? win.id : undefined);
}

export function onMinimizedChanged(win: WindowAdapter, deps: WindowEventDeps): void {
    const columnId = deps.columnOf(win.id);
    if (columnId === null) {
        return;
    }
    if (win.isMinimized()) {
        deps.hideColumn(columnId);
    } else {
        deps.showColumn(columnId);
    }
    deps.render();
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] Logic is a faithful port of the current `main.ts` handlers (same guards, same order)
- [ ] Naming: functions `camelCase`, interface `WindowEventDeps` PascalCase; filename kebab-case
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 4

---

### Task 4: debug/snapshot

**Files:**
- Create: `src/debug/snapshot.ts`
- Test: `src/debug/snapshot.test.ts`

Note: `src/debug.ts` (the debug channel) and `src/debug/` (this new folder) coexist; `import from '../debug'` resolves to `debug.ts`, `import from '../debug/snapshot'` resolves here.

- [ ] **Step 1: Write the failing test**

Create `src/debug/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import { ColumnRegistry } from '../runtime/column-registry';
import { Viewport } from '../viewport/viewport';
import { debugCamera, debugRows } from './snapshot';

describe('debugRows', () => {
    it('reports "(none)" for a column with no registered window', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(400);
        const registry = new ColumnRegistry();

        const rows = debugRows(grid, registry);

        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('(none)');
        expect(rows[0].columnId).toBe(column.id);
        expect(rows[0].hidden).toBe(false);
        expect(rows[0].real).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('reports a hidden column with a zero-height virtual rect', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(400);
        grid.hideColumn(column.id);

        const rows = debugRows(grid, new ColumnRegistry());

        expect(rows[0].hidden).toBe(true);
        expect(rows[0].virtual).toEqual({ x: 0, y: 0, width: 400, height: 0 });
    });
});

describe('debugCamera', () => {
    it('reports the viewport offset and content bounds', () => {
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, 2000);

        const camera = debugCamera(viewport);

        expect(camera.viewportWidth).toBe(1280);
        expect(camera.contentLeft).toBe(0);
        expect(camera.contentWidth).toBe(2000);
        expect(typeof camera.offset).toBe('number');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `snapshot.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/debug/snapshot.ts`:

```ts
// Builds the debug-console snapshot structures from a strip's live state. Extracted
// verbatim from the debugRows()/debugCamera() closures that used to sit inside main.ts's
// init(), keeping presentation out of the orchestration layer.

import type { CameraDebugState, WindowDebugRow } from '../core/debug-format';
import type { Grid } from '../core/grid';
import type { ColumnRegistry } from '../runtime/column-registry';
import type { Viewport } from '../viewport/viewport';

export function debugRows(grid: Grid, registry: ColumnRegistry): WindowDebugRow[] {
    return grid.columns().map((column) => {
        const win = registry.get(column.id);
        return {
            id: win?.id ?? '(none)',
            title: win?.caption ?? '',
            columnId: column.id,
            hidden: column.hidden,
            virtual: column.hidden ? { x: 0, y: 0, width: column.width, height: 0 } : grid.columnRect(column.id),
            real: win?.frameGeometry() ?? { x: 0, y: 0, width: 0, height: 0 },
        };
    });
}

export function debugCamera(viewport: Viewport): CameraDebugState {
    return {
        offset: viewport.offset(),
        viewportWidth: viewport.viewportWidth(),
        contentLeft: viewport.contentLeft(),
        contentWidth: viewport.contentWidth(),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] `debugRows`/`debugCamera` output matches the current `main.ts` closures field-for-field
- [ ] `import type` used for type-only imports; no default export; filename kebab-case
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 5

---

### Task 5: Strip

**Files:**
- Create: `src/runtime/strip.ts`

`Strip` is integration glue (it drives `GeometrySync`, which writes real window geometry), so it is verified by typecheck + the existing suite staying green rather than a new unit test. It composes Tasks 1–4.

- [ ] **Step 1: Write the implementation**

Create `src/runtime/strip.ts`:

```ts
// One scrollable tiling surface: owns its Grid (layout), Viewport (camera), Animator
// (scroll animation), GeometrySync (virtual->real writes), and ColumnRegistry (window
// bookkeeping). Absorbs the render(), revealFocused(), and per-window lifecycle logic
// that used to live in main.ts's init(). Only runtime/ and main.ts do this wiring.

import type { Rect } from '../core/coordinates';
import { formatDebugState } from '../core/debug-format';
import { Grid } from '../core/grid';
import type { Settings } from '../config/settings';
import { setDebugState } from '../debug';
import { debugCamera, debugRows } from '../debug/snapshot';
import { registerDragReorder } from '../input/drag';
import { GeometrySync } from '../kwin/geometry-sync';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { Animator, type Timer } from '../viewport/animator';
import { Viewport } from '../viewport/viewport';
import { ColumnRegistry } from './column-registry';
import { onMinimizedChanged, onWindowGeometryChanged, type WindowEventDeps } from './window-events';
import { SignalManager } from '../utils/signal-manager';

export class Strip {
    private readonly grid: Grid;
    private readonly viewport: Viewport;
    private readonly geometrySync: GeometrySync;
    private readonly animator: Animator;
    private readonly registry = new ColumnRegistry();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
    ) {
        this.grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
        this.viewport = new Viewport(area.width);
        this.geometrySync = new GeometrySync(area);
        this.animator = new Animator(timer, () => Date.now(), settings.animationTickMs, (offset) => {
            this.viewport.scrollTo(offset);
            this.render();
        });
    }

    render(excludeWindowId?: string): void {
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            if (column.hidden) {
                continue;
            }
            const win = this.registry.get(column.id);
            if (win && win.id !== excludeWindowId) {
                this.geometrySync.apply(win, this.grid.columnRect(column.id), this.viewport.offset());
            }
        }
        setDebugState(formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()));
    }

    revealFocused(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        this.animator.animate(this.viewport.offset(), this.viewport.offsetToReveal(rect.x, rect.width), this.settings.animationDurationMs);
    }

    addWindow(win: WindowAdapter): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        const signals = new SignalManager();
        this.registry.set(column.id, win, signals);
        if (win.isMinimized()) {
            this.grid.hideColumn(column.id);
        }
        signals.add(win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal, this.eventDeps())));
        signals.add(win.onMinimizedChanged(() => onMinimizedChanged(win, this.eventDeps())));
        signals.add(
            registerDragReorder(win, column.id, {
                grid: this.grid,
                viewport: this.viewport,
                workspaceAdapter: this.workspaceAdapter,
                area: this.area,
                render: () => this.render(),
            }),
        );
        this.render();
        this.revealFocused();
    }

    removeWindow(win: WindowAdapter): void {
        const columnId = this.registry.columnOf(win.id);
        if (columnId === null) {
            return;
        }
        this.registry.delete(columnId);
        this.geometrySync.forget(win.id);
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }

    activateWindow(win: WindowAdapter): void {
        const columnId = this.registry.columnOf(win.id);
        if (columnId === null) {
            return;
        }
        this.grid.setFocus(columnId);
        this.revealFocused();
    }

    focusLeft(): void {
        this.grid.focusLeft();
        this.revealFocused();
    }

    focusRight(): void {
        this.grid.focusRight();
        this.revealFocused();
    }

    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
            hideColumn: (columnId) => this.grid.hideColumn(columnId),
            showColumn: (columnId) => this.grid.showColumn(columnId),
            render: (excludeWindowId) => this.render(excludeWindowId),
        };
    }
}
```

- [ ] **Step 2: Verify build and existing tests**

`npm run typecheck` then `npm test`
Expected: typecheck PASS, all existing tests PASS (no test imports `Strip` yet; it must still compile cleanly).

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] `render`/`revealFocused`/`addWindow`/`removeWindow`/`activateWindow` are faithful
      ports of the corresponding `main.ts` closures (same order, same guards, same
      drag-deps object)
- [ ] Naming: `Strip` class, private fields `camelCase`; filename kebab-case
- [ ] `import type` used for type-only imports; no default export
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 6

---

### Task 6: StripManager

**Files:**
- Create: `src/runtime/strip-manager.ts`

- [ ] **Step 1: Write the implementation**

Create `src/runtime/strip-manager.ts`:

```ts
// Owns the set of strips and exposes the active one. Phase 1 has exactly one strip,
// constructed eagerly. Phase 2 (Plasma Activities) widens this into a map keyed by
// (activity, desktop, screen) and reacts to the corresponding workspace signals to
// switch the active strip — this class is the single seam for that change.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

export class StripManager {
    private readonly strip: Strip;

    constructor(area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) {
        this.strip = new Strip(area, settings, timer, workspaceAdapter);
    }

    activeStrip(): Strip {
        return this.strip;
    }
}
```

- [ ] **Step 2: Verify build and existing tests**

`npm run typecheck` then `npm test`
Expected: typecheck PASS, all existing tests PASS.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] Naming: `StripManager` class, `activeStrip` method; filename kebab-case
- [ ] `import type` for type-only imports; no default export
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 7

---

### Task 7: WindowManager

**Files:**
- Create: `src/runtime/window-manager.ts`

- [ ] **Step 1: Write the implementation**

Create `src/runtime/window-manager.ts`:

```ts
// Global entry point for window lifecycle events: decides whether a window should be
// tiled and routes it to the active strip. Per-window state lives in each strip's
// ColumnRegistry. Phase 2 (Plasma Activities) grows this to pick the strip for a
// window's (activity, desktop, screen) and to move a window when that context changes.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    constructor(private readonly stripManager: StripManager) {}

    addWindow(win: WindowAdapter): void {
        if (!win.isTileable()) {
            return;
        }
        this.stripManager.activeStrip().addWindow(win);
    }

    removeWindow(win: WindowAdapter): void {
        this.stripManager.activeStrip().removeWindow(win);
    }

    activateWindow(win: WindowAdapter | null): void {
        if (win === null) {
            return;
        }
        this.stripManager.activeStrip().activateWindow(win);
    }
}
```

- [ ] **Step 2: Verify build and existing tests**

`npm run typecheck` then `npm test`
Expected: typecheck PASS, all existing tests PASS.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] Tileability guard matches current `main.ts` `onWindowAdded` (`if (!win.isTileable()) return;`)
- [ ] `null` activation guard matches current `onWindowActivated`
- [ ] Naming: `WindowManager` class; filename kebab-case; `import type`; no default export
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 8

---

### Task 8: workspace-signals

**Files:**
- Create: `src/runtime/workspace-signals.ts`

- [ ] **Step 1: Write the implementation**

Create `src/runtime/workspace-signals.ts`:

```ts
// Centralizes the workspace signal registration that used to be inline in main.ts's
// init(). Phase 2 adds currentActivityChanged / currentDesktopChanged / screensChanged
// handlers here to drive the StripManager.

import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(windowManager: WindowManager, workspaceAdapter: WorkspaceAdapter): void {
    workspaceAdapter.onWindowAdded((win) => windowManager.addWindow(win));
    workspaceAdapter.onWindowRemoved((win) => windowManager.removeWindow(win));
    workspaceAdapter.onWindowActivated((win) => windowManager.activateWindow(win));
}
```

- [ ] **Step 2: Verify build and existing tests**

`npm run typecheck` then `npm test`
Expected: typecheck PASS, all existing tests PASS.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] The three registrations match current `main.ts` (`onWindowAdded`/`onWindowRemoved`/`onWindowActivated`)
- [ ] Naming: `initWorkspaceSignals` function; filename kebab-case; `import type`; no default export
- [ ] `npm run typecheck`, `npm test`, `npm run lint` all pass
- [ ] Fix any violation before Task 9

---

### Task 9: Controller + main.ts rewire

**Files:**
- Create: `src/runtime/controller.ts`
- Modify: `src/main.ts` (replace entire file body)

This task activates the new layer and removes the old `init()` body. After this task the behavior must be identical to before the refactor.

- [ ] **Step 1: Write the Controller**

Create `src/runtime/controller.ts`:

```ts
// Root orchestrator constructed by main.ts's init(). Owns the StripManager and
// WindowManager, wires the workspace signals and global shortcuts, and starts the
// script. Contains coordination only — no layout, camera, or geometry math.

import type { Settings } from '../config/settings';
import { createDebugConsole, type DebugConsole } from '../kwin/debug-console';
import { createQmlTimer } from '../kwin/qml-timer';
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { registerShortcuts } from '../input/shortcuts';
import { StripManager } from './strip-manager';
import { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

export class Controller {
    private readonly workspaceAdapter = new WorkspaceAdapter();
    private readonly stripManager: StripManager;
    private readonly windowManager: WindowManager;
    private readonly debugConsole: DebugConsole;

    constructor(
        private readonly root: QmlObject,
        settings: Settings,
    ) {
        const area = this.workspaceAdapter.combinedGeometry();
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager);
        this.debugConsole = createDebugConsole(root);
    }

    start(): void {
        initWorkspaceSignals(this.windowManager, this.workspaceAdapter);
        registerShortcuts(this.root, {
            focusLeft: () => this.stripManager.activeStrip().focusLeft(),
            focusRight: () => this.stripManager.activeStrip().focusRight(),
            toggleDebugConsole: () => this.debugConsole.toggle(),
        });
        console.log('Drift: initialized');
    }
}
```

Note: `DebugConsole` is already exported from `src/kwin/debug-console.ts` (verified: `export interface DebugConsole { toggle(): void; }`), so the `import type { ..., DebugConsole }` above resolves directly.

- [ ] **Step 2: Replace `src/main.ts`**

Replace the **entire** contents of `src/main.ts` with:

```ts
// Drift entry point. `init` is the single exported boot function the QML host calls
// (docs §6.2), receiving the QML root as the parent for runtime QML objects. All
// orchestration now lives in runtime/ — this file only boots the Controller.

import { loadSettings } from './config/settings';
import { Controller } from './runtime/controller';

export function init(root: QmlObject): void {
    new Controller(root, loadSettings()).start();
}
```

- [ ] **Step 3: Verify the full suite and build**

Run all of:
- `npm run typecheck` — Expected: PASS
- `npm test` — Expected: PASS (all pre-existing tests plus the new Task 1–4 tests)
- `npm run lint` — Expected: PASS
- `npm run build` — Expected: PASS (rollup bundles `src/main.ts` → `drift/contents/code/main.js`)

- [ ] **Step 4: Manual smoke test (in a KWin session)**

Load the built script and confirm no behavior change:
- Open/close windows → columns add/remove and the strip re-flows
- Alt-tab / click windows → focus follows and the focused column reveals
- `Meta+A` / `Meta+D` → focus steps left/right and reveals
- Interactively resize a window → its column resizes, neighbors shift
- Drag a window and release → it snaps into the nearest slot
- Minimize/restore a window → its column collapses/reappears in place
- `Meta+Shift+D` → debug console toggles and shows the live snapshot

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read for TypeScript
- [ ] `src/main.ts` contains no orchestration logic — only `init()` → `Controller`
- [ ] No dead code left from the old `init()` (no orphaned imports/helpers)
- [ ] `Controller` shortcut/ signal wiring matches the old `registerShortcuts` and
      workspace handler behavior exactly
- [ ] Naming: `Controller` class; filenames kebab-case; `import type` where type-only; no default export
- [ ] `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` all pass
- [ ] Manual smoke test performed and behavior unchanged

---

### Task 10: Documentation update

**Files:**
- Modify: `docs/architecture.md` (Module Map table + design-principle note)

- [ ] **Step 1: Update the Module Map**

In `docs/architecture.md`, update the "Module Map" section so it reflects the new
layout. Add rows for `src/runtime/` (the orchestration layer: `Controller`, `Strip`,
`StripManager`, `WindowManager`, `ColumnRegistry`), `src/utils/` (`SignalManager`),
and `src/debug/` (`snapshot.ts`); change the `src/main.ts` row to "Entry point only:
constructs and starts the `Controller`." Extend the design-principle note to: "only
`runtime/` and `main.ts` perform wiring." Write one sentence per line (docs convention).

- [ ] **Step 2: Verify**

`npm run lint` (qmllint is unaffected; prettier/eslint ignore Markdown but run anyway to be safe).
Visually confirm the table renders and links resolve.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Documentation written one sentence per line (AGENTS.md rule)
- [ ] Module Map matches the files actually created
- [ ] No stale references to the old single-`init()` design remain

---

## Self-review

**Spec coverage:**
- `runtime/` layer + naming (`Controller`/`Strip`/`StripManager`/`WindowManager`) → Tasks 5–9 ✓
- `SignalManager` → Task 1 ✓
- `ColumnRegistry` → Task 2 ✓
- `windowEvents` testable functions → Task 3 ✓
- `debug/snapshot.ts` → Task 4 ✓
- `workspaceSignals` centralization → Task 8 ✓
- Activities seams (`StripManager`/`WindowManager`) → Tasks 6–7 (single-key/single-strip in Phase 1) ✓
- Tiny `main.ts` → Task 9 ✓
- Non-goal "no behavior change" → enforced by ground rules + Task 9 smoke test ✓
- Docs updated → Task 10 ✓

**Type consistency:**
- `Strip.eventDeps()` returns `WindowEventDeps` exactly as defined in Task 3 (same method names/signatures). ✓
- `ColumnRegistry.set(columnId, window, signals)` / `get` / `columnOf` / `delete` used consistently in Tasks 2 and 5. ✓
- `SignalManager.add`/`destroy` used consistently in Tasks 1, 2, 5. ✓
- `Timer` type imported from `../viewport/animator` in Tasks 5, 6. ✓
- `StripManager.activeStrip()` used in Tasks 7 and 9. ✓
- `WindowManager` constructed with `StripManager` only (Task 7) and used that way in Task 9. ✓

**Placeholder scan:** No TBDs; every code step contains full file contents. The
`DebugConsole` type note in Task 9 is confirmed against the source, not left open.
