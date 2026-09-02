# Symmetric Row Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `StripStack` create and navigate rows above row 0, not just below it, so the workspace is unbounded in both vertical directions.

**Architecture:** `StripStack.rows` is already a sparse `Map<number, Strip>`, and the vertical layout math already renders whichever row is active at the workspace top regardless of its numeric index. Three isolated guards in `src/runtime/strip-stack.ts` currently special-case index `0` (`rowUp`'s no-op, `moveFocusedWindowToRow`'s negative-index no-op, and `pruneIfEmpty`'s never-prune-row-0 rule); removing them is the entire change. See [`docs/agents/specs/2026-09-02-symmetric-row-stack-design.md`](../specs/2026-09-02-symmetric-row-stack-design.md) for the full design rationale.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

### Task 1: `rowUp` pages above row 0 into row -1

**Files:**
- Modify: `src/runtime/strip-stack.ts:120-125` (`rowUp`)
- Test: `src/runtime/strip-stack.test.ts:198-207` (replaces the existing `'rowUp is a no-op at row 0'` test), and a new test alongside `strip-stack.test.ts:220-228` (`'rowUp after rowDown returns to row 0'`)

- [ ] **Step 1: Write the failing tests**

In `src/runtime/strip-stack.test.ts`, replace the existing test:

```typescript
    it('rowUp is a no-op at row 0', () => {
        const { stack, created } = makeStack();

        stack.rowUp();
        stack.render();

        expect(created).toHaveLength(1); // still only row 0
        expect(created[0].render).toHaveBeenCalled(); // render() still targets row 0
    });
```

with:

```typescript
    it('rowUp pages into a new row -1 when at row 0', () => {
        const { stack, created } = makeStack();

        stack.rowUp();
        stack.render();

        expect(created).toHaveLength(2); // row 0 and the newly created row -1
        expect(created[1].render).toHaveBeenCalled(); // render() now targets row -1
        expect(created[0].render).not.toHaveBeenCalled();
    });
```

Then add a new test directly after the existing `'rowUp after rowDown returns to row 0'` test (`strip-stack.test.ts:220-228`):

```typescript
    it('rowDown after rowUp returns to row 0', () => {
        const { stack, created } = makeStack();
        stack.rowUp(); // row 0 -> row -1

        stack.rowDown();
        stack.render();

        expect(created[0].render).toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

`npx vitest run src/runtime/strip-stack.test.ts -t "rowUp"`
Expected: FAIL — `rowUp pages into a new row -1 when at row 0` fails because `rowUp()` still no-ops at row 0 (`created` has length 1, not 2); `rowDown after rowUp returns to row 0` fails for the same underlying reason (there's no row -1 to return from).

- [ ] **Step 3: Remove the row-0 guard in `rowUp`**

In `src/runtime/strip-stack.ts`, change:

```typescript
    rowUp(): void {
        if (this.activeRowIndex === 0) {
            return;
        }
        this.switchToRow(this.activeRowIndex - 1);
    }
```

to:

```typescript
    rowUp(): void {
        this.switchToRow(this.activeRowIndex - 1);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

`npx vitest run src/runtime/strip-stack.test.ts`
Expected: PASS — full file, including the two changed/added tests and every pre-existing test in it (this also guards against a regression in the unrelated tests in the same file).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `moveWindowToRowAbove` moves a window above row 0, unbounded

**Files:**
- Modify: `src/runtime/strip-stack.ts:213-219` (`moveFocusedWindowToRow`)
- Test: `src/runtime/strip-stack.test.ts:308-315` (replaces the existing `'moveWindowToRowAbove is a no-op at row 0'` test), plus one new test in the same `describe('StripStack.moveWindowToRowAbove/Below', ...)` block

- [ ] **Step 1: Write the failing tests**

In `src/runtime/strip-stack.test.ts`, replace:

```typescript
    it('moveWindowToRowAbove is a no-op at row 0', () => {
        const { stack, created } = makeStack();

        stack.moveWindowToRowAbove();

        expect(created).toHaveLength(1); // no row -1 created
        expect(created[0].detachFocusedColumn).not.toHaveBeenCalled();
    });
```

with:

```typescript
    it('moveWindowToRowAbove moves the focused window into row -1 when at row 0', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue(win);

        stack.moveWindowToRowAbove();
        stack.render();

        expect(created[0].detachFocusedColumn).toHaveBeenCalled();
        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
        expect(created[1].render).toHaveBeenCalled(); // row -1 is now active
    });
```

Then add a new test after `'prunes the source row if moving its last window empties it'` (`strip-stack.test.ts:359-370`), still inside the same `describe` block:

```typescript
    it('moveWindowToRowAbove twice moves a window from row 0 through row -1 into row -2', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue(win);

        stack.moveWindowToRowAbove(); // win: row 0 -> row -1
        created[1].isEmpty.mockReturnValue(false); // row -1 now owns a window; don't prune it on the next move
        created[1].detachFocusedColumn.mockReturnValue(win);

        stack.moveWindowToRowAbove(); // win: row -1 -> row -2

        expect(created[2].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });
```

- [ ] **Step 2: Run tests to verify they fail**

`npx vitest run src/runtime/strip-stack.test.ts -t "moveWindowToRowAbove"`
Expected: FAIL — `moveWindowToRowAbove moves the focused window into row -1 when at row 0` fails because `moveFocusedWindowToRow` still returns early for `targetIndex < 0`, so `detachFocusedColumn` and `addWindow` are never called; the double-move test fails for the same reason.

- [ ] **Step 3: Remove the negative-index guard in `moveFocusedWindowToRow`**

In `src/runtime/strip-stack.ts`, change:

```typescript
    private moveFocusedWindowToRow(
        targetIndex: number,
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
    ): void {
        if (targetIndex < 0) {
            return;
        }
        const sourceIndex = this.activeRowIndex;
```

to:

```typescript
    private moveFocusedWindowToRow(
        targetIndex: number,
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
    ): void {
        const sourceIndex = this.activeRowIndex;
```

- [ ] **Step 4: Run tests to verify they pass**

`npx vitest run src/runtime/strip-stack.test.ts`
Expected: PASS — full file, including the mouse-drag tests in `describe('StripStack cross-row drag', ...)`, since `moveFocusedWindowToRow` is the same function `onEdgeDwellFired` calls; removing its guard fixes drag-to-row-above symmetrically for free.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Row 0 is prunable like any other row

**Files:**
- Modify: `src/runtime/strip-stack.ts:310-313` (`pruneIfEmpty`)
- Test: `src/runtime/strip-stack.test.ts` — new test in `describe('StripStack.moveWindowToRowAbove/Below', ...)`, directly after the test added in Task 2

- [ ] **Step 1: Write the failing test**

In `src/runtime/strip-stack.test.ts`, add:

```typescript
    it('prunes row 0 once it becomes empty and inactive, recreating it fresh on return', () => {
        const { stack, created } = makeStack();
        // row 0 starts empty (created[0].isEmpty defaults to true)

        stack.rowDown(); // row 0 -> row 1; leaving empty row 0 behind prunes it
        stack.rowUp(); // page back toward row 0 to prove it was pruned and recreated

        expect(created).toHaveLength(3); // the original (now-pruned) row 0, row 1, and a fresh row 0
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npx vitest run src/runtime/strip-stack.test.ts -t "prunes row 0"`
Expected: FAIL — `created` has length 2, not 3, because `pruneIfEmpty` still special-cases `index === 0` and never deletes it, so paging back to row 0 reuses the original strip instead of creating a fresh one.

- [ ] **Step 3: Remove the row-0 special case in `pruneIfEmpty`**

In `src/runtime/strip-stack.ts`, change:

```typescript
    private pruneIfEmpty(index: number): void {
        if (index === 0 || index === this.activeRowIndex) {
            return; // row 0 is never pruned; you can't prune the row you're standing in
        }
```

to:

```typescript
    private pruneIfEmpty(index: number): void {
        if (index === this.activeRowIndex) {
            return; // you can't prune the row you're standing in
        }
```

- [ ] **Step 4: Run test to verify it passes**

`npx vitest run src/runtime/strip-stack.test.ts`
Expected: PASS — full file.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Update stale comments and run full verification

**Files:**
- Modify: `src/runtime/strip-stack.ts:1-4` (file header comment)
- Modify: `src/runtime/strip-stack.ts:147` (`row()` JSDoc)

This task has no new behavior and no new tests — it only corrects comments left over from the old row-0-is-special design, then runs the full verification suite.

- [ ] **Step 1: Update the file header comment**

In `src/runtime/strip-stack.ts`, change:

```typescript
// One (activity, virtualDesktop) pair's full vertical stack of rows: an ordered set of
// independent Strips (each one row, unchanged), paged between via a Drift-native vertical
// camera. Row 0 always exists; rows above/below are created lazily and pruned once empty
// (docs: 2026-09-01-row-navigation-design).
```

to:

```typescript
// One (activity, virtualDesktop) pair's full vertical stack of rows: an ordered set of
// independent Strips (each one row, unchanged), paged between via a Drift-native vertical
// camera. Rows are created lazily in either direction (positive or negative index) and pruned
// once empty and inactive, including row 0 (docs: 2026-09-01-row-navigation-design,
// 2026-09-02-symmetric-row-stack-design).
```

- [ ] **Step 2: Update the `row()` JSDoc**

In `src/runtime/strip-stack.ts`, change:

```typescript
    /** Row 0 always exists; other rows are created lazily on first access. */
    private row(index: number): Strip {
```

to:

```typescript
    /** Row 0 is created eagerly as the stack's starting position; every row, in either
     * direction, is created lazily on first access after that. */
    private row(index: number): Strip {
```

- [ ] **Step 3: Run the full test suite**

`npm test`
Expected: PASS — every test file in the project, not just `strip-stack.test.ts`.

- [ ] **Step 4: Run lint**

`npm run lint`
Expected: PASS — no ESLint, Prettier, or qmllint violations.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task
