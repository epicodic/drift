# Column Align-Cycle Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Meta+Shift+Left`/`Meta+Shift+Right` shortcuts that cycle the focused column through left-aligned → centered → right-aligned viewport positions, and on a further press move focus to the next/previous column and continue the cycle there; make all 5 keyboard shortcuts configurable via `kwinrc`.

**Architecture:** A new pure module (`src/viewport/align-cycle.ts`) derives the current cycle phase from the viewport's actual offset (no stored state) and returns the next target offset or a "cross to neighbor" signal. `Strip` gains `cycleAlignLeft()`/`cycleAlignRight()` that wire this into `Grid`/`Viewport`/`Animator`. `Settings` gains 5 shortcut fields read from `kwinrc`, and `shortcuts.ts`/`Controller` are updated to use them.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-08-30-column-align-cycle-design.md` — read before implementing

---

### Task 1: Pure align-cycle logic

**Files:**
- Create: `src/viewport/align-cycle.ts`
- Test: `src/viewport/align-cycle.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { alignOffsets, nextAlignStep } from './align-cycle';

describe('alignOffsets', () => {
    it('computes candidates for a column narrower than the viewport', () => {
        expect(alignOffsets(100, 400, 1000)).toEqual({ left: 100, center: -200, right: -500 });
    });

    it('computes candidates for a column exactly as wide as the viewport', () => {
        expect(alignOffsets(50, 1000, 1000)).toEqual({ left: 50, center: 50, right: 50 });
    });

    it('computes candidates for a column wider than the viewport', () => {
        expect(alignOffsets(0, 1500, 1000)).toEqual({ left: 0, center: 250, right: 500 });
    });
});

describe('nextAlignStep — direction "right"', () => {
    const offsets = { left: 0, center: 100, right: 200 };

    it('advances from left to center', () => {
        expect(nextAlignStep('right', 0, offsets)).toEqual({ targetOffset: 100, crossToNeighbor: false });
    });

    it('advances from center to right', () => {
        expect(nextAlignStep('right', 100, offsets)).toEqual({ targetOffset: 200, crossToNeighbor: false });
    });

    it('crosses to the neighbor from right', () => {
        expect(nextAlignStep('right', 200, offsets)).toEqual({ targetOffset: 0, crossToNeighbor: true });
    });

    it('starts at left when the current offset matches none of the three', () => {
        expect(nextAlignStep('right', 999, offsets)).toEqual({ targetOffset: 0, crossToNeighbor: false });
    });

    it('tolerates sub-pixel rounding when matching the current offset', () => {
        expect(nextAlignStep('right', 100.4, offsets)).toEqual({ targetOffset: 200, crossToNeighbor: false });
    });
});

describe('nextAlignStep — direction "left"', () => {
    const offsets = { left: 0, center: 100, right: 200 };

    it('advances from right to center', () => {
        expect(nextAlignStep('left', 200, offsets)).toEqual({ targetOffset: 100, crossToNeighbor: false });
    });

    it('advances from center to left', () => {
        expect(nextAlignStep('left', 100, offsets)).toEqual({ targetOffset: 0, crossToNeighbor: false });
    });

    it('crosses to the neighbor from left', () => {
        expect(nextAlignStep('left', 0, offsets)).toEqual({ targetOffset: 200, crossToNeighbor: true });
    });

    it('starts at right when the current offset matches none of the three', () => {
        expect(nextAlignStep('left', 999, offsets)).toEqual({ targetOffset: 200, crossToNeighbor: false });
    });
});

describe('nextAlignStep — degenerate column (no room to realign)', () => {
    const offsets = { left: 50, center: 50, right: 50 };

    it('crosses immediately for direction "right", regardless of the current offset', () => {
        expect(nextAlignStep('right', 50, offsets)).toEqual({ targetOffset: 50, crossToNeighbor: true });
        expect(nextAlignStep('right', 999, offsets)).toEqual({ targetOffset: 999, crossToNeighbor: true });
    });

    it('crosses immediately for direction "left", regardless of the current offset', () => {
        expect(nextAlignStep('left', 50, offsets)).toEqual({ targetOffset: 50, crossToNeighbor: true });
        expect(nextAlignStep('left', 999, offsets)).toEqual({ targetOffset: 999, crossToNeighbor: true });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run `npm test -- align-cycle`
Expected: FAIL — cannot find module `./align-cycle`

- [ ] **Step 3: Write minimal implementation**

```typescript
// Pure phase-cycling logic for the Meta+Shift+Left/Right "cycle align" shortcuts:
// left-aligned -> centered -> right-aligned -> neighboring column, and back. Derives
// the current phase from the viewport's actual offset instead of storing one, so it
// self-corrects if anything else moved the viewport between presses (docs: see
// docs/agents/specs/2026-08-30-column-align-cycle-design.md).

export interface AlignOffsets {
    left: number;
    center: number;
    right: number;
}

/** The 3 candidate scroll offsets that place a column at `rectX`/`rectWidth` at the
 * left edge, centered, or the right edge of a `viewportWidth`-wide viewport.
 * Unclamped — the caller clamps each field with `Viewport.clampOffset` before use. */
export function alignOffsets(rectX: number, rectWidth: number, viewportWidth: number): AlignOffsets {
    return {
        left: rectX,
        center: rectX + rectWidth / 2 - viewportWidth / 2,
        right: rectX + rectWidth - viewportWidth,
    };
}

export type AlignDirection = 'left' | 'right';

export interface AlignStep {
    targetOffset: number;
    crossToNeighbor: boolean;
}

/** Next step in the align cycle for `direction`, given the viewport's current (clamped)
 * offset and the focused column's already-clamped candidate offsets. When
 * `crossToNeighbor` is true, `targetOffset` is not meaningful — the caller re-runs this
 * against the newly-focused column instead. */
export function nextAlignStep(direction: AlignDirection, currentOffset: number, offsets: AlignOffsets): AlignStep {
    const current = Math.round(currentOffset);
    const left = Math.round(offsets.left);
    const center = Math.round(offsets.center);
    const right = Math.round(offsets.right);

    // No room to reposition within this column (e.g. the whole strip already fits in
    // the viewport, or the column is pinned against the content's edge): `center`
    // clamps to the same value too, since it always lies between `left` and `right`.
    if (left === right) {
        return { targetOffset: currentOffset, crossToNeighbor: true };
    }

    if (direction === 'right') {
        if (current === right) {
            return { targetOffset: offsets.left, crossToNeighbor: true };
        }
        if (current === center) {
            return { targetOffset: offsets.right, crossToNeighbor: false };
        }
        if (current === left) {
            return { targetOffset: offsets.center, crossToNeighbor: false };
        }
        return { targetOffset: offsets.left, crossToNeighbor: false };
    }

    if (current === left) {
        return { targetOffset: offsets.right, crossToNeighbor: true };
    }
    if (current === center) {
        return { targetOffset: offsets.left, crossToNeighbor: false };
    }
    if (current === right) {
        return { targetOffset: offsets.center, crossToNeighbor: false };
    }
    return { targetOffset: offsets.right, crossToNeighbor: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run `npm test -- align-cycle`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`camelCase` functions, `PascalCase`/`type` for the exported types, lowercase kebab-case filename)
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, semicolons, 120-char limit, explicit imports)
- [ ] `npm test -- align-cycle` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `Viewport.clampOffset`

**Files:**
- Modify: `src/viewport/viewport.ts`
- Test: `src/viewport/viewport.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `src/viewport/viewport.test.ts`, right after the existing `describe('Viewport — scrolling and clamping', ...)` block:

```typescript
describe('Viewport — clampOffset', () => {
    it('clamps below the content origin up to it', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(200, 3000);
        expect(viewport.clampOffset(-50)).toBe(200);
    });

    it('clamps above the max offset down to it', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000); // maxOffset = 2000
        expect(viewport.clampOffset(9000)).toBe(2000);
    });

    it('passes through an offset already within bounds', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        expect(viewport.clampOffset(500)).toBe(500);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run `npm test -- viewport.test.ts`
Expected: FAIL — `viewport.clampOffset is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/viewport/viewport.ts`, add a public `clampOffset` method right after `scrollBy`:

```typescript
    scrollBy(delta: number): void {
        this.scrollTo(this.offsetX + delta);
    }

    /** Clamps `offset` to the current valid scroll range, without changing the camera.
     * Lets callers outside `Viewport` (the align-cycle shortcuts) clamp a computed
     * target before animating to it or comparing it against the current offset. */
    clampOffset(offset: number): number {
        return this.clamp(offset);
    }

    /** Minimal offset that brings [rectX, rectX + rectWidth] fully into view. */
    offsetToReveal(rectX: number, rectWidth: number): number {
```

- [ ] **Step 4: Run test to verify it passes**

Run `npm test -- viewport.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` method)
- [ ] Language-specific guidelines are followed
- [ ] `npm test -- viewport.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: `Strip.cycleAlignLeft` / `cycleAlignRight`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Add `INSTANT_SETTINGS` right after the existing `const AREA` line near the top of `src/runtime/strip.test.ts`:

```typescript
const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };
const INSTANT_SETTINGS = { ...DEFAULT_SETTINGS, animationDurationMs: 0 };
```

Then add this `describe` block right before the final closing `});` of the outer `describe('Strip', ...)` block (i.e. as the last thing inside it):

```typescript
    describe('cycleAlignLeft / cycleAlignRight', () => {
        it('cycles a single oversized column through left/center/right and no-ops at both strip edges', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win = fakeWindow('w1', { width: 1600 });
            strip.addWindow(win.adapter); // offset 0 — already covers the viewport, no reveal needed

            strip.cycleAlignRight();
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -160 })); // centered

            strip.cycleAlignRight();
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -320 })); // right-aligned

            const callsAtRightEdge = win.setFrameGeometry.mock.calls.length;
            strip.cycleAlignRight(); // no next column: no-op
            expect(win.setFrameGeometry.mock.calls.length).toBe(callsAtRightEdge);

            strip.cycleAlignLeft();
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -160 })); // back to centered

            strip.cycleAlignLeft();
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 })); // back to left-aligned

            const callsAtLeftEdge = win.setFrameGeometry.mock.calls.length;
            strip.cycleAlignLeft(); // no previous column: no-op
            expect(win.setFrameGeometry.mock.calls.length).toBe(callsAtLeftEdge);
        });

        it('crosses to the next column and lands it left-aligned', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1', { width: 1600 });
            const win2 = fakeWindow('w2', { width: 1600 });
            strip.addWindow(win1.adapter);
            strip.addWindow(win2.adapter); // col2 is now focused
            strip.activateWindow(win1.adapter); // refocus col1, landing it right-aligned (oversized reveal)

            strip.cycleAlignRight(); // col1 is already right-aligned: crosses to col2

            expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
        });

        it('crosses to the previous column and lands it right-aligned', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1', { width: 1600 });
            const win2 = fakeWindow('w2', { width: 1600 });
            strip.addWindow(win1.adapter);
            strip.addWindow(win2.adapter); // col2 is now focused, left-aligned (oversized reveal)

            strip.cycleAlignLeft(); // col2 is already left-aligned: crosses back to col1

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -320 }));
        });

        it('does nothing when the focused column is hidden (minimized)', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win = fakeWindow('w1', { minimized: true });
            strip.addWindow(win.adapter);
            win.setFrameGeometry.mockClear();

            strip.cycleAlignRight();
            strip.cycleAlignLeft();

            expect(win.setFrameGeometry).not.toHaveBeenCalled();
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run `npm test -- strip.test.ts`
Expected: FAIL — `strip.cycleAlignRight is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip.ts`, add the import at the top alongside the other `core`/`viewport` imports:

```typescript
import { alignOffsets, nextAlignStep, type AlignDirection, type AlignOffsets } from '../viewport/align-cycle';
```

Add the two public methods and their private helpers right after `focusRight()` and before `private eventDeps()`:

```typescript
    focusRight(): void {
        this.grid.focusRight();
        this.revealFocused();
    }

    cycleAlignLeft(): void {
        this.cycleAlign('left');
    }

    cycleAlignRight(): void {
        this.cycleAlign('right');
    }

    private cycleAlign(direction: AlignDirection): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            return;
        }
        const step = nextAlignStep(direction, this.viewport.offset(), this.clampedAlignOffsets(focused.id));
        if (!step.crossToNeighbor) {
            this.animator.animate(this.viewport.offset(), step.targetOffset, this.settings.animationDurationMs);
            return;
        }
        const moved = direction === 'right' ? this.grid.focusRight() : this.grid.focusLeft();
        if (moved === null || moved.id === focused.id) {
            return; // strip edge: no neighbor to move focus to
        }
        const neighborOffsets = this.clampedAlignOffsets(moved.id);
        const target = direction === 'right' ? neighborOffsets.left : neighborOffsets.right;
        this.animator.animate(this.viewport.offset(), target, this.settings.animationDurationMs);
    }

    private clampedAlignOffsets(columnId: number): AlignOffsets {
        const rect = this.grid.columnRect(columnId);
        const raw = alignOffsets(rect.x, rect.width, this.viewport.viewportWidth());
        return {
            left: this.viewport.clampOffset(raw.left),
            center: this.viewport.clampOffset(raw.center),
            right: this.viewport.clampOffset(raw.right),
        };
    }

    private eventDeps(): WindowEventDeps {
```

- [ ] **Step 4: Run test to verify it passes**

Run `npm test -- strip.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` methods, `PascalCase`/`type` imports)
- [ ] Language-specific guidelines are followed (KWin API access stays out of `core`/`viewport`; `Strip` is the orchestration layer)
- [ ] `npm test -- strip.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: `Settings` — shortcut fields

**Files:**
- Modify: `src/config/settings.ts`

This is glue code (docs §8) with no dedicated unit test, same as the existing `bottomMargin`/`readNumberConfig`. Verified via `npm run typecheck` and by the `Controller`/`shortcuts.ts` wiring in later tasks.

- [ ] **Step 1: Add the 5 new fields to `Settings` and their defaults to `DEFAULT_SETTINGS`**

Replace the full contents of `src/config/settings.ts` with:

```typescript
// Hardcoded spike defaults (docs §7.2), overridable via the package's config/main.xml
// (KConfigXT, read through `KWin.readConfig`) — the same mechanism Karousel uses.

export interface Settings {
    /** Horizontal gap between columns, in pixels. */
    columnGap: number;
    /** Width given to a newly opened window's column, in pixels. */
    defaultColumnWidth: number;
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Timer tick interval driving the animation, in milliseconds (~60fps). */
    animationTickMs: number;
    /** Space reserved at the bottom of the screen (e.g. for a panel), in pixels. */
    bottomMargin: number;
    /** Shortcut sequence for focusing the column to the left. */
    shortcutFocusLeft: string;
    /** Shortcut sequence for focusing the column to the right. */
    shortcutFocusRight: string;
    /** Shortcut sequence for toggling the debug console. */
    shortcutToggleDebugConsole: string;
    /** Shortcut sequence for cycling the focused column's align/focus leftward. */
    shortcutCycleAlignLeft: string;
    /** Shortcut sequence for cycling the focused column's align/focus rightward. */
    shortcutCycleAlignRight: string;
}

export const DEFAULT_SETTINGS: Settings = {
    columnGap: 8,
    defaultColumnWidth: 800,
    animationDurationMs: 200,
    animationTickMs: 16,
    bottomMargin: 0,
    shortcutFocusLeft: 'Meta+A',
    shortcutFocusRight: 'Meta+D',
    shortcutToggleDebugConsole: 'Meta+Shift+D',
    shortcutCycleAlignLeft: 'Meta+Shift+Left',
    shortcutCycleAlignRight: 'Meta+Shift+Right',
};

/** Reads user-configurable settings from kwinrc (docs §5). Untestable glue (docs §8). */
export function loadSettings(): Settings {
    // Object spread is unsupported by KWin's declarativescript JS engine — use Object.assign.
    return Object.assign({}, DEFAULT_SETTINGS, {
        bottomMargin: readNumberConfig('marginBottom', DEFAULT_SETTINGS.bottomMargin),
        shortcutFocusLeft: readStringConfig('shortcutFocusLeft', DEFAULT_SETTINGS.shortcutFocusLeft),
        shortcutFocusRight: readStringConfig('shortcutFocusRight', DEFAULT_SETTINGS.shortcutFocusRight),
        shortcutToggleDebugConsole: readStringConfig(
            'shortcutToggleDebugConsole',
            DEFAULT_SETTINGS.shortcutToggleDebugConsole,
        ),
        shortcutCycleAlignLeft: readStringConfig('shortcutCycleAlignLeft', DEFAULT_SETTINGS.shortcutCycleAlignLeft),
        shortcutCycleAlignRight: readStringConfig(
            'shortcutCycleAlignRight',
            DEFAULT_SETTINGS.shortcutCycleAlignRight,
        ),
    });
}

// A bad/unexpected value here must never take down the rest of init() (docs §8).
function readNumberConfig(key: string, defaultValue: number): number {
    try {
        const value = KWin.readConfig(key, defaultValue);
        return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
    } catch (error) {
        // Optional catch binding (`catch {`) is also unsupported by the same engine.
        void error;
        return defaultValue;
    }
}

// Same rationale as readNumberConfig: never let a bad config value take down init().
function readStringConfig(key: string, defaultValue: string): string {
    try {
        const value = KWin.readConfig(key, defaultValue);
        return typeof value === 'string' && value.length > 0 ? value : defaultValue;
    } catch (error) {
        void error;
        return defaultValue;
    }
}
```

- [ ] **Step 2: Run the typechecker**

Run `npm run typecheck`
Expected: FAIL at this point — `src/input/shortcuts.ts` and `src/runtime/controller.ts` don't yet pass the new required fields where `registerShortcuts` is called (fixed in Tasks 5 and 6). If it fails only on those two files, that confirms `Settings` itself is correctly typed; proceed to Task 5.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` fields, `UPPER_SNAKE_CASE` constant unchanged)
- [ ] Language-specific guidelines are followed (KWin API access stays isolated to `readStringConfig`/`readNumberConfig`)
- [ ] `npm run typecheck` shows no new errors in `src/config/settings.ts` itself
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: KConfigXT schema

**Files:**
- Modify: `drift/contents/config/main.xml`

- [ ] **Step 1: Add the 5 new entries**

Replace the full contents of `drift/contents/config/main.xml` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kcfg xmlns="http://www.kde.org/standards/kcfg/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.kde.org/standards/kcfg/1.0 http://www.kde.org/standards/kcfg/1.0/kcfg.xsd">
    <kcfgfile name="kwinrc" />
    <group name="">
        <entry name="marginBottom" type="UInt">
            <default>0</default>
        </entry>
        <entry name="shortcutFocusLeft" type="String">
            <default>Meta+A</default>
        </entry>
        <entry name="shortcutFocusRight" type="String">
            <default>Meta+D</default>
        </entry>
        <entry name="shortcutToggleDebugConsole" type="String">
            <default>Meta+Shift+D</default>
        </entry>
        <entry name="shortcutCycleAlignLeft" type="String">
            <default>Meta+Shift+Left</default>
        </entry>
        <entry name="shortcutCycleAlignRight" type="String">
            <default>Meta+Shift+Right</default>
        </entry>
    </group>
</kcfg>
```

- [ ] **Step 2: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] XML is well-formed (matches the existing single-`marginBottom`-entry structure, just with 5 more entries)
- [ ] Entry `name` attributes exactly match the `Settings`/`readStringConfig` keys used in `src/config/settings.ts`
- [ ] Any convention violations fixed before moving to next task

---

### Task 6: `input/shortcuts.ts` — configurable sequences + 2 new actions

**Files:**
- Modify: `src/input/shortcuts.ts`

This is glue code (docs §8) with no dedicated unit test (there is no `shortcuts.test.ts` today), verified live via `npm run typecheck`/`npm run build`.

- [ ] **Step 1: Replace the full contents of `src/input/shortcuts.ts`**

```typescript
// Binds global shortcuts to Drift actions. Under declarativescript there is no
// `registerShortcut` global — each shortcut is a QML `ShortcutHandler` element from
// `org.kde.kwin`, created via `Qt.createQmlObject` parented to the QML root (docs §4).

import type { Settings } from '../config/settings';

export interface ShortcutActions {
    focusLeft(): void;
    focusRight(): void;
    toggleDebugConsole(): void;
    cycleAlignLeft(): void;
    cycleAlignRight(): void;
}

export function registerShortcuts(parent: QmlObject, settings: Settings, actions: ShortcutActions): void {
    createShortcut(
        parent,
        'DriftFocusLeft',
        'Drift: Focus Column Left',
        settings.shortcutFocusLeft,
        actions.focusLeft,
    );
    createShortcut(
        parent,
        'DriftFocusRight',
        'Drift: Focus Column Right',
        settings.shortcutFocusRight,
        actions.focusRight,
    );
    createShortcut(
        parent,
        'DriftToggleDebugConsole',
        'Drift: Toggle Debug Console',
        settings.shortcutToggleDebugConsole,
        actions.toggleDebugConsole,
    );
    createShortcut(
        parent,
        'DriftCycleAlignLeft',
        'Drift: Cycle Column Align Left',
        settings.shortcutCycleAlignLeft,
        actions.cycleAlignLeft,
    );
    createShortcut(
        parent,
        'DriftCycleAlignRight',
        'Drift: Cycle Column Align Right',
        settings.shortcutCycleAlignRight,
        actions.cycleAlignRight,
    );
}

function createShortcut(
    parent: QmlObject,
    name: string,
    text: string,
    sequence: string,
    onActivated: () => void,
): void {
    const qml = `import QtQuick 6.0
import org.kde.kwin 3.0
ShortcutHandler {
    name: "${name}"
    text: "${text}"
    sequence: "${sequence}"
}`;
    const handler = Qt.createQmlObject(qml, parent) as QmlShortcutHandler;
    handler.activated.connect(onActivated);
}
```

- [ ] **Step 2: Run the typechecker**

Run `npm run typecheck`
Expected: FAIL only in `src/runtime/controller.ts` (fixed in Task 7) — `registerShortcuts` now requires a `settings` argument and `ShortcutActions` requires 2 more methods.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` methods/params, `PascalCase` interface)
- [ ] Language-specific guidelines are followed (KWin API access — `Qt.createQmlObject` — stays isolated here)
- [ ] `npm run typecheck` shows no new errors in `src/input/shortcuts.ts` itself
- [ ] Any convention violations fixed before moving to next task

---

### Task 7: `Controller` wiring

**Files:**
- Modify: `src/runtime/controller.ts`

This is glue code (docs §8) with no dedicated unit test, verified live via `npm run typecheck`/`npm run build` and manual testing in a running Plasma session.

- [ ] **Step 1: Replace the full contents of `src/runtime/controller.ts`**

```typescript
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
        private readonly settings: Settings,
    ) {
        const area = this.workspaceAdapter.combinedGeometry();
        // Create the debug console before the animation timer, matching the original init() order.
        this.debugConsole = createDebugConsole(root);
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager);
    }

    start(): void {
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter);
        registerShortcuts(this.root, this.settings, {
            focusLeft: () => this.stripManager.activeStrip().focusLeft(),
            focusRight: () => this.stripManager.activeStrip().focusRight(),
            toggleDebugConsole: () => this.debugConsole.toggle(),
            cycleAlignLeft: () => this.stripManager.activeStrip().cycleAlignLeft(),
            cycleAlignRight: () => this.stripManager.activeStrip().cycleAlignRight(),
        });
        console.log('Drift: initialized');
    }
}
```

- [ ] **Step 2: Run the typechecker**

Run `npm run typecheck`
Expected: PASS — no errors anywhere

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` fields/methods)
- [ ] Language-specific guidelines are followed (coordination only, no layout/camera/geometry math added here)
- [ ] `npm run typecheck` passing with zero errors
- [ ] Any convention violations fixed before moving to next task

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run `npm test`
Expected: PASS — every test file, including the 3 new/modified ones from Tasks 1–3

- [ ] **Step 2: Run the typechecker**

Run `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run `npm run lint`
Expected: PASS (ESLint, Prettier, and `qmllint` on `drift/contents/ui/main.qml` — this feature touches no QML files directly, but the check must still be clean)

- [ ] **Step 4: Run the build**

Run `npm run build`
Expected: PASS — produces the compiled addon bundle with no errors

- [ ] **Step 5: Manual smoke test (optional but recommended if a Plasma session is available)**

Install via `npm run package:install`, reload the script, and confirm in a running KWin session:
- `Meta+Shift+Right` cycles the focused window left → center → right, then moves focus to the next window starting left-aligned
- `Meta+Shift+Left` does the mirror image
- Both are no-ops at the respective end of the strip
- `Meta+A`/`Meta+D`/`Meta+Shift+D` still work (regression check on the settings migration)

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` all passing
- [ ] Any convention violations fixed before considering the plan complete
