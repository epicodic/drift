# Stack and Drag-Release Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate a stacked tile's y/height whenever a column's stack composition changes (live hover preview and commit alike), and ease the dragged window itself into its final slot on release instead of snapping there.

**Architecture:** Generalize the existing per-column x-position smoother (`ColumnMotion`) into a generic `AxisMotion<K>` and add two more instances to `Strip`, keyed by window id, driving tile y/height in `render()` exactly the way x already drives column position. On drag release, seed those motions (and, for a reorder, the column's own x motion) at the window's actual drop position before the commit's render — so the following animation eases from the drop point into the resolved slot instead of jumping.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-07-stack-and-release-motion-design.md` — read before implementing

---

## Task 1: Generalize `ColumnMotion` into `AxisMotion<K>`

Pure rename + generic key-type widening. No behavioral change — every existing case (`K = number`, column ids) must keep working identically.

**Files:**
- Create: `src/viewport/axis-motion.ts`
- Create: `src/viewport/axis-motion.test.ts`
- Delete: `src/viewport/column-motion.ts`
- Delete: `src/viewport/column-motion.test.ts`
- Modify: `src/runtime/strip.ts:28` (import) and `src/runtime/strip.ts:67` (instantiation)

- [ ] **Step 1: Write the new test file (carries over every existing case, generic key)**

```typescript
// src/viewport/axis-motion.test.ts
import { describe, expect, it } from 'vitest';
import { AxisMotion } from './axis-motion';

describe('AxisMotion', () => {
    it('snaps to the target the first time an id is seen (no animation)', () => {
        const motion = new AxisMotion<number>();

        const value = motion.update(1, 500, 0, 200);

        expect(value).toBe(500);
        expect(motion.isAnimating()).toBe(false);
    });

    it('animates toward a new target when it changes', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 500, 0, 200); // establishes resting at 500

        const value = motion.update(1, 900, 1000, 200);

        expect(value).toBe(500); // valueAt(elapsed=0) === "from"
        expect(motion.isAnimating()).toBe(true);
    });

    it('interpolates partway through the animation', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animate 0 -> 100 over 200ms, started at t=0

        const value = motion.update(1, 100, 100, 200); // same target, 100ms later

        expect(value).toBeCloseTo(87.5); // easeOutCubic(0.5) = 0.875
    });

    it('settles exactly at the target once the duration has elapsed, and stops animating', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200);

        const value = motion.update(1, 100, 200, 200);

        expect(value).toBe(100);
        expect(motion.isAnimating()).toBe(false);
    });

    it('retargets from the current interpolated value, not the old target, when the target changes mid-flight', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating 0 -> 100
        motion.update(1, 100, 100, 200); // now at ~87.5, still mid-flight

        const value = motion.update(1, 200, 100, 200); // retarget to 200, starting now

        expect(value).toBeCloseTo(87.5); // valueAt(0) of the new animation === its "from"
    });

    it('snapTo cancels any in-flight animation and rests at the given value immediately', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating

        motion.snapTo(1, 250);

        expect(motion.isAnimating()).toBe(false);
        expect(motion.update(1, 250, 100, 200)).toBe(250); // same target: rests, no animation
    });

    it('forget makes a later update treat the id as brand new (snaps instead of animating)', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);
        motion.update(1, 100, 0, 200); // animating 0 -> 100

        motion.forget(1);
        const value = motion.update(1, 999, 50, 200);

        expect(value).toBe(999);
        expect(motion.isAnimating()).toBe(false);
    });

    it('collapses to the target immediately with a zero duration', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);

        const value = motion.update(1, 500, 0, 0);

        expect(value).toBe(500);
        expect(motion.isAnimating()).toBe(false);
    });

    it('tracks multiple ids independently', () => {
        const motion = new AxisMotion<number>();
        motion.update(1, 0, 0, 200);
        motion.update(2, 1000, 0, 200);

        motion.update(1, 100, 0, 200); // only id 1 retargets

        expect(motion.isAnimating()).toBe(true);
        expect(motion.update(2, 1000, 100, 200)).toBe(1000); // id 2 untouched, still resting
    });

    it('works with a non-numeric key type (e.g. window id)', () => {
        const motion = new AxisMotion<string>();

        const value = motion.update('win-1', 42, 0, 200);

        expect(value).toBe(42);
    });
});
```

- [ ] **Step 2: Run the new test to verify it fails (module doesn't exist yet)**

`npm test -- src/viewport/axis-motion.test.ts`
Expected: FAIL — cannot find module `./axis-motion`

- [ ] **Step 3: Create `axis-motion.ts`**

```typescript
// src/viewport/axis-motion.ts
// Smooths a value toward wherever it should now rest, keyed by an arbitrary id — used both for
// a column's real x (reorder/layout changes, keyed by column id) and a tile's real y/height
// (stack changes, keyed by window id), so neighbors slide instead of jumping. Pure and
// KWin-free, driven entirely by an injected clock, like `Animation`/`Animator`.

import { Animation } from './animator';

export class AxisMotion<K> {
    private readonly targets = new Map<K, number>();
    private readonly resting = new Map<K, number>();
    private readonly animations = new Map<K, Animation>();
    private readonly startedAt = new Map<K, number>();

    /** Call once per id per render. Returns the value to actually draw at `nowMs`.
     * The first time an id is seen, it snaps straight to `target` — a brand-new or
     * just-restored id appears instantly, it never animates itself in. */
    update(id: K, target: number, nowMs: number, durationMs: number): number {
        if (!this.targets.has(id)) {
            this.snapTo(id, target);
            return target;
        }
        if (this.targets.get(id) !== target) {
            const from = this.currentValue(id, nowMs);
            this.targets.set(id, target);
            this.animations.set(id, new Animation(from, target, durationMs));
            this.startedAt.set(id, nowMs);
        }
        return this.currentValue(id, nowMs);
    }

    /** Forces `id` to rest at `value` immediately, cancelling any in-flight animation.
     * Used both to keep something tracking its logical value with zero lag (e.g. a live
     * interactive resize's neighbors), and to seed the *starting point* of a fresh
     * animation before the next `update()` call retargets it. */
    snapTo(id: K, value: number): void {
        this.targets.set(id, value);
        this.resting.set(id, value);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    /** Drops all tracked state for an id, so a later reappearance is treated as brand
     * new and snaps instead of animating from a stale pre-hide value. */
    forget(id: K): void {
        this.targets.delete(id);
        this.resting.delete(id);
        this.animations.delete(id);
        this.startedAt.delete(id);
    }

    isAnimating(): boolean {
        return this.animations.size > 0;
    }

    private currentValue(id: K, nowMs: number): number {
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

- [ ] **Step 4: Delete the old files**

```bash
rm src/viewport/column-motion.ts src/viewport/column-motion.test.ts
```

- [ ] **Step 5: Update `strip.ts`'s import and instantiation**

In `src/runtime/strip.ts:28`, change:
```typescript
import { ColumnMotion } from '../viewport/column-motion';
```
to:
```typescript
import { AxisMotion } from '../viewport/axis-motion';
```

In `src/runtime/strip.ts:67`, change:
```typescript
    private readonly columnMotion = new ColumnMotion();
```
to:
```typescript
    private readonly columnMotion = new AxisMotion<number>();
```

- [ ] **Step 6: Run the full test suite to verify everything still passes**

`npm test`
Expected: PASS — `axis-motion.test.ts` passes, and every existing `strip.test.ts` case referencing `columnMotion`/`snapColumn` behavior is unaffected (pure rename).

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`AxisMotion` PascalCase, `camelCase` methods/params)
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, trailing commas, 120-char limit)
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: Animate tile y/height in `Strip.render()`

**Files:**
- Modify: `src/runtime/strip.ts` (fields near line 67-69, `render()` body lines 120-216)
- Test: `src/runtime/strip.test.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Add this new describe block to `src/runtime/strip.test.ts`, right after the existing `describe('column-motion animation', ...)` block (before its closing `});` that ends the outer `describe('Strip', ...)` at line 928 — i.e. as a new top-level block alongside `describe('Strip — absorb/expel', ...)`):

```typescript
describe('Strip — stack motion animation', () => {
    it("animates a newly-stacked tile's y/height from its previous standalone position to its new stacked slot", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const timer = fakeTimer();
            const strip = new Strip(AREA, DEFAULT_SETTINGS, timer, fakeWorkspaceAdapter());
            const left = fakeWindow('left');
            const right = fakeWindow('right');
            strip.addWindow(left.adapter);
            strip.addWindow(right.adapter);
            strip.focusLeft();
            right.setFrameGeometry.mockClear();

            strip.absorbRight(); // right becomes left's second tile, stacked below

            // first frame: right hasn't jumped yet, still at its previous standalone y/height
            expect(right.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: 0, height: AREA.height }));

            vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs);
            timer.fire();

            const settled = right.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
            expect(settled.y).toBeGreaterThan(0); // now below its stack-mate
            expect(settled.height).toBeLessThan(AREA.height); // now sharing the column
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders a stacked tile at its exact logical y/height when instant=true, bypassing animation', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight();
        right.setFrameGeometry.mockClear();

        strip.render(undefined, true); // e.g. a live interactive-resize frame

        const rect = right.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
        expect(rect.y).toBeGreaterThan(0);
        expect(rect.height).toBeLessThan(AREA.height);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- src/runtime/strip.test.ts`
Expected: FAIL on the first new test — `right`'s first post-`absorbRight` frame already shows the final stacked `y`/`height` (no animation exists yet), so the "first frame unchanged" assertion fails.

- [ ] **Step 3: Implement tile y/height motion in `strip.ts`**

Add two fields next to `columnMotion` (`src/runtime/strip.ts`, in the field list starting at line 62):

```typescript
    private readonly columnMotion = new AxisMotion<number>();
    private readonly tileYMotion = new AxisMotion<string>();
    private readonly tileHeightMotion = new AxisMotion<string>();
```

In `render()`, replace the per-tile loop and the direct `column.tileRect`/preview-rect application (`src/runtime/strip.ts`, currently lines 182-198):

```typescript
            for (const tile of column.tiles()) {
                const key = this.tileKey(column.id, tile.id);
                if (this.fullScreenTiles.has(key) || this.minimizedTiles.has(key)) {
                    continue;
                }
                const win = this.registry.get(column.id, tile.id);
                if (!win || win.id === excludeWindowId) {
                    continue;
                }
                const rect = previewRects?.get(tile.id) ?? column.tileRect(tile.id, columnRect);
                this.geometrySync.apply(
                    win,
                    Object.assign({}, rect, { x }),
                    this.viewport.offset(),
                    this.verticalOffsetY,
                );
            }
```

with:

```typescript
            for (const tile of column.tiles()) {
                const key = this.tileKey(column.id, tile.id);
                if (this.fullScreenTiles.has(key) || this.minimizedTiles.has(key)) {
                    continue;
                }
                const win = this.registry.get(column.id, tile.id);
                if (!win || win.id === excludeWindowId) {
                    continue;
                }
                const targetRect = previewRects?.get(tile.id) ?? column.tileRect(tile.id, columnRect);
                let y: number;
                let height: number;
                if (instant) {
                    this.tileYMotion.snapTo(win.id, targetRect.y);
                    this.tileHeightMotion.snapTo(win.id, targetRect.height);
                    y = targetRect.y;
                    height = targetRect.height;
                } else {
                    y = this.tileYMotion.update(win.id, targetRect.y, Date.now(), this.settings.animationDurationMs);
                    height = this.tileHeightMotion.update(
                        win.id,
                        targetRect.height,
                        Date.now(),
                        this.settings.animationDurationMs,
                    );
                }
                this.geometrySync.apply(
                    win,
                    Object.assign({}, targetRect, { x, y, height }),
                    this.viewport.offset(),
                    this.verticalOffsetY,
                );
            }
```

Update the "keep ticking" check right after the column loop (currently `if (this.columnMotion.isAnimating()) {` around line 200):

```typescript
        if (this.columnMotion.isAnimating() || this.tileYMotion.isAnimating() || this.tileHeightMotion.isAnimating()) {
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- src/runtime/strip.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

`npm test`
Expected: PASS — no other test asserted an exact instantaneous stack y/height jump (the existing `commitTileIntoStack`/`absorb/expel` tests all use `INSTANT_SETTINGS`, i.e. `animationDurationMs: 0`, so `AxisMotion` collapses to the target immediately and their assertions are unaffected).

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: Forget tile motion on hide/fullscreen/remove

Mirrors every place `columnMotion.forget(columnId)` already runs, but per affected *window*.

**Files:**
- Modify: `src/runtime/strip.ts` (`removeWindow`, `detachColumn`, `eventDeps`'s `hideTile`/`setFullScreen`)
- Test: `src/runtime/strip.test.ts` (two new cases in `describe('Strip — stack motion animation', ...)` from Task 2)

- [ ] **Step 1: Write the failing tests**

Add these two cases inside the `describe('Strip — stack motion animation', ...)` block added in Task 2:

```typescript
    it("snaps a stack tile back into place after fullscreen instead of animating from its pre-fullscreen position", () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a');
        const b = fakeWindow('b');
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [a, b], b stacked below a
        b.setIsFullScreen(true);
        b.triggerFullScreenChanged(); // excluded from render; forgets b's y/height motion

        const c = fakeWindow('c');
        strip.addWindow(c.adapter); // pushes nothing here, but let's actually change the stack: absorb c too
        strip.focusLeft(); // back to the [a, b] column (still focused on a's tile)
        strip.absorbRight(); // column becomes [a, b, c] while b is still fullscreen-excluded

        b.setIsFullScreen(false);
        b.triggerFullScreenChanged(); // resumes rendering — must snap straight to its new 3-way slot

        const rect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
        // 3-way split of AREA.height, b in the middle slot — allow a couple of pixels of
        // rounding slack rather than assuming an exactly-integer-divisible split.
        expect(Math.abs(rect.height - AREA.height / 3)).toBeLessThanOrEqual(2);
        expect(Math.abs(rect.y - AREA.height / 3)).toBeLessThanOrEqual(2);
    });

    it('snaps a minimized stack tile back into place after restore instead of animating from its pre-minimize position', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a');
        const b = fakeWindow('b');
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [a, b]
        b.minimize(); // excluded from render; forgets b's y/height motion

        const c = fakeWindow('c');
        strip.addWindow(c.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column becomes [a, b, c] while b is still minimize-excluded

        b.restore(); // resumes rendering — must snap straight to its new 3-way slot

        const rect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
        expect(Math.abs(rect.height - AREA.height / 3)).toBeLessThanOrEqual(2);
        expect(Math.abs(rect.y - AREA.height / 3)).toBeLessThanOrEqual(2);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- src/runtime/strip.test.ts`
Expected: FAIL — without forgetting, `b`'s reappearance animates from its stale pre-hide `y`/`height` instead of snapping, so the first post-restore frame is mid-animation, not at the 3-way split.

- [ ] **Step 3: Implement the forget calls**

In `eventDeps()` (`src/runtime/strip.ts`), change `hideTile`:

```typescript
            hideTile: (columnId, tileId) => {
                const column = this.grid.column(columnId);
                if (column !== null && column.tileCount() > 1) {
                    this.minimizedTiles.add(this.tileKey(columnId, tileId));
                    const win = this.registry.get(columnId, tileId);
                    if (win) {
                        this.tileYMotion.forget(win.id);
                        this.tileHeightMotion.forget(win.id);
                    }
                    return;
                }
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
```

Change `setFullScreen`:

```typescript
            setFullScreen: (columnId, tileId, fullScreen) => {
                const key = this.tileKey(columnId, tileId);
                if (fullScreen) {
                    this.fullScreenTiles.add(key);
                    this.columnMotion.forget(columnId);
                    const win = this.registry.get(columnId, tileId);
                    if (win) {
                        this.tileYMotion.forget(win.id);
                        this.tileHeightMotion.forget(win.id);
                    }
                } else {
                    this.fullScreenTiles.delete(key);
                }
            },
```

In `removeWindow` (`src/runtime/strip.ts`, the multi-tile branch), add the two forgets alongside the existing `geometrySync.forget`:

```typescript
    removeWindow(win: WindowAdapter): void {
        const location = this.registry.tileOf(win.id);
        if (location === null) {
            return;
        }
        const column = this.grid.column(location.columnId);
        if (column !== null && column.tileCount() > 1) {
            this.registry.deleteTile(location.columnId, location.tileId);
            column.removeTile(location.tileId);
            this.geometrySync.forget(win.id);
            this.tileYMotion.forget(win.id);
            this.tileHeightMotion.forget(win.id);
            this.fullScreenTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.minimizedTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.render();
            this.revealFocused();
            return;
        }
        this.detachColumn(location.columnId, [win]);
    }
```

In `detachColumn`, add the two forgets inside the existing `for (const win of windows)` loop:

```typescript
    private detachColumn(columnId: number, windows: WindowAdapter[]): void {
        this.registry.deleteColumn(columnId);
        for (const win of windows) {
            this.geometrySync.forget(win.id);
            this.tileYMotion.forget(win.id);
            this.tileHeightMotion.forget(win.id);
        }
        this.fullScreenTiles.forEach((key) => {
            if (key.startsWith(`${columnId}:`)) {
                this.fullScreenTiles.delete(key);
            }
        });
        this.minimizedTiles.forEach((key) => {
            if (key.startsWith(`${columnId}:`)) {
                this.minimizedTiles.delete(key);
            }
        });
        this.columnMotion.forget(columnId);
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }
```

Add a short clarifying comment above `absorbRight`'s and `commitTileIntoStack`'s bodies explaining the deliberate *absence* of a forget call there — open `src/runtime/strip.ts` and update the doc comment directly above `absorbRight` (currently starting `/** Absorb: pull the column...`) by appending one sentence, and similarly for `commitTileIntoStack`:

```typescript
    /** Absorb: pull the column to the right of the focused one into its stack, as a
     * new tile at the bottom. No-op if there's no right neighbor or it's already a
     * stack (docs: 2026-09-03-vertical-tiling-design). Deliberately does not forget the
     * absorbed window's tile y/height motion: its old position is exactly the intended
     * starting point for the stack-entry animation, not a stale value to discard (docs:
     * 2026-09-07-stack-and-release-motion-design). */
    absorbRight(): void {
```

```typescript
    /** Moves `fromTileId` out of `fromColumnId` and into `toColumnId` at `slot` —
     * the general, drag-driven form of `absorbRight`, for any source/target pair.
     * `fromColumnId` must differ from `toColumnId`; same-column reordering goes
     * through `Column.moveTile` directly (see drag.ts), which needs no registry or
     * bookkeeping changes at all (docs: 2026-09-03-drag-to-stack-design). Also deliberately
     * does not forget the moved window's tile y/height motion — see `absorbRight`. */
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void {
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- src/runtime/strip.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

`npm test`
Expected: PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: Ease the dragged window into place on release

Replaces the hard `snapColumn`-to-final-slot on drag release with seeding the relevant motions at the window's actual drop position, so the following render eases it in.

**Files:**
- Modify: `src/input/drag.ts` (`DragReorderDeps` interface, `finishedInner`)
- Modify: `src/runtime/strip.ts` (new `seedReorderRelease`/`seedStackRelease` methods, `wireTile`'s deps wiring)
- Test: `src/runtime/strip.test.ts` (new describe blocks)

- [ ] **Step 1: Write the failing tests**

Add these two new top-level describe blocks to `src/runtime/strip.test.ts`, after `describe('Strip — live reorder commit', ...)`:

```typescript
describe('Strip — reorder release eases into place', () => {
    it('eases the dragged column from its drop position into its resolved slot, instead of snapping', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const timer = new ManualTimer();
            const workspaceAdapter = fakeWorkspaceAdapter();
            const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, timer, workspaceAdapter);
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter); // col a @ x=0
            strip.addWindow(b.adapter); // col b @ x=808

            const aRealX = a.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;
            const bRealX = b.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;

            b.startDrag();
            const dropX = aRealX + 50; // deep enough into a to trigger the live swap
            b.setFrameGeometryValue({ x: dropX, y: 0, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 }); // commits the swap live

            b.finishDrag();

            // right after release: eased in from the actual drop point, not snapped to the resolved slot
            const rightAfterRelease = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { x: number };
            expect(rightAfterRelease.x).toBe(dropX);

            vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs);
            timer.fire();

            const settled = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { x: number };
            expect(settled.x).toBe(aRealX); // now resting exactly at its resolved (swapped-into) slot
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Strip — stack release eases into place', () => {
    it("eases the dragged tile from its drop y/height into its resolved cross-column stack slot", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const strip = new Strip(
                WIDE_AREA,
                { ...DEFAULT_SETTINGS, columnDragDwellMs: 100 },
                timer,
                workspaceAdapter,
            );
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter);
            strip.addWindow(b.adapter);
            const bRealX = b.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;

            b.startDrag();
            // Dragged down to y=100 (its own live screen position, e.g. wherever the cursor
            // left it — distinct from both its pre-drag y=0 and its eventual resolved slot
            // y=0, so the assertions below can't pass by coincidence). topFraction = 100/1000
            // = 0.1, comfortably under resolveStackTarget's 0.25 'above' threshold, so this
            // still resolves to the 'above' direction (see the equivalent dwell-preview test
            // for the rest of the geometry rationale).
            b.setFrameGeometryValue({ x: 200, y: 100, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 }); // arms the dwell

            vi.setSystemTime(100);
            timer.fire(); // dwell elapses, resolves+previews the cross-column stack target

            b.finishDrag(); // commits the cross-column stack move

            // right after release: eased in from the actual drop y/height, not snapped to the
            // resolved slot
            const rightAfterRelease = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as {
                y: number;
                height: number;
            };
            expect(rightAfterRelease.y).toBe(100);
            expect(rightAfterRelease.height).toBe(1000);

            vi.setSystemTime(100 + DEFAULT_SETTINGS.animationDurationMs);
            timer.fire();

            const settled = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
            expect(settled.y).toBe(0); // top slot of the 2-tile stack
            expect(settled.height).toBeLessThan(1000); // redistributed within the stack
        } finally {
            vi.useRealTimers();
        }
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- src/runtime/strip.test.ts`
Expected: FAIL on both new tests — with today's `deps.snapColumn(...)`, the reorder test's `rightAfterRelease.x` is already `aRealX` (snapped) instead of `dropX`; the stack test's `rightAfterRelease.y` is already `0` (snapped, since there is no seeding at all yet) instead of `300`.

- [ ] **Step 3: Add `seedReorderRelease`/`seedStackRelease` to `Strip`**

Add these two methods right after `snapColumn` in `src/runtime/strip.ts` (which stays as-is — it's still used by `moveWindowLeft`/`moveWindowRight`/`moveWindowToStart`/`moveWindowToEnd`):

```typescript
    /** Forces `columnId`'s position animation to rest at its current logical x with no
     * easing — used to settle the dragged column instantly on drag-reorder release
     * while its neighbors keep animating (docs: 2026-08-31-drag-reorder-live-preview). */
    snapColumn(columnId: number): void {
        this.columnMotion.snapTo(columnId, this.grid.columnRect(columnId).x);
    }

    /** Seeds a just-finished drag-reorder's column at its actual drop position (real
     * x/y/height, already converted to virtual/area-relative coordinates by the caller)
     * instead of hard-snapping to the resolved slot — the very next `render()` then
     * eases it in rather than jumping there. Replaces the previous unconditional
     * `snapColumn`-to-final-slot on a reorder release (docs:
     * 2026-09-07-stack-and-release-motion-design). */
    seedReorderRelease(windowId: string, columnId: number, virtualX: number, virtualY: number, height: number): void {
        this.columnMotion.snapTo(columnId, virtualX);
        this.tileYMotion.snapTo(windowId, virtualY);
        this.tileHeightMotion.snapTo(windowId, height);
    }

    /** Same idea as `seedReorderRelease`, for a stack drop: seeds the dropped tile's
     * actual drop y/height so the next `render()` eases it into its resolved stack slot.
     * Column x is deliberately left untouched — a cross-column drop's horizontal
     * position still snaps to the target column's x (docs:
     * 2026-09-07-stack-and-release-motion-design). */
    seedStackRelease(windowId: string, virtualY: number, height: number): void {
        this.tileYMotion.snapTo(windowId, virtualY);
        this.tileHeightMotion.snapTo(windowId, height);
    }
```

- [ ] **Step 4: Wire the new methods into `wireTile`'s deps object**

In `src/runtime/strip.ts`'s `wireTile`, replace:

```typescript
                        snapColumn: (id: number) => this.snapColumn(id),
```

with:

```typescript
                        seedReorderRelease: (
                            windowId: string,
                            columnId: number,
                            virtualX: number,
                            virtualY: number,
                            height: number,
                        ) => this.seedReorderRelease(windowId, columnId, virtualX, virtualY, height),
                        seedStackRelease: (windowId: string, virtualY: number, height: number) =>
                            this.seedStackRelease(windowId, virtualY, height),
```

- [ ] **Step 5: Update `DragReorderDeps` and `finishedInner` in `src/input/drag.ts`**

Replace the `snapColumn` line in the `DragReorderDeps` interface:

```typescript
    snapColumn(columnId: number): void;
```

with:

```typescript
    /** Seeds the dragged column's x (and the window's own y/height) motion at its
     * actual drop position on a reorder settle, so it eases into its final slot instead
     * of snapping (docs: 2026-09-07-stack-and-release-motion-design). */
    seedReorderRelease(windowId: string, columnId: number, virtualX: number, virtualY: number, height: number): void;
    /** Same idea for a stack drop: seeds the dropped tile's y/height at its actual drop
     * position (column x is intentionally left alone for a cross-column drop — docs:
     * 2026-09-07-stack-and-release-motion-design). */
    seedStackRelease(windowId: string, virtualY: number, height: number): void;
```

Replace `finishedInner`'s body (currently):

```typescript
    const finishedInner = (): void => {
        if (!dragging) {
            debug('drag finished: ignored, dragging flag already false');
            return;
        }
        dragging = false;
        stackDwell.stop();
        armedStackKey = null;
        const location = currentLocation();
        debug(
            `drag finished: win=${win.id} loc=${location ? `col${location.columnId}/tile${location.tileId}` : 'null'}`,
        );
        if (location === null) {
            deps.onDragFinished?.();
            return;
        }
        if (lastStackHover === null) {
            // Reorder already committed live, tick by tick — nothing left to apply here
            // except settling the dragged column's own animation at its final real slot.
            deps.snapColumn(location.columnId);
        } else if (lastStackHover.columnId === location.columnId) {
            requireColumn(deps.grid, location.columnId).moveTile(location.tileId, lastStackHover.slot);
        } else {
            deps.commitTileIntoStack(location.columnId, location.tileId, lastStackHover.columnId, lastStackHover.slot);
        }
        lastStackHover = null;
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    };
```

with:

```typescript
    const finishedInner = (): void => {
        if (!dragging) {
            debug('drag finished: ignored, dragging flag already false');
            return;
        }
        dragging = false;
        stackDwell.stop();
        armedStackKey = null;
        const location = currentLocation();
        debug(
            `drag finished: win=${win.id} loc=${location ? `col${location.columnId}/tile${location.tileId}` : 'null'}`,
        );
        if (location === null) {
            deps.onDragFinished?.();
            return;
        }
        // The window's own actual position/size right at release — the animation's intended
        // starting point, converted to the same virtual-x/area-relative-y coordinate space
        // Grid/Column already produce (docs: 2026-09-07-stack-and-release-motion-design).
        const dropRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
        if (lastStackHover === null) {
            // Reorder already committed live, tick by tick — seed the dragged column's own
            // motion at its actual drop point so it eases into its final slot.
            deps.seedReorderRelease(win.id, location.columnId, dropRect.x, dropRect.y, dropRect.height);
        } else if (lastStackHover.columnId === location.columnId) {
            deps.seedStackRelease(win.id, dropRect.y, dropRect.height);
            requireColumn(deps.grid, location.columnId).moveTile(location.tileId, lastStackHover.slot);
        } else {
            deps.seedStackRelease(win.id, dropRect.y, dropRect.height);
            deps.commitTileIntoStack(location.columnId, location.tileId, lastStackHover.columnId, lastStackHover.slot);
        }
        lastStackHover = null;
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    };
```

- [ ] **Step 6: Run the tests to verify they pass**

`npm test -- src/runtime/strip.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite**

`npm test`
Expected: PASS — `Strip — drag handler after column membership changes (regression)` and every other existing drag test go through the same `finishedInner` path; since they all use `INSTANT_SETTINGS` (`animationDurationMs: 0`), the seed-then-animate sequence collapses to the same final rect immediately, so none of their assertions change.

- [ ] **Step 8: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: Update documentation

**Files:**
- Modify: `docs/algorithms.md` (lines 89-98)
- Modify: `docs/glossary.md` (line 49)

- [ ] **Step 1: Update `docs/algorithms.md`**

Replace the "Layout-Change Position Animation" section (currently):

```markdown
## Layout-Change Position Animation

Source: [`ColumnMotion`](../src/viewport/column-motion.ts) in `column-motion.ts`, driven by [`Strip.render`](../src/runtime/strip.ts) in `strip.ts`, sharing a `Timer` with the camera's `Animator` via [`SharedTicker`](../src/viewport/shared-ticker.ts).

Whenever a column's logical x changes for a reason other than the user actively dragging or resizing it — adding, removing, or minimizing/restoring a window, a resize pushing a neighbor, or a drag-reorder settling on release — `ColumnMotion` animates that column's real x from wherever it currently visually is to the new logical x, using the same eased duration as the camera (`settings.animationDurationMs` / `easeOutCubic`).
A column is never animated on its own first appearance (add, restore, returning from fullscreen): `ColumnMotion` snaps a never-seen-before column straight to its target, so only *already-visible* neighbors slide.

Border-drag resize stays fully instant: `Strip.render`'s `instant` flag makes `ColumnMotion` snap straight to the target instead of animating for those frames.
Window drag-reorder is the exception: neighbors displaced by a live reorder tick, or by the settle on release, animate like any other layout change; only the dragged column itself is forced instant, via `Strip.snapColumn` on release.
`Strip` forgets a column's motion state whenever it is hidden (minimized) or excluded (fullscreen), so that restoring it later snaps to its new position instead of animating in from a stale pre-hide value.
```

with:

```markdown
## Layout-Change Position Animation

Source: [`AxisMotion`](../src/viewport/axis-motion.ts) in `axis-motion.ts`, driven by [`Strip.render`](../src/runtime/strip.ts) in `strip.ts`, sharing a `Timer` with the camera's `Animator` via [`SharedTicker`](../src/viewport/shared-ticker.ts). `Strip` owns three independent `AxisMotion` instances: one for a column's real x (keyed by column id), and two for a tile's real y/height (keyed by window id, since a tile id is only stable within one column — a stack move reassigns it in the target column).

Whenever a column's logical x changes for a reason other than the user actively dragging or resizing it — adding, removing, or minimizing/restoring a window, a resize pushing a neighbor, a drag-reorder settling on release, or (for the tile y/height case) a stack composition change — `AxisMotion` animates the real value from wherever it currently visually is to the new logical value, using the same eased duration as the camera (`settings.animationDurationMs` / `easeOutCubic`). This covers stacking a window into a column, removing one from a stack, and reordering within a stack, live-hover preview and commit alike.
A column/tile is never animated on its own first appearance (add, restore, returning from fullscreen): `AxisMotion` snaps a never-seen-before id straight to its target, so only *already-visible* neighbors slide.

Border-drag resize stays fully instant: `Strip.render`'s `instant` flag makes `AxisMotion` snap straight to the target instead of animating for those frames.
The dragged window's own release is *not* forced instant: `Strip.seedReorderRelease`/`Strip.seedStackRelease` seed its motion at its actual drop position right before the commit's render, so it eases from wherever it was dropped into its resolved slot instead of snapping there — for both a reorder settle and a stack commit. The one exception is a cross-column stack drop's horizontal position, which still snaps to the target column's x (`seedStackRelease` only seeds y/height) — a deliberate simplification, since every tile in a column shares one animated x.
`Strip` forgets a tile's motion state whenever it is hidden (minimized) or excluded (fullscreen), so that restoring it later snaps to its new position instead of animating in from a stale pre-hide value. It deliberately does *not* forget a tile's y/height motion when the tile moves into or out of a stack (`absorbRight`/`commitTileIntoStack`): its old position is exactly the intended starting point for the stack-entry animation.
```

- [ ] **Step 2: Update `docs/glossary.md`**

Replace line 49:

```markdown
- **ColumnMotion** — animates a column's real x from wherever it currently sits to its new logical x whenever the layout changes for a reason other than the user actively dragging or resizing it ([`src/viewport/column-motion.ts`](../src/viewport/column-motion.ts)).
```

with:

```markdown
- **AxisMotion** — animates a value (a column's real x, or a tile's real y/height) from wherever it currently sits to its new logical value whenever the layout changes for a reason other than the user actively dragging or resizing it; `Strip` owns three independent instances, keyed by column id (x) or window id (y, height) ([`src/viewport/axis-motion.ts`](../src/viewport/axis-motion.ts)).
```

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md` (Markdown docs aren't covered by it, but `docs/writing-documentation` conventions — one sentence per line — do not apply retroactively to this file's existing prose style; match the surrounding paragraph style already in `algorithms.md`/`glossary.md`)
- [ ] Task-level verification: re-read both edited sections for accuracy against the actual code from Tasks 1-4

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

`npm test`
Expected: PASS, all suites

- [ ] **Step 2: Run lint**

`npm run lint`
Expected: PASS — no TypeScript/ESLint/qmllint violations

- [ ] **Step 3: Run the build**

`npm run build`
Expected: PASS

- [ ] **Step 4: Grep for any stray reference to the old names**

```bash
grep -rn "ColumnMotion\|column-motion\|snapColumn(location" src docs --include="*.ts" --include="*.md"
```

Expected: no output referring to the deleted `ColumnMotion`/`column-motion.ts` names (an unrelated `Strip.snapColumn` method itself is expected to still exist and match — that's fine, it's still used by the keyboard-driven `moveWindowLeft`/`moveWindowRight`/`moveWindowToStart`/`moveWindowToEnd`).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] All prior tasks' checklists passed
- [ ] No placeholder/TODO left behind
- [ ] Spec (`docs/agents/specs/2026-09-07-stack-and-release-motion-design.md`) fully implemented — re-check each section against the actual diff
