# Drag-Reorder Live Preview and Anchor Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make drag-reorder use the dragged window's own center (not the cursor) to pick its insertion slot, and make that reorder happen live while dragging — displaced neighbors slide out of the way continuously, not only on release.

**Architecture:** `src/input/drag.ts`'s `registerDragReorder` gains a third signal connection (`onFrameGeometryChanged`, gated by the existing `dragging` flag) that recomputes the insertion index from the window's current center on every tick and commits it immediately via `Grid.moveColumn` + `Strip.render(excludeWindowId, instant=false)`, so neighbors animate through the existing `ColumnMotion`. On release, the dragged column itself is forced to snap instantly via a new `Strip.snapColumn` method, while neighbors keep whatever animation they're already mid-flight on. `WorkspaceAdapter.cursorX()` (and its supporting `cursorPos`/`QPoint` types) become dead code and are removed.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-08-31-drag-reorder-live-preview-design.md` — read before implementing

---

### Task 1: `Strip.snapColumn`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('column-motion animation', ...)` block in `src/runtime/strip.test.ts` (after the `'renders a column at its exact logical position when instant=true...'` test):

```ts
        it('snapColumn settles one column instantly while a separately-animating neighbor keeps sliding', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const timer = fakeTimer();
                const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, timer, fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                const win2 = fakeWindow('w2');
                const win3 = fakeWindow('w3');
                strip.addWindow(win1.adapter); // col id 1 @ x=0, focused
                strip.addWindow(win2.adapter); // col id 2 @ x=808, focused
                strip.addWindow(win3.adapter); // col id 3 @ x=1616, focused
                strip.focusLeft();
                strip.focusLeft(); // focus back to col 1

                const win4 = fakeWindow('w4');
                strip.addWindow(win4.adapter); // col id 4, inserted right of col 1; pushes col2 -> 1616, col3 -> 2424
                win2.setFrameGeometry.mockClear();
                win3.setFrameGeometry.mockClear();

                strip.snapColumn(2); // settle col2 (win2) instantly; col3 (win3) keeps animating
                vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
                strip.render();

                expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1616 }));
                const [lastCall] = win3.setFrameGeometry.mock.calls.slice(-1);
                const col3X = (lastCall[0] as { x: number }).x;
                expect(col3X).toBeGreaterThan(1616); // still mid-flight...
                expect(col3X).toBeLessThan(2424); // ...not yet at its target
            } finally {
                vi.useRealTimers();
            }
        });
```

Note: column ids are assigned sequentially starting at 1 by a fresh `Grid` per `Strip` (same invariant `grid.test.ts` already relies on for `Column.id`), so `win1`/`win2`/`win3`/`win4` added in that order get ids 1/2/3/4.

- [ ] **Step 2: Run test to verify it fails**

`npm test -- strip.test.ts`
Expected: FAIL — `strip.snapColumn` does not exist yet (TypeScript compile error surfaced via vitest).

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip.ts`, insert a new public method right after `render()`'s closing brace and before `revealFocused()`:

```ts
    /** Forces `columnId`'s position animation to rest at its current logical x with no
     * easing — used to settle the dragged column instantly on drag-reorder release
     * while its neighbors keep animating (docs: 2026-08-31-drag-reorder-live-preview). */
    snapColumn(columnId: number): void {
        this.columnMotion.snapTo(columnId, this.grid.columnRect(columnId).x);
    }

    revealFocused(): void {
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- strip.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` method, `PascalCase` class) for all new/edited symbols
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, 120-char limit)
- [ ] Task-level verification commands from the plan executed and passing (`npm test -- strip.test.ts`)
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Window-center anchor and live-preview reorder

**Files:**
- Modify: `src/input/drag.ts`
- Modify: `src/runtime/strip.ts`

This task has no new automated tests: `input/drag.ts`'s signal-wiring is untested glue, consistent with
the rest of `kwin/`/`input/` (docs §8) and the existing `2026-08-28-window-drag-reorder-design.md`
precedent. Verification is via `npm run typecheck` and the full `npm test` suite staying green.

- [ ] **Step 1: Replace `src/input/drag.ts` in full**

```ts
// Turns a window's interactive-move lifecycle into a live column reorder: as the
// window's center crosses a boundary, its neighbors slide out of the way (docs
// §2.1.7); on release, the dragged column itself snaps instantly into its final
// slot. The window's own real geometry is never touched while dragging — it keeps
// following the cursor untouched throughout.

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
}

/** Virtual x of `win`'s own center — the anchor used to find the nearest insertion
 * boundary, so the vote reflects the dragged window itself rather than wherever the
 * cursor happened to grab it. */
function windowCenterVirtualX(win: WindowAdapter, area: Rect, viewportOffsetX: number): number {
    const rect = win.frameGeometry();
    return toVirtualX(rect.x + rect.width / 2, area, viewportOffsetX);
}

/** Wires `win`'s move lifecycle to reorder `columnId` in `deps.grid` live, and to
 * settle it on release. Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, columnId: number, deps: DragReorderDeps): () => void {
    let dragging = false;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
    });

    /** Reorders `columnId` to the insertion index nearest the window's current
     * center. Returns whether the order actually changed. */
    const reorderToCurrentPosition = (): boolean => {
        const virtualX = windowCenterVirtualX(win, deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForX(columnId, virtualX);
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
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        reorderToCurrentPosition();
        deps.snapColumn(columnId);
        deps.render();
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
    };
}
```

- [ ] **Step 2: Update `registerDragReorder`'s call site in `src/runtime/strip.ts`**

Replace:

```ts
        signals.add(
            registerDragReorder(win, column.id, {
                grid: this.grid,
                viewport: this.viewport,
                workspaceAdapter: this.workspaceAdapter,
                area: this.area,
                // Drag-reorder settle stays fully instant, matching pre-animation behavior.
                render: () => this.render(undefined, true),
            }),
        );
```

With:

```ts
        signals.add(
            registerDragReorder(win, column.id, {
                grid: this.grid,
                viewport: this.viewport,
                area: this.area,
                render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
                snapColumn: (id) => this.snapColumn(id),
            }),
        );
```

- [ ] **Step 3: Run typecheck**

`npm run typecheck`
Expected: PASS — no references to the removed `workspaceAdapter` field remain in `DragReorderDeps` usage.

- [ ] **Step 4: Run the full test suite**

`npm test`
Expected: PASS (the stale disconnect-count assertion in `strip.test.ts` is fixed in Task 3 — if this task
is executed strictly before Task 3, expect exactly one failure there: `'tears down every window signal
when the window is removed'`, asserting `disconnects.frameGeometry` was called once when it is now called
twice, once per independent `onFrameGeometryChanged` subscriber. That failure is resolved by Task 3, not
this one.)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`windowCenterVirtualX` camelCase,
      `DragReorderDeps` PascalCase)
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, explicit imports, 120-char limit)
- [ ] Task-level verification commands from the plan executed and passing (`npm run typecheck`; `npm test`
      with the one known, Task-3-owned failure noted above, if Task 3 hasn't run yet)
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Remove dead cursor-anchor plumbing and fix the stale disconnect-count test

**Files:**
- Modify: `src/kwin/workspace-adapter.ts`
- Modify: `src/types/kwin.d.ts`
- Modify: `src/runtime/strip.test.ts`

No new tests: this task removes now-unused code and repairs an existing test's assertion to match the new,
correct behavior (two independent `onFrameGeometryChanged` subscribers per window instead of one).

- [ ] **Step 1: Remove `WorkspaceAdapter.cursorX()`**

In `src/kwin/workspace-adapter.ts`, remove:

```ts
    /** The mouse cursor's x position in real (screen) coordinates. */
    cursorX(): number {
        return Workspace.cursorPos.x;
    }

```

(the blank line immediately after it goes too, so `combinedGeometry()` is followed directly by
`currentActivity()`).

- [ ] **Step 2: Remove `QPoint` and `WorkspaceApi.cursorPos` from `src/types/kwin.d.ts`**

Remove the now-unused type:

```ts
interface QPoint {
    x: number;
    y: number;
}

```

And remove this field from `WorkspaceApi`:

```ts
    readonly cursorPos: QPoint;
```

- [ ] **Step 3: Fix the stale disconnect-count assertion in `src/runtime/strip.test.ts`**

Replace:

```ts
        expect(win.disconnects.frameGeometry).toHaveBeenCalledTimes(1);
        expect(win.disconnects.minimized).toHaveBeenCalledTimes(1);
```

With:

```ts
        // Two independent onFrameGeometryChanged subscribers: window-events.ts's resize/fullscreen
        // handling, and drag.ts's live drag-reorder preview.
        expect(win.disconnects.frameGeometry).toHaveBeenCalledTimes(2);
        expect(win.disconnects.minimized).toHaveBeenCalledTimes(1);
```

- [ ] **Step 4: Simplify `fakeWorkspaceAdapter()` in `src/runtime/strip.test.ts`**

Replace:

```ts
function fakeWorkspaceAdapter(): WorkspaceAdapter {
    return { cursorX: () => 0 } as unknown as WorkspaceAdapter;
}
```

With:

```ts
function fakeWorkspaceAdapter(): WorkspaceAdapter {
    return {} as unknown as WorkspaceAdapter;
}
```

- [ ] **Step 5: Run typecheck and the full test suite**

`npm run typecheck`
Expected: PASS

`npm test`
Expected: PASS (all tests green, including the fixed disconnect-count assertion)

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing (`npm run typecheck`; `npm test`)
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Update `docs/algorithms.md`

**Files:**
- Modify: `docs/algorithms.md`

- [ ] **Step 1: Replace the "Drag-Reorder Insertion Index" section**

Replace:

```md
## Drag-Reorder Insertion Index

Source: [`nearestInsertionIndex`](../src/core/coordinates.ts) in `coordinates.ts`, driven by [`registerDragReorder`](../src/input/drag.ts) in `drag.ts`.

While a window is being interactively moved, Drift does not touch the layout — the window moves freely under the cursor.
Only on `interactiveMoveResizeFinished` does `registerDragReorder` act: it converts the cursor's real screen x to a virtual x (`toVirtualX`), then asks `Grid.insertionIndexForX` for the closest valid insertion index among all *other* columns (the dragged column is excluded from the candidate list so it cannot "insert relative to itself").

`nearestInsertionIndex(offsets, widths, x)` builds the list of column boundaries — each column's left edge, plus one final boundary at the last column's right edge — and returns the index of the boundary closest to `x` by absolute distance.
That index is a valid `moveColumn` target: inserting at boundary `i` places the column immediately before the column currently at index `i` (or at the end, for the final boundary).
```

With:

```md
## Drag-Reorder Insertion Index

Source: [`nearestInsertionIndex`](../src/core/coordinates.ts) in `coordinates.ts`, driven by [`registerDragReorder`](../src/input/drag.ts) in `drag.ts`.

While a window is being interactively moved, Drift never writes its real geometry — it moves freely under the
cursor — but the *order* of the other columns updates live: on every `frameGeometryChanged` tick during the
drag, `registerDragReorder` converts the dragged window's own center (not the cursor) to a virtual x
(`toVirtualX`), then asks `Grid.insertionIndexForX` for the closest valid insertion index among all *other*
columns (the dragged column is excluded from the candidate list so it cannot "insert relative to itself").
If that index differs from the column's current position, it is committed immediately via `Grid.moveColumn`,
and displaced neighbors slide into their new positions through the normal per-column position animation
(see "Layout-Change Position Animation" below) rather than jumping.
Using the window's own center, rather than the cursor, means the vote reflects where the dragged window itself
sits, regardless of where within it the user grabbed to start the drag.

`nearestInsertionIndex(offsets, widths, x)` builds the list of column boundaries — each column's left edge, plus one final boundary at the last column's right edge — and returns the index of the boundary closest to `x` by absolute distance.
That index is a valid `moveColumn` target: inserting at boundary `i` places the column immediately before the column currently at index `i` (or at the end, for the final boundary).
A useful property falls out of this: for any candidate column of width `W` starting at offset `O`, the vote
flips exactly at its midpoint `O + W/2` — hovering its left half votes to insert before it, its right half
votes to insert after — regardless of that column's or its neighbors' widths.

On `interactiveMoveResizeFinished`, the same center-based computation runs once more, then the dragged column
itself is forced to snap instantly into its final slot (`Strip.snapColumn`) while its neighbors keep whatever
slide they were already mid-flight on.
```

- [ ] **Step 2: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md` (Markdown/docs conventions: one sentence per line
      per `AGENTS.md`'s "Writing Documentation" section — confirm the replacement text follows this)
- [ ] No stale references to cursor-based anchoring remain in `docs/algorithms.md`
- [ ] Any convention violations fixed before moving to next task

---

## Self-Review

**Spec coverage:** Task 1 covers `Strip.snapColumn`; Task 2 covers the anchor switch to window-center and the
live-preview commit-on-change loop plus release settling; Task 3 covers the `DragReorderDeps`/cleanup and test
fixes the spec's "API Changes Summary" calls for; Task 4 covers the spec's implicit requirement that
`docs/algorithms.md` (a living reference, unlike point-in-time specs) stays accurate. All spec sections are
covered.

**Placeholder scan:** No "TBD"/"placeholder" markers; every step shows complete, exact code.

**Type consistency:** `DragReorderDeps.render`'s signature (`(excludeWindowId?: string, instant?: boolean) =>
void`) matches `Strip.render`'s actual signature used at the Task 2 call site. `snapColumn(columnId: number)`
matches between the `Strip` method (Task 1) and the `DragReorderDeps` field (Task 2). Column id numbering
assumed in the Task 1 test (1/2/3/4, sequential from a fresh `Grid`) matches the same invariant already
exercised by `src/core/grid.test.ts`.
