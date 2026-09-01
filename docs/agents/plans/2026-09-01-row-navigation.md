# Row Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single `(activity, virtualDesktop)` hold multiple independent `Strip`s stacked vertically ("rows"), paged between with dedicated shortcuts, instead of one strip per activity/desktop.

**Architecture:** Introduce a `StripStack` layer between `StripManager` and `Strip`. `StripStack` owns an ordered `Map<number, Strip>` of rows (row `0` always exists, others created lazily and pruned once empty), a vertical `Animator` for page transitions, and a `windowId -> rowIndex` index. Vertical placement reuses the existing horizontal virtual-coordinate pattern: `GeometrySync`/`toRealRect` grow a `viewportOffsetY` parameter exactly parallel to the existing `viewportOffsetX`.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-01-row-navigation-design.md` — read before implementing

---

## Important Implementation Note (read first)

Every `Strip` today is handed one shared raw `Timer` object (constructed once in `Controller`, threaded through `StripManager` unchanged to every `Strip` it creates). Each `Strip` wraps that raw timer in its own `SharedTicker`. This is safe today only because at most one `Strip` is ever animating at a time — KWin only shows one activity/desktop at once, so a background `Strip` never calls `render()`/`animate()`.

Row navigation breaks that assumption: during a page transition, the outgoing and incoming row's `Strip`s must both render on the same ticks. Two independent `SharedTicker`s wrapping the same raw timer would fight over it (the raw `createQmlTimer` handle in `kwin/qml-timer.ts` holds a single `handler` variable — the second `SharedTicker` to call `.start()` silently overwrites the first's callback, starving it of ticks).

The fix: `StripStack` becomes the one place that turns the single raw `Timer` it receives into a `SharedTicker`, and hands every row's `Strip`, plus its own vertical `Animator`, a `ticker.subscribe()` handle instead of the raw timer directly. This is additive — `SharedTicker` itself needs no changes; only *where* it gets constructed moves from `Strip` (implicitly, once per strip) to `StripStack` (once per activity/desktop, shared by every row).

---

## Task 1: Vertical geometry primitives

**Files:**
- Modify: `src/kwin/geometry-sync.ts`
- Test: `src/kwin/geometry-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/kwin/geometry-sync.test.ts`, inside the existing `describe('toRealRect', ...)` block (after the existing three `it` cases, before the closing `});`):

```typescript
    it('subtracts the vertical viewport offset from the virtual y, defaulting to 0', () => {
        expect(toRealRect({ x: 0, y: 0, width: 300, height: 1080 }, area, 0)).toEqual({
            x: 0,
            y: 0,
            width: 300,
            height: 1080,
        });
        expect(toRealRect({ x: 0, y: 0, width: 300, height: 1080 }, area, 0, 1080)).toEqual({
            x: 0,
            y: -1080,
            width: 300,
            height: 1080,
        });
    });
```

- [ ] **Step 2: Run the test to verify it fails**

`npm test -- geometry-sync`
Expected: FAIL — `toRealRect` does not accept a fourth argument yet, and the second assertion's expected `y: -1080` does not match the current always-`0` result.

- [ ] **Step 3: Extend `toRealRect` and `GeometrySync.apply`**

Modify `src/kwin/geometry-sync.ts`:

```typescript
/** Maps a rect from virtual strip coordinates into the real screen area. `viewportOffsetY`
 * is the row-navigation vertical camera offset (docs: 2026-09-01-row-navigation-design) —
 * 0 for the active row, non-zero to park an inactive row's windows off-screen. */
export function toRealRect(virtualRect: Rect, area: Rect, viewportOffsetX: number, viewportOffsetY = 0): Rect {
    return {
        x: area.x + virtualRect.x - viewportOffsetX,
        y: area.y + virtualRect.y - viewportOffsetY,
        width: virtualRect.width,
        height: virtualRect.height,
    };
}
```

Update `GeometrySync.apply`:

```typescript
    apply(window: WindowAdapter, virtualRect: Rect, viewportOffsetX: number, viewportOffsetY = 0): void {
        const real = toRealRect(virtualRect, this.area, viewportOffsetX, viewportOffsetY);
        window.setFrameGeometry(real);
        this.lastApplied.set(window.id, real);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

`npm test -- geometry-sync`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (`viewportOffsetY` camelCase, matches sibling `viewportOffsetX`)
- [ ] TypeScript guidelines followed (explicit types, no default export)
- [ ] `npm test -- geometry-sync` passing
- [ ] No convention violations found

---

## Task 2: Writable `skipTaskbar` on `WindowAdapter`

**Files:**
- Modify: `src/types/kwin.d.ts`
- Modify: `src/kwin/window-adapter.ts`
- Test: `src/kwin/window-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/kwin/window-adapter.test.ts`, a new `describe` block after the existing `describe('WindowAdapter.isTileable', ...)` block:

```typescript
describe('WindowAdapter.setSkipTaskbar', () => {
    it('writes skipTaskbar on the underlying window', () => {
        const window = createWindow({ skipTaskbar: false });
        const adapter = new WindowAdapter(window);

        adapter.setSkipTaskbar(true);

        expect(window.skipTaskbar).toBe(true);
    });

    it('does not affect isTileable for an already-tiled window (only checked once, at add-time)', () => {
        const window = createWindow({ skipTaskbar: false });
        const adapter = new WindowAdapter(window);
        expect(adapter.isTileable()).toBe(true);

        adapter.setSkipTaskbar(true);

        expect(adapter.isTileable()).toBe(false); // isTileable() itself always reads live state...
        // ...but WindowManager.addWindow (window-manager.ts, unchanged by this plan) only calls
        // isTileable() once, at first sight of the window, and never again on a live-changed
        // signal — so a later toggle here cannot cause Drift to un-tile a window it already
        // manages. That's a property of window-manager.ts's existing, untouched code, not
        // something this plan adds a new test for; this test only proves skipTaskbar itself
        // round-trips through the adapter correctly.
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

`npm test -- window-adapter`
Expected: FAIL — `adapter.setSkipTaskbar` is not a function, and `window.skipTaskbar` is declared `readonly` so the fake object literal assignment inside `createWindow`'s `overrides` still type-checks (it's a plain object), but `WindowAdapter` has no method to write it yet.

- [ ] **Step 3: Make `skipTaskbar` writable and add the adapter method**

Modify `src/types/kwin.d.ts` — change the `Window` interface's `skipTaskbar` field from readonly to writable (it now needs to be written, not just read, mirroring how `frameGeometry` is already writable on the same interface):

```typescript
    skipTaskbar: boolean;
```

(replacing the existing `readonly skipTaskbar: boolean;` line)

Modify `src/kwin/window-adapter.ts` — add a new method after `isFullScreen()`:

```typescript
    /** Toggles taskbar visibility without affecting tiling: used to hide a window's taskbar
     * entry while its row is inactive (docs: 2026-09-01-row-navigation-design). Safe to call on
     * an already-managed window — `isTileable()` is only read once, at the moment `WindowManager`
     * first sees the window (`window-manager.ts`), never on a live-changed signal. */
    setSkipTaskbar(skipTaskbar: boolean): void {
        this.window.skipTaskbar = skipTaskbar;
    }
```

- [ ] **Step 4: Run the test to verify it passes**

`npm test -- window-adapter`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- window-adapter` passing
- [ ] No convention violations found

---

## Task 3: `ColumnRegistry.isEmpty()` and `ColumnRegistry.windows()`

**Files:**
- Modify: `src/runtime/column-registry.ts`
- Test: `src/runtime/column-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/column-registry.test.ts`, inside the existing `describe('ColumnRegistry', ...)` block:

```typescript
    it('reports empty only when it holds no columns', () => {
        const registry = new ColumnRegistry();
        expect(registry.isEmpty()).toBe(true);

        registry.set(1, fakeWindow('w1'), new SignalManager());
        expect(registry.isEmpty()).toBe(false);

        registry.delete(1);
        expect(registry.isEmpty()).toBe(true);
    });

    it('lists every registered window', () => {
        const registry = new ColumnRegistry();
        const w1 = fakeWindow('w1');
        const w2 = fakeWindow('w2');
        registry.set(1, w1, new SignalManager());
        registry.set(2, w2, new SignalManager());

        expect(registry.windows()).toEqual([w1, w2]);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

`npm test -- column-registry`
Expected: FAIL — `registry.isEmpty` and `registry.windows` are not functions yet.

- [ ] **Step 3: Implement `isEmpty()` and `windows()`**

Modify `src/runtime/column-registry.ts`, adding both methods after `columnOf`:

```typescript
    isEmpty(): boolean {
        return this.byColumn.size === 0;
    }

    windows(): WindowAdapter[] {
        return Array.from(this.byColumn.values(), (entry) => entry.window);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

`npm test -- column-registry`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- column-registry` passing
- [ ] No convention violations found

---

## Task 4: `Strip` additions — vertical render offset, `detachFocusedColumn`, `isEmpty`, `setSkipTaskbar`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip.test.ts`, inside the existing `describe('Strip', ...)` block (this file already has the `fakeWindow`/`fakeWorkspaceAdapter`/`fakeTimer` helpers shown above — reuse them):

```typescript
    it('renders a window shifted by the vertical offset passed to render()', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render(undefined, true, 1000);

        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: -1000 }));
    });

    it('defaults render() to no vertical offset', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
    });

    it('detachFocusedColumn removes the focused column and returns its window', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter); // focused
        strip.addWindow(win2.adapter); // becomes focused (added right of the focused column)

        const detached = strip.detachFocusedColumn();

        expect(detached).toBe(win2.adapter);
        expect(strip.isEmpty()).toBe(false); // win1's column remains
    });

    it('detachFocusedColumn returns null when the strip has no columns', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(strip.detachFocusedColumn()).toBeNull();
    });

    it('isEmpty reflects whether any window is registered', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(strip.isEmpty()).toBe(true);

        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        expect(strip.isEmpty()).toBe(false);

        strip.removeWindow(win.adapter);
        expect(strip.isEmpty()).toBe(true);
    });

    it('setSkipTaskbar toggles every window currently in the strip', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter);
        const setSkipTaskbar1 = vi.fn();
        const setSkipTaskbar2 = vi.fn();
        (win1.adapter as unknown as { setSkipTaskbar: typeof setSkipTaskbar1 }).setSkipTaskbar = setSkipTaskbar1;
        (win2.adapter as unknown as { setSkipTaskbar: typeof setSkipTaskbar2 }).setSkipTaskbar = setSkipTaskbar2;

        strip.setSkipTaskbar(true);

        expect(setSkipTaskbar1).toHaveBeenCalledWith(true);
        expect(setSkipTaskbar2).toHaveBeenCalledWith(true);
    });
```

Note: the last test attaches `setSkipTaskbar` spies directly to the fake adapter objects after creation, since the shared `fakeWindow()` helper in this file does not build it in — this avoids modifying the shared helper's shape for every other existing test in the file.

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip.test`
Expected: FAIL — `render()` ignores a third argument, `detachFocusedColumn`/`isEmpty`/`setSkipTaskbar` are not functions.

- [ ] **Step 3: Implement the changes**

Modify `src/runtime/strip.ts`.

Change `render`'s signature and both `geometrySync.apply` call sites (the hidden-column branch and the normal branch):

```typescript
    render(excludeWindowId?: string, instant = false, verticalOffsetY = 0): void {
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            const win = this.registry.get(column.id);
            if (!win || win.id === excludeWindowId || this.fullScreenColumns.has(column.id)) {
                continue;
            }
            const rect = this.grid.columnRect(column.id);
            if (column.hidden) {
                this.geometrySync.apply(win, rect, this.viewport.offset(), verticalOffsetY);
                continue;
            }
            let x: number;
            if (instant) {
                this.columnMotion.snapTo(column.id, rect.x);
                x = rect.x;
            } else {
                x = this.columnMotion.update(column.id, rect.x, Date.now(), this.settings.animationDurationMs);
            }
            this.geometrySync.apply(win, Object.assign({}, rect, { x }), this.viewport.offset(), verticalOffsetY);
        }
        if (this.columnMotion.isAnimating()) {
            this.columnMotionTimer.start(this.settings.animationTickMs, () =>
                this.render(excludeWindowId, false, verticalOffsetY),
            );
        } else {
            this.columnMotionTimer.stop();
        }
        setDebugState(
            formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()),
        );
    }
```

Refactor `removeWindow` to share cleanup with the new `detachFocusedColumn`, and add the three new methods. Replace the existing `removeWindow` method with:

```typescript
    removeWindow(win: WindowAdapter): void {
        const columnId = this.registry.columnOf(win.id);
        if (columnId === null) {
            return;
        }
        this.detachColumn(columnId, win);
    }

    /** Removes the focused column and returns its window, without touching the window's real
     * geometry — used when moving a window to a different row (docs:
     * 2026-09-01-row-navigation-design). Returns null if this row has no focused column. */
    detachFocusedColumn(): WindowAdapter | null {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return null;
        }
        const win = this.registry.get(focused.id);
        if (win === undefined) {
            return null;
        }
        this.detachColumn(focused.id, win);
        return win;
    }

    /** Shared teardown for `removeWindow` and `detachFocusedColumn`: forgets every
     * per-column tracking state and removes the column from the grid. */
    private detachColumn(columnId: number, win: WindowAdapter): void {
        this.registry.delete(columnId);
        this.geometrySync.forget(win.id);
        this.fullScreenColumns.delete(columnId);
        this.columnMotion.forget(columnId);
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }

    /** True when this row has no windows — used by row-pruning (docs:
     * 2026-09-01-row-navigation-design). */
    isEmpty(): boolean {
        return this.registry.isEmpty();
    }

    /** Toggles `skipTaskbar` on every window currently in this row — used while paging rows,
     * so an inactive row's windows don't clutter the taskbar (docs:
     * 2026-09-01-row-navigation-design). */
    setSkipTaskbar(skipTaskbar: boolean): void {
        for (const win of this.registry.windows()) {
            win.setSkipTaskbar(skipTaskbar);
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip.test`
Expected: PASS — including all pre-existing `Strip` tests (the `removeWindow` refactor must not change its observable behavior).

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- strip.test` passing (full file, not just the new cases)
- [ ] No convention violations found

---

## Task 5: `StripStack` core — row 0, delegation to the active row

**Files:**
- Create: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/strip-stack.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import type { Strip } from './strip';
import { StripStack, type StripFactory } from './strip-stack';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}

function fakeWorkspaceAdapter(): WorkspaceAdapter {
    return {} as unknown as WorkspaceAdapter;
}

interface FakeStrip {
    strip: Strip;
    addWindow: ReturnType<typeof vi.fn>;
    removeWindow: ReturnType<typeof vi.fn>;
    activateWindow: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    focusLeft: ReturnType<typeof vi.fn>;
    focusRight: ReturnType<typeof vi.fn>;
    cycleAlignLeft: ReturnType<typeof vi.fn>;
    cycleAlignRight: ReturnType<typeof vi.fn>;
    shiftViewportLeft: ReturnType<typeof vi.fn>;
    shiftViewportRight: ReturnType<typeof vi.fn>;
    minimapSnapshot: ReturnType<typeof vi.fn>;
    detachFocusedColumn: ReturnType<typeof vi.fn>;
    isEmpty: ReturnType<typeof vi.fn>;
    setSkipTaskbar: ReturnType<typeof vi.fn>;
}

function fakeStrip(): FakeStrip {
    const fns = {
        addWindow: vi.fn(),
        removeWindow: vi.fn(),
        activateWindow: vi.fn(),
        render: vi.fn(),
        focusLeft: vi.fn(),
        focusRight: vi.fn(),
        cycleAlignLeft: vi.fn(),
        cycleAlignRight: vi.fn(),
        shiftViewportLeft: vi.fn(),
        shiftViewportRight: vi.fn(),
        minimapSnapshot: vi.fn(() => ({ columns: [] })),
        detachFocusedColumn: vi.fn(() => null),
        isEmpty: vi.fn(() => true),
        setSkipTaskbar: vi.fn(),
    };
    const strip = { ...fns } as unknown as Strip;
    return { strip, ...fns };
}

function recordingFactory(): { factory: StripFactory; created: FakeStrip[] } {
    const created: FakeStrip[] = [];
    const factory: StripFactory = () => {
        const fake = fakeStrip();
        created.push(fake);
        return fake.strip;
    };
    return { factory, created };
}

function fakeWin(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

function makeStack() {
    const { factory, created } = recordingFactory();
    const stack = new StripStack(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(), factory);
    return { stack, created };
}

describe('StripStack', () => {
    it('creates row 0 eagerly', () => {
        const { created } = makeStack();
        expect(created).toHaveLength(1);
    });

    it('routes addWindow to the active row (row 0 initially)', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');

        stack.addWindow(win);

        expect(created[0].addWindow).toHaveBeenCalledWith(win);
    });

    it('routes removeWindow to the row that owns the window', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.removeWindow(win);

        expect(created[0].removeWindow).toHaveBeenCalledWith(win);
    });

    it('ignores removeWindow for an unowned window', () => {
        const { stack, created } = makeStack();

        expect(() => stack.removeWindow(fakeWin('ghost'))).not.toThrow();
        expect(created[0].removeWindow).not.toHaveBeenCalled();
    });

    it('delegates render, focusLeft/Right, cycleAlign, shiftViewport, and minimapSnapshot to the active row', () => {
        const { stack, created } = makeStack();

        stack.render();
        stack.focusLeft();
        stack.focusRight();
        stack.cycleAlignLeft();
        stack.cycleAlignRight();
        stack.shiftViewportLeft();
        stack.shiftViewportRight();
        stack.minimapSnapshot();

        expect(created[0].render).toHaveBeenCalled();
        expect(created[0].focusLeft).toHaveBeenCalled();
        expect(created[0].focusRight).toHaveBeenCalled();
        expect(created[0].cycleAlignLeft).toHaveBeenCalled();
        expect(created[0].cycleAlignRight).toHaveBeenCalled();
        expect(created[0].shiftViewportLeft).toHaveBeenCalled();
        expect(created[0].shiftViewportRight).toHaveBeenCalled();
        expect(created[0].minimapSnapshot).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip-stack`
Expected: FAIL — `./strip-stack` does not exist yet.

- [ ] **Step 3: Create `StripStack`**

Create `src/runtime/strip-stack.ts`:

```typescript
// One (activity, virtualDesktop) pair's full vertical stack of rows: an ordered set of
// independent Strips (each one row, unchanged), paged between via a Drift-native vertical
// camera. Row 0 always exists; rows above/below are created lazily and pruned once empty
// (docs: 2026-09-01-row-navigation-design).
//
// Owns the one SharedTicker for every row it creates plus its own vertical Animator — see
// the "Important Implementation Note" in docs/agents/plans/2026-09-01-row-navigation.md for
// why this can't be left to each row's own Strip constructor.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { MinimapSnapshot } from '../ui/minimap';
import { Animator, type Timer } from '../viewport/animator';
import { SharedTicker } from '../viewport/shared-ticker';
import { Strip } from './strip';

export type StripFactory = (area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) => Strip;

export class StripStack {
    private readonly rows = new Map<number, Strip>();
    private readonly rowByWindow = new Map<string, number>();
    private readonly ticker: SharedTicker;
    private readonly verticalAnimator: Animator;
    private activeRowIndex = 0;
    private transitionRows: [number, number] = [0, 0];

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (area, settings, timer, workspaceAdapter) =>
            new Strip(area, settings, timer, workspaceAdapter),
    ) {
        this.ticker = new SharedTicker(timer, settings.animationTickMs);
        this.verticalAnimator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            settings.animationTickMs,
            (cameraY) => this.applyVerticalOffset(cameraY),
        );
        this.row(0);
    }

    addWindow(win: WindowAdapter): void {
        this.activeStripInstance().addWindow(win);
        this.rowByWindow.set(win.id, this.activeRowIndex);
    }

    removeWindow(win: WindowAdapter): void {
        const rowIndex = this.rowByWindow.get(win.id);
        if (rowIndex === undefined) {
            return;
        }
        this.requireRow(rowIndex).removeWindow(win);
        this.rowByWindow.delete(win.id);
        this.pruneIfEmpty(rowIndex);
    }

    render(): void {
        this.activeStripInstance().render();
    }

    focusLeft(): void {
        this.activeStripInstance().focusLeft();
    }

    focusRight(): void {
        this.activeStripInstance().focusRight();
    }

    cycleAlignLeft(): void {
        this.activeStripInstance().cycleAlignLeft();
    }

    cycleAlignRight(): void {
        this.activeStripInstance().cycleAlignRight();
    }

    shiftViewportLeft(): void {
        this.activeStripInstance().shiftViewportLeft();
    }

    shiftViewportRight(): void {
        this.activeStripInstance().shiftViewportRight();
    }

    minimapSnapshot(): MinimapSnapshot {
        return this.activeStripInstance().minimapSnapshot();
    }

    private activeStripInstance(): Strip {
        return this.row(this.activeRowIndex);
    }

    /** Row 0 always exists; other rows are created lazily on first access. */
    private row(index: number): Strip {
        let strip = this.rows.get(index);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.ticker.subscribe(), this.workspaceAdapter);
            this.rows.set(index, strip);
        }
        return strip;
    }

    private requireRow(index: number): Strip {
        const strip = this.rows.get(index);
        if (strip === undefined) {
            throw new Error(`Unknown row index: ${index}`);
        }
        return strip;
    }

    private pruneIfEmpty(index: number): void {
        if (index === 0 || index === this.activeRowIndex) {
            return; // row 0 is never pruned; you can't prune the row you're standing in
        }
        const strip = this.rows.get(index);
        if (strip === undefined || !strip.isEmpty()) {
            return;
        }
        this.rows.delete(index);
    }

    private applyVerticalOffset(cameraY: number): void {
        for (const rowIndex of this.transitionRows) {
            this.rows.get(rowIndex)?.render(undefined, false, cameraY - rowIndex * this.area.height);
        }
    }
}
```

`Strip` doesn't export a `MinimapSnapshot` type itself — check `src/ui/minimap.ts` exports `MinimapSnapshot` (it does, per `strip.ts`'s own `import { buildMinimapSnapshot, type MinimapSnapshot } from '../ui/minimap';`) — the import above matches that existing export.

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip-stack`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- strip-stack` passing
- [ ] No convention violations found

---

## Task 6: `StripStack` row paging — `rowUp`/`rowDown`, vertical animation, `skipTaskbar` toggling

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip-stack.test.ts`. First, extend `ManualTimer`-style control: replace the `fakeTimer()` helper at the top of the file with a manual, tick-capturing one (needed to assert on in-flight animation state), and add a new `describe` block. Replace the existing `fakeTimer` function with:

```typescript
class ManualTimer implements Timer {
    private onTick: (() => void) | null = null;

    start(_intervalMs: number, onTick: () => void): void {
        this.onTick = onTick;
    }

    stop(): void {
        this.onTick = null;
    }

    fire(): void {
        this.onTick?.();
    }
}

function fakeTimer(): ManualTimer {
    return new ManualTimer();
}
```

Update `makeStack` to accept and default an `animationDurationMs` override, and to return the timer so tests can fire ticks:

```typescript
function makeStack(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const { factory, created } = recordingFactory();
    const timer = fakeTimer();
    const stack = new StripStack(
        AREA,
        { ...DEFAULT_SETTINGS, ...settingsOverride },
        timer,
        fakeWorkspaceAdapter(),
        factory,
    );
    return { stack, created, timer };
}
```

Then add:

```typescript
describe('StripStack row paging', () => {
    it('rowUp is a no-op at row 0', () => {
        const { stack, created } = makeStack();

        stack.rowUp();
        stack.render();

        expect(created).toHaveLength(1); // still only row 0
        expect(created[0].render).toHaveBeenCalled(); // render() still targets row 0
    });

    it('rowDown creates row 1 and makes it active', () => {
        const { stack, created } = makeStack();

        stack.rowDown();
        stack.render();

        expect(created).toHaveLength(2);
        expect(created[1].render).toHaveBeenCalled(); // render() now targets row 1
        expect(created[0].render).not.toHaveBeenCalled();
    });

    it('rowUp after rowDown returns to row 0', () => {
        const { stack, created } = makeStack();
        stack.rowDown();

        stack.rowUp();
        stack.render();

        expect(created[0].render).toHaveBeenCalled();
    });

    it('animates the vertical transition, rendering both the outgoing and incoming row on each tick', () => {
        const { stack, created, timer } = makeStack({ animationDurationMs: 100 });

        stack.rowDown();
        timer.fire();

        expect(created[0].render).toHaveBeenCalledWith(undefined, false, expect.any(Number));
        expect(created[1].render).toHaveBeenCalledWith(undefined, false, expect.any(Number));
    });

    it('sets skipTaskbar(true) on the outgoing row and skipTaskbar(false) on the incoming row', () => {
        const { stack, created } = makeStack();

        stack.rowDown();

        expect(created[0].setSkipTaskbar).toHaveBeenCalledWith(true);
        expect(created[1].setSkipTaskbar).toHaveBeenCalledWith(false);
    });

    it('snaps every other row to its resting offset instantly when paging', () => {
        const { stack, created } = makeStack();
        stack.rowDown(); // row 1 active
        stack.rowDown(); // row 2 active, row 0 and row 1 both now "other"
        created[0].render.mockClear();
        created[1].render.mockClear();

        stack.rowDown(); // row 3 active

        expect(created[0].render).toHaveBeenCalledWith(undefined, true, expect.any(Number));
        expect(created[1].render).toHaveBeenCalledWith(undefined, true, expect.any(Number));
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip-stack`
Expected: FAIL — `stack.rowUp`/`stack.rowDown` are not functions yet.

- [ ] **Step 3: Implement `rowUp`, `rowDown`, `switchToRow`, `snapRestingRows`**

Modify `src/runtime/strip-stack.ts`, adding these public methods (near `shiftViewportRight`):

```typescript
    rowUp(): void {
        if (this.activeRowIndex === 0) {
            return;
        }
        this.switchToRow(this.activeRowIndex - 1);
    }

    rowDown(): void {
        this.switchToRow(this.activeRowIndex + 1);
    }
```

And these private methods (near `applyVerticalOffset`):

```typescript
    private switchToRow(newIndex: number): void {
        const oldIndex = this.activeRowIndex;
        if (newIndex === oldIndex) {
            return;
        }
        this.row(newIndex); // ensure the target row exists before anything below touches it
        this.activeRowIndex = newIndex;
        this.snapRestingRows(oldIndex, newIndex);
        this.rows.get(oldIndex)?.setSkipTaskbar(true);
        this.rows.get(newIndex)?.setSkipTaskbar(false);
        this.transitionRows = [oldIndex, newIndex];
        this.verticalAnimator.animate(
            oldIndex * this.area.height,
            newIndex * this.area.height,
            this.settings.animationDurationMs,
        );
        this.pruneIfEmpty(oldIndex);
    }

    /** Snaps every row except the outgoing/incoming pair straight to its resting offset
     * relative to the new active row — those rows are off-screen the whole transition, so
     * jumping directly to the final position (rather than animating) is visually identical
     * and avoids a per-tick render for rows nobody can see move. */
    private snapRestingRows(oldIndex: number, newIndex: number): void {
        const targetCameraY = newIndex * this.area.height;
        for (const [rowIndex, strip] of this.rows) {
            if (rowIndex === oldIndex || rowIndex === newIndex) {
                continue;
            }
            strip.render(undefined, true, targetCameraY - rowIndex * this.area.height);
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip-stack`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- strip-stack` passing
- [ ] No convention violations found

---

## Task 7: `StripStack.moveWindowToRowAbove`/`moveWindowToRowBelow`

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip-stack.test.ts`:

```typescript
describe('StripStack.moveWindowToRowAbove/Below', () => {
    it('moveWindowToRowAbove is a no-op at row 0', () => {
        const { stack, created } = makeStack();

        stack.moveWindowToRowAbove();

        expect(created).toHaveLength(1); // no row -1 created
    });

    it('moveWindowToRowAbove is a no-op when the active row has no focused window', () => {
        const { stack, created } = makeStack();
        stack.rowDown(); // row 1 active, empty
        created[1].detachFocusedColumn.mockReturnValue(null);

        stack.moveWindowToRowAbove();

        expect(created).toHaveLength(2); // no row -1... wait, row 0 already exists; assert no throw and no move
        expect(created[0].addWindow).not.toHaveBeenCalled();
    });

    it('moveWindowToRowBelow detaches the focused window from the active row, adds it to the row below, and follows it', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue(win);

        stack.moveWindowToRowBelow();
        stack.render();

        expect(created[0].detachFocusedColumn).toHaveBeenCalled();
        expect(created[1].addWindow).toHaveBeenCalledWith(win);
        expect(created[1].render).toHaveBeenCalled(); // row 1 is now active
    });

    it('prunes the source row if moving its last window empties it', () => {
        const { stack, created } = makeStack();
        stack.rowDown(); // row 1 active
        const win = fakeWin('w1');
        created[1].detachFocusedColumn.mockReturnValue(win);
        created[1].isEmpty.mockReturnValue(true);

        stack.moveWindowToRowAbove(); // moves win from row 1 back to row 0, row 1 empties
        stack.rowDown(); // page back toward row 1 to prove it was pruned and recreated empty

        expect(created).toHaveLength(3); // row 0, the original (now-pruned) row 1, and a fresh row 1
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip-stack`
Expected: FAIL — `moveWindowToRowAbove`/`moveWindowToRowBelow` are not functions yet.

- [ ] **Step 3: Implement the move methods**

Modify `src/runtime/strip-stack.ts`, adding these public methods (near `rowDown`):

```typescript
    moveWindowToRowAbove(): void {
        this.moveFocusedWindowToRow(this.activeRowIndex - 1);
    }

    moveWindowToRowBelow(): void {
        this.moveFocusedWindowToRow(this.activeRowIndex + 1);
    }
```

And this private method (near `switchToRow`):

```typescript
    private moveFocusedWindowToRow(targetIndex: number): void {
        if (targetIndex < 0) {
            return;
        }
        const sourceIndex = this.activeRowIndex;
        const win = this.requireRow(sourceIndex).detachFocusedColumn();
        if (win === null) {
            return;
        }
        this.rowByWindow.delete(win.id);
        const targetStrip = this.row(targetIndex);
        targetStrip.addWindow(win);
        this.rowByWindow.set(win.id, targetIndex);
        this.switchToRow(targetIndex);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip-stack`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- strip-stack` passing
- [ ] No convention violations found

---

## Task 8: `StripStack.activateWindow` — cross-row auto-paging

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip-stack.test.ts`:

```typescript
describe('StripStack.activateWindow', () => {
    it('activates a window already in the active row without paging', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.activateWindow(win);

        expect(created[0].activateWindow).toHaveBeenCalledWith(win);
        expect(created).toHaveLength(1); // no new row created/switched to
    });

    it('pages to the owning row before activating a window parked in an inactive row', () => {
        const { stack, created } = makeStack();
        stack.rowDown(); // row 1 active
        const win = fakeWin('w1');
        stack.addWindow(win); // lands in row 1
        stack.rowUp(); // back to row 0; win is now in an inactive row

        stack.activateWindow(win);
        stack.render();

        expect(created[1].activateWindow).toHaveBeenCalledWith(win);
        expect(created[0].render).not.toHaveBeenCalled(); // active row is now 1
        expect(created[1].render).toHaveBeenCalled();
    });

    it('ignores activation of an unowned window', () => {
        const { stack, created } = makeStack();

        expect(() => stack.activateWindow(fakeWin('ghost'))).not.toThrow();
        expect(created[0].activateWindow).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip-stack`
Expected: FAIL — `stack.activateWindow` is not a function yet.

- [ ] **Step 3: Implement `activateWindow`**

Modify `src/runtime/strip-stack.ts`, adding this public method (near `removeWindow`):

```typescript
    /** Activates `win` wherever it is, paging to its row first if it isn't the active one —
     * extends Strip's existing "every focus change triggers a reveal" model up one level, so
     * an off-screen window activated externally (taskbar, Alt-Tab, a notification) doesn't
     * silently take KWin focus while parked off-screen (docs: 2026-09-01-row-navigation-design). */
    activateWindow(win: WindowAdapter): void {
        const rowIndex = this.rowByWindow.get(win.id);
        if (rowIndex === undefined) {
            return;
        }
        if (rowIndex !== this.activeRowIndex) {
            this.switchToRow(rowIndex);
        }
        this.requireRow(rowIndex).activateWindow(win);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip-stack`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- strip-stack` passing (run the full file — all tasks 5-8 together)
- [ ] No convention violations found

---

## Task 9: `StripManager` holds `StripStack` instead of `Strip`

**Files:**
- Modify: `src/runtime/strip-manager.ts`
- Modify: `src/runtime/strip-manager.test.ts`

- [ ] **Step 1: Update the test file's fakes and expectations**

Replace the full contents of `src/runtime/strip-manager.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import type { StripStack } from './strip-stack';
import { StripManager, type StripStackFactory } from './strip-manager';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}

function fakeWorkspaceAdapter(activity: string, desktop: string): WorkspaceAdapter {
    return {
        currentActivity: () => activity,
        currentDesktop: () => desktop,
    } as unknown as WorkspaceAdapter;
}

interface FakeStripStack {
    stack: StripStack;
    addWindow: ReturnType<typeof vi.fn>;
    removeWindow: ReturnType<typeof vi.fn>;
    activateWindow: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
}

function fakeStripStack(): FakeStripStack {
    const addWindow = vi.fn();
    const removeWindow = vi.fn();
    const activateWindow = vi.fn();
    const render = vi.fn();
    const stack = { addWindow, removeWindow, activateWindow, render } as unknown as StripStack;
    return { stack, addWindow, removeWindow, activateWindow, render };
}

function recordingFactory(): { factory: StripStackFactory; created: FakeStripStack[] } {
    const created: FakeStripStack[] = [];
    const factory: StripStackFactory = () => {
        const fake = fakeStripStack();
        created.push(fake);
        return fake.stack;
    };
    return { factory, created };
}

function fakeWin(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

function makeManager(activity = 'a', desktop = 'd1') {
    const { factory, created } = recordingFactory();
    const manager = new StripManager(
        AREA,
        DEFAULT_SETTINGS,
        fakeTimer(),
        fakeWorkspaceAdapter(activity, desktop),
        factory,
    );
    return { manager, created };
}

describe('StripManager', () => {
    it('routes windows for different (activity, desktop) to separate strip stacks', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        const w2 = fakeWin('w2');

        manager.addTo('a', 'd1', w1);
        manager.addTo('a', 'd2', w2);

        expect(created).toHaveLength(2);
        expect(created[0].addWindow).toHaveBeenCalledWith(w1);
        expect(created[1].addWindow).toHaveBeenCalledWith(w2);
    });

    it('reuses the same strip stack for the same key', () => {
        const { manager, created } = makeManager();

        manager.addTo('a', 'd1', fakeWin('w1'));
        manager.addTo('a', 'd1', fakeWin('w2'));

        expect(created).toHaveLength(1);
        expect(created[0].addWindow).toHaveBeenCalledTimes(2);
    });

    it('activeStripStack follows the workspace current activity and desktop', () => {
        const { manager } = makeManager('a', 'd1');

        const active = manager.activeStripStack();

        expect(manager.stripStackFor('a', 'd1')).toBe(active);
    });

    it('records ownership and routes removal to the owning strip stack', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        expect(manager.ownerOf('w1')).toBe('a|d1');

        manager.remove(w1);

        expect(created[0].removeWindow).toHaveBeenCalledWith(w1);
        expect(manager.ownerOf('w1')).toBeNull();
    });

    it('ignores removal of an unmanaged window', () => {
        const { manager, created } = makeManager();

        expect(() => manager.remove(fakeWin('ghost'))).not.toThrow();
        expect(created).toHaveLength(0);
    });

    it('routes activation to the owning strip stack', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        manager.activate(w1);

        expect(created[0].activateWindow).toHaveBeenCalledWith(w1);
    });

    it('prunes strip stacks whose activity or desktop disappeared and clears their ownership', () => {
        const { manager, created } = makeManager();
        manager.addTo('a', 'd1', fakeWin('w1'));
        manager.addTo('b', 'd1', fakeWin('w2'));
        const countBefore = created.length;

        manager.prune(new Set(['a']), new Set(['d1']));

        expect(manager.ownerOf('w1')).toBe('a|d1');
        expect(manager.ownerOf('w2')).toBeNull();

        manager.stripStackFor('b', 'd1');
        expect(created.length).toBe(countBefore + 1);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip-manager`
Expected: FAIL — `strip-manager.ts` still exports the old `Strip`-keyed shape (`stripFor`/`activeStrip`/`StripFactory`).

- [ ] **Step 3: Rewrite `StripManager`**

Replace the full contents of `src/runtime/strip-manager.ts`:

```typescript
// Owns one StripStack per (activity, virtualDesktop) pair and tracks which strip stack
// owns each window. Grids always span all screens, so screen is not part of the key.
// activeStripStack() follows the workspace's current activity/desktop; strip stacks are
// created lazily and pruned when their activity or desktop disappears.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { StripStack } from './strip-stack';

export type StripStackFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
) => StripStack;

export class StripManager {
    private readonly stacks = new Map<string, StripStack>();
    private readonly ownerByWindow = new Map<string, string>();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        private readonly timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStripStack: StripStackFactory = (area, settings, timer, workspaceAdapter) =>
            new StripStack(area, settings, timer, workspaceAdapter),
    ) {}

    keyOf(activity: string, desktop: string): string {
        return `${activity}|${desktop}`;
    }

    stripStackFor(activity: string, desktop: string): StripStack {
        return this.stack(this.keyOf(activity, desktop));
    }

    activeStripStack(): StripStack {
        return this.stripStackFor(this.workspaceAdapter.currentActivity(), this.workspaceAdapter.currentDesktop());
    }

    ownerOf(windowId: string): string | null {
        return this.ownerByWindow.get(windowId) ?? null;
    }

    addTo(activity: string, desktop: string, win: WindowAdapter): void {
        const key = this.keyOf(activity, desktop);
        this.stack(key).addWindow(win);
        this.ownerByWindow.set(win.id, key);
    }

    remove(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.stacks.get(key)?.removeWindow(win);
        this.ownerByWindow.delete(win.id);
    }

    activate(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.stacks.get(key)?.activateWindow(win);
    }

    renderActive(): void {
        this.activeStripStack().render();
    }

    prune(validActivities: ReadonlySet<string>, validDesktops: ReadonlySet<string>): void {
        for (const key of Array.from(this.stacks.keys())) {
            const [activity, desktop] = key.split('|');
            if (validActivities.has(activity) && validDesktops.has(desktop)) {
                continue;
            }
            this.stacks.delete(key);
            for (const [windowId, owner] of Array.from(this.ownerByWindow)) {
                if (owner === key) {
                    this.ownerByWindow.delete(windowId);
                }
            }
        }
    }

    private stack(key: string): StripStack {
        let stack = this.stacks.get(key);
        if (stack === undefined) {
            stack = this.createStripStack(this.area, this.settings, this.timer, this.workspaceAdapter);
            this.stacks.set(key, stack);
        }
        return stack;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip-manager`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] TypeScript guidelines followed
- [ ] `npm test -- strip-manager` passing
- [ ] No convention violations found

---

## Task 10: Settings, config XML, shortcuts, and `Controller` wiring

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/config/settings.test.ts`
- Modify: `drift/contents/config/main.xml`
- Modify: `src/input/shortcuts.ts`
- Modify: `src/runtime/controller.ts`

This task has no failing-test-first step for `shortcuts.ts`/`controller.ts`/`main.xml`, matching the existing project pattern: `input/shortcuts.ts` has no test file today (thin KWin QML-wiring code, same rationale as `kwin/` adapters — see `docs/architecture.md`'s module map), and `main.xml`/`controller.ts` wiring is verified by `npm run build` and manual smoke-testing (Step 5), not unit tests. `config/settings.ts` does have a test file and gets a proper TDD step.

- [ ] **Step 1: Write the failing test for the new settings**

Read `src/config/settings.test.ts` first to match its exact existing style before adding, then add a new case inside its top-level `describe` block (mirroring however the existing shortcut defaults are asserted there) asserting the four new keys:

```typescript
    it('defaults the four row-navigation shortcuts', () => {
        expect(DEFAULT_SETTINGS.shortcutRowUp).toBe('Meta+Page_Up');
        expect(DEFAULT_SETTINGS.shortcutRowDown).toBe('Meta+Page_Down');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToRowAbove).toBe('Meta+Shift+Page_Up');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToRowBelow).toBe('Meta+Shift+Page_Down');
    });
```

- [ ] **Step 2: Run the test to verify it fails**

`npm test -- settings`
Expected: FAIL — `DEFAULT_SETTINGS.shortcutRowUp` and its siblings are `undefined`.

- [ ] **Step 3: Add the four settings fields**

Modify `src/config/settings.ts`. Add to the `Settings` interface, after `shortcutViewportShiftRight`:

```typescript
    /** Shortcut sequence for paging to the row above (docs: 2026-09-01-row-navigation-design). */
    shortcutRowUp: string;
    /** Shortcut sequence for paging to the row below. */
    shortcutRowDown: string;
    /** Shortcut sequence for moving the focused window to the row above and following it there. */
    shortcutMoveWindowToRowAbove: string;
    /** Shortcut sequence for moving the focused window to the row below and following it there. */
    shortcutMoveWindowToRowBelow: string;
```

Add to `DEFAULT_SETTINGS`, after `shortcutViewportShiftRight`:

```typescript
    shortcutRowUp: 'Meta+Page_Up',
    shortcutRowDown: 'Meta+Page_Down',
    shortcutMoveWindowToRowAbove: 'Meta+Shift+Page_Up',
    shortcutMoveWindowToRowBelow: 'Meta+Shift+Page_Down',
```

Add to `loadSettings`'s `Object.assign` call, after `shortcutViewportShiftRight`'s entry:

```typescript
        shortcutRowUp: readStringConfig('shortcutRowUp', DEFAULT_SETTINGS.shortcutRowUp),
        shortcutRowDown: readStringConfig('shortcutRowDown', DEFAULT_SETTINGS.shortcutRowDown),
        shortcutMoveWindowToRowAbove: readStringConfig(
            'shortcutMoveWindowToRowAbove',
            DEFAULT_SETTINGS.shortcutMoveWindowToRowAbove,
        ),
        shortcutMoveWindowToRowBelow: readStringConfig(
            'shortcutMoveWindowToRowBelow',
            DEFAULT_SETTINGS.shortcutMoveWindowToRowBelow,
        ),
```

- [ ] **Step 4: Run the test to verify it passes**

`npm test -- settings`
Expected: PASS

- [ ] **Step 5: Wire the KConfigXT entries, shortcuts, and Controller (build-verified, not unit-tested)**

Modify `drift/contents/config/main.xml`, adding after the `shortcutViewportShiftRight` entry, before `</group>`:

```xml
        <entry name="shortcutRowUp" type="String">
            <default>Meta+Page_Up</default>
        </entry>
        <entry name="shortcutRowDown" type="String">
            <default>Meta+Page_Down</default>
        </entry>
        <entry name="shortcutMoveWindowToRowAbove" type="String">
            <default>Meta+Shift+Page_Up</default>
        </entry>
        <entry name="shortcutMoveWindowToRowBelow" type="String">
            <default>Meta+Shift+Page_Down</default>
        </entry>
```

Modify `src/input/shortcuts.ts`. Extend `ShortcutActions`:

```typescript
export interface ShortcutActions {
    focusLeft(): void;
    focusRight(): void;
    toggleDebugConsole(): void;
    cycleAlignLeft(): void;
    cycleAlignRight(): void;
    shiftViewportLeft(): void;
    shiftViewportRight(): void;
    rowUp(): void;
    rowDown(): void;
    moveWindowToRowAbove(): void;
    moveWindowToRowBelow(): void;
}
```

Add to `registerShortcuts`, after the existing `DriftViewportShiftRight` call:

```typescript
    createShortcut(parent, 'DriftRowUp', 'Drift: Page Row Up', settings.shortcutRowUp, actions.rowUp);
    createShortcut(parent, 'DriftRowDown', 'Drift: Page Row Down', settings.shortcutRowDown, actions.rowDown);
    createShortcut(
        parent,
        'DriftMoveWindowToRowAbove',
        'Drift: Move Window To Row Above',
        settings.shortcutMoveWindowToRowAbove,
        actions.moveWindowToRowAbove,
    );
    createShortcut(
        parent,
        'DriftMoveWindowToRowBelow',
        'Drift: Move Window To Row Below',
        settings.shortcutMoveWindowToRowBelow,
        actions.moveWindowToRowBelow,
    );
```

Modify `src/runtime/controller.ts`:

Change the `import type { Strip } from './strip';` line to:

```typescript
import type { StripStack } from './strip-stack';
```

Change `focusAndShowMinimap`'s parameter type from `(strip: Strip) => void` to `(stack: StripStack) => void`, and its body to match the renamed variable:

```typescript
    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        move(stack);
        const snapshot = stack.minimapSnapshot();
        if (!snapshot.columns.some((column) => column.focused)) {
            return;
        }
        this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    }
```

Update every call inside `start()`'s `registerShortcuts(...)` that referenced `strip` to use `stack` instead (`focusLeft`/`focusRight` callbacks), and add the four new actions:

```typescript
        registerShortcuts(this.root, this.settings, {
            focusLeft: () => this.focusAndShowMinimap((stack) => stack.focusLeft()),
            focusRight: () => this.focusAndShowMinimap((stack) => stack.focusRight()),
            toggleDebugConsole: () => this.debugConsole.toggle(),
            cycleAlignLeft: () => this.stripManager.activeStripStack().cycleAlignLeft(),
            cycleAlignRight: () => this.stripManager.activeStripStack().cycleAlignRight(),
            shiftViewportLeft: () => this.stripManager.activeStripStack().shiftViewportLeft(),
            shiftViewportRight: () => this.stripManager.activeStripStack().shiftViewportRight(),
            rowUp: () => this.focusAndShowMinimap((stack) => stack.rowUp()),
            rowDown: () => this.focusAndShowMinimap((stack) => stack.rowDown()),
            moveWindowToRowAbove: () => this.focusAndShowMinimap((stack) => stack.moveWindowToRowAbove()),
            moveWindowToRowBelow: () => this.focusAndShowMinimap((stack) => stack.moveWindowToRowBelow()),
        });
```

Verify:

`npm test` (full suite) — Expected: PASS
`npm run build` — Expected: succeeds, confirms `main.xml` and the TypeScript wiring are all consistent
`npm run lint` — Expected: no new errors

- [ ] **Step 6: Coding-guideline follow-up checklist**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (shortcut identifiers `DriftRowUp` etc. match the existing `DriftFocusLeft`-style naming)
- [ ] TypeScript/QML/XML guidelines followed
- [ ] `npm test`, `npm run build`, `npm run lint` all passing
- [ ] No convention violations found

---

## Task 11: Full verification and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

```bash
npm test
npm run lint
npm run build
```

Expected: all three succeed with no failures and no new lint errors.

- [ ] **Step 2: Manual smoke test (requires a running KWin/Plasma session — cannot be automated)**

Install the built package and, with a couple of windows open on one desktop:

1. Press the `rowDown` shortcut (`Meta+Page_Down` by default). Confirm the current windows slide up and out, and the screen goes empty (a new, empty row 1 was created and is now active).
2. Open a new window. Confirm it appears in row 1, not row 0.
3. Press `rowUp` (`Meta+Page_Up`). Confirm the original row 0 windows slide back into view from the top, and the new window from row 1 is gone from view.
4. Focus a window in row 0, press `moveWindowToRowBelow` (`Meta+Shift+Page_Down`). Confirm the view pages down to row 1 along with the moved window, and it now sits alongside the window opened in Step 2.
5. Open the KDE taskbar/task manager widget. Confirm only the currently-visible row's windows are listed — page rows and confirm the taskbar list changes to match.
6. Alt-Tab while another row has windows open. Confirm the known, accepted limitation from the design doc: those windows may appear in the switcher positioned off-screen. This is expected, not a regression to chase in this task.
7. Close the only window in a non-zero row, then page away from it and back. Confirm the row was pruned (a fresh empty row, not the same one) — e.g. by opening a window there and confirming it's the only one present.

- [ ] **Step 3: Record results**

Note any deviations from the expected behavior above before considering this plan complete.

---

## Execution Handoff

Plan complete and saved to `docs/agents/plans/2026-09-01-row-navigation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
