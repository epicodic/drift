# Cross-Row Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a tiled window past the screen's top/bottom edge to move it into the row above/below, mirroring the existing keyboard shortcuts (`moveWindowToRowAbove`/`Below`) but mouse-driven.

**Architecture:** A new pure-logic `EdgeDwell` timer (mirroring `Animator`) watches the dragged window's vertical position via a hook threaded through the existing `registerDragReorder`/`Strip.addWindow` chain, and fires into `StripStack`, which reparents the window into the target row using the same detach/`switchToRow`/add sequence the keyboard shortcuts already use — extended with an `initiallyDragging` flag (so live reordering and release-snap keep working in the new row) and an `excludeWindowId` (so the row-transition animation never touches the still-being-dragged window's real geometry).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-02-cross-row-drag-design.md` — read before implementing

---

### Task 1: `edgeDirection` pure function

**Files:**
- Modify: `src/core/coordinates.ts`
- Test: `src/core/coordinates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/coordinates.test.ts` (new `import` for `edgeDirection` alongside the existing ones):

```typescript
import { virtualWidth, columnRect, resizedEdge, rectsEqualRounded, edgeDirection } from './coordinates';

describe('edgeDirection', () => {
    const area = { x: 0, y: 100, width: 1920, height: 1000 };

    it('is null when the rect is fully within the area vertically', () => {
        expect(edgeDirection({ x: 0, y: 150, width: 800, height: 500 }, area)).toBeNull();
    });

    it('reports "above" when the top edge crosses above the area', () => {
        expect(edgeDirection({ x: 0, y: 50, width: 800, height: 500 }, area)).toBe('above');
    });

    it('reports "below" when the bottom edge crosses below the area', () => {
        expect(edgeDirection({ x: 0, y: 700, width: 800, height: 500 }, area)).toBe('below');
    });

    it('prefers "above" when a rect somehow spans past both edges', () => {
        expect(edgeDirection({ x: 0, y: 50, width: 800, height: 2000 }, area)).toBe('above');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- coordinates.test.ts`
Expected: FAIL — `edgeDirection` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

Add to `src/core/coordinates.ts`, after `rectsEqualRounded`:

```typescript
export type EdgeDirection = 'above' | 'below';

/** Which screen edge, if any, `rect` has crossed past within `area`'s vertical bounds — used
 * to detect a window dragged past the strip's top/bottom edge, the trigger for a cross-row
 * drag (docs: 2026-09-02-cross-row-drag-design). `null` when `rect` is still fully within
 * `area` vertically. */
export function edgeDirection(rect: Rect, area: Rect): EdgeDirection | null {
    if (rect.y < area.y) {
        return 'above';
    }
    if (rect.y + rect.height > area.y + area.height) {
        return 'below';
    }
    return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- coordinates.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming: `edgeDirection`/`EdgeDirection` follow `camelCase`/`PascalCase`
- [ ] `Rect`/pure-function style matches the rest of `coordinates.ts` (no KWin dependency)
- [ ] `npm test -- coordinates.test.ts` passes
- [ ] No convention violations found

---

### Task 2: `EdgeDwell` pure-logic timer

**Files:**
- Create: `src/viewport/edge-dwell.ts`
- Test: `src/viewport/edge-dwell.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/viewport/edge-dwell.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Timer } from './animator';
import { EdgeDwell } from './edge-dwell';

class FakeTimer implements Timer {
    started = false;
    stopped = false;
    private onTick: (() => void) | null = null;

    start(_intervalMs: number, onTick: () => void): void {
        this.started = true;
        this.stopped = false;
        this.onTick = onTick;
    }

    stop(): void {
        this.stopped = true;
        this.onTick = null;
    }

    fire(): void {
        this.onTick?.();
    }
}

describe('EdgeDwell', () => {
    it('does not fire before the dwell duration elapses', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(timer, () => clock, 16, 100, (direction) => fired.push(direction));

        dwell.update('above');
        clock = 50;
        timer.fire();

        expect(fired).toEqual([]);
    });

    it('fires once the dwell duration elapses while still armed', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(timer, () => clock, 16, 100, (direction) => fired.push(direction));

        dwell.update('above');
        clock = 100;
        timer.fire();

        expect(fired).toEqual(['above']);
    });

    it('re-arms and fires again if still held past the edge', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(timer, () => clock, 16, 100, (direction) => fired.push(direction));

        dwell.update('above');
        clock = 100;
        timer.fire();
        clock = 200;
        timer.fire();

        expect(fired).toEqual(['above', 'above']);
    });

    it('disarms and stops the timer when direction returns to null', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(timer, () => clock, 16, 100, (direction) => fired.push(direction));

        dwell.update('above');
        dwell.update(null);
        clock = 100;
        timer.fire();

        expect(fired).toEqual([]);
        expect(timer.stopped).toBe(true);
    });

    it('does not restart the dwell when the same direction is reported again', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(timer, () => clock, 16, 100, (direction) => fired.push(direction));

        dwell.update('above');
        clock = 50;
        dwell.update('above'); // still 'above' - must not push armedAt forward to 50
        clock = 100;
        timer.fire();

        expect(fired).toEqual(['above']); // fired at total elapsed 100, not restarted at 50
    });

    it('stop() disarms unconditionally', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(timer, () => clock, 16, 100, (direction) => fired.push(direction));

        dwell.update('above');
        dwell.stop();
        clock = 100;
        timer.fire();

        expect(fired).toEqual([]);
        expect(timer.stopped).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- edge-dwell.test.ts`
Expected: FAIL — `./edge-dwell` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/viewport/edge-dwell.ts`:

```typescript
// Detects a window dragged past a screen edge and held there, firing after a dwell period —
// used to trigger a row-flip during cross-row drag (docs: 2026-09-02-cross-row-drag-design).
// Pure and KWin-free, driven entirely by an injected clock and Timer, like Animator/ColumnMotion.

import type { EdgeDirection } from '../core/coordinates';
import type { Timer } from './animator';

export class EdgeDwell {
    private armedDirection: EdgeDirection | null = null;
    private armedAt = 0;

    constructor(
        private readonly timer: Timer,
        private readonly now: () => number,
        private readonly tickIntervalMs: number,
        private readonly dwellMs: number,
        private readonly onFire: (direction: EdgeDirection) => void,
    ) {}

    /** Reports the dragged window's current edge state. Arms the dwell timer on a new
     * direction, disarms on `null` (back within bounds), and leaves an already-armed
     * direction alone — the dwell keeps counting from when it first armed, not restarting
     * on every tick. */
    update(direction: EdgeDirection | null): void {
        if (direction === this.armedDirection) {
            return;
        }
        if (direction === null) {
            this.disarm();
            return;
        }
        this.armedDirection = direction;
        this.armedAt = this.now();
        this.timer.start(this.tickIntervalMs, () => this.tick());
    }

    /** Stops the dwell timer unconditionally — used when the drag itself ends. */
    stop(): void {
        this.disarm();
    }

    private disarm(): void {
        this.armedDirection = null;
        this.timer.stop();
    }

    private tick(): void {
        if (this.armedDirection === null || this.now() - this.armedAt < this.dwellMs) {
            return;
        }
        const direction = this.armedDirection;
        this.armedAt = this.now(); // re-arm: a window held past the edge keeps flipping
        this.onFire(direction);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- edge-dwell.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming/file layout matches `viewport/animator.ts` and `viewport/column-motion.ts`
- [ ] `npm test -- edge-dwell.test.ts` passes
- [ ] No convention violations found

---

### Task 3: `rowDragDwellMs` setting

**Files:**
- Modify: `src/config/settings.ts`
- Test: `src/config/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/config/settings.test.ts`:

```typescript
it('defaults the row-drag dwell to 400ms', () => {
    expect(DEFAULT_SETTINGS.rowDragDwellMs).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- settings.test.ts`
Expected: FAIL — `rowDragDwellMs` does not exist on `DEFAULT_SETTINGS`.

- [ ] **Step 3: Write minimal implementation**

In `src/config/settings.ts`, add to the `Settings` interface (near `viewportShiftStep`):

```typescript
    /** How long a dragged window must stay past the screen's top/bottom edge before it
     * flips into the row above/below, in milliseconds (docs: 2026-09-02-cross-row-drag-design). */
    rowDragDwellMs: number;
```

Add to `DEFAULT_SETTINGS`:

```typescript
    rowDragDwellMs: 400,
```

Add to `loadSettings()`'s `Object.assign` call:

```typescript
        rowDragDwellMs: readNumberConfig('rowDragDwellMs', DEFAULT_SETTINGS.rowDragDwellMs),
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- settings.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Field name matches the `Settings` field ↔ config key convention used by every other entry
- [ ] `npm test -- settings.test.ts` passes
- [ ] No convention violations found

---

### Task 4: Expose the setting in the config UI

**Files:**
- Modify: `drift/contents/config/main.xml`
- Modify: `drift/contents/ui/config.ui`

No test: `main.xml`/`config.ui` are untestable glue per project convention (docs §8), verified manually via `make install` and opening the KWin Scripts config dialog — same precedent as every other setting in `docs/agents/specs/2026-08-31-settings-dialog-design.md`.

- [ ] **Step 1: Add the kcfg entry**

In `drift/contents/config/main.xml`, add after the `viewportShiftStep` entry:

```xml
        <entry name="rowDragDwellMs" type="UInt">
            <default>400</default>
        </entry>
```

- [ ] **Step 2: Add the config UI field**

In `drift/contents/ui/config.ui`, in the "Animation" tab's `formLayout_animation`, add a new row after the `viewportShiftStep` row (renumber subsequent `row` attributes — `minimapAutoHideMs` becomes row 2 → 3, `minimapShowThumbnails` row 3 → 4):

```xml
                            <item row="2" column="0">
                                <widget class="QLabel" name="label_rowDragDwellMs">
                                    <property name="text">
                                        <string>Row-drag dwell:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="2" column="1">
                                <widget class="QSpinBox" name="kcfg_rowDragDwellMs">
                                    <property name="toolTip">
                                        <string>How long a dragged window must stay past the screen's top/bottom edge before it moves to the row above/below</string>
                                    </property>
                                    <property name="suffix">
                                        <string> ms</string>
                                    </property>
                                    <property name="minimum">
                                        <number>0</number>
                                    </property>
                                    <property name="maximum">
                                        <number>5000</number>
                                    </property>
                                    <property name="value">
                                        <number>400</number>
                                    </property>
                                </widget>
                            </item>
```

Update the existing `minimapAutoHideMs` item pair from `row="2"` to `row="3"`, and the `minimapShowThumbnails` item from `row="3"` to `row="4"`.

- [ ] **Step 3: Verify**

`npm run lint` (runs `qmllint` and other checks) and `npm run build`.
Expected: both pass with no new warnings.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `kcfg_rowDragDwellMs` naming matches the `kcfg_<fieldName>` convention every other field uses
- [ ] `npm run lint` and `npm run build` pass
- [ ] No convention violations found

---

### Task 5: `registerDragReorder` — continuation flag and row-crossing hooks

**Files:**
- Modify: `src/input/drag.ts`

No dedicated test: `input/drag.ts` is untested glue per project convention (docs §8) — same precedent as the rest of this file. Verified via Task 6 and Task 7's tests, which exercise it indirectly through `Strip`/`StripStack`, plus `npm run typecheck`.

- [ ] **Step 1: Add `initiallyDragging` and the row-crossing hooks**

Replace the full contents of `src/input/drag.ts`:

```typescript
// Turns a window's interactive-move lifecycle into a live column reorder: as the
// window's own leading edge crosses a neighbor's center, its neighbors slide out
// of the way (docs §2.1.7); on release, the dragged column itself snaps instantly
// into its final slot. The window's own real geometry is never touched while
// dragging — it keeps following the cursor untouched throughout.

import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { Viewport } from '../viewport/viewport';

export interface DragReorderDeps {
    grid: Grid;
    viewport: Viewport;
    area: Rect;
    render(excludeWindowId?: string, instant?: boolean): void;
    snapColumn(columnId: number): void;
    /** Row-crossing hooks (docs: 2026-09-02-cross-row-drag-design) — StripStack supplies
     * these to watch the dragged window's vertical position without a second, independent
     * signal connection on the same window. All optional; omitted when not row-aware
     * (e.g. a Strip used outside a StripStack). */
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
}

/** Virtual x of `win`'s own left and right edges — the anchors used to decide
 * whether it has crossed into a neighbor's territory, so the vote reflects the
 * dragged window itself rather than wherever the cursor happened to grab it. */
function windowEdgesVirtualX(win: WindowAdapter, area: Rect, viewportOffsetX: number): { left: number; right: number } {
    const rect = win.frameGeometry();
    return {
        left: toVirtualX(rect.x, area, viewportOffsetX),
        right: toVirtualX(rect.x + rect.width, area, viewportOffsetX),
    };
}

/** Wires `win`'s move lifecycle to reorder `columnId` in `deps.grid` live, and to
 * settle it on release. `initiallyDragging` seeds the local dragging state for a
 * connection created mid-drag — e.g. when a cross-row move reparents the window into
 * a new row's Strip while the user is still holding the drag (docs:
 * 2026-09-02-cross-row-drag-design): the new connection never sees
 * `interactiveMoveResizeStarted`, since it already fired once on the connection this
 * one replaces. Returns a disconnect function. */
export function registerDragReorder(
    win: WindowAdapter,
    columnId: number,
    deps: DragReorderDeps,
    initiallyDragging = false,
): () => void {
    let dragging = initiallyDragging;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        if (dragging) {
            deps.onDragStarted?.(win);
        }
    });

    /** Reorders `columnId` to swap with its current left or right neighbor if the
     * window's own edge has crossed that neighbor's center. Returns whether the
     * order actually changed. */
    const reorderToCurrentPosition = (): boolean => {
        const { left, right } = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForEdges(columnId, left, right);
        if (targetIndex === deps.grid.indexOf(columnId)) {
            return false;
        }
        deps.grid.moveColumn(columnId, targetIndex);
        return true;
    };

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        if (reorderToCurrentPosition()) {
            deps.render(win.id, false);
        }
        deps.onDragTick?.(win);
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        reorderToCurrentPosition();
        deps.snapColumn(columnId);
        deps.render();
        deps.onDragFinished?.();
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
    };
}
```

- [ ] **Step 2: Verify nothing else broke**

`npm run typecheck && npm test`
Expected: PASS (existing `Strip.addWindow` call site still compiles — `registerDragReorder`'s 4th parameter is optional, and the deps object doesn't require the new hooks).

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] New hooks documented with a doc comment explaining *why* (mirrors existing file comments)
- [ ] `npm run typecheck && npm test` passes
- [ ] No convention violations found

---

### Task 6: `Strip.addWindow` — thread `initiallyDragging` and row-drag hooks

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Extend the test's `fakeWindow` helper to capture the frame-geometry and move-finished handlers**

In `src/runtime/strip.test.ts`, replace the `FakeWindow` interface and `fakeWindow` function with:

```typescript
interface FakeWindow {
    adapter: WindowAdapter;
    setFrameGeometry: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    disconnects: {
        frameGeometry: ReturnType<typeof vi.fn>;
        minimized: ReturnType<typeof vi.fn>;
        fullScreen: ReturnType<typeof vi.fn>;
        moveStarted: ReturnType<typeof vi.fn>;
        moveFinished: ReturnType<typeof vi.fn>;
    };
    setIsFullScreen(value: boolean): void;
    triggerFullScreenChanged(): void;
    minimize(): void;
    restore(): void;
    setFrameGeometryValue(rect: Rect): void;
    triggerFrameGeometryChanged(oldGeometry: Rect): void;
}

function fakeWindow(
    id: string,
    options: { width?: number; minimized?: boolean; fullScreen?: boolean } = {},
): FakeWindow {
    const disconnects = {
        frameGeometry: vi.fn(),
        minimized: vi.fn(),
        fullScreen: vi.fn(),
        moveStarted: vi.fn(),
        moveFinished: vi.fn(),
    };
    const setFrameGeometry = vi.fn();
    const activate = vi.fn();
    let isFullScreen = options.fullScreen ?? false;
    let isMinimized = options.minimized ?? false;
    let currentRect: Rect = { x: 0, y: 0, width: options.width ?? 800, height: 1000 };
    let fullScreenHandler: (() => void) | undefined;
    let minimizedHandler: (() => void) | undefined;
    const frameGeometryHandlers: ((oldGeometry: Rect) => void)[] = [];
    const adapter = {
        id,
        caption: id,
        frameGeometry: () => currentRect,
        setFrameGeometry,
        activate,
        icon: () => null,
        windowHandle: () => null,
        output: () => FAKE_OUTPUT,
        isMinimized: () => isMinimized,
        isFullScreen: () => isFullScreen,
        isInteractiveResize: () => false,
        isInteractiveMove: () => false,
        onFrameGeometryChanged: (handler: (oldGeometry: Rect) => void) => {
            frameGeometryHandlers.push(handler);
            return disconnects.frameGeometry;
        },
        onMinimizedChanged: (handler: () => void) => {
            minimizedHandler = handler;
            return disconnects.minimized;
        },
        onFullScreenChanged: (handler: () => void) => {
            fullScreenHandler = handler;
            return disconnects.fullScreen;
        },
        onInteractiveMoveResizeStarted: () => disconnects.moveStarted,
        onInteractiveMoveResizeFinished: () => disconnects.moveFinished,
    } as unknown as WindowAdapter;
    return {
        adapter,
        setFrameGeometry,
        activate,
        disconnects,
        setIsFullScreen: (value) => {
            isFullScreen = value;
        },
        triggerFullScreenChanged: () => fullScreenHandler?.(),
        minimize: () => {
            isMinimized = true;
            minimizedHandler?.();
        },
        restore: () => {
            isMinimized = false;
            minimizedHandler?.();
        },
        setFrameGeometryValue: (rect) => {
            currentRect = rect;
        },
        triggerFrameGeometryChanged: (oldGeometry) => {
            for (const handler of frameGeometryHandlers) {
                handler(oldGeometry);
            }
        },
    };
}
```

(This only adds capture/trigger support for `frameGeometryChanged` — every existing test using `minimize()`/`restore()`/`triggerFullScreenChanged()` is unaffected.)

- [ ] **Step 2: Write the failing tests**

Add to `src/runtime/strip.test.ts`, inside (or after) the `describe('Strip', ...)` block:

```typescript
it('excludes the newly-added window from its own trailing render when added mid-drag', () => {
    const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
    const existing = fakeWindow('existing', { width: 400 });
    strip.addWindow(existing.adapter);
    existing.setFrameGeometry.mockClear();
    const dragged = fakeWindow('dragged', { width: 400 });

    strip.addWindow(dragged.adapter, true);

    expect(dragged.setFrameGeometry).not.toHaveBeenCalled();
    expect(existing.setFrameGeometry).toHaveBeenCalled(); // neighbor still gets positioned normally
});

it('does not exclude the newly-added window when added normally (regression)', () => {
    const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
    const win = fakeWindow('w1', { width: 400 });

    strip.addWindow(win.adapter);

    expect(win.setFrameGeometry).toHaveBeenCalled();
});

it('seeds an already-dragging connection when added mid-drag, so a geometry tick reorders without a Started signal', () => {
    const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
    const existing = fakeWindow('existing', { width: 400 });
    strip.addWindow(existing.adapter);
    const dragged = fakeWindow('dragged', { width: 400 });
    strip.addWindow(dragged.adapter, true); // reparented mid-drag - Started never fires on this connection
    existing.setFrameGeometry.mockClear();
    dragged.setFrameGeometry.mockClear();

    // Move the dragged window's real geometry (as KWin would during the live move) past
    // "existing"'s center, without ever firing interactiveMoveResizeStarted on this connection.
    dragged.setFrameGeometryValue({ x: 500, y: 0, width: 400, height: 1000 });
    dragged.triggerFrameGeometryChanged({ x: 0, y: 0, width: 400, height: 1000 });

    // The dragged window's own geometry must still never be written mid-drag...
    expect(dragged.setFrameGeometry).not.toHaveBeenCalled();
    // ...while "existing" (displaced) gets a real geometry write from the live-preview reorder.
    expect(existing.setFrameGeometry).toHaveBeenCalled();
});

it('invokes the supplied row-drag hooks on start/tick/finish', () => {
    const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
    const win = fakeWindow('w1', { width: 400 });
    const onDragStarted = vi.fn();
    const onDragTick = vi.fn();
    const onDragFinished = vi.fn();
    strip.addWindow(win.adapter, false, { onDragStarted, onDragTick, onDragFinished });

    win.triggerFrameGeometryChanged({ x: 0, y: 0, width: 400, height: 1000 }); // not dragging yet: no hook calls
    expect(onDragTick).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests to verify they fail**

`npm test -- strip.test.ts`
Expected: FAIL — `Strip.addWindow` does not yet accept a second/third parameter, and the trailing render does not yet exclude the added window.

- [ ] **Step 4: Write minimal implementation**

In `src/runtime/strip.ts`:

Add the import and type, alongside the existing `registerDragReorder` import:

```typescript
import { registerDragReorder, type DragReorderDeps } from '../input/drag';
```

Add, near the top of the file (after the imports, before `export class Strip`):

```typescript
/** The subset of `DragReorderDeps` a caller can supply per-window without knowing about
 * `Grid`/`Viewport`/rendering internals — used by `StripStack` to watch a dragged window's
 * vertical position (docs: 2026-09-02-cross-row-drag-design). */
export type RowDragHooks = Pick<DragReorderDeps, 'onDragStarted' | 'onDragTick' | 'onDragFinished'>;
```

Replace `addWindow`'s signature and body:

```typescript
    addWindow(win: WindowAdapter, initiallyDragging = false, rowDragHooks?: RowDragHooks): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        const signals = new SignalManager();
        this.registry.set(column.id, win, signals);
        if (win.isMinimized()) {
            this.grid.hideColumn(column.id);
        }
        if (win.isFullScreen()) {
            this.fullScreenColumns.add(column.id);
        }
        signals.add(win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal, this.eventDeps())));
        signals.add(win.onMinimizedChanged(() => onMinimizedChanged(win, this.eventDeps())));
        signals.add(win.onFullScreenChanged(() => onFullScreenChanged(win, this.eventDeps())));
        signals.add(
            registerDragReorder(
                win,
                column.id,
                {
                    grid: this.grid,
                    viewport: this.viewport,
                    area: this.area,
                    render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
                    snapColumn: (id) => this.snapColumn(id),
                    onDragStarted: rowDragHooks?.onDragStarted,
                    onDragTick: rowDragHooks?.onDragTick,
                    onDragFinished: rowDragHooks?.onDragFinished,
                },
                initiallyDragging,
            ),
        );
        this.render(initiallyDragging ? win.id : undefined);
        this.revealFocused();
    }
```

- [ ] **Step 5: Run tests to verify they pass**

`npm test -- strip.test.ts`
Expected: PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `RowDragHooks` naming/placement follows existing `PascalCase`/interface conventions
- [ ] `npm test -- strip.test.ts` passes
- [ ] `npm run typecheck` passes
- [ ] No convention violations found

---

### Task 7: `StripStack` — edge watch, `excludeWindowId` threading, drag-triggered row move

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Extend the test's `fakeWin` and `fakeStrip` helpers**

In `src/runtime/strip-stack.test.ts`, replace `fakeWin`:

```typescript
function fakeWin(id: string, rect: Rect = { x: 0, y: 0, width: 400, height: 1000 }): WindowAdapter {
    return { id, setSkipTaskbar: vi.fn(), frameGeometry: () => rect } as unknown as WindowAdapter;
}
```

Add this import near the top (alongside the existing ones):

```typescript
import type { RowDragHooks } from './strip';
```

Add this helper after `recordingFactory`:

```typescript
/** Pulls the `RowDragHooks` StripStack passed into a `fake.addWindow` call, so a test can
 * simulate a live drag by invoking them directly (docs: 2026-09-02-cross-row-drag-design). */
function capturedRowDragHooks(fake: FakeStrip): RowDragHooks {
    const lastCall = fake.addWindow.mock.calls[fake.addWindow.mock.calls.length - 1];
    return lastCall[2] as RowDragHooks;
}
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block at the end of `src/runtime/strip-stack.test.ts`:

```typescript
describe('StripStack cross-row drag', () => {
    it('keyboard-driven moveWindowToRowBelow still passes initiallyDragging=false and no exclusion (regression)', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue(win);

        stack.moveWindowToRowBelow();

        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('flips to the row above once the dwell elapses while the window is held past the top edge', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 0, rowDragDwellMs: 100 });
            stack.rowDown(); // row 1 active
            const win = fakeWin('w1', { x: 0, y: -50, width: 400, height: 1000 }); // already past the top edge
            stack.addWindow(win); // lands in row 1, wires the row-drag hooks
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue(win);
            const hooks = capturedRowDragHooks(created[1]);

            hooks.onDragStarted?.(win);
            hooks.onDragTick?.(win); // rect.y = -50 < area.y = 0 -> 'above'
            vi.setSystemTime(100);
            timer.fire(); // dwell elapses

            expect(created[1].detachFocusedColumn).toHaveBeenCalled();
            expect(created[0].addWindow).toHaveBeenCalledWith(win, true, expect.any(Object));
        } finally {
            vi.useRealTimers();
        }
    });

    it('excludes the dragged window from the target row's priming render during a drag-triggered flip', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 0, rowDragDwellMs: 100 });
            stack.rowDown(); // row 1 active
            const win = fakeWin('w1', { x: 0, y: -50, width: 400, height: 1000 });
            stack.addWindow(win);
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue(win);
            const hooks = capturedRowDragHooks(created[1]);
            hooks.onDragStarted?.(win);
            hooks.onDragTick?.(win);

            vi.setSystemTime(100);
            timer.fire();

            const primeCall = created[0].render.mock.calls.find((call) => call[0] === win.id);
            expect(primeCall).toBeDefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not flip while the window is within bounds', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 0, rowDragDwellMs: 100 });
            const win = fakeWin('w1', { x: 0, y: 0, width: 400, height: 1000 }); // within AREA bounds
            stack.addWindow(win);
            const hooks = capturedRowDragHooks(created[0]);
            hooks.onDragStarted?.(win);
            hooks.onDragTick?.(win); // direction is null - never arms

            vi.setSystemTime(100);
            timer.fire();

            expect(created[0].detachFocusedColumn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops watching once the drag finishes, so a later stray tick cannot fire', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 0, rowDragDwellMs: 100 });
            const win = fakeWin('w1', { x: 0, y: -50, width: 400, height: 1000 }); // past the top edge
            stack.addWindow(win);
            const hooks = capturedRowDragHooks(created[0]);
            hooks.onDragStarted?.(win);
            hooks.onDragTick?.(win);

            hooks.onDragFinished?.();
            vi.setSystemTime(100);
            timer.fire();

            expect(created[0].detachFocusedColumn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

`npm test -- strip-stack.test.ts`
Expected: FAIL — `StripStack.addWindow` doesn't pass a `RowDragHooks` object yet, `moveFocusedWindowToRow` doesn't accept options, no edge watch exists.

- [ ] **Step 4: Write minimal implementation**

In `src/runtime/strip-stack.ts`:

Update imports:

```typescript
import type { Rect, EdgeDirection } from '../core/coordinates';
import { edgeDirection } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { MinimapSnapshot } from '../ui/minimap';
import { Animator, type Timer } from '../viewport/animator';
import { EdgeDwell } from '../viewport/edge-dwell';
import { SharedTicker } from '../viewport/shared-ticker';
import { Strip, type RowDragHooks } from './strip';
```

Add two new private fields, alongside the existing `transitionRows`/`cameraY` fields:

```typescript
    private transitionRows: [number, number] = [0, 0];
    private transitionExcludeWindowId: string | undefined;
    private cameraY = 0;
    private edgeDwell: EdgeDwell | null = null;
    private draggedWindowId: string | null = null;
```

Replace `addWindow`:

```typescript
    addWindow(win: WindowAdapter): void {
        win.setSkipTaskbar(false);
        this.activeStrip().addWindow(win, false, this.rowDragHooks());
        this.rowByWindow.set(win.id, this.activeRowIndex);
    }
```

Replace `moveWindowToRowAbove`/`moveWindowToRowBelow`:

```typescript
    moveWindowToRowAbove(): void {
        this.moveFocusedWindowToRow(this.activeRowIndex - 1);
    }

    moveWindowToRowBelow(): void {
        this.moveFocusedWindowToRow(this.activeRowIndex + 1);
    }
```

(unchanged signatures — the new options parameter on the private method defaults to `{}`)

Replace `switchToRow`:

```typescript
    private switchToRow(newIndex: number, excludeWindowId?: string): void {
        const oldIndex = this.activeRowIndex;
        if (newIndex === oldIndex) {
            return;
        }
        this.row(newIndex); // ensure the target row exists before anything below touches it
        this.activeRowIndex = newIndex;
        const fromCameraY = this.verticalAnimator.isAnimating() ? this.cameraY : oldIndex * this.area.height;
        // Prime the incoming row's remembered offset to its pre-transition resting position
        // immediately, synchronously — before any other code (e.g. addWindow, called right
        // after this returns in moveFocusedWindowToRow) can render into it at the wrong (0)
        // offset. The animator's own ticks take over from here once it starts below.
        this.rows.get(newIndex)?.render(excludeWindowId, true, this.restingOffset(fromCameraY, newIndex));
        this.snapRestingRows(oldIndex, newIndex);
        this.rows.get(oldIndex)?.setSkipTaskbar(true);
        this.rows.get(newIndex)?.setSkipTaskbar(false);
        // Must be set before verticalAnimator.animate(): animate() can finish synchronously
        // (calling applyVerticalOffset immediately) when durationMs <= 0, and applyVerticalOffset
        // reads transitionRows/transitionExcludeWindowId — reordering these lines would render
        // the wrong row pair (or fail to exclude a mid-drag window) on that first frame.
        this.transitionRows = [oldIndex, newIndex];
        this.transitionExcludeWindowId = excludeWindowId;
        this.verticalAnimator.animate(fromCameraY, newIndex * this.area.height, this.settings.animationDurationMs);
        // Leaving an unpopulated row prunes it, so plain navigation never accumulates empty rows.
        this.pruneIfEmpty(oldIndex);
    }
```

Replace `applyVerticalOffset`:

```typescript
    private applyVerticalOffset(cameraY: number): void {
        this.cameraY = cameraY;
        for (const rowIndex of this.transitionRows) {
            this.rows
                .get(rowIndex)
                ?.render(this.transitionExcludeWindowId, false, this.restingOffset(cameraY, rowIndex));
        }
    }
```

Replace `moveFocusedWindowToRow`:

```typescript
    private moveFocusedWindowToRow(
        targetIndex: number,
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
    ): void {
        if (targetIndex < 0) {
            return;
        }
        const sourceIndex = this.activeRowIndex;
        const win = this.requireRow(sourceIndex).detachFocusedColumn();
        if (win === null) {
            return;
        }
        this.rowByWindow.delete(win.id);
        // If this emptied the source row, switchToRow's trailing pruneIfEmpty(oldIndex) removes it —
        // no separate cleanup needed here. Must run before addWindow so the target row's remembered
        // offset is primed to its correct resting position before anything renders into it.
        this.switchToRow(targetIndex, options.excludeWindowId);
        const targetStrip = this.row(targetIndex);
        targetStrip.addWindow(win, options.initiallyDragging ?? false, this.rowDragHooks());
        this.rowByWindow.set(win.id, targetIndex);
    }
```

Add these new private methods (near `moveFocusedWindowToRow`):

```typescript
    /** Hooks passed to every `Strip.addWindow` call so a live drag's vertical position keeps
     * feeding this stack's edge watch across a mid-drag reparent (docs:
     * 2026-09-02-cross-row-drag-design). */
    private rowDragHooks(): RowDragHooks {
        return {
            onDragStarted: (win) => this.beginEdgeWatch(win),
            onDragTick: (win) => this.updateEdgeWatch(win),
            onDragFinished: () => this.endEdgeWatch(),
        };
    }

    private beginEdgeWatch(win: WindowAdapter): void {
        this.draggedWindowId = win.id;
        this.edgeDwell = new EdgeDwell(
            this.ticker.subscribe(),
            () => Date.now(),
            this.settings.animationTickMs,
            this.settings.rowDragDwellMs,
            (direction) => this.onEdgeDwellFired(direction),
        );
    }

    private updateEdgeWatch(win: WindowAdapter): void {
        this.edgeDwell?.update(edgeDirection(win.frameGeometry(), this.area));
    }

    private endEdgeWatch(): void {
        this.edgeDwell?.stop();
        this.edgeDwell = null;
        this.draggedWindowId = null;
    }

    private onEdgeDwellFired(direction: EdgeDirection): void {
        if (this.draggedWindowId === null) {
            return;
        }
        const targetIndex = direction === 'above' ? this.activeRowIndex - 1 : this.activeRowIndex + 1;
        this.moveFocusedWindowToRow(targetIndex, { excludeWindowId: this.draggedWindowId, initiallyDragging: true });
    }
```

- [ ] **Step 5: Run tests to verify they pass**

`npm test -- strip-stack.test.ts`
Expected: PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] New private method names/placement match the file's existing style
- [ ] `npm test -- strip-stack.test.ts` passes
- [ ] `npm run typecheck` passes
- [ ] No convention violations found

---

### Task 8: Full verification and manual check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

`npm test`
Expected: PASS, no regressions in any other suite (`grid.test.ts`, `strip.test.ts`, `strip-stack.test.ts`, `strip-manager.test.ts`, `window-manager.test.ts`, etc.)

- [ ] **Step 2: Typecheck, lint, build**

`npm run lint && npm run build`
Expected: PASS

- [ ] **Step 3: Manual verification (untestable without a live compositor, docs §8)**

Install the addon (`make install` or the project's existing install step) and, in a running KWin session with at least two rows (create one via `Meta+Page_Down` if needed):

1. Drag a tiled window's top edge above the screen's top boundary and hold for ~400ms (or whatever `rowDragDwellMs` is set to) — confirm the row pages up and the window lands in the row above, still following the cursor.
2. Keep holding past the edge after the flip — confirm it keeps flipping into further rows above, if any exist or get created.
3. Drag the window back within bounds before the dwell completes — confirm no flip happens.
4. Release the drag after a flip — confirm the window snaps to the nearest horizontal slot in the new row, exactly like an in-row drag.
5. Repeat dragging toward the bottom edge into the row below.
6. At row 0, drag above the top edge and hold — confirm nothing happens (no-op, matching `Meta+Page_Up` at row 0).
7. Open System Settings → Drift's config dialog → Animation tab — confirm the new "Row-drag dwell" field is present and editable.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `npm test`, `npm run lint`, `npm run build` all pass
- [ ] Manual verification steps above completed and confirmed working
- [ ] Spec (`docs/agents/specs/2026-09-02-cross-row-drag-design.md`) requirements all have a corresponding implemented behavior

---

## Self-Review Notes

**Spec coverage:** Trigger mechanism (Task 7's edge watch), dwell timing (Task 2's `EdgeDwell`), no extra visual feedback (no new UI added), multi-row flips while held (`EdgeDwell`'s re-arm-on-fire), drag-state continuity (Task 5/6's `initiallyDragging`), row-transition exclusion (Task 7's `excludeWindowId` threading), `Strip.addWindow`'s own exclusion (Task 6), new setting (Task 3/4), row-0 no-op (reuses existing `moveFocusedWindowToRow`'s `targetIndex < 0` guard, verified in Task 7's tests) — all covered.

**Type consistency:** `RowDragHooks` (defined in `strip.ts`, Task 6) is the exact type threaded through `StripStack.rowDragHooks()` (Task 7) and `DragReorderDeps` (Task 5) — same field names (`onDragStarted`/`onDragTick`/`onDragFinished`) throughout. `EdgeDirection`/`edgeDirection` (Task 1) are the exact names imported and used in `EdgeDwell` (Task 2) and `StripStack` (Task 7).

**No placeholders:** every step above shows complete, runnable code.

## Execution Handoff

Plan complete and saved to `docs/agents/plans/2026-09-02-cross-row-drag.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
