# Drag Pan-Default With Dwell-To-Free Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-threshold pan/reorder cutover (`dragPanShouldPan`) with a default-pan, dwell-to-free
gesture: dragging a window always pans by default (its `y` pinned to drag-start), and pulling it vertically
and holding it steady for a dwell period is what "frees" it into today's reorder/stack/cross-strip-drag
behavior for the rest of that drag.

**Architecture:** A generalized `DwellTimer` (renamed from `EdgeDwell`, since it's already used for
non-edge purposes) drives a third dwell instance in `registerDragReorder`, alongside the existing stack
dwell. A new pure predicate `dragPanHolding` decides whether the current tick still counts as "holding."
`registerDragReorder` gates the entire existing reorder/edge-expel/stack block behind
`deps.dragPanEnabled && !freed`, and re-seeds the window to its true pointer-relative position (via
`WorkspaceAdapter.cursorPos()`) the instant the dwell fires, fixing the "has to be nudged to catch up" bug
found during a throwaway spike. `initiallyFreed` threads through the same cross-strip-reparent path
`initiallyDragging` already uses, so a drag that already earned "drag mode" doesn't lose it when it crosses
into another strip.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design doc:** `docs/agents/specs/2026-09-12-drag-pan-dwell-design.md` — read before implementing; every
task below implements a specific part of it.

**Verification commands used throughout:** `make test` (JS/TS unit tests), `make lint` (ESLint + Prettier +
qmllint), `make build` (lint + test + assemble). All three must pass before this plan is done.

---

### Task 1: Rename `EdgeDwell` to `DwellTimer` and relocate it to `src/utils/`

**Files:**
- Create: `drift/src/utils/dwell-timer.ts` (moved from `drift/src/viewport/edge-dwell.ts`)
- Create: `drift/src/utils/dwell-timer.test.ts` (moved from `drift/src/viewport/edge-dwell.test.ts`)
- Delete: `drift/src/viewport/edge-dwell.ts`, `drift/src/viewport/edge-dwell.test.ts`
- Modify: `drift/src/input/drag.ts`, `drift/src/runtime/strip.ts`, `drift/src/runtime/strip-stack.ts`,
  `drift/src/viewport/shared-ticker.ts`

Pure rename + move — no behavior change, so no new test is written; the existing tests move with the class
and must keep passing unmodified (only their import path changes).

- [ ] **Step 1: Move and rename the class file**

Create `drift/src/utils/dwell-timer.ts` with this content (identical to `drift/src/viewport/edge-dwell.ts`
today, except the class name and the `Timer` import path, which now needs one more `../` to reach
`viewport/animator`):

```ts
// Detects the pointer dragged past a screen edge (or hovering some other identified zone)
// and held there, firing after a dwell period — used to trigger a strip-flip during cross-strip
// drag (docs: 2026-09-02-cross-row-drag-design), reused for the horizontal drag-to-stack dwell,
// armed on a resolved stack target's compound key (columnId:tileId:direction) instead of an edge
// direction (docs: 2026-09-07-drag-reorder-stack-refinement-design), and for the drag-pan
// dwell-to-free gesture (docs: 2026-09-12-drag-pan-dwell-design). Pure and KWin-free, driven
// entirely by an injected clock and Timer, like Animator/AxisMotion. Generic over `T` (the
// "direction"/zone/key identity) so every caller shares the exact same arm/fire/disarm semantics.

import type { Timer } from '../viewport/animator';

export class DwellTimer<T> {
    private armedDirection: T | null = null;
    private armedAt = 0;
    /** Set to the direction just fired, and cleared only once `update` reports `null` (the
     * pointer genuinely back within bounds). Blocks re-arming for that same direction from the
     * continued same-direction reports every later drag tick still sends while the pointer
     * keeps holding past the edge, unmoved — without this, one continuous hold would flip
     * through strips every `dwellMs` instead of just once. */
    private awaitingRelease: T | null = null;

    constructor(
        private readonly timer: Timer,
        private readonly now: () => number,
        private readonly tickIntervalMs: number,
        private readonly dwellMs: number,
        private readonly onFire: (direction: T) => void,
    ) {}

    /** Reports the dragged window's current edge state. Arms the dwell timer on a new
     * direction, disarms on `null` (back within bounds), and leaves an already-armed
     * direction alone — the dwell keeps counting from when it first armed, not restarting
     * on every tick. A direction that just fired is ignored until `null` is reported first. */
    update(direction: T | null): void {
        if (direction === null) {
            this.awaitingRelease = null;
            this.disarm();
            return;
        }
        if (direction === this.awaitingRelease || direction === this.armedDirection) {
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
        this.disarm();
        this.awaitingRelease = direction; // one fire per hold: the pointer must leave and re-enter to flip again
        this.onFire(direction);
    }
}
```

- [ ] **Step 2: Move the test file**

Create `drift/src/utils/dwell-timer.test.ts` with the exact content of
`drift/src/viewport/edge-dwell.test.ts`, with only these two textual substitutions applied throughout:
`EdgeDwell` → `DwellTimer`, and the import `from './edge-dwell'` → `from './dwell-timer'`. Every test body,
description string, and assertion stays byte-for-byte identical otherwise.

- [ ] **Step 3: Delete the old files**

```sh
rm drift/src/viewport/edge-dwell.ts drift/src/viewport/edge-dwell.test.ts
```

- [ ] **Step 4: Update `drift/src/input/drag.ts`'s import and type reference**

Replace:

```ts
import { EdgeDwell } from '../viewport/edge-dwell';
```

with:

```ts
import { DwellTimer } from '../utils/dwell-timer';
```

Replace the `createStackDwell` return type in `DragReorderDeps`:

```ts
    createStackDwell(onFire: (key: string) => void): EdgeDwell<string>;
```

with:

```ts
    createStackDwell(onFire: (key: string) => void): DwellTimer<string>;
```

- [ ] **Step 5: Update `drift/src/runtime/strip.ts`'s import and construction site**

Replace:

```ts
import { EdgeDwell } from '../viewport/edge-dwell';
```

with:

```ts
import { DwellTimer } from '../utils/dwell-timer';
```

Replace the `createStackDwell` factory body:

```ts
                    createStackDwell: (onFire: (key: string) => void) =>
                        new EdgeDwell<string>(
                            this.ticker.subscribe(),
                            () => Date.now(),
                            ANIMATION_TICK_MS,
                            this.settings.columnDragDwellMs,
                            onFire,
                        ),
```

with:

```ts
                    createStackDwell: (onFire: (key: string) => void) =>
                        new DwellTimer<string>(
                            this.ticker.subscribe(),
                            () => Date.now(),
                            ANIMATION_TICK_MS,
                            this.settings.columnDragDwellMs,
                            onFire,
                        ),
```

- [ ] **Step 6: Update `drift/src/runtime/strip-stack.ts`'s import and construction site**

Replace:

```ts
import { EdgeDwell } from '../viewport/edge-dwell';
```

with:

```ts
import { DwellTimer } from '../utils/dwell-timer';
```

Replace the `edgeDwell` property type and `beginEdgeWatch`'s construction:

```ts
    private edgeDwell: EdgeDwell<EdgeDirection> | null = null;
```

with:

```ts
    private edgeDwell: DwellTimer<EdgeDirection> | null = null;
```

and:

```ts
        this.edgeDwell = new EdgeDwell<EdgeDirection>(
```

with:

```ts
        this.edgeDwell = new DwellTimer<EdgeDirection>(
```

- [ ] **Step 7: Fix the stale reference in `drift/src/viewport/shared-ticker.ts`'s doc comment**

Replace:

```ts
/** Internal render-tick rate driving every `SharedTicker`/`Animator`/`EdgeDwell` in the
```

with:

```ts
/** Internal render-tick rate driving every `SharedTicker`/`Animator`/`DwellTimer` in the
```

- [ ] **Step 8: Run the full test suite and confirm everything still passes**

```sh
make test
```

Expected: PASS, 655 tests (unchanged count — this task renames/moves, adds nothing).

- [ ] **Step 9: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `PascalCase` used for the `DwellTimer` class name
- [ ] `make lint` passes (ESLint + Prettier + qmllint)
- [ ] `make test` passes with no test count regression
- [ ] No remaining references to `EdgeDwell` or `viewport/edge-dwell` anywhere in `drift/src`
      (`grep -rn "EdgeDwell\|edge-dwell" drift/src` returns nothing)

---

### Task 2: Replace `dragPanVerticalTolerancePx` with the three new pan/dwell settings

**Files:**
- Modify: `drift/src/config/settings.ts`
- Modify: `drift/src/config/settings-definitions.ts`
- Modify: `drift/src/config/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

In `drift/src/config/settings.test.ts`, replace:

```ts
    it('defaults dragPanVerticalTolerancePx to 40', () => {
        expect(DEFAULT_SETTINGS.dragPanVerticalTolerancePx).toBe(40);
    });
```

with:

```ts
    it('defaults dragPanVerticalTriggerPx to 20', () => {
        expect(DEFAULT_SETTINGS.dragPanVerticalTriggerPx).toBe(20);
    });

    it('defaults dragPanHorizontalTolerancePx to 10', () => {
        expect(DEFAULT_SETTINGS.dragPanHorizontalTolerancePx).toBe(10);
    });

    it('defaults dragPanFreeDwellMs to 400, matching the other drag dwells', () => {
        expect(DEFAULT_SETTINGS.dragPanFreeDwellMs).toBe(400);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

```sh
npx vitest run drift/src/config/settings.test.ts
```

Expected: FAIL — `dragPanVerticalTriggerPx`/`dragPanHorizontalTolerancePx`/`dragPanFreeDwellMs` don't exist
on `DEFAULT_SETTINGS` yet (and the removed `dragPanVerticalTolerancePx` test is already gone, so it can't
fail — this step confirms the three new properties are what's missing).

- [ ] **Step 3: Update the settings type and definitions**

In `drift/src/config/settings-definitions.ts`, replace:

```ts
    { name: 'dragPanEnabled', type: 'Bool', default: true },
    { name: 'dragPanVerticalTolerancePx', type: 'UInt', default: 40 },
```

with:

```ts
    { name: 'dragPanEnabled', type: 'Bool', default: true },
    { name: 'dragPanVerticalTriggerPx', type: 'UInt', default: 20 },
    { name: 'dragPanHorizontalTolerancePx', type: 'UInt', default: 10 },
    { name: 'dragPanFreeDwellMs', type: 'UInt', default: 400 },
```

In `drift/src/config/settings.ts`, replace:

```ts
    /** Whether an almost-purely-horizontal drag pans the viewport instead of reordering the
     * dragged window's column (docs: 2026-09-10-drag-viewport-pan-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, at which drag-pan fades to 0 and today's
     * reorder/stack behavior takes over fully (docs: 2026-09-10-drag-viewport-pan-design). */
    dragPanVerticalTolerancePx: number;
```

with:

```ts
    /** Whether dragging a window defaults to panning the viewport instead of immediately
     * reordering/stacking (docs: 2026-09-12-drag-pan-dwell-design). `false` disables panning
     * and the dwell-to-free gesture entirely — dragging behaves exactly as it would without
     * this feature. */
    dragPanEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, before a hold-to-free gesture can start
     * counting at all (docs: 2026-09-12-drag-pan-dwell-design). */
    dragPanVerticalTriggerPx: number;
    /** Horizontal drift, in pixels, allowed since a hold-to-free gesture started before it's
     * canceled (docs: 2026-09-12-drag-pan-dwell-design) — measured cumulatively from where the
     * hold began, not per tick, so ordinary hand tremor doesn't cancel it. */
    dragPanHorizontalTolerancePx: number;
    /** How long a hold-to-free gesture must be sustained before the drag is freed from pan mode
     * into today's normal reorder/stack/cross-strip-drag behavior, in milliseconds (docs:
     * 2026-09-12-drag-pan-dwell-design). */
    dragPanFreeDwellMs: number;
```

- [ ] **Step 4: Run the tests to verify they pass**

```sh
npx vitest run drift/src/config/settings.test.ts
```

Expected: PASS

- [ ] **Step 5: Run the full test suite**

```sh
make test
```

Expected: PASS. No other test file references `dragPanVerticalTolerancePx` outside `strip.test.ts`'s spread
of `DEFAULT_SETTINGS` (which picks up the new fields automatically, since it never named that field
explicitly) — confirm with `grep -rn "dragPanVerticalTolerancePx" drift/src`, which must return nothing.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` used for all three new setting names
- [ ] `make lint` passes
- [ ] `make test` passes
- [ ] `grep -rn "dragPanVerticalTolerancePx" drift/src` returns nothing

---

### Task 3: Replace `dragPanShouldPan` with the `dragPanHolding` predicate

**Files:**
- Modify: `drift/src/input/drag-pan.ts`
- Modify: `drift/src/input/drag-pan.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `drift/src/input/drag-pan.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { dragPanHolding } from './drag-pan';

describe('dragPanHolding', () => {
    it('is not holding before the vertical trigger is reached', () => {
        expect(dragPanHolding(19, 0, 20, 10)).toBe(false);
    });

    it('is holding once the vertical trigger is exactly reached, with no drift yet', () => {
        expect(dragPanHolding(20, 0, 20, 10)).toBe(true);
    });

    it('is holding once the vertical trigger is exceeded, with no drift yet', () => {
        expect(dragPanHolding(50, 0, 20, 10)).toBe(true);
    });

    it('stays holding while horizontal drift is under the tolerance', () => {
        expect(dragPanHolding(50, 9, 20, 10)).toBe(true);
        expect(dragPanHolding(50, -9, 20, 10)).toBe(true);
    });

    it('still holds when horizontal drift exactly equals the tolerance (inclusive boundary)', () => {
        expect(dragPanHolding(50, 10, 20, 10)).toBe(true);
        expect(dragPanHolding(50, -10, 20, 10)).toBe(true);
    });

    it('cancels the hold once horizontal drift exceeds the tolerance', () => {
        expect(dragPanHolding(50, 25, 20, 10)).toBe(false);
    });

    it('always holds at zero drift regardless of tolerance, once past the trigger', () => {
        expect(dragPanHolding(50, 0, 20, 0)).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```sh
npx vitest run drift/src/input/drag-pan.test.ts
```

Expected: FAIL — `dragPanHolding` is not exported from `./drag-pan` yet.

- [ ] **Step 3: Replace the implementation**

Replace the entire contents of `drift/src/input/drag-pan.ts` with:

```ts
// Pure geometry: whether a drag's current vertical pull and horizontal drift still qualify as
// "holding" for the dwell-to-free gesture — the single mechanism shared by every drag, no
// KWin/Grid/Viewport dependency (docs: 2026-09-12-drag-pan-dwell-design).

/** Whether this tick's cumulative vertical pull and horizontal drift-since-hold-started still
 * qualify as "holding" for the dwell-to-free gesture: true once `dyTotal` has crossed
 * `triggerPx`, as long as drift stays within `tolerancePx`. `driftSinceHoldStartPx` is 0 for
 * the tick that first arms the hold — there's no prior anchor yet to drift from. */
export function dragPanHolding(
    dyTotal: number,
    driftSinceHoldStartPx: number,
    triggerPx: number,
    tolerancePx: number,
): boolean {
    return dyTotal >= triggerPx && Math.abs(driftSinceHoldStartPx) <= tolerancePx;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```sh
npx vitest run drift/src/input/drag-pan.test.ts
```

Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` used for `dragPanHolding` and its parameters
- [ ] `make lint` passes
- [ ] `grep -rn "dragPanShouldPan" drift/src` returns nothing (fully replaced, not left dangling)

---

### Task 4: Wire the pin/dwell/freed/reseed logic into `registerDragReorder`

**Files:**
- Modify: `drift/src/input/drag.ts`

This is glue code wiring KWin/viewport/settings together — per this file's own existing documented
convention, it stays untested at the unit level (the pure logic it calls, `dragPanHolding`, is already
covered by Task 3). Verified instead by `make build` and manual live-testing (Task 8).

- [ ] **Step 1: Add the `WorkspaceAdapter` import**

Replace:

```ts
import { WindowAdapter } from '../kwin/window-adapter';
```

with:

```ts
import { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
```

- [ ] **Step 2: Update the `DragReorderDeps` interface**

Replace:

```ts
    /** Whether an almost-purely-horizontal drag pans the viewport instead of reordering
     * (`settings.dragPanEnabled`) — see `dragPanShouldPan` (docs:
     * 2026-09-10-drag-viewport-pan-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, past which drag-pan stops and today's
     * reorder/stack behavior applies (`settings.dragPanVerticalTolerancePx`) — see
     * `dragPanShouldPan`. */
    dragPanVerticalTolerancePx: number;
```

with:

```ts
    /** Whether dragging defaults to pan mode with a dwell-to-free gesture, or is fully inert
     * (`settings.dragPanEnabled`) — see `dragPanHolding` (docs: 2026-09-12-drag-pan-dwell-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical pull, in pixels, before a hold can start counting
     * (`settings.dragPanVerticalTriggerPx`) — see `dragPanHolding`. */
    dragPanVerticalTriggerPx: number;
    /** Horizontal drift, in pixels, allowed since a hold started before it's canceled
     * (`settings.dragPanHorizontalTolerancePx`) — see `dragPanHolding`. */
    dragPanHorizontalTolerancePx: number;
    /** Read access to the real pointer position — used to re-seed the dragged window's geometry
     * to its true cursor-relative position the instant a hold-to-free gesture fires, closing the
     * gap left by pinning `y` during pan mode in one write instead of leaving KWin's own tracking
     * to close it incrementally (docs: 2026-09-12-drag-pan-dwell-design). */
    workspace: Pick<WorkspaceAdapter, 'cursorPos'>;
    /** Builds the dwell timer for the pan-to-drag-mode hold gesture, firing `onFire` once held
     * past `dragPanFreeDwellMs` — one instance per drag-reorder connection, reused across every
     * drag that window does, same pattern as `createStackDwell` (docs:
     * 2026-09-12-drag-pan-dwell-design). */
    createPanFreeDwell(onFire: () => void): DwellTimer<true>;
```

- [ ] **Step 3: Update the `drag-pan` import**

Replace:

```ts
import { dragPanShouldPan } from './drag-pan';
```

with:

```ts
import { dragPanHolding } from './drag-pan';
```

- [ ] **Step 4: Add the new closure state to `registerDragReorder`**

Replace the function signature and its leading state block:

```ts
export function registerDragReorder(win: WindowAdapter, deps: DragReorderDeps, initiallyDragging = false): () => void {
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which stack target's compound key (`` `${columnId}:${tileId}:${direction}` ``) the
     * dwell has actually FIRED for — null while merely hovering, before the dwell elapses.
     * Only a fired key shows a preview. */
    let armedStackKey: string | null = null;
    /** The dragged window's real (screen) y at the start of the current drag — the baseline
     * `dragPanShouldPan`'s cumulative `dyTotal` is measured against. Seeded here (not just in
     * `onInteractiveMoveResizeStarted`) so an `initiallyDragging` connection — created
     * mid-drag by a cross-strip reparent — has a sane starting value even though it never
     * sees that signal fire (docs: 2026-09-10-drag-viewport-pan-design). */
    let startY = win.frameGeometry().y;
    /** The dragged window's real (screen) x as of the last tick — this tick's raw
     * horizontal delta (`dxTick`) is measured against it. */
    let lastX = win.frameGeometry().x;
```

with:

```ts
export function registerDragReorder(
    win: WindowAdapter,
    deps: DragReorderDeps,
    initiallyDragging = false,
    initiallyFreed = false,
): () => void {
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which stack target's compound key (`` `${columnId}:${tileId}:${direction}` ``) the
     * dwell has actually FIRED for — null while merely hovering, before the dwell elapses.
     * Only a fired key shows a preview. */
    let armedStackKey: string | null = null;
    /** The dragged window's real (screen) y at the start of the current drag — the baseline
     * `dragPanHolding`'s cumulative `dyTotal` is measured against. Seeded here (not just in
     * `onInteractiveMoveResizeStarted`) so an `initiallyDragging` connection — created
     * mid-drag by a cross-strip reparent — has a sane starting value even though it never
     * sees that signal fire (docs: 2026-09-12-drag-pan-dwell-design). */
    let startY = win.frameGeometry().y;
    /** The dragged window's real (screen) x as of the last tick — this tick's raw
     * horizontal delta (`dxTick`) is measured against it. */
    let lastX = win.frameGeometry().x;
    /** `startY` minus the real pointer's y at drag start — lets the freeing moment place the
     * window at exactly where an un-pinned drag would have put it (`cursorPos().y +
     * grabOffsetY`), instead of leaving KWin's own tracking to close the gap incrementally
     * (docs: 2026-09-12-drag-pan-dwell-design). */
    let grabOffsetY = startY - deps.workspace.cursorPos().y;
    /** The dragged window's real x when the current hold-to-free gesture started (null while
     * not holding) — horizontal drift is measured cumulatively from here, not per tick, so
     * ordinary hand tremor doesn't cancel the hold. */
    let holdStartX: number | null = null;
    /** Whether this drag has earned full reorder/stack/cross-strip-drag behavior. Starts at
     * `initiallyFreed` for a connection created mid-drag by a cross-strip reparent (see
     * `onEdgeDwellFired` in `strip-stack.ts`, which — by construction, since cross-strip moves
     * can only ever fire once already freed — always passes `true` there); every later
     * genuinely new drag on this same window/connection starts unfree again, same as
     * `dragging` always starts fresh rather than reusing `initiallyDragging`. */
    let freed = initiallyFreed;
    /** Re-entrancy guard: `win.setFrameGeometry` below fires `onFrameGeometryChanged`
     * synchronously, before the call returns, which would otherwise re-enter `tickInner`
     * mid-tick and corrupt `lastX`/the hold state (docs: 2026-09-12-drag-pan-dwell-design). */
    let applyingPin = false;
```

- [ ] **Step 5: Seed `grabOffsetY` and reset the new state in `onInteractiveMoveResizeStarted`**

Replace:

```ts
    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            lastX = rect.x;
            deps.onDragStarted?.(win);
        }
    });
```

with:

```ts
    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            lastX = rect.x;
            grabOffsetY = startY - deps.workspace.cursorPos().y;
            holdStartX = null;
            freed = false;
            deps.onDragStarted?.(win);
        }
    });
```

- [ ] **Step 6: Add the `panFreeDwell` instance**

Insert this right before the existing `const stackDwell = deps.createStackDwell(...)` block (same
pattern, same place a per-connection dwell instance is already built):

```ts
    // Fires once the hold-to-free gesture (dragPanHolding) has held steady past
    // dragPanFreeDwellMs. Re-seeds the window to its true pointer-relative position — closing
    // the gap `y`-pinning left behind in one write — then lets tickInner's normal reorder/stack
    // logic take over from the very next tick (docs: 2026-09-12-drag-pan-dwell-design).
    const panFreeDwell = deps.createPanFreeDwell(() => {
        freed = true;
        const raw = win.frameGeometry();
        const cursor = deps.workspace.cursorPos();
        applyingPin = true;
        win.setFrameGeometry({ x: raw.x, y: cursor.y + grabOffsetY, width: raw.width, height: raw.height });
        applyingPin = false;
    });
```

- [ ] **Step 7: Replace the pan step and add the re-entrancy guard**

Replace:

```ts
    const tickInner = (): void => {
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        // Pan step: while dragPanShouldPan holds, redirect this tick's raw horizontal
        // movement into the viewport instead of leaving it as real (reorder/stack-triggering)
        // movement. Must run before winEdges/resolveCurrentTarget below, since both read the
        // window's virtual position, which this changes via viewport.offset() (docs:
        // 2026-09-10-drag-viewport-pan-design). Uses setOffset, not the clamped scrollBy —
        // panning is allowed past the strip's content bounds (e.g. dragging the first column
        // further right); revealFocused() on release (see finishedInner) already animates the
        // viewport back into a valid, clamped position, so no clamping is needed here.
        const raw = win.frameGeometry();
        if (deps.dragPanEnabled) {
            const dyTotal = Math.abs(raw.y - startY);
            const dxTick = raw.x - lastX;
            if (dxTick !== 0 && dragPanShouldPan(dyTotal, deps.dragPanVerticalTolerancePx)) {
                deps.viewport.setOffset(deps.viewport.offset() - dxTick);
            }
        }
        lastX = raw.x;

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
```

with:

```ts
    const tickInner = (): void => {
        if (applyingPin) {
            // Re-entrant call caused by our own win.setFrameGeometry below — ignore it.
            return;
        }
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        // Pan step: while dragPanEnabled and not yet freed, the drag is pinned pan-only —
        // y stays at startY, x's movement redirects into the viewport instead of the window's
        // virtual position, and reorder/edge-expel/stack below never runs at all (the early
        // return, not just the offset math, is what makes that true — docs:
        // 2026-09-12-drag-pan-dwell-design). Gating on `deps.dragPanEnabled && !freed` together
        // (not `freed` alone) matters: `freed` never becomes true when the feature is disabled,
        // so gating on it alone would wrongly keep this block — and reorder/stack below —
        // blocked forever whenever dragPanEnabled is false.
        if (deps.dragPanEnabled && !freed) {
            const raw = win.frameGeometry();
            const dyTotal = Math.abs(raw.y - startY);
            const driftSinceHoldStartPx = holdStartX === null ? 0 : raw.x - holdStartX;
            if (dragPanHolding(dyTotal, driftSinceHoldStartPx, deps.dragPanVerticalTriggerPx, deps.dragPanHorizontalTolerancePx)) {
                holdStartX ??= raw.x;
                panFreeDwell.update(true);
            } else {
                holdStartX = null;
                panFreeDwell.update(null);
            }

            const dxTick = raw.x - lastX;
            if (dxTick !== 0) {
                deps.viewport.setOffset(deps.viewport.offset() - dxTick);
            }
            lastX = raw.x;

            applyingPin = true;
            win.setFrameGeometry({ x: raw.x, y: startY, width: raw.width, height: raw.height });
            applyingPin = false;
            // Every other tickInner exit path ends by calling deps.render(...) — this one must too,
            // or the viewport.setOffset() above only takes visible effect once finishedInner's
            // unconditional render() fires on release, instead of live during the drag. (Found
            // during Task 8's manual live-testing — the original version of this step omitted this
            // line, and panning was invisible until release.)
            deps.render(win.id, false);
            return;
        }

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
```

Note: `raw` is no longer computed once at the top of `tickInner` for the whole function — it's now local
to the pan-mode branch. The reorder/stack logic itself never used the `raw` variable directly (it uses
`windowEdgesVirtualX(win, ...)` and `win.frameGeometry()` calls of its own throughout `resolveCurrentTarget`
etc., all re-reading fresh) — but the debug logging immediately below `winEdges` does still reference `raw`,
and needs its own fresh read now that the top-of-function one is gone. Replace:

```ts
        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);

        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)}) ` +
                `raw=(${raw.x.toFixed(0)},${raw.y.toFixed(0)},${raw.width.toFixed(0)},${raw.height.toFixed(0)}) ` +
                `viewportOffset=${deps.viewport.offset().toFixed(0)}`,
        );
```

with:

```ts
        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);

        const raw = win.frameGeometry();
        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)}) ` +
                `raw=(${raw.x.toFixed(0)},${raw.y.toFixed(0)},${raw.width.toFixed(0)},${raw.height.toFixed(0)}) ` +
                `viewportOffset=${deps.viewport.offset().toFixed(0)}`,
        );
```

Beyond this one debug-logging read, there is no other use of a bare `raw` identifier anywhere else in
`tickInner`/`finishedInner` — every other read is `win.frameGeometry()` or `windowRectVirtual(win, ...)`
called directly where needed.

- [ ] **Step 8: Gate cross-strip forwarding on the same disabled-or-freed condition**

Replace:

```ts
    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        deps.onDragTick?.(win);
    });
```

with:

```ts
    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        // Cross-strip moves (StripStack.updateEdgeWatch, the only thing wired to onDragTick)
        // must be structurally impossible during active panning, not just unlikely — same
        // disabled-or-freed condition as the pin block in tickInner, and for the same reason:
        // freed never becomes true when the feature is disabled (docs:
        // 2026-09-12-drag-pan-dwell-design).
        if (!deps.dragPanEnabled || freed) {
            deps.onDragTick?.(win);
        }
    });
```

- [ ] **Step 9: Stop `panFreeDwell` everywhere `stackDwell` is stopped**

Replace each of the three occurrences below (in `finishedInner`, the `onInteractiveMoveResizeFinished`
error handler, and the returned disconnect function) by adding a `panFreeDwell.stop();` line immediately
after the existing `stackDwell.stop();` line in each of the three places:

In `finishedInner`:

```ts
        dragging = false;
        stackDwell.stop();
        armedStackKey = null;
```

becomes:

```ts
        dragging = false;
        stackDwell.stop();
        panFreeDwell.stop();
        armedStackKey = null;
```

In the `onInteractiveMoveResizeFinished` catch block:

```ts
            dragging = false;
            stackDwell.stop();
            armedStackKey = null;
            lastStackHover = null;
            deps.onDragFinished?.();
```

becomes:

```ts
            dragging = false;
            stackDwell.stop();
            panFreeDwell.stop();
            armedStackKey = null;
            lastStackHover = null;
            deps.onDragFinished?.();
```

In the returned disconnect function:

```ts
    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
    };
```

becomes:

```ts
    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
        panFreeDwell.stop();
    };
```

- [ ] **Step 10: Compile and lint**

```sh
make compile
npx eslint drift/src/input/drag.ts
```

Expected: both succeed. This step will not yet pass `make test`/`make build` end-to-end, since
`DragReorderDeps`'s two new required fields (`workspace`, `createPanFreeDwell`) aren't supplied by
`strip.ts` yet — that's Task 5. Confirm specifically that there are no TypeScript errors *inside
`drag.ts` itself* (the errors, if any at this point, should only be "missing property" errors at
`strip.ts`'s call site, not inside this file).

- [ ] **Step 11: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` used for all new variables/parameters
- [ ] No stray/dangling reference to `raw` (`grep -n "raw\." drift/src/input/drag.ts` shows exactly three
      legitimate, independently-scoped reads: inside the `if (deps.dragPanEnabled && !freed)` block, the
      debug-logging read right before the `debug(...)` call in the reorder/stack section, and inside
      `panFreeDwell`'s callback)
- [ ] `grep -n "dragPanShouldPan\|dragPanVerticalTolerancePx" drift/src/input/drag.ts` returns nothing

---

### Task 5: Supply the new `DragReorderDeps` fields from `Strip`

**Files:**
- Modify: `drift/src/runtime/strip.ts`

- [ ] **Step 1: Update the `registerDragReorder` deps object in `wireTile`**

Replace:

```ts
                    reorderThresholdFraction: this.settings.reorderThresholdFraction,
                    stackOverlapFraction: this.settings.stackOverlapFraction,
                    dragPanEnabled: this.settings.dragPanEnabled,
                    dragPanVerticalTolerancePx: this.settings.dragPanVerticalTolerancePx,
                    createStackDwell: (onFire: (key: string) => void) =>
```

with:

```ts
                    reorderThresholdFraction: this.settings.reorderThresholdFraction,
                    stackOverlapFraction: this.settings.stackOverlapFraction,
                    dragPanEnabled: this.settings.dragPanEnabled,
                    dragPanVerticalTriggerPx: this.settings.dragPanVerticalTriggerPx,
                    dragPanHorizontalTolerancePx: this.settings.dragPanHorizontalTolerancePx,
                    workspace: this.workspaceAdapter,
                    createPanFreeDwell: (onFire: () => void) =>
                        new DwellTimer<true>(
                            this.ticker.subscribe(),
                            () => Date.now(),
                            ANIMATION_TICK_MS,
                            this.settings.dragPanFreeDwellMs,
                            onFire,
                        ),
                    createStackDwell: (onFire: (key: string) => void) =>
```

- [ ] **Step 2: Compile, lint, and run the full test suite**

```sh
make build
```

Expected: PASS in full now — this closes out the type errors left open at the end of Task 4. No test
content changes needed in `strip.test.ts`: it already sets `dragPanEnabled: false` in its shared `SETTINGS`
fixture (with the comment explaining why — its drag tests simulate purely-horizontal drags and assert
immediate reorder/stack, which is exactly the behavior this feature would otherwise intercept), and it
already builds its settings via `{ ...DEFAULT_SETTINGS, ... }`, so the three new fields flow through
automatically without needing to be named there. Its existing `fakeWorkspaceAdapter()` already implements
`cursorPos()`, so `workspace: this.workspaceAdapter` needs no new test double either.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `make build` passes end-to-end (lint, test, compile, ui, bin-scripts, shaders)
- [ ] `grep -n "dragPanVerticalTolerancePx" drift/src/runtime/strip.ts` returns nothing

---

### Task 6: Thread `initiallyFreed` through the cross-strip reparent path

**Files:**
- Modify: `drift/src/runtime/strip.ts`
- Modify: `drift/src/runtime/strip-stack.ts`

- [ ] **Step 1: Add `initiallyFreed` to `Strip.wireTile`, `addWindow`, `addWindowStack`**

Replace:

```ts
    addWindow(win: WindowAdapter, initiallyDragging = false, stripDragHooks?: StripDragHooks): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        this.wireTile(win, column, column.focusedTileId, initiallyDragging, stripDragHooks);
```

with:

```ts
    addWindow(
        win: WindowAdapter,
        initiallyDragging = false,
        stripDragHooks?: StripDragHooks,
        initiallyFreed = false,
    ): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        this.wireTile(win, column, column.focusedTileId, initiallyDragging, stripDragHooks, initiallyFreed);
```

Replace:

```ts
    addWindowStack(windows: WindowAdapter[], initiallyDragging = false, stripDragHooks?: StripDragHooks): void {
        const [first, ...rest] = windows;
        if (first === undefined) {
            return;
        }
        const width = Math.round(first.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        this.wireTile(first, column, column.focusedTileId, initiallyDragging, stripDragHooks);
        for (const win of rest) {
            const tileId = column.addTile();
            this.wireTile(win, column, tileId, initiallyDragging, stripDragHooks);
        }
```

with:

```ts
    addWindowStack(
        windows: WindowAdapter[],
        initiallyDragging = false,
        stripDragHooks?: StripDragHooks,
        initiallyFreed = false,
    ): void {
        const [first, ...rest] = windows;
        if (first === undefined) {
            return;
        }
        const width = Math.round(first.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        this.wireTile(first, column, column.focusedTileId, initiallyDragging, stripDragHooks, initiallyFreed);
        for (const win of rest) {
            const tileId = column.addTile();
            this.wireTile(win, column, tileId, initiallyDragging, stripDragHooks, initiallyFreed);
        }
```

Replace:

```ts
    private wireTile(
        win: WindowAdapter,
        column: Column,
        tileId: number,
        initiallyDragging: boolean,
        stripDragHooks?: StripDragHooks,
    ): void {
```

with:

```ts
    private wireTile(
        win: WindowAdapter,
        column: Column,
        tileId: number,
        initiallyDragging: boolean,
        stripDragHooks?: StripDragHooks,
        initiallyFreed = false,
    ): void {
```

Replace the end of the `registerDragReorder(...)` call inside `wireTile`:

```ts
                    onDragTick: (draggedWin: WindowAdapter) => stripDragHooks?.onDragTick?.(draggedWin),
                    onDragFinished: () => stripDragHooks?.onDragFinished?.(),
                },
                initiallyDragging,
            ),
        );
    }
```

with:

```ts
                    onDragTick: (draggedWin: WindowAdapter) => stripDragHooks?.onDragTick?.(draggedWin),
                    onDragFinished: () => stripDragHooks?.onDragFinished?.(),
                },
                initiallyDragging,
                initiallyFreed,
            ),
        );
    }
```

- [ ] **Step 2: Thread `initiallyFreed` through `StripStack`'s options bag**

Replace both occurrences of the options type (in `addWindowsToStrip` and `moveFocusedWindowToStrip`):

```ts
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
```

with:

```ts
        options: { excludeWindowId?: string; initiallyDragging?: boolean; initiallyFreed?: boolean } = {},
```

In `addWindowsToStrip`, replace:

```ts
        if (windows.length === 1) {
            targetStrip.addWindow(windows[0], options.initiallyDragging ?? false, this.stripDragHooks());
        } else {
            targetStrip.addWindowStack(windows, options.initiallyDragging ?? false, this.stripDragHooks());
        }
```

with:

```ts
        if (windows.length === 1) {
            targetStrip.addWindow(
                windows[0],
                options.initiallyDragging ?? false,
                this.stripDragHooks(),
                options.initiallyFreed ?? false,
            );
        } else {
            targetStrip.addWindowStack(
                windows,
                options.initiallyDragging ?? false,
                this.stripDragHooks(),
                options.initiallyFreed ?? false,
            );
        }
```

- [ ] **Step 3: Pass `initiallyFreed: true` from the one call site that can only ever fire when already freed**

Replace:

```ts
    private onEdgeDwellFired(direction: EdgeDirection): void {
        if (this.draggedWindowId === null) {
            return;
        }
        const targetIndex = direction === 'above' ? this.activeStripIndex - 1 : this.activeStripIndex + 1;
        this.moveFocusedWindowToStrip(targetIndex, { excludeWindowId: this.draggedWindowId, initiallyDragging: true });
    }
```

with:

```ts
    private onEdgeDwellFired(direction: EdgeDirection): void {
        if (this.draggedWindowId === null) {
            return;
        }
        const targetIndex = direction === 'above' ? this.activeStripIndex - 1 : this.activeStripIndex + 1;
        // updateEdgeWatch — the only thing that can ever lead here — is only forwarded to at all
        // once a drag is already freed (drag.ts gates onDragTick on `!deps.dragPanEnabled ||
        // freed`), so this call site can only ever be reached from an already-freed drag:
        // initiallyFreed: true is correct unconditionally, not just a default (docs:
        // 2026-09-12-drag-pan-dwell-design).
        this.moveFocusedWindowToStrip(targetIndex, {
            excludeWindowId: this.draggedWindowId,
            initiallyDragging: true,
            initiallyFreed: true,
        });
    }
```

- [ ] **Step 4: Run the full test suite**

```sh
make test
```

Expected (corrected after this task surfaced a real gap in this plan): this is NOT a clean pass with zero
test changes. `strip-stack.test.ts` mocks `Strip.addWindow`/`addWindowStack` with `vi.fn()` and asserts on
them via `toHaveBeenCalledWith(win, initiallyDragging, expect.any(Object))` (or similar) — an EXACT-ARITY
assertion. Adding `initiallyFreed` as a 4th positional argument breaks 10 of these assertions purely on
argument count, regardless of the value passed — this has nothing to do with placement logic (which is
unaffected, as originally reasoned) and everything to do with Vitest's `toHaveBeenCalledWith` requiring an
exact argument list. Update each of the 10 affected assertions to add the correct 4th argument: `true` for
the two tests whose names mention "flips to the strip above/below once the dwell elapses" (these go through
`onEdgeDwellFired`, which this task makes pass `initiallyFreed: true`), and `false` for the other 8 (which
never set it explicitly, so it stays at its default). Only after that fix does `make build` pass in full.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` used for `initiallyFreed` throughout, matching `initiallyDragging`'s casing exactly
- [ ] `make build` passes end-to-end
- [ ] Every `wireTile`/`addWindow`/`addWindowStack` call site compiles without needing to pass
      `initiallyFreed` explicitly (it has a default everywhere) — confirm via `make compile`

---

### Task 7: Update the KCM settings dialog

**Files:**
- Modify: `drift/ui/config.ui`

`drift/contents/config/main.xml` needs no manual edit — it's generated from
`drift/src/config/settings-definitions.ts` by `drift/src/config/generate-main-xml.ts` at build time
(confirmed: no static `main.xml` file exists in the repo).

**Gap this task's original scope missed** (surfaced during review, not anticipated when this plan was
written): the pre-existing `kcfg_dragPanEnabled` checkbox's own text/tooltip in `config.ui` still describe
the OLD threshold-based pan behavior ("An almost-purely-horizontal drag pans the viewport instead of
reordering") — stale now that dragging always pans by default regardless of angle. Fix this in the same
task, since it sits directly above the three new rows and a reviewer will otherwise flag misleading text
right next to newly-accurate controls. Replace:

```xml
                                        <item row="5" column="1">
                                            <widget class="QCheckBox" name="kcfg_dragPanEnabled">
                                                <property name="toolTip">
                                                    <string>An almost-purely-horizontal drag pans the viewport instead of reordering the dragged window's column</string>
                                                </property>
                                                <property name="text">
                                                    <string>Pan the viewport on a horizontal drag</string>
                                                </property>
                                                <property name="checked">
                                                    <bool>true</bool>
                                                </property>
                                            </widget>
                                        </item>
```

with:

```xml
                                        <item row="5" column="1">
                                            <widget class="QCheckBox" name="kcfg_dragPanEnabled">
                                                <property name="toolTip">
                                                    <string>Dragging a window pans the viewport by default. Pull the window down or up and hold it steady to switch to normal reordering, stacking, or moving it to another strip.</string>
                                                </property>
                                                <property name="text">
                                                    <string>Pan the viewport by default while dragging a window</string>
                                                </property>
                                                <property name="checked">
                                                    <bool>true</bool>
                                                </property>
                                            </widget>
                                        </item>
```

- [ ] **Step 1: Replace the tolerance spin box with three new controls**

Replace:

```xml
                                        <item row="6" column="0">
                                            <widget class="QLabel" name="label_dragPanVerticalTolerancePx">
                                                <property name="text">
                                                    <string>Drag-pan vertical tolerance:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="6" column="1">
                                            <widget class="QSpinBox" name="kcfg_dragPanVerticalTolerancePx">
                                                <property name="toolTip">
                                                    <string>Cumulative vertical drag movement, in pixels, at which drag-pan fades out and reordering takes over fully</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>500</number>
                                                </property>
                                                <property name="value">
                                                    <number>40</number>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
```

with:

```xml
                                        <item row="6" column="0">
                                            <widget class="QLabel" name="label_dragPanVerticalTriggerPx">
                                                <property name="text">
                                                    <string>Drag-pan hold trigger distance:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="6" column="1">
                                            <widget class="QSpinBox" name="kcfg_dragPanVerticalTriggerPx">
                                                <property name="toolTip">
                                                    <string>Cumulative vertical drag movement, in pixels, before a hold-to-free gesture can start counting</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>500</number>
                                                </property>
                                                <property name="value">
                                                    <number>20</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="7" column="0">
                                            <widget class="QLabel" name="label_dragPanHorizontalTolerancePx">
                                                <property name="text">
                                                    <string>Drag-pan hold sideways tolerance:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="7" column="1">
                                            <widget class="QSpinBox" name="kcfg_dragPanHorizontalTolerancePx">
                                                <property name="toolTip">
                                                    <string>Horizontal drift, in pixels, allowed since a hold-to-free gesture started before it's canceled</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>500</number>
                                                </property>
                                                <property name="value">
                                                    <number>10</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="8" column="0">
                                            <widget class="QLabel" name="label_dragPanFreeDwellMs">
                                                <property name="text">
                                                    <string>Drag-pan hold-to-free dwell:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="8" column="1">
                                            <widget class="QSpinBox" name="kcfg_dragPanFreeDwellMs">
                                                <property name="toolTip">
                                                    <string>How long a hold-to-free gesture must be sustained before the drag is freed into normal reorder/stack/cross-strip-drag behavior</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> ms</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>2000</number>
                                                </property>
                                                <property name="value">
                                                    <number>400</number>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
```

- [ ] **Step 2: Build and confirm the KCM still compiles**

```sh
make build
```

Expected: PASS — `qmllint`/build steps don't validate `.ui` files beyond `make ui`'s plain copy, but this
confirms nothing else broke.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Widget object names follow the existing `kcfg_<settingName>`/`label_<settingName>` convention exactly
- [ ] `make build` passes
- [ ] `grep -n "dragPanVerticalTolerancePx" drift/ui/config.ui` returns nothing

---

### Task 8: Full verification and manual live-testing

**Files:** none (verification only)

- [ ] **Step 1: Full clean build**

```sh
make clean
make build
```

Expected: PASS in full — lint, test (all unit tests including the renamed `DwellTimer` suite and the new
`dragPanHolding` suite), compile, ui, bin-scripts, shaders.

- [ ] **Step 2: Install to a live session and manually verify each behavior from the design doc**

```sh
make install
make enable
```

Then, dragging real windows in the live session, confirm:
- A purely horizontal drag pans the viewport 1:1, with the dragged window's height never changing.
- Pulling a window down or up and holding it (without moving sideways) for about 400ms frees it — it starts
  tracking the cursor normally, with **no need for extra small nudges to catch up** (this is the bug the
  grab-offset reseed fixes; if it reappears, the reseed in Task 4 Step 5 has a mistake).
- Small sideways hand tremor while holding does *not* cancel the hold before 400ms (this is what the
  cumulative-drift-from-hold-start design, not a per-tick check, is for).
- While in pan mode (before freeing), dragging a window near the top/bottom screen edge does **not** trigger
  a cross-strip move — only after freeing does it become possible.
- Setting `dragPanEnabled` to `false` in the config dialog reproduces exactly today's pre-feature behavior:
  immediate reorder/stack from the first pixel of drag movement, no panning, no pinning.
- `docs/known_bugs.md` entry 1 (stack over-eager expel during pan) is not something this plan attempts to
  fix — if it reproduces during this pass, that's expected and not a regression to chase down here.

- [ ] **Step 3: Restore the session to a normal (non-freshly-enabled) state if needed**

No cleanup required beyond what `make install`/`make enable` already did — this is the real feature now,
not a spike, so it stays installed.

- [ ] **Step 4: Final coding-guideline follow-up checklist for the whole plan**

- [ ] `docs/coding-conventions.md` re-read once more against the full diff (`git diff`)
- [ ] `make build` passes with zero warnings
- [ ] `grep -rn "dragPanShouldPan\|dragPanVerticalTolerancePx\|EdgeDwell\|edge-dwell" drift/src` returns
      nothing anywhere in the codebase
- [ ] The design doc's Edge Cases and Out of Scope sections
      (`docs/agents/specs/2026-09-12-drag-pan-dwell-design.md`) are all accounted for by a task above or
      explicitly deferred (`docs/known_bugs.md` entry 1)
