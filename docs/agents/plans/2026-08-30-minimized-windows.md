# Minimized Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Minimizing a window closes the gap in the strip (right-hand columns shift left, exactly as if the window was closed) and no longer causes the camera viewport to shift; restoring a minimized window brings its column back at its original position.

**Architecture:** `Column` gains a `hidden` flag. `Grid` keeps hidden columns in its ordered list (so restoring is free) but excludes them from all layout math (width/offset/insertion) and from focus navigation. `main.ts` listens to KWin's `minimizedChanged` signal to toggle a column's hidden flag, skips hidden columns when applying geometry, and ignores geometry-change events for hidden columns (the actual fix for the camera-shift bug).

**Tech Stack:** TypeScript, JavaScript, and QML with npm.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design spec:** `docs/agents/specs/2026-08-30-minimized-windows-design.md` — read before implementing

---

### Task 1: `Column` gains a `hidden` flag

**Files:**
- Modify: `src/core/column.ts`
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/column.test.ts`, after the existing `describe('Column', ...)` block:

```typescript
describe('Column — hidden flag', () => {
    it('starts visible', () => {
        const column = new Column(1, 300);
        expect(column.hidden).toBe(false);
    });

    it('toggles hidden via setHidden', () => {
        const column = new Column(1, 300);
        column.setHidden(true);
        expect(column.hidden).toBe(true);
        column.setHidden(false);
        expect(column.hidden).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- src/core/column.test.ts`
Expected: FAIL — `column.hidden` is `undefined` / `setHidden` is not a function.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/core/column.ts` with:

```typescript
// A single column in the strip. Reduced for the spike: identity and width only.
// Vertical tiling (stacking windows within a column) is deferred (docs §5, §7.2).

function assertPositiveWidth(width: number): void {
    if (!(width > 0)) {
        throw new Error(`Column width must be positive, got ${width}`);
    }
}

export class Column {
    private columnWidth: number;
    private isHiddenFlag = false;

    constructor(
        public readonly id: number,
        width: number,
    ) {
        assertPositiveWidth(width);
        this.columnWidth = width;
    }

    get width(): number {
        return this.columnWidth;
    }

    setWidth(width: number): void {
        assertPositiveWidth(width);
        this.columnWidth = width;
    }

    /** True while the column's window is minimized (docs: minimized-windows design). */
    get hidden(): boolean {
        return this.isHiddenFlag;
    }

    setHidden(hidden: boolean): void {
        this.isHiddenFlag = hidden;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- src/core/column.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` members, `PascalCase` class)
- [ ] `npm run lint -- src/core/column.ts src/core/column.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `Grid` — hide/show columns, excluded from layout math

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts`, after the `describe('Grid — geometry', ...)` block:

```typescript
describe('Grid — hiding and showing columns', () => {
    it('excludes a hidden column from virtualWidth and neighbor offsets, closing the gap', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        expect(grid.virtualWidth()).toBe(510); // 300 + gap(10) + 200 — b contributes nothing
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(c.id).x).toBe(310); // c shifts left to fill b's gap
    });

    it('keeps the hidden column in columns() at its original position', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        expect(grid.columns().map((col) => col.id)).toEqual([a.id, b.id, c.id]);
    });

    it('restores a shown column to its original layout position', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.hideColumn(b.id);
        grid.showColumn(b.id);
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(b.id).x).toBe(310);
        expect(grid.virtualWidth()).toBe(810);
    });

    it('throws when asked for the rect of a hidden column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.hideColumn(a.id);
        expect(() => grid.columnRect(a.id)).toThrow();
    });

    it('reports hidden state via isHidden', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.isHidden(a.id)).toBe(false);
        grid.hideColumn(a.id);
        expect(grid.isHidden(a.id)).toBe(true);
        grid.showColumn(a.id);
        expect(grid.isHidden(a.id)).toBe(false);
    });

    it('does not change focus when hiding or showing the focused column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500);
        grid.setFocus(a.id);
        grid.hideColumn(a.id);
        expect(grid.focusedColumn()).toBe(a);
        grid.showColumn(a.id);
        expect(grid.focusedColumn()).toBe(a);
    });
});
```

Update the existing `describe('Grid — debugState', ...)` test — `debugState()` now reports a `hidden` flag per column:

```typescript
describe('Grid — debugState', () => {
    it('reports focus, id counter, origin, and columns with widths', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500);
        grid.setFocus(a.id);
        expect(grid.debugState()).toEqual({
            focusedColumnId: 1,
            nextId: 3,
            originX: 0,
            columns: [
                { id: 1, width: 300, hidden: false },
                { id: 2, width: 500, hidden: false },
            ],
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- src/core/grid.test.ts`
Expected: FAIL — `grid.hideColumn is not a function`, and the `debugState` test fails on the missing `hidden` field.

- [ ] **Step 3: Write minimal implementation**

In `src/core/grid.ts`, update the `GridDebugState` interface:

```typescript
export interface GridDebugState {
    focusedColumnId: number | null;
    nextId: number;
    originX: number;
    columns: { id: number; width: number; hidden: boolean }[];
}
```

Add these three methods to the `Grid` class, right after `removeColumn`:

```typescript
    /** Hides a column's window (e.g. minimized) without removing it from the strip:
     * it keeps its place in `columns()` but stops contributing width/gap to layout. */
    hideColumn(id: number): void {
        this.requireColumn(id).setHidden(true);
    }

    /** Reverses `hideColumn` — the column resumes contributing to layout at its same position. */
    showColumn(id: number): void {
        this.requireColumn(id).setHidden(false);
    }

    isHidden(id: number): boolean {
        return this.requireColumn(id).hidden;
    }
```

Replace `virtualWidth()` and `columnRect()`:

```typescript
    virtualWidth(): number {
        return virtualWidth(this.visibleWidths(), this.gap);
    }

    contentLeft(): number {
        return this.originX;
    }

    columnRect(id: number): Rect {
        const column = this.requireColumn(id);
        if (column.hidden) {
            throw new Error(`Column ${id} is hidden`);
        }
        const visible = this.visibleColumns();
        const index = visible.indexOf(column);
        const offset = columnOffsets(this.visibleWidths(), this.gap, this.originX)[index];
        return columnRect(offset, column.width, this.height);
    }
```

Replace `debugState()`:

```typescript
    /** Raw internal state for the debug console (docs §8) — not used by layout logic. */
    debugState(): GridDebugState {
        return {
            focusedColumnId: this.focusedColumnId,
            nextId: this.nextId,
            originX: this.originX,
            columns: this.ordered.map((column) => ({ id: column.id, width: column.width, hidden: column.hidden })),
        };
    }
```

Replace the private `widths()` helper with two helpers (add right after `debugState`, before the existing `moveFocus`):

```typescript
    private visibleColumns(): Column[] {
        return this.ordered.filter((column) => !column.hidden);
    }

    private visibleWidths(): number[] {
        return this.visibleColumns().map((column) => column.width);
    }
```

Delete the old `private widths(): number[] { return this.ordered.map((column) => column.width); }` method — it is no longer used.

- [ ] **Step 4: Run test to verify it passes**

`npm test -- src/core/grid.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run typecheck` passes (confirms `widths()` removal didn't leave a dangling reference)
- [ ] `npm run lint -- src/core/grid.ts src/core/grid.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: `Grid` — focus navigation skips hidden columns

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts`, after the `describe('Grid — focus navigation', ...)` block:

```typescript
describe('Grid — focus navigation skips hidden columns', () => {
    it('skips a hidden column when moving focus right', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        grid.setFocus(a.id);
        expect(grid.focusRight()).toBe(c);
    });

    it('skips a hidden column when moving focus left', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        grid.setFocus(c.id);
        expect(grid.focusLeft()).toBe(a);
    });

    it('leaves focus unchanged when every column in that direction is hidden', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.hideColumn(b.id);
        grid.setFocus(a.id);
        expect(grid.focusRight()).toBe(a);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- src/core/grid.test.ts`
Expected: FAIL — `focusRight()`/`focusLeft()` currently land on the hidden column instead of skipping it.

- [ ] **Step 3: Write minimal implementation**

Replace the private `moveFocus` method in `src/core/grid.ts`:

```typescript
    private moveFocus(step: number): Column | null {
        if (this.focusedColumnId === null) {
            return null;
        }
        const current = this.indexOf(this.focusedColumnId);
        for (let target = current + step; target >= 0 && target < this.ordered.length; target += step) {
            if (!this.ordered[target].hidden) {
                this.focusedColumnId = this.ordered[target].id;
                return this.ordered[target];
            }
        }
        return this.columnById(this.focusedColumnId);
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- src/core/grid.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run lint -- src/core/grid.ts src/core/grid.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: `Grid.removeColumn` skips hidden neighbors when reassigning focus

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts`, after the `describe('Grid — removing columns closes the gap', ...)` block:

```typescript
describe('Grid — removing a column skips hidden neighbors when reassigning focus', () => {
    it('moves focus past a hidden right neighbor to the next visible column', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        const d = grid.addColumn(150);
        grid.hideColumn(c.id);
        grid.setFocus(b.id);
        grid.removeColumn(b.id);
        expect(grid.focusedColumn()).toBe(d);
    });

    it('falls back to a visible left neighbor when every right neighbor is hidden', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        grid.hideColumn(c.id);
        grid.setFocus(b.id);
        grid.removeColumn(b.id);
        expect(grid.focusedColumn()).toBe(a);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- src/core/grid.test.ts`
Expected: FAIL — today's fallback (`this.ordered[index] ?? this.ordered[index - 1]`) picks the hidden column instead of skipping it.

- [ ] **Step 3: Write minimal implementation**

Replace `removeColumn` in `src/core/grid.ts`:

```typescript
    removeColumn(id: number): void {
        const index = this.requireIndex(id);
        this.ordered.splice(index, 1);
        if (this.focusedColumnId !== id) {
            return;
        }
        const next = this.nearestVisibleFrom(index);
        this.focusedColumnId = next ? next.id : null;
    }
```

Add a new private helper, next to `visibleColumns`/`visibleWidths`:

```typescript
    /** Nearest visible column at or after `index`, else nearest visible before it, else null. */
    private nearestVisibleFrom(index: number): Column | null {
        for (let i = index; i < this.ordered.length; i++) {
            if (!this.ordered[i].hidden) {
                return this.ordered[i];
            }
        }
        for (let i = index - 1; i >= 0; i--) {
            if (!this.ordered[i].hidden) {
                return this.ordered[i];
            }
        }
        return null;
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- src/core/grid.test.ts`
Expected: PASS — this must also NOT break the existing `describe('Grid — removing columns closes the gap', ...)` tests (no hidden columns there, so behavior is unchanged).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run lint -- src/core/grid.ts src/core/grid.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: `Grid.insertionIndexForX` skips hidden columns

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/core/grid.test.ts`, after the `describe('Grid — insertion index for a drag position', ...)` block:

```typescript
describe('Grid — insertion index skips hidden columns', () => {
    it('excludes a hidden column from boundary candidates and maps back to the full ordered index', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // visible, [0,300)
        const b = grid.addColumn(500); // hidden — contributes no space
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        // with c excluded and b hidden: only a occupies space, boundaries are [0, 300]
        expect(grid.insertionIndexForX(c.id, 50)).toBe(0); // before a -> ordered index 0
        expect(grid.insertionIndexForX(c.id, 400)).toBe(2); // past a -> ordered index 2 (end, after hidden b)
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- src/core/grid.test.ts`
Expected: FAIL — today's `insertionIndexForX` includes `b`'s full width in the boundary math even though it's hidden.

- [ ] **Step 3: Write minimal implementation**

Replace `insertionIndexForX` in `src/core/grid.ts`:

```typescript
    /** Insertion index — a valid `moveColumn` target — closest to `virtualX`,
     * considering every VISIBLE column except `excludeId` (the one being dragged),
     * then mapped back to a real index in the full ordered list. */
    insertionIndexForX(excludeId: number, virtualX: number): number {
        const remaining = this.ordered.filter((column) => column.id !== excludeId);
        const visibleRemaining = remaining.filter((column) => !column.hidden);
        const widths = visibleRemaining.map((column) => column.width);
        const offsets = columnOffsets(widths, this.gap, this.originX);
        const visibleIndex = nearestInsertionIndex(offsets, widths, virtualX);
        if (visibleIndex >= visibleRemaining.length) {
            return remaining.length;
        }
        return remaining.indexOf(visibleRemaining[visibleIndex]);
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- src/core/grid.test.ts`
Expected: PASS — including the existing `describe('Grid — insertion index for a drag position', ...)` tests (no hidden columns there, so `visibleRemaining === remaining` and behavior is unchanged).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm test` (full suite) passes — Task 5 completes all `Grid`/`Column` changes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint -- src/core/grid.ts src/core/grid.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 6: `debug-format.ts` — mark hidden columns/rows

**Files:**
- Modify: `src/core/debug-format.ts`
- Test: `src/core/debug-format.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/core/debug-format.test.ts`, update the existing row literal in `'formats one row per window with its title, virtual, and real geometry'` to include `hidden: false`:

```typescript
    it('formats one row per window with its title, virtual, and real geometry', () => {
        const text = formatDebugState(
            [
                {
                    columnId: 1,
                    id: 'win-1',
                    title: 'Firefox',
                    hidden: false,
                    virtual: { x: 0, y: 0, width: 800, height: 1040 },
                    real: { x: -120, y: 0, width: 800, height: 1040 },
                },
            ],
            { offset: 120, viewportWidth: 1920, contentLeft: 0, contentWidth: 2400 },
        );

        expect(text).toBe(
            'camera: offset=120 viewport=1920 content=[0..2400]\n' +
                'col 1 (win win-1 "Firefox"): virtual={x:0,y:0,w:800,h:1040} real={x:-120,y:0,w:800,h:1040}',
        );
    });
```

Update the existing `'prepends a grid line when grid debug state is given'` test's `columns` array to include `hidden: false`:

```typescript
    it('prepends a grid line when grid debug state is given', () => {
        const text = formatDebugState(
            [],
            { offset: 120, viewportWidth: 1920, contentLeft: 0, contentWidth: 2400 },
            {
                focusedColumnId: 2,
                nextId: 3,
                originX: -120,
                columns: [
                    { id: 1, width: 800, hidden: false },
                    { id: 2, width: 640, hidden: false },
                ],
            },
        );

        expect(text).toBe(
            'grid: focused=2 nextId=3 originX=-120 columns=[1:800,2:640]\n' +
                'camera: offset=120 viewport=1920 content=[0..2400]',
        );
    });
```

Add two new tests at the end of the `describe('formatDebugState', ...)` block:

```typescript
    it('marks a hidden row with [minimized]', () => {
        const text = formatDebugState(
            [
                {
                    columnId: 1,
                    id: 'win-1',
                    title: 'Firefox',
                    hidden: true,
                    virtual: { x: 0, y: 0, width: 800, height: 0 },
                    real: { x: 0, y: 0, width: 800, height: 1040 },
                },
            ],
            { offset: 0, viewportWidth: 1920, contentLeft: 0, contentWidth: 800 },
        );

        expect(text).toBe(
            'camera: offset=0 viewport=1920 content=[0..800]\n' +
                'col 1 (win win-1 "Firefox") [minimized]: virtual={x:0,y:0,w:800,h:0} real={x:0,y:0,w:800,h:1040}',
        );
    });

    it('marks a hidden column in the grid line', () => {
        const text = formatDebugState(
            [],
            { offset: 0, viewportWidth: 1920, contentLeft: 0, contentWidth: 800 },
            {
                focusedColumnId: 1,
                nextId: 2,
                originX: 0,
                columns: [{ id: 1, width: 800, hidden: true }],
            },
        );

        expect(text).toBe(
            'grid: focused=1 nextId=2 originX=0 columns=[1:800(hidden)]\n' +
                'camera: offset=0 viewport=1920 content=[0..800]',
        );
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- src/core/debug-format.test.ts`
Expected: FAIL — `hidden` isn't a known field on `WindowDebugRow`/the grid column shape yet, and the new tests don't see `[minimized]`/`(hidden)` markers.

- [ ] **Step 3: Write minimal implementation**

In `src/core/debug-format.ts`, update `WindowDebugRow`:

```typescript
export interface WindowDebugRow {
    id: string;
    title: string;
    columnId: number;
    hidden: boolean;
    virtual: Rect;
    real: Rect;
}
```

Update `formatDebugState`'s `windowLines` mapping:

```typescript
    const windowLines = rows.map(
        (row) =>
            `col ${row.columnId} (win ${row.id} "${row.title}")${row.hidden ? ' [minimized]' : ''}: ` +
            `virtual=${formatRect(row.virtual)} real=${formatRect(row.real)}`,
    );
```

Update `formatGridLine`:

```typescript
function formatGridLine(grid: GridDebugState): string {
    const columns = grid.columns
        .map((column) => `${column.id}:${column.width}${column.hidden ? '(hidden)' : ''}`)
        .join(',');
    return `grid: focused=${grid.focusedColumnId} nextId=${grid.nextId} originX=${grid.originX} columns=[${columns}]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- src/core/debug-format.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run lint -- src/core/debug-format.ts src/core/debug-format.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 7: `kwin.d.ts` — expose `minimized` / `minimizedChanged`

**Files:**
- Modify: `src/types/kwin.d.ts`

No test — this is an ambient type declaration file, not executable logic (docs §8).

- [ ] **Step 1: Add the new members to the `Window` interface**

In `src/types/kwin.d.ts`, add `readonly minimized: boolean;` after `readonly resize: boolean;`, and add `readonly minimizedChanged: Signal<() => void>;` after `readonly frameGeometryChanged: Signal<(oldGeometry: QRect) => void>;`, so the interface reads:

```typescript
interface Window {
    frameGeometry: QRect;
    readonly internalId: string;
    readonly caption: string;
    readonly normalWindow: boolean;
    readonly transient: boolean;
    readonly fullScreen: boolean;
    readonly skipTaskbar: boolean;
    readonly onScreenDisplay: boolean;
    readonly deleted: boolean;
    readonly minSize: QSize;
    readonly maxSize: QSize;
    readonly move: boolean;
    readonly resize: boolean;
    readonly minimized: boolean;
    readonly frameGeometryChanged: Signal<(oldGeometry: QRect) => void>;
    readonly minimizedChanged: Signal<() => void>;
    readonly interactiveMoveResizeStarted: Signal<() => void>;
    readonly interactiveMoveResizeFinished: Signal<() => void>;
}
```

(Verified against the installed Karousel bundle: `kwinClient.minimized` / `kwinClient.minimizedChanged`, per repo memory of the KWin 6 declarativescript API.)

- [ ] **Step 2: Run typecheck**

`npm run typecheck`
Expected: PASS (adding fields to an interface with no other consumers yet doesn't break anything).

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run lint -- src/types/kwin.d.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 8: `WindowAdapter` — `isMinimized()` / `onMinimizedChanged()`

**Files:**
- Modify: `src/kwin/window-adapter.ts`
- Modify: `src/kwin/window-adapter.test.ts`

- [ ] **Step 1: Update the test helper so the existing suite still compiles**

In `src/kwin/window-adapter.test.ts`, add `minimized: false,` and `minimizedChanged: { connect: () => {}, disconnect: () => {} },` to the `createWindow` helper's default object (the `Window` interface now requires them):

```typescript
function createWindow(overrides: Partial<Window> = {}): Window {
    return {
        frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
        internalId: 'window-1',
        caption: 'Window',
        normalWindow: true,
        skipTaskbar: false,
        onScreenDisplay: false,
        deleted: false,
        minSize: { width: 0, height: 0 },
        maxSize: { width: 1920, height: 1080 },
        move: false,
        resize: false,
        minimized: false,
        frameGeometryChanged: { connect: () => {}, disconnect: () => {} },
        minimizedChanged: { connect: () => {}, disconnect: () => {} },
        interactiveMoveResizeStarted: { connect: () => {}, disconnect: () => {} },
        interactiveMoveResizeFinished: { connect: () => {}, disconnect: () => {} },
        ...overrides,
        transient: overrides.transient ?? false,
        fullScreen: overrides.fullScreen ?? false,
    };
}
```

- [ ] **Step 2: Run test to verify the suite still passes**

`npm test -- src/kwin/window-adapter.test.ts`
Expected: PASS (this step only keeps the existing `isTileable` suite compiling against the wider `Window` interface from Task 7 — no new adapter behavior yet).

- [ ] **Step 3: Add the adapter methods**

In `src/kwin/window-adapter.ts`, add `isMinimized()` right after `maxWidth()`:

```typescript
    isMinimized(): boolean {
        return this.window.minimized;
    }
```

Add `onMinimizedChanged()` right after `onFrameGeometryChanged()` (end of class):

```typescript
    onMinimizedChanged(handler: () => void): () => void {
        this.window.minimizedChanged.connect(handler);
        return () => this.window.minimizedChanged.disconnect(handler);
    }
```

These are thin KWin wrappers with no independent logic (docs §8, same convention as `isInteractiveResize`/`onFrameGeometryChanged`) — no dedicated unit test beyond the compile-level helper update above.

- [ ] **Step 4: Run typecheck and the adapter test**

`npm run typecheck && npm test -- src/kwin/window-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run lint -- src/kwin/window-adapter.ts src/kwin/window-adapter.test.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 9: `main.ts` — wire minimize/restore, guard the camera-shift bug

**Files:**
- Modify: `src/main.ts`

No new automated test — this is boot-time glue over already-tested `Grid`/`WindowAdapter` behavior (docs §8). Verified live per the plan's final task.

- [ ] **Step 1: Skip hidden columns in `render()`**

In `src/main.ts`, replace the `render` function body's column loop:

```typescript
    function render(excludeWindowId?: string): void {
        viewport.setContentGeometry(grid.contentLeft(), grid.virtualWidth());
        for (const column of grid.columns()) {
            if (column.hidden) {
                continue;
            }
            const win = windowsByColumn.get(column.id);
            if (win && win.id !== excludeWindowId) {
                geometrySync.apply(win, grid.columnRect(column.id), viewport.offset());
            }
        }
        setDebugState(formatDebugState(debugRows(), debugCamera(), grid.debugState()));
    }
```

- [ ] **Step 2: Report hidden columns in the debug rows**

Replace `debugRows`:

```typescript
    function debugRows(): WindowDebugRow[] {
        return grid.columns().map((column) => {
            const win = windowsByColumn.get(column.id);
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
```

- [ ] **Step 3: Guard the geometry-changed handler against hidden columns (the camera-shift fix)**

Replace the first two lines of `onWindowGeometryChanged`'s body:

```typescript
    function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect): void {
        const columnId = columnOf(win.id);
        if (columnId === null || grid.isHidden(columnId)) {
            return;
        }
        const newReal = win.frameGeometry();
```

(The rest of the function — `rectsEqualRounded`, `geometrySync.isEcho`, the width-only check, and the `grid.resizeColumn`/`render` calls — is unchanged.)

- [ ] **Step 4: Wire the minimize/restore signal**

Add a new function next to `onWindowGeometryChanged`:

```typescript
    function onMinimizedChanged(win: WindowAdapter): void {
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        if (win.isMinimized()) {
            grid.hideColumn(columnId);
        } else {
            grid.showColumn(columnId);
        }
        render();
    }
```

In the `workspaceAdapter.onWindowAdded` handler, hide the column immediately if the window is already minimized, connect the new signal, and disconnect it alongside the others:

```typescript
    workspaceAdapter.onWindowAdded((win) => {
        if (!win.isTileable()) {
            return;
        }
        const width = Math.round(win.frameGeometry().width) || settings.defaultColumnWidth;
        const column = grid.addColumn(width);
        windowsByColumn.set(column.id, win);
        if (win.isMinimized()) {
            grid.hideColumn(column.id);
        }
        const disconnectGeometry = win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal));
        const disconnectMinimized = win.onMinimizedChanged(() => onMinimizedChanged(win));
        const disconnectDrag = registerDragReorder(win, column.id, {
            grid,
            viewport,
            workspaceAdapter,
            area,
            render,
        });
        disconnectByColumn.set(column.id, () => {
            disconnectGeometry();
            disconnectMinimized();
            disconnectDrag();
        });
        render();
        revealFocused();
    });
```

- [ ] **Step 5: Run the full check suite**

`npm run typecheck && npm test && npm run lint && npm run build`
Expected: all PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run lint -- src/main.ts` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete quality gate**

```
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all four PASS, with no leftover formatting drift (see repo memory: re-run `npm run lint:fix` then `npm run lint` if an empty-block reformat sneaks in on a recently touched file).

- [ ] **Step 2: Confirm only the intended files changed**

`git status --short` and `git diff --stat`
Expected: only the files listed in Tasks 1–9 (`column.ts`, `column.test.ts`, `grid.ts`, `grid.test.ts`, `debug-format.ts`, `debug-format.test.ts`, `kwin.d.ts`, `window-adapter.ts`, `window-adapter.test.ts`, `main.ts`).

- [ ] **Step 3: Package for live verification**

`npm run package:install`

Per repo memory, this only takes effect on next login/`kwin_wayland --replace` (JS-logic-only smoke test) — a full login cycle is needed to also confirm the `minimizedChanged` signal actually fires live. This step is a handoff to the user; it is not part of the automated task loop.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] All four quality-gate commands passed
- [ ] `git status --short` shows only expected files
- [ ] Package installed for the user's next live verification
