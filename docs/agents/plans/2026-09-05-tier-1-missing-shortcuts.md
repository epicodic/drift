# Tier 1 Missing Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five shortcut-only action pairs (ten shortcuts) identified as gaps in `docs/comparison-keybindings.md`'s "Drift Target" column, per `docs/agents/specs/2026-09-05-tier-1-missing-shortcuts-design.md`.

**Architecture:** Every shortcut follows Drift's existing six-layer wiring: `Settings` field + `main.xml` entry → `ShortcutActions` interface + `registerShortcuts` → `StripStack` delegation → `Strip` implementation → a `Grid`/`Column` primitive. All ten additions reuse a primitive that already exists (`Grid.moveColumn`, `Grid.resizeColumn`, `Column.resizeTile`) or a trivial variant of one (`Grid.focusFirst`/`Last`, `Column.growFocusedTile`/`shrinkFocusedTile`).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## Task 1: Settings & KConfigXT plumbing

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `drift/contents/config/main.xml`
- Test: `src/config/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('DEFAULT_SETTINGS', ...)` block in `src/config/settings.test.ts`:

```typescript
    it('uses Meta+Home and Meta+End to focus the first/last column', () => {
        expect(DEFAULT_SETTINGS.shortcutFocusFirst).toBe('Meta+Home');
        expect(DEFAULT_SETTINGS.shortcutFocusLast).toBe('Meta+End');
    });

    it('uses Meta+Ctrl+Home and Meta+Ctrl+End to move the focused column to the start/end', () => {
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToStart).toBe('Meta+Ctrl+Home');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToEnd).toBe('Meta+Ctrl+End');
    });

    it('uses Meta+Alt+Home and Meta+Alt+End to pan the viewport to the start/end', () => {
        expect(DEFAULT_SETTINGS.shortcutViewportShiftToStart).toBe('Meta+Alt+Home');
        expect(DEFAULT_SETTINGS.shortcutViewportShiftToEnd).toBe('Meta+Alt+End');
    });

    it('uses Meta+Plus and Meta+- to step the focused column width, defaulting the step to 80px', () => {
        expect(DEFAULT_SETTINGS.shortcutIncreaseColumnWidth).toBe('Meta+Plus');
        expect(DEFAULT_SETTINGS.shortcutDecreaseColumnWidth).toBe('Meta+-');
        expect(DEFAULT_SETTINGS.columnWidthStep).toBe(80);
    });

    it('uses Meta+Shift+Plus and Meta+Shift+- to step the focused tile height, defaulting the step to 80px', () => {
        expect(DEFAULT_SETTINGS.shortcutIncreaseWindowHeight).toBe('Meta+Shift+Plus');
        expect(DEFAULT_SETTINGS.shortcutDecreaseWindowHeight).toBe('Meta+Shift+-');
        expect(DEFAULT_SETTINGS.windowHeightStep).toBe(80);
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — TypeScript compile error, `Property 'shortcutFocusFirst' does not exist on type 'Settings'` (and similarly for the others).

- [ ] **Step 3: Add the fields to the `Settings` interface**

In `src/config/settings.ts`, insert immediately after the existing `shortcutMoveColumnToStripBelow: string;` field (the last shortcut field):

```typescript
    /** Shortcut sequence for focusing the first column in the strip. */
    shortcutFocusFirst: string;
    /** Shortcut sequence for focusing the last column in the strip. */
    shortcutFocusLast: string;
    /** Shortcut sequence for moving the focused column to the start of the strip. */
    shortcutMoveWindowToStart: string;
    /** Shortcut sequence for moving the focused column to the end of the strip. */
    shortcutMoveWindowToEnd: string;
    /** Shortcut sequence for panning the viewport to the strip's start without changing focus. */
    shortcutViewportShiftToStart: string;
    /** Shortcut sequence for panning the viewport to the strip's end without changing focus. */
    shortcutViewportShiftToEnd: string;
    /** Shortcut sequence for growing the focused column's width by `columnWidthStep`. */
    shortcutIncreaseColumnWidth: string;
    /** Shortcut sequence for shrinking the focused column's width by `columnWidthStep`. */
    shortcutDecreaseColumnWidth: string;
    /** Shortcut sequence for growing the focused tile's height by `windowHeightStep` (stacked columns only). */
    shortcutIncreaseWindowHeight: string;
    /** Shortcut sequence for shrinking the focused tile's height by `windowHeightStep` (stacked columns only). */
    shortcutDecreaseWindowHeight: string;
```

Then insert immediately after the existing `viewportShiftStep: number;` field:

```typescript
    /** Distance a column's width changes per `shortcutIncreaseColumnWidth`/`shortcutDecreaseColumnWidth` press, in pixels. */
    columnWidthStep: number;
    /** Distance a stacked tile's height changes per `shortcutIncreaseWindowHeight`/`shortcutDecreaseWindowHeight` press, in pixels. */
    windowHeightStep: number;
```

- [ ] **Step 4: Add the defaults to `DEFAULT_SETTINGS`**

Insert immediately after the existing `shortcutMoveColumnToStripBelow: 'Meta+Ctrl+Page_Down',` line:

```typescript
    shortcutFocusFirst: 'Meta+Home',
    shortcutFocusLast: 'Meta+End',
    shortcutMoveWindowToStart: 'Meta+Ctrl+Home',
    shortcutMoveWindowToEnd: 'Meta+Ctrl+End',
    shortcutViewportShiftToStart: 'Meta+Alt+Home',
    shortcutViewportShiftToEnd: 'Meta+Alt+End',
    shortcutIncreaseColumnWidth: 'Meta+Plus',
    shortcutDecreaseColumnWidth: 'Meta+-',
    shortcutIncreaseWindowHeight: 'Meta+Shift+Plus',
    shortcutDecreaseWindowHeight: 'Meta+Shift+-',
```

Insert immediately after the existing `viewportShiftStep: 400,` line:

```typescript
    columnWidthStep: 80,
    windowHeightStep: 80,
```

- [ ] **Step 5: Add the config reads to `loadSettings`**

Insert immediately after the existing `viewportShiftStep: readNumberConfig(...)` line inside the `Object.assign` call:

```typescript
        columnWidthStep: readNumberConfig('columnWidthStep', DEFAULT_SETTINGS.columnWidthStep),
        windowHeightStep: readNumberConfig('windowHeightStep', DEFAULT_SETTINGS.windowHeightStep),
```

Insert immediately after the existing `shortcutMoveColumnToStripBelow: readStringConfig(...)` call:

```typescript
        shortcutFocusFirst: readStringConfig('shortcutFocusFirst', DEFAULT_SETTINGS.shortcutFocusFirst),
        shortcutFocusLast: readStringConfig('shortcutFocusLast', DEFAULT_SETTINGS.shortcutFocusLast),
        shortcutMoveWindowToStart: readStringConfig(
            'shortcutMoveWindowToStart',
            DEFAULT_SETTINGS.shortcutMoveWindowToStart,
        ),
        shortcutMoveWindowToEnd: readStringConfig('shortcutMoveWindowToEnd', DEFAULT_SETTINGS.shortcutMoveWindowToEnd),
        shortcutViewportShiftToStart: readStringConfig(
            'shortcutViewportShiftToStart',
            DEFAULT_SETTINGS.shortcutViewportShiftToStart,
        ),
        shortcutViewportShiftToEnd: readStringConfig(
            'shortcutViewportShiftToEnd',
            DEFAULT_SETTINGS.shortcutViewportShiftToEnd,
        ),
        shortcutIncreaseColumnWidth: readStringConfig(
            'shortcutIncreaseColumnWidth',
            DEFAULT_SETTINGS.shortcutIncreaseColumnWidth,
        ),
        shortcutDecreaseColumnWidth: readStringConfig(
            'shortcutDecreaseColumnWidth',
            DEFAULT_SETTINGS.shortcutDecreaseColumnWidth,
        ),
        shortcutIncreaseWindowHeight: readStringConfig(
            'shortcutIncreaseWindowHeight',
            DEFAULT_SETTINGS.shortcutIncreaseWindowHeight,
        ),
        shortcutDecreaseWindowHeight: readStringConfig(
            'shortcutDecreaseWindowHeight',
            DEFAULT_SETTINGS.shortcutDecreaseWindowHeight,
        ),
```

- [ ] **Step 6: Add the KConfigXT entries**

In `drift/contents/config/main.xml`, insert immediately after the existing `viewportShiftStep` entry:

```xml
        <entry name="columnWidthStep" type="UInt">
            <default>80</default>
        </entry>
        <entry name="windowHeightStep" type="UInt">
            <default>80</default>
        </entry>
```

Insert immediately before the closing `</group>` tag:

```xml
        <entry name="shortcutFocusFirst" type="String">
            <default>Meta+Home</default>
        </entry>
        <entry name="shortcutFocusLast" type="String">
            <default>Meta+End</default>
        </entry>
        <entry name="shortcutMoveWindowToStart" type="String">
            <default>Meta+Ctrl+Home</default>
        </entry>
        <entry name="shortcutMoveWindowToEnd" type="String">
            <default>Meta+Ctrl+End</default>
        </entry>
        <entry name="shortcutViewportShiftToStart" type="String">
            <default>Meta+Alt+Home</default>
        </entry>
        <entry name="shortcutViewportShiftToEnd" type="String">
            <default>Meta+Alt+End</default>
        </entry>
        <entry name="shortcutIncreaseColumnWidth" type="String">
            <default>Meta+Plus</default>
        </entry>
        <entry name="shortcutDecreaseColumnWidth" type="String">
            <default>Meta+-</default>
        </entry>
        <entry name="shortcutIncreaseWindowHeight" type="String">
            <default>Meta+Shift+Plus</default>
        </entry>
        <entry name="shortcutDecreaseWindowHeight" type="String">
            <default>Meta+Shift+-</default>
        </entry>
```

- [ ] **Step 7: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 8: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules (`camelCase` fields, `PascalCase` n/a here)
- [ ] Language-specific guidelines followed (4-space indent, 120-char limit)
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 2: `Grid.focusFirst`/`focusLast`

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/core/grid.test.ts`, near the existing `'Grid — focus navigation'` blocks:

```typescript
describe('Grid — focusFirst/focusLast', () => {
    it('jumps focus to the first/last column regardless of current focus', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(300);
        const c = grid.addColumn(300);
        grid.setFocus(c.id);

        expect(grid.focusLast()).toBe(c);
        expect(grid.focusFirst()).toBe(a);
    });

    it('is a no-op when already at the reachable edge', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(300);
        grid.setFocus(a.id);

        expect(grid.focusFirst()).toBe(a);
    });

    it('skips hidden columns at the edges', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const c = grid.addColumn(300);
        grid.hideColumn(a.id);
        grid.hideColumn(c.id);
        grid.setFocus(b.id);

        expect(grid.focusFirst()).toBe(b);
        expect(grid.focusLast()).toBe(b);
    });

    it('returns null when there is no focused column', () => {
        const grid = new Grid(HEIGHT, GAP);

        expect(grid.focusFirst()).toBeNull();
        expect(grid.focusLast()).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `grid.focusFirst is not a function`

- [ ] **Step 3: Implement `focusFirst`/`focusLast`**

In `src/core/grid.ts`, insert immediately after the existing `focusRight()` method:

```typescript
    /** Jumps focus directly to the first visible column, regardless of current focus —
     * unlike `focusLeft`, which walks one column at a time. No-op if already there, or if
     * there is no focused column at all (empty grid). */
    focusFirst(): Column | null {
        return this.focusEdge(0, 1);
    }

    /** Jumps focus directly to the last visible column — see `focusFirst`. */
    focusLast(): Column | null {
        return this.focusEdge(this.ordered.length - 1, -1);
    }
```

Insert the private helper immediately after the existing private `moveFocus` method:

```typescript
    /** Scans from `start` in direction `step` for the first visible column, skipping
     * hidden ones, and focuses it. Falls back to the current focus if none is found
     * (e.g. every column is hidden), or returns null if there's no focus to fall back to. */
    private focusEdge(start: number, step: number): Column | null {
        if (this.focusedColumnId === null) {
            return null;
        }
        for (let i = start; i >= 0 && i < this.ordered.length; i += step) {
            if (!this.ordered[i].hidden) {
                this.focusedColumnId = this.ordered[i].id;
                return this.ordered[i];
            }
        }
        return this.columnById(this.focusedColumnId);
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 3: `Strip.focusFirst`/`focusLast`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `src/runtime/strip.test.ts`:

```typescript
describe('Strip — focusFirst/focusLast', () => {
    function threeColumnStrip(): { strip: Strip; win1: FakeWindow; win2: FakeWindow; win3: FakeWindow } {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        const win3 = fakeWindow('w3');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter);
        strip.addWindow(win3.adapter); // col3 focused
        win1.activate.mockClear();
        win2.activate.mockClear();
        win3.activate.mockClear();
        return { strip, win1, win2, win3 };
    }

    it('focusFirst activates the first column from anywhere in the strip', () => {
        const { strip, win1 } = threeColumnStrip();

        strip.focusFirst();

        expect(win1.activate).toHaveBeenCalled();
    });

    it('focusLast activates the last column from anywhere in the strip', () => {
        const { strip, win3 } = threeColumnStrip();
        strip.focusFirst();
        win3.activate.mockClear();

        strip.focusLast();

        expect(win3.activate).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `strip.focusFirst is not a function`

- [ ] **Step 3: Implement `focusFirst`/`focusLast`**

In `src/runtime/strip.ts`, insert immediately after the existing `focusRight()` method:

```typescript
    focusFirst(): void {
        this.activateColumn(this.grid.focusFirst());
    }

    focusLast(): void {
        this.activateColumn(this.grid.focusLast());
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 4: `Strip.moveWindowToStart`/`moveWindowToEnd`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/runtime/strip.test.ts`:

```typescript
describe('Strip — moveWindowToStart/moveWindowToEnd', () => {
    it('moves the focused column to index 0', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('w1').adapter);
        strip.addWindow(fakeWindow('w2').adapter);
        strip.addWindow(fakeWindow('w3').adapter); // col3 focused, at index 2

        strip.moveWindowToStart();

        const focusedFlags = strip.minimapSnapshot().columns.map((c) => c.tiles[0].focused);
        expect(focusedFlags).toEqual([true, false, false]);
    });

    it('moves the focused column to the last index', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('w1').adapter);
        strip.addWindow(fakeWindow('w2').adapter);
        strip.addWindow(fakeWindow('w3').adapter);
        strip.focusLeft();
        strip.focusLeft(); // back to col1, focused, at index 0

        strip.moveWindowToEnd();

        const focusedFlags = strip.minimapSnapshot().columns.map((c) => c.tiles[0].focused);
        expect(focusedFlags).toEqual([false, false, true]);
    });

    it('is a no-op with zero or one column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(() => strip.moveWindowToStart()).not.toThrow();
        expect(() => strip.moveWindowToEnd()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `strip.moveWindowToStart is not a function`

- [ ] **Step 3: Implement `moveWindowToStart`/`moveWindowToEnd`**

In `src/runtime/strip.ts`, insert immediately after the existing `moveWindowRight()` method:

```typescript
    /** Moves the focused column directly to index 0 within the strip — the "jump" form of
     * `moveWindowLeft`, which moves one slot at a time. No-op with no focused column or
     * already at the start. */
    moveWindowToStart(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const currentIndex = this.grid.indexOf(focused.id);
        if (currentIndex <= 0) {
            return;
        }
        this.grid.moveColumn(focused.id, 0);
        this.snapColumn(focused.id);
        this.render();
        this.revealFocused();
    }

    /** Moves the focused column directly to the last index — see `moveWindowToStart`. */
    moveWindowToEnd(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const lastIndex = this.grid.columns().length - 1;
        const currentIndex = this.grid.indexOf(focused.id);
        if (currentIndex >= lastIndex) {
            return;
        }
        this.grid.moveColumn(focused.id, lastIndex);
        this.snapColumn(focused.id);
        this.render();
        this.revealFocused();
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 5: `Strip.shiftViewportToStart`/`shiftViewportToEnd`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/runtime/strip.test.ts`:

```typescript
describe('Strip — shiftViewportToStart/shiftViewportToEnd', () => {
    function twoColumnStrip(): { strip: Strip; win1: FakeWindow; win2: FakeWindow } {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter); // col2 focused; revealFocused already scrolled right
        strip.focusLeft(); // back to col1, offset 0
        win1.setFrameGeometry.mockClear();
        win2.setFrameGeometry.mockClear();
        win1.activate.mockClear();
        win2.activate.mockClear();
        return { strip, win1, win2 };
    }

    it('shiftViewportToEnd pans to contentWidth-minus-viewportWidth (1608 - 1280 = 328)', () => {
        const { strip, win2 } = twoColumnStrip();

        strip.shiftViewportToEnd();

        // col2's virtual x is 808 (800 + gap 8); real x = virtual x - offset
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 808 - 328 }));
    });

    it('shiftViewportToStart pans back to offset 0', () => {
        const { strip, win1 } = twoColumnStrip();
        strip.shiftViewportToEnd();
        win1.setFrameGeometry.mockClear();

        strip.shiftViewportToStart();

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
    });

    it('does not change which column is focused', () => {
        const { strip, win1, win2 } = twoColumnStrip();

        strip.shiftViewportToEnd();
        strip.shiftViewportToStart();

        expect(win1.activate).not.toHaveBeenCalled();
        expect(win2.activate).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `strip.shiftViewportToEnd is not a function`

- [ ] **Step 3: Refactor `shiftViewport` and add the two new methods**

In `src/runtime/strip.ts`, replace the existing private `shiftViewport` method and the `shiftViewportLeft`/`shiftViewportRight` methods with:

```typescript
    private animateViewportTo(target: number): void {
        this.animator.animate(this.viewport.offset(), target, this.settings.animationDurationMs);
    }

    private shiftViewport(delta: number): void {
        this.animateViewportTo(this.viewport.offset() + delta);
    }

    /** Pans the camera without touching focus — unlike focusLeft/Right and cycleAlign,
     * which both move or reposition the focused column itself. */
    shiftViewportLeft(): void {
        this.shiftViewport(this.settings.viewportShiftStep);
    }

    shiftViewportRight(): void {
        this.shiftViewport(-this.settings.viewportShiftStep);
    }

    /** Pans directly to the strip's leftmost content edge, without changing focus —
     * the "jump" form of `shiftViewportLeft`, which pans by a fixed step. */
    shiftViewportToStart(): void {
        this.animateViewportTo(this.viewport.contentLeft());
    }

    /** Pans directly to the strip's rightmost content edge — see `shiftViewportToStart`.
     * Falls back to `contentLeft()` when the content is narrower than the viewport (there
     * is no further edge to reveal), the same floor `Viewport`'s own private `maxOffset()`
     * uses internally. */
    shiftViewportToEnd(): void {
        const start = this.viewport.contentLeft();
        const end = start + this.viewport.contentWidth() - this.viewport.viewportWidth();
        this.animateViewportTo(Math.max(start, end));
    }
```

(Keep the existing doc comment above `shiftViewportLeft` — it's shown above for placement context.)

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 6: `Strip.increaseColumnWidth`/`decreaseColumnWidth`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/runtime/strip.test.ts`:

```typescript
describe('Strip — increaseColumnWidth/decreaseColumnWidth', () => {
    const STEP_SETTINGS = { ...INSTANT_SETTINGS, columnWidthStep: 50 };

    it('grows the focused column by columnWidthStep', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1'); // defaultColumnWidth 800
        strip.addWindow(win1.adapter);
        win1.setFrameGeometry.mockClear();

        strip.increaseColumnWidth();

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 850 }));
    });

    it('shrinks the focused column by columnWidthStep', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter);
        win1.setFrameGeometry.mockClear();

        strip.decreaseColumnWidth();

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 750 }));
    });

    it('clamps shrinking at columnWidthStep, never reaching zero or below', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter);

        for (let i = 0; i < 20; i++) {
            strip.decreaseColumnWidth();
        }

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 50 }));
    });

    it('is a no-op with no focused column', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(() => strip.increaseColumnWidth()).not.toThrow();
        expect(() => strip.decreaseColumnWidth()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `strip.increaseColumnWidth is not a function`

- [ ] **Step 3: Implement `increaseColumnWidth`/`decreaseColumnWidth`**

In `src/runtime/strip.ts`, insert immediately after `moveWindowToEnd()` (added in Task 4):

```typescript
    /** Grows the focused column's width by `columnWidthStep`, without changing focus —
     * the keyboard equivalent of dragging the column's right edge. No-op with no focused
     * column. */
    increaseColumnWidth(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        this.grid.resizeColumn(focused.id, focused.width + this.settings.columnWidthStep);
        this.render();
        this.revealFocused();
    }

    /** Shrinks the focused column's width by `columnWidthStep`, clamped at `columnWidthStep`
     * itself so it never reaches zero — see `increaseColumnWidth`. */
    decreaseColumnWidth(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const target = Math.max(this.settings.columnWidthStep, focused.width - this.settings.columnWidthStep);
        this.grid.resizeColumn(focused.id, target);
        this.render();
        this.revealFocused();
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 7: `Column.growFocusedTile`/`shrinkFocusedTile`

**Files:**
- Modify: `src/core/column.ts`
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/core/column.test.ts`:

```typescript
describe('Column — growFocusedTile/shrinkFocusedTile', () => {
    it('grows the focused (top) tile by taking space from its neighbor below', () => {
        const column = new Column(1, 400, 1000);
        column.addTile(); // 500/500; focus stays on the top tile

        expect(column.growFocusedTile(100)).toBe(true);

        expect(column.tiles().map((t) => t.height)).toEqual([600, 400]);
    });

    it('shrinks the focused (top) tile, giving the space to its neighbor below', () => {
        const column = new Column(1, 400, 1000);
        column.addTile();

        expect(column.shrinkFocusedTile(100)).toBe(true);

        expect(column.tiles().map((t) => t.height)).toEqual([400, 600]);
    });

    it('falls back to the neighbor above when the focused tile is at the bottom of the stack', () => {
        const column = new Column(1, 400, 1000);
        column.addTile();
        column.setFocusedTile(column.tiles()[1].id);

        expect(column.growFocusedTile(100)).toBe(true);

        expect(column.tiles().map((t) => t.height)).toEqual([400, 600]);
    });

    it('is a no-op on a single-tile column', () => {
        const column = new Column(1, 400, 1000);

        expect(column.growFocusedTile(100)).toBe(false);
        expect(column.shrinkFocusedTile(100)).toBe(false);
        expect(column.tiles()[0].height).toBe(1000);
    });

    it('clamps growth to the floor when the requested step would go past it', () => {
        const column = new Column(1, 400, 120);
        column.addTile(); // 60/60
        column.resizeTile(column.tiles()[0].id, 90, 'bottom'); // 90/30

        expect(column.growFocusedTile(100)).toBe(true); // requested +100 clamps to the 60/60 floor

        expect(column.tiles().map((t) => t.height)).toEqual([60, 60]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `column.growFocusedTile is not a function`

- [ ] **Step 3: Implement `growFocusedTile`/`shrinkFocusedTile`**

In `src/core/column.ts`, insert immediately after the existing `resizeTile` method:

```typescript
    /** Grows the focused tile by `step`, taking the space from its neighbor below in the
     * stack — or above, if the focused tile is at the bottom — the keyboard equivalent of
     * drag-resizing via `resizeTile`. No-op (returns `false`) on a single-tile column.
     * Returns whether the tile's height actually changed (see `resizeFocusedTile` for the
     * floor that can make a large `step` a no-op when the stack has little room). */
    growFocusedTile(step: number): boolean {
        return this.resizeFocusedTile(step, step);
    }

    /** Shrinks the focused tile by `step`, giving the space to its neighbor — see
     * `growFocusedTile`. */
    shrinkFocusedTile(step: number): boolean {
        return this.resizeFocusedTile(-step, step);
    }

    /** Shared implementation for `growFocusedTile`/`shrinkFocusedTile`. Clamps the target
     * height to `[floor, total - floor]`, where `floor` is `min(floorCandidate, total / 2)` —
     * normally exactly `floorCandidate` (the configured step), but capped at half the pair's
     * combined height so the range is never empty, however small the stack. This is what lets
     * `resizeTile` below never throw its "pushed to zero or below" error. */
    private resizeFocusedTile(delta: number, floorCandidate: number): boolean {
        const index = this.requireTileIndex(this.focusedTile);
        const edge: VerticalResizeEdge = index < this.stack.length - 1 ? 'bottom' : 'top';
        const neighborIndex = edge === 'bottom' ? index + 1 : index - 1;
        const neighbor = this.stack[neighborIndex];
        if (neighbor === undefined) {
            return false;
        }
        const current = this.stack[index].height;
        const total = current + neighbor.height;
        const floor = Math.min(floorCandidate, total / 2);
        const target = Math.min(total - floor, Math.max(floor, current + delta));
        if (target === current) {
            return false;
        }
        this.resizeTile(this.focusedTile, target, edge);
        return true;
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 8: `Strip.increaseWindowHeight`/`decreaseWindowHeight`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/runtime/strip.test.ts`:

```typescript
describe('Strip — increaseWindowHeight/decreaseWindowHeight', () => {
    const STEP_SETTINGS = { ...INSTANT_SETTINGS, windowHeightStep: 50 };

    it('grows the focused (top) tile, taking space from its neighbor below', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindowStack(win2.adapter); // stacks onto col1: 500/500 (AREA.height 1000)
        win1.setFrameGeometry.mockClear();
        win2.setFrameGeometry.mockClear();

        expect(strip.increaseWindowHeight()).toBe(true);

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 550 }));
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 450 }));
    });

    it('shrinks the focused (top) tile, giving space to its neighbor below', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindowStack(win2.adapter);
        win1.setFrameGeometry.mockClear();
        win2.setFrameGeometry.mockClear();

        expect(strip.decreaseWindowHeight()).toBe(true);

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 450 }));
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 550 }));
    });

    it('is a no-op on a single-tile column', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('w1').adapter);

        expect(strip.increaseWindowHeight()).toBe(false);
        expect(strip.decreaseWindowHeight()).toBe(false);
    });

    it('is a no-op with no focused column', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(strip.increaseWindowHeight()).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `strip.increaseWindowHeight is not a function`

- [ ] **Step 3: Implement `increaseWindowHeight`/`decreaseWindowHeight`**

In `src/runtime/strip.ts`, insert immediately after the existing `moveTileDown()` method (right before the private `moveTile` helper):

```typescript
    /** Grows the focused tile's height by `windowHeightStep`, taking the space from a
     * neighbor in the same stack — the keyboard equivalent of drag-resizing a tile
     * boundary. No-op on a single-tile column or with no focused column. Returns whether
     * it actually grew. */
    increaseWindowHeight(): boolean {
        return this.moveTile((column) => column.growFocusedTile(this.settings.windowHeightStep));
    }

    /** Shrinks the focused tile's height by `windowHeightStep` — see `increaseWindowHeight`. */
    decreaseWindowHeight(): boolean {
        return this.moveTile((column) => column.shrinkFocusedTile(this.settings.windowHeightStep));
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 9: `StripStack` delegation

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/runtime/strip-stack.test.ts`, add the ten new fake methods to the `FakeStrip` interface (alongside the existing `shiftViewportRight: ReturnType<typeof vi.fn>;` field):

```typescript
    focusFirst: ReturnType<typeof vi.fn>;
    focusLast: ReturnType<typeof vi.fn>;
    moveWindowToStart: ReturnType<typeof vi.fn>;
    moveWindowToEnd: ReturnType<typeof vi.fn>;
    shiftViewportToStart: ReturnType<typeof vi.fn>;
    shiftViewportToEnd: ReturnType<typeof vi.fn>;
    increaseColumnWidth: ReturnType<typeof vi.fn>;
    decreaseColumnWidth: ReturnType<typeof vi.fn>;
    increaseWindowHeight: ReturnType<typeof vi.fn>;
    decreaseWindowHeight: ReturnType<typeof vi.fn>;
```

Add the corresponding entries to the `fns` object inside `fakeStrip()` (alongside the existing `shiftViewportRight: vi.fn(),` line):

```typescript
        focusFirst: vi.fn(),
        focusLast: vi.fn(),
        moveWindowToStart: vi.fn(),
        moveWindowToEnd: vi.fn(),
        shiftViewportToStart: vi.fn(),
        shiftViewportToEnd: vi.fn(),
        increaseColumnWidth: vi.fn(),
        decreaseColumnWidth: vi.fn(),
        increaseWindowHeight: vi.fn(() => false),
        decreaseWindowHeight: vi.fn(() => false),
```

Add a new `it` inside `describe('StripStack', ...)`, alongside the existing delegation test:

```typescript
    it('delegates focusFirst/Last, moveWindowToStart/End, shiftViewportToStart/End, and width/height stepping to the active strip', () => {
        const { stack, created } = makeStack();

        stack.focusFirst();
        stack.focusLast();
        stack.moveWindowToStart();
        stack.moveWindowToEnd();
        stack.shiftViewportToStart();
        stack.shiftViewportToEnd();
        stack.increaseColumnWidth();
        stack.decreaseColumnWidth();
        stack.increaseWindowHeight();
        stack.decreaseWindowHeight();

        expect(created[0].focusFirst).toHaveBeenCalled();
        expect(created[0].focusLast).toHaveBeenCalled();
        expect(created[0].moveWindowToStart).toHaveBeenCalled();
        expect(created[0].moveWindowToEnd).toHaveBeenCalled();
        expect(created[0].shiftViewportToStart).toHaveBeenCalled();
        expect(created[0].shiftViewportToEnd).toHaveBeenCalled();
        expect(created[0].increaseColumnWidth).toHaveBeenCalled();
        expect(created[0].decreaseColumnWidth).toHaveBeenCalled();
        expect(created[0].increaseWindowHeight).toHaveBeenCalled();
        expect(created[0].decreaseWindowHeight).toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — TypeScript compile error, `Property 'focusFirst' is missing in type ... but required in type 'FakeStrip'` (or, once the fake object compiles, `stack.focusFirst is not a function`).

- [ ] **Step 3: Implement the delegating methods**

In `src/runtime/strip-stack.ts`, insert immediately after the existing `shiftViewportRight()` method:

```typescript
    focusFirst(): void {
        this.activeStrip().focusFirst();
    }

    focusLast(): void {
        this.activeStrip().focusLast();
    }

    moveWindowToStart(): void {
        this.activeStrip().moveWindowToStart();
    }

    moveWindowToEnd(): void {
        this.activeStrip().moveWindowToEnd();
    }

    shiftViewportToStart(): void {
        this.activeStrip().shiftViewportToStart();
    }

    shiftViewportToEnd(): void {
        this.activeStrip().shiftViewportToEnd();
    }

    increaseColumnWidth(): void {
        this.activeStrip().increaseColumnWidth();
    }

    decreaseColumnWidth(): void {
        this.activeStrip().decreaseColumnWidth();
    }

    increaseWindowHeight(): boolean {
        return this.activeStrip().increaseWindowHeight();
    }

    decreaseWindowHeight(): boolean {
        return this.activeStrip().decreaseWindowHeight();
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` passing
- [ ] Any convention violations fixed

---

## Task 10: `ShortcutActions` interface and `registerShortcuts` wiring

**Files:**
- Modify: `src/input/shortcuts.ts`

No test file: `createShortcut` calls `Qt.createQmlObject`, which needs a live KWin runtime — this file is untestable glue, same as `loadSettings` (see its own doc comment in `settings.ts`). Coverage for the ten new defaults already exists via Task 1's `settings.test.ts` additions.

- [ ] **Step 1: Extend the `ShortcutActions` interface**

In `src/input/shortcuts.ts`, insert immediately after the existing `moveColumnToStripBelow(): void;` line:

```typescript
    focusFirst(): void;
    focusLast(): void;
    moveWindowToStart(): void;
    moveWindowToEnd(): void;
    shiftViewportToStart(): void;
    shiftViewportToEnd(): void;
    increaseColumnWidth(): void;
    decreaseColumnWidth(): void;
    increaseWindowHeight(): void;
    decreaseWindowHeight(): void;
```

(`increaseWindowHeight`/`decreaseWindowHeight` are declared `void` here even though `Strip`'s own methods return `boolean` — a function returning `boolean` is assignable to a `() => void` field in TypeScript, and nothing in this wiring layer needs the return value, matching how `moveTileUp`/`moveTileDown` are used elsewhere.)

- [ ] **Step 2: Register the ten new shortcuts**

In `src/input/shortcuts.ts`, insert immediately after the existing `moveColumnToStripBelow` `createShortcut` call, inside `registerShortcuts`:

```typescript
    createShortcut(
        parent,
        'DriftFocusFirst',
        'Drift: Focus First Column',
        settings.shortcutFocusFirst,
        actions.focusFirst,
    );
    createShortcut(
        parent,
        'DriftFocusLast',
        'Drift: Focus Last Column',
        settings.shortcutFocusLast,
        actions.focusLast,
    );
    createShortcut(
        parent,
        'DriftMoveWindowToStart',
        'Drift: Move Column To Start',
        settings.shortcutMoveWindowToStart,
        actions.moveWindowToStart,
    );
    createShortcut(
        parent,
        'DriftMoveWindowToEnd',
        'Drift: Move Column To End',
        settings.shortcutMoveWindowToEnd,
        actions.moveWindowToEnd,
    );
    createShortcut(
        parent,
        'DriftViewportShiftToStart',
        'Drift: Shift Viewport To Start',
        settings.shortcutViewportShiftToStart,
        actions.shiftViewportToStart,
    );
    createShortcut(
        parent,
        'DriftViewportShiftToEnd',
        'Drift: Shift Viewport To End',
        settings.shortcutViewportShiftToEnd,
        actions.shiftViewportToEnd,
    );
    createShortcut(
        parent,
        'DriftIncreaseColumnWidth',
        'Drift: Increase Column Width',
        settings.shortcutIncreaseColumnWidth,
        actions.increaseColumnWidth,
    );
    createShortcut(
        parent,
        'DriftDecreaseColumnWidth',
        'Drift: Decrease Column Width',
        settings.shortcutDecreaseColumnWidth,
        actions.decreaseColumnWidth,
    );
    createShortcut(
        parent,
        'DriftIncreaseWindowHeight',
        'Drift: Increase Window Height',
        settings.shortcutIncreaseWindowHeight,
        actions.increaseWindowHeight,
    );
    createShortcut(
        parent,
        'DriftDecreaseWindowHeight',
        'Drift: Decrease Window Height',
        settings.shortcutDecreaseWindowHeight,
        actions.decreaseWindowHeight,
    );
```

- [ ] **Step 3: Run the full suite**

`npm test`
Expected: PASS (this file has no direct tests, but a `ShortcutActions` typing mistake would fail `Controller`'s compile in Task 11)

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm run lint` passing (line-length check on the wrapped `createShortcut` calls)
- [ ] Any convention violations fixed

---

## Task 11: `Controller` wiring

**Files:**
- Modify: `src/runtime/controller.ts`

No test file exists for `controller.ts` (coordination-only glue, per its own top-of-file comment). A wiring mistake here would fail TypeScript compilation against the `ShortcutActions` interface from Task 10.

- [ ] **Step 1: Wire the ten new actions**

In `src/runtime/controller.ts`, insert immediately after the existing `moveColumnToStripBelow: () => this.focusAndShowMinimap((stack) => stack.moveColumnToStripBelow()),` line, inside the `registerShortcuts({...})` call:

```typescript
            focusFirst: () => this.focusAndShowMinimap((stack) => stack.focusFirst()),
            focusLast: () => this.focusAndShowMinimap((stack) => stack.focusLast()),
            moveWindowToStart: () => this.focusAndShowMinimap((stack) => stack.moveWindowToStart()),
            moveWindowToEnd: () => this.focusAndShowMinimap((stack) => stack.moveWindowToEnd()),
            shiftViewportToStart: () => this.stripManager.activeStripStack().shiftViewportToStart(),
            shiftViewportToEnd: () => this.stripManager.activeStripStack().shiftViewportToEnd(),
            increaseColumnWidth: () => this.stripManager.activeStripStack().increaseColumnWidth(),
            decreaseColumnWidth: () => this.stripManager.activeStripStack().decreaseColumnWidth(),
            increaseWindowHeight: () => this.stripManager.activeStripStack().increaseWindowHeight(),
            decreaseWindowHeight: () => this.stripManager.activeStripStack().decreaseWindowHeight(),
```

`focusFirst`/`focusLast`/`moveWindowToStart`/`moveWindowToEnd` change focus, so they go through `focusAndShowMinimap` like `focusLeft`/`moveWindowLeft` already do. The other six don't change focus, so they call `activeStripStack()` directly, like `cycleAlignLeft`/`shiftViewportLeft` already do.

- [ ] **Step 2: Run the full suite and build**

`npm test`
Expected: PASS

`npm run build`
Expected: succeeds (verifies `Controller`'s object literal satisfies the full `ShortcutActions` interface)

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules
- [ ] `npm test` and `npm run build` passing
- [ ] Any convention violations fixed

---

## Task 12: Update `comparison-keybindings.md`

**Files:**
- Modify: `docs/comparison-keybindings.md`

- [ ] **Step 1: Fill in the five newly-implemented "Drift" cells**

Replace the `—` in the "Drift" column with the matching "Drift Target" value (they're now identical) for these five rows: "Focus first/last column", "Move column/window to start/end", "Increase/decrease column width", "Increase/decrease window height", and "Scroll viewport to start/end". Also fix the markdown glitch on the two width/height rows so both columns read the named `Plus` key consistently — for example:

```markdown
| Increase/decrease column width | `Mod+=` / `Mod+-` | `Super++` / `Super+-` | `Meta+Ctrl++` / `Meta+Ctrl+-` | `Meta+Plus` / `Meta+-` | `Meta+Plus` / `Meta+-` |
| Increase/decrease window height | `Mod+Shift+=` / `Mod+Shift+-` | `Shift+Super++` / `Shift+Super+-` | — | `Meta+Shift+Plus` / `Meta+Shift+-` | `Meta+Shift+Plus` / `Meta+Shift+-` |
```

- [ ] **Step 2: Update the "Observations" section**

In the bullet "Column/window reordering by keyboard is a gap," this remains true (that bullet is about reordering by *dragging* vs. keyboard, unaffected by this plan — leave as-is).

Replace the "Column width control is a gap" bullet:

```markdown
- **Column width control is now keyboard-steppable** (`Meta+Plus`/`Meta+-`), reusing the same `Grid.resizeColumn` mouse-drag already had. Cycling between preset widths (`Meta+R`) is still a gap — it needs an actual preset list, which doesn't exist yet.
```

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] One sentence per line (per `AGENTS.md`'s documentation-writing rule)
- [ ] No other unrelated rows changed

---

## Self-Review Notes

**Spec coverage:** All five action pairs from the design doc have a task (Grid: Task 2; Strip: Tasks 3–6, 8; Column: Task 7; StripStack: Task 9; wiring: Tasks 10–11; docs: Task 12). Settings/config plumbing (Task 1) covers all ten shortcuts plus both new step settings.

**Type consistency:** `focusFirst`/`focusLast`/`moveWindowToStart`/`moveWindowToEnd`/`shiftViewportToStart`/`shiftViewportToEnd`/`increaseColumnWidth`/`decreaseColumnWidth` are `void` at every layer (Grid returns `Column | null` internally, but `Strip` discards it via `activateColumn`). `increaseWindowHeight`/`decreaseWindowHeight` are `boolean` from `Column` through `Strip` and `StripStack`, `void` only at the `ShortcutActions` interface boundary (Task 10) — consistent with how `moveTileUp`/`moveTileDown` are typed but never wired as standalone shortcuts today.

**No placeholders:** every step has real, complete code.
