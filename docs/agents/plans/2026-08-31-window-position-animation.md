# Animated Window Repositioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate a column's real x position whenever its logical position changes for a reason other than the user actively dragging/resizing it, so neighbors visibly slide instead of jumping.

**Architecture:** A new pure `ColumnMotion` class (mirrors `Animation`/`Animator`) tracks a per-column eased position and is queried every `render()`; a new `SharedTicker` lets it and the existing camera `Animator` share the one real `Timer` a `Strip` is given. `Strip.render()` gains an `instant` flag so live interactive-resize frames keep bypassing animation entirely, exactly as they do today.

**Tech Stack:** TypeScript, JavaScript, and QML with npm.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing. In particular: **never use spread syntax (`...obj`, `[...arr]`) or an optional catch binding (`catch {`)** — KWin's QJSEngine cannot parse either and the whole script silently fails to load. Use `Object.assign({}, a, b)` instead of object spread.

**Spec:** [`docs/agents/specs/2026-08-31-window-position-animation-design.md`](../specs/2026-08-31-window-position-animation-design.md)

---

### Task 1: `ColumnMotion` — pure per-column eased position tracker

**Files:**
- Create: `src/viewport/column-motion.ts`
- Test: `src/viewport/column-motion.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/viewport/column-motion.test.ts
import { describe, expect, it } from 'vitest';
import { ColumnMotion } from './column-motion';

describe('ColumnMotion', () => {
    it('snaps to the target the first time an id is seen (no animation)', () => {
        const motion = new ColumnMotion();

        const value = motion.update(1, 500, 0, 200);

        expect(value).toBe(500);
        expect(motion.isAnimating()).toBe(false);
    });

    it('animates toward a new target when it changes', () => {
        const motion = new ColumnMotion();
        motion.update(1, 500, 0, 200); // establishes resting at 500

        const value = motion.update(1, 900, 1000, 200);

        expect(value).toBe(500); // valueAt(elapsed=0) === "from"
        expect(motion.isAnimating()).toBe(true);
    });

    it('interpolates partway through the animation', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animate 0 -> 100 over 200ms, started at t=0

        const value = motion.update(1, 100, 100, 200); // same target, 100ms later

        expect(value).toBeCloseTo(87.5); // easeOutCubic(0.5) = 0.875
    });

    it('settles exactly at the target once the duration has elapsed, and stops animating', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200);

        const value = motion.update(1, 100, 200, 200);

        expect(value).toBe(100);
        expect(motion.isAnimating()).toBe(false);
    });

    it('retargets from the current interpolated value, not the old target, when the target changes mid-flight', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating 0 -> 100
        motion.update(1, 100, 100, 200); // now at ~87.5, still mid-flight

        const value = motion.update(1, 200, 100, 200); // retarget to 200, starting now

        expect(value).toBeCloseTo(87.5); // valueAt(0) of the new animation === its "from"
    });

    it('snapTo cancels any in-flight animation and rests at the given value immediately', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating

        motion.snapTo(1, 250);

        expect(motion.isAnimating()).toBe(false);
        expect(motion.update(1, 250, 100, 200)).toBe(250); // same target: rests, no animation
    });

    it('forget makes a later update treat the id as brand new (snaps instead of animating)', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating 0 -> 100

        motion.forget(1);
        const value = motion.update(1, 999, 50, 200);

        expect(value).toBe(999);
        expect(motion.isAnimating()).toBe(false);
    });

    it('collapses to the target immediately with a zero duration', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);

        const value = motion.update(1, 500, 0, 0);

        expect(value).toBe(500);
        expect(motion.isAnimating()).toBe(false);
    });

    it('tracks multiple columns independently', () => {
        const motion = new ColumnMotion();
        motion.update(1, 0, 0, 200);
        motion.update(2, 1000, 0, 200);

        motion.update(1, 100, 0, 200); // only column 1 retargets

        expect(motion.isAnimating()).toBe(true);
        expect(motion.update(2, 1000, 100, 200)).toBe(1000); // column 2 untouched, still resting
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npx vitest run src/viewport/column-motion.test.ts`
Expected: FAIL — `./column-motion` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/viewport/column-motion.ts
// Smooths a column's real x position toward wherever `Grid` says it now belongs, so a
// neighbor pushed by an add/remove/resize/minimize slides instead of jumping. Pure and
// KWin-free, like `Animation`/`Animator` — driven entirely by an injected clock.

import { Animation } from './animator';

export class ColumnMotion {
    private readonly targets = new Map<number, number>();
    private readonly resting = new Map<number, number>();
    private readonly animations = new Map<number, Animation>();
    private readonly startedAt = new Map<number, number>();

    /** Call once per column per render. Returns the x to actually draw at `nowMs`.
     * The first time an id is seen, it snaps straight to `targetX` — a brand-new or
     * just-restored column appears instantly, it never animates itself in. */
    update(id: number, targetX: number, nowMs: number, durationMs: number): number {
        if (!this.targets.has(id)) {
            this.snapTo(id, targetX);
            return targetX;
        }
        if (this.targets.get(id) !== targetX) {
            const from = this.currentValue(id, nowMs);
            this.targets.set(id, targetX);
            this.animations.set(id, new Animation(from, targetX, durationMs));
            this.startedAt.set(id, nowMs);
        }
        return this.currentValue(id, nowMs);
    }

    /** Forces column `id` to rest at `x` immediately, cancelling any in-flight
     * animation. Used for columns that must track their logical position with zero
     * lag (e.g. a live interactive resize's neighbors). */
    snapTo(id: number, x: number): void {
        this.targets.set(id, x);
        this.resting.set(id, x);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    /** Drops all tracked state for a column id, so a later reappearance (e.g.
     * un-minimizing, or returning from fullscreen) is treated as brand new and snaps
     * instead of animating from a stale pre-hide position. */
    forget(id: number): void {
        this.targets.delete(id);
        this.resting.delete(id);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    isAnimating(): boolean {
        return this.animations.size > 0;
    }

    private currentValue(id: number, nowMs: number): number {
        const animation = this.animations.get(id);
        if (!animation) {
            return this.resting.get(id) as number;
        }
        const elapsed = nowMs - (this.startedAt.get(id) as number);
        const value = animation.valueAt(elapsed);
        if (animation.isComplete(elapsed)) {
            this.animations.delete(id);
            this.startedAt.delete(id);
            this.resting.set(id, value);
        }
        return value;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`npx vitest run src/viewport/column-motion.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` methods/locals, `PascalCase` class, no spread syntax anywhere in the new file
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/viewport/column-motion.ts src/viewport/column-motion.test.ts && npx prettier --check src/viewport/column-motion.ts src/viewport/column-motion.test.ts` passes
- [ ] Fix any violation before moving to the next task

---

### Task 2: `SharedTicker` — one real `Timer` shared by multiple animation drivers

**Files:**
- Create: `src/viewport/shared-ticker.ts`
- Test: `src/viewport/shared-ticker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/viewport/shared-ticker.test.ts
import { describe, expect, it } from 'vitest';
import type { Timer } from './animator';
import { SharedTicker } from './shared-ticker';

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

describe('SharedTicker', () => {
    it('starts the real timer when one subscriber starts', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);

        ticker.subscribe().start(16, () => {});

        expect(timer.started).toBe(true);
    });

    it('fires every active subscriber on a single real tick', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        let aCalls = 0;
        let bCalls = 0;
        a.start(16, () => (aCalls += 1));
        b.start(16, () => (bCalls += 1));

        timer.fire();

        expect(aCalls).toBe(1);
        expect(bCalls).toBe(1);
    });

    it('keeps the real timer running when only one of two subscribers stops', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        a.start(16, () => {});
        b.start(16, () => {});

        a.stop();

        expect(timer.stopped).toBe(false);
    });

    it('stops the real timer once every subscriber has stopped', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        a.start(16, () => {});
        b.start(16, () => {});

        a.stop();
        b.stop();

        expect(timer.stopped).toBe(true);
    });

    it('a subscriber that stopped no longer fires on later ticks', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        let aCalls = 0;
        a.start(16, () => (aCalls += 1));
        b.start(16, () => {});

        a.stop();
        timer.fire();

        expect(aCalls).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npx vitest run src/viewport/shared-ticker.test.ts`
Expected: FAIL — `./shared-ticker` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/viewport/shared-ticker.ts
// A `Strip` only gets one real KWin-provided `Timer`, but the camera pan (`Animator`)
// and column-position smoothing (`ColumnMotion`) are independent concerns that may both
// need to tick at once. `SharedTicker` hands out independent Timer-shaped handles: the
// real timer starts once any handle is active, and stops only once every handle has
// stopped.

import type { Timer } from './animator';

export class SharedTicker {
    private readonly callbacks = new Map<number, () => void>();
    private nextId = 1;

    constructor(
        private readonly timer: Timer,
        private readonly intervalMs: number,
    ) {}

    subscribe(): Timer {
        const id = this.nextId++;
        return {
            start: (_intervalMs, onTick) => {
                this.callbacks.set(id, onTick);
                this.timer.start(this.intervalMs, () => {
                    for (const callback of this.callbacks.values()) {
                        callback();
                    }
                });
            },
            stop: () => {
                this.callbacks.delete(id);
                if (this.callbacks.size === 0) {
                    this.timer.stop();
                }
            },
        };
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`npx vitest run src/viewport/shared-ticker.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] No spread syntax; `camelCase`/`PascalCase` conventions followed
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/viewport/shared-ticker.ts src/viewport/shared-ticker.test.ts && npx prettier --check src/viewport/shared-ticker.ts src/viewport/shared-ticker.test.ts` passes
- [ ] Fix any violation before moving to the next task

---

### Task 3: `Strip.render()` gains an `instant` flag; interactive resize uses it

**Files:**
- Modify: `src/runtime/window-events.ts`
- Modify: `src/runtime/window-events.test.ts`

- [ ] **Step 1: Write the failing test change**

In `src/runtime/window-events.test.ts`, update the existing interactive-resize test to expect the new second argument:

```typescript
    it('excludes the resized window from render during an interactive resize, without animating its neighbors', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 }, { interactiveResize: true });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.render).toHaveBeenCalledWith('w1', true);
    });
```

(This replaces the existing `it('excludes the resized window from render during an interactive resize', ...)` test — same body, renamed and updated assertion.)

- [ ] **Step 2: Run the test to verify it fails**

`npx vitest run src/runtime/window-events.test.ts`
Expected: FAIL — `deps.render` was called with just `'w1'`, not `('w1', true)`.

- [ ] **Step 3: Update `WindowEventDeps` and the call site**

In `src/runtime/window-events.ts`, change the interface:

```typescript
export interface WindowEventDeps {
    columnOf(windowId: string): number | null;
    isHidden(columnId: number): boolean;
    isEcho(windowId: string, rect: Rect): boolean;
    resizeColumn(columnId: number, width: number, edge: ResizeEdge): void;
    hideColumn(columnId: number): void;
    showColumn(columnId: number): void;
    setFullScreen(columnId: number, fullScreen: boolean): void;
    /** `instant`, when true, skips per-column position animation entirely — used for a
     * live interactive resize's neighbors, which must track the cursor with zero lag. */
    render(excludeWindowId?: string, instant?: boolean): void;
    revealFocused(): void;
    /** Whether `win`'s geometry already covers its output's fullscreen area (see workspace-adapter.ts). */
    isFullScreenGeometry(win: WindowAdapter): boolean;
}
```

And the interactive-resize branch of `onWindowGeometryChanged`:

```typescript
    if (win.isInteractiveResize()) {
        // A live border drag can tell us the left edge genuinely moved, and needs to render
        // immediately (excluding itself, and skipping neighbor animation) to track the pointer
        // without stutter.
        deps.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
        deps.render(win.id, true);
        return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npx vitest run src/runtime/window-events.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/runtime/window-events.ts src/runtime/window-events.test.ts && npx prettier --check src/runtime/window-events.ts src/runtime/window-events.test.ts` passes
- [ ] Fix any violation before moving to the next task

---

### Task 4: Wire `ColumnMotion` + `SharedTicker` into `Strip`

**Files:**
- Modify: `src/runtime/strip.ts`
- Modify: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/runtime/strip.test.ts`, add a `WIDE_AREA` constant next to the existing `AREA` (wide enough that `revealFocused()` never needs to scroll, isolating column-motion behavior from the camera animation), replace the inert `fakeTimer()` helper with a fireable one, and add three new tests.

Replace:

```typescript
const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };
const INSTANT_SETTINGS = { ...DEFAULT_SETTINGS, animationDurationMs: 0 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}
```

with:

```typescript
const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };
const WIDE_AREA: Rect = { x: 0, y: 0, width: 5000, height: 1000 };
const INSTANT_SETTINGS = { ...DEFAULT_SETTINGS, animationDurationMs: 0 };

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

(`ManualTimer` is a strict superset of the old no-op timer — every existing test that passes `fakeTimer()` and never calls `.fire()` behaves identically.)

Add a new `describe` block at the end of the file, before the final closing brace:

```typescript
describe('column-motion animation', () => {
    it('starts a pushed neighbor from its previous position and settles it at the new one', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const timer = fakeTimer();
            const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, timer, fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            const win2 = fakeWindow('w2');
            strip.addWindow(win1.adapter); // col1 @ x=0, focused
            strip.addWindow(win2.adapter); // col2 @ x=808, focused
            strip.focusLeft(); // focus back to col1
            win2.setFrameGeometry.mockClear();

            const win3 = fakeWindow('w3');
            strip.addWindow(win3.adapter); // inserted right of col1, pushes col2 to x=1616

            // first frame: col2 hasn't jumped yet, still at its previous position
            expect(win2.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 808 }));

            vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs);
            timer.fire();

            // settled at its new, pushed-right position
            expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1616 }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders a column at its exact logical position when instant=true, bypassing animation', () => {
        const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter); // col2 @ x=808
        strip.focusLeft();
        const win3 = fakeWindow('w3');
        strip.addWindow(win3.adapter); // pushes col2 to x=1616; its animation is still in-flight
        win2.setFrameGeometry.mockClear();

        strip.render(undefined, true); // e.g. a live interactive-resize frame

        expect(win2.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 1616 }));
    });

    it('snaps a column back into place after fullscreen instead of animating from its pre-fullscreen position', () => {
        const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter); // col1 @ 0
        strip.addWindow(win2.adapter); // col2 @ 808, focused
        win2.setIsFullScreen(true);
        win2.triggerFullScreenChanged(); // excluded from render; forgets col2's motion state

        strip.focusLeft(); // focus back to col1
        const win3 = fakeWindow('w3');
        strip.addWindow(win3.adapter); // inserted right of col1, pushes col2 to x=1616 while it's still fullscreen

        win2.setIsFullScreen(false);
        win2.triggerFullScreenChanged(); // resumes rendering — must snap straight to 1616, not animate from 808

        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1616 }));
    });
});
```

Add `vi` to the existing `vitest` import at the top of the file (it already imports `describe, expect, it, vi` — confirm `vi` is present; it is, used already by `vi.fn()`).

- [ ] **Step 2: Run the tests to verify they fail**

`npx vitest run src/runtime/strip.test.ts`
Expected: FAIL — `Strip` does not yet track column motion, so pushed neighbors jump straight to their final position instead of starting from the old one, and fullscreen-restore animates instead of snapping.

- [ ] **Step 3: Wire `Strip`**

In `src/runtime/strip.ts`, update imports:

```typescript
import { Animator, type Timer } from '../viewport/animator';
import { ColumnMotion } from '../viewport/column-motion';
import { SharedTicker } from '../viewport/shared-ticker';
```

Add a field and change the constructor:

```typescript
export class Strip {
    private readonly grid: Grid;
    private readonly viewport: Viewport;
    private readonly geometrySync: GeometrySync;
    private readonly animator: Animator;
    private readonly columnMotion = new ColumnMotion();
    private readonly columnMotionTimer: Timer;
    private readonly registry = new ColumnRegistry();
    private readonly fullScreenColumns = new Set<number>();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
    ) {
        this.grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
        this.viewport = new Viewport(area.width);
        this.geometrySync = new GeometrySync(area);
        const ticker = new SharedTicker(timer, settings.animationTickMs);
        this.animator = new Animator(ticker.subscribe(), () => Date.now(), settings.animationTickMs, (offset) => {
            this.viewport.setOffset(offset);
            this.render();
        });
        this.columnMotionTimer = ticker.subscribe();
    }
```

Replace `render()`:

```typescript
    render(excludeWindowId?: string, instant = false): void {
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            if (column.hidden) {
                continue;
            }
            const win = this.registry.get(column.id);
            if (!win || win.id === excludeWindowId || this.fullScreenColumns.has(column.id)) {
                continue;
            }
            const rect = this.grid.columnRect(column.id);
            let x: number;
            if (instant) {
                this.columnMotion.snapTo(column.id, rect.x);
                x = rect.x;
            } else {
                x = this.columnMotion.update(column.id, rect.x, Date.now(), this.settings.animationDurationMs);
            }
            this.geometrySync.apply(win, Object.assign({}, rect, { x }), this.viewport.offset());
        }
        if (this.columnMotion.isAnimating()) {
            this.columnMotionTimer.start(this.settings.animationTickMs, () => this.render());
        } else {
            this.columnMotionTimer.stop();
        }
        setDebugState(
            formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()),
        );
    }
```

In `removeWindow`, forget the column's motion state:

```typescript
    removeWindow(win: WindowAdapter): void {
        const columnId = this.registry.columnOf(win.id);
        if (columnId === null) {
            return;
        }
        this.registry.delete(columnId);
        this.geometrySync.forget(win.id);
        this.fullScreenColumns.delete(columnId);
        this.columnMotion.forget(columnId);
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }
```

In `eventDeps()`, forget motion state on hide (so a later restore snaps) and on entering fullscreen (so returning from fullscreen snaps), and pass through the new `instant` parameter:

```typescript
    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
            hideColumn: (columnId) => {
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
            showColumn: (columnId) => this.grid.showColumn(columnId),
            setFullScreen: (columnId, fullScreen) => {
                if (fullScreen) {
                    this.fullScreenColumns.add(columnId);
                    this.columnMotion.forget(columnId);
                } else {
                    this.fullScreenColumns.delete(columnId);
                }
            },
            render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
            revealFocused: () => this.revealFocused(),
            isFullScreenGeometry: (win) => this.workspaceAdapter.isFullScreenGeometry(win),
        };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npx vitest run src/runtime/strip.test.ts`
Expected: PASS (all tests in the file, including the 3 new ones)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] No spread syntax used anywhere in the diff (`Object.assign` used instead)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/runtime/strip.ts src/runtime/strip.test.ts && npx prettier --check src/runtime/strip.ts src/runtime/strip.test.ts` passes
- [ ] `npm test` passes (full suite — confirms nothing else regressed)
- [ ] Fix any violation before moving to the next task

---

### Task 5: Update docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/algorithms.md`

- [ ] **Step 1: Add a module-map row in `docs/architecture.md`**

In the `## Module Map` table, update the `src/viewport/` row:

```markdown
| [`src/viewport/`](../src/viewport) | Pure "camera" (`Viewport`) and the timer-driven scroll animation (`Animator`), plus `ColumnMotion` (per-column position smoothing) and `SharedTicker` (lets both share one real `Timer`). Fully unit-tested. |
```

(Replaces the existing row that only mentions `Viewport`/`Animator`.)

- [ ] **Step 2: Add a new section to `docs/algorithms.md`**

Append after the existing "Viewport Reveal and Animation Easing" section:

```markdown
## Layout-Change Position Animation

Source: [`ColumnMotion`](../src/viewport/column-motion.ts) in `column-motion.ts`, driven by [`Strip.render`](../src/runtime/strip.ts) in `strip.ts`, sharing a `Timer` with the camera's `Animator` via [`SharedTicker`](../src/viewport/shared-ticker.ts).

Whenever a column's logical x changes for a reason other than the user actively dragging or
resizing it — adding, removing, or minimizing/restoring a window, a resize pushing a neighbor,
or a drag-reorder settling on release — `ColumnMotion` animates that column's real x from
wherever it currently visually is to the new logical x, using the same eased duration as the
camera (`settings.animationDurationMs` / `easeOutCubic`). A column is never animated on its own
first appearance (add, restore, returning from fullscreen): `ColumnMotion` snaps a
never-seen-before column straight to its target, so only *already-visible* neighbors slide.

Live interactive gestures (border drag, window drag) stay fully instant: `Strip.render`'s
`instant` flag bypasses `ColumnMotion` entirely for those frames, and `Strip` forgets a column's
motion state whenever it is hidden (minimized) or excluded (fullscreen) so that restoring it
later snaps to its new position instead of animating in from a stale pre-hide value.

`SharedTicker` exists because a `Strip` is only ever given one real `Timer` (docs §6.2), but the
camera pan and per-column motion are independent animations that may need to tick at once — it
hands out independent `Timer`-shaped handles that share one real timer, starting it when any
handle is active and stopping it only once every handle has stopped.
```

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] One sentence per line (per `AGENTS.md`'s documentation rule)
- [ ] `npx prettier --check docs/architecture.md docs/algorithms.md` passes (docs are excluded from prettier's markdown formatting per `.prettierignore` — verify this command is a no-op/harmless; if prettier is configured to skip `docs/*.md`, skip this check and just proofread manually)
- [ ] Links resolve to real files in the repo

---

## Self-Review Notes

- **Spec coverage:** Add/remove/resize-neighbor-push (Task 4's `render`/`removeWindow` wiring), minimize/restore (Task 4's `hideColumn` forget), fullscreen-restore parity (Task 4's `setFullScreen` forget + its dedicated test), live interactive resize staying instant (Task 3 + Task 4's `instant` test), drag-reorder settle staying non-special (no change needed — it already just calls `render()`, which now animates through the same path as every other non-instant trigger) are all covered.
- **Placeholder scan:** none — every step has complete code.
- **Type consistency:** `ColumnMotion.update`/`snapTo`/`forget`/`isAnimating` signatures are identical everywhere they're referenced (Task 1 definition, Task 4 usage). `WindowEventDeps.render`'s new `instant` parameter matches between the Task 3 interface and Task 4's `eventDeps()` implementation.
