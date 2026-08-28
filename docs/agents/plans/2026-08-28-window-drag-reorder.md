# Window Drag Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging a tiled window by any grab point reorders its column in the strip: on release, the column snaps into whichever slot border is closest to the mouse pointer.

**Architecture:** Two new pure, unit-tested functions (`nearestInsertionIndex` in `core/coordinates.ts`, `toVirtualX` in `kwin/geometry-sync.ts`) plus a `Grid.insertionIndexForX` wrapper do all the actual math. A new `src/input/drag.ts` module wires KWin's `interactiveMoveResizeStarted`/`Finished` signals per window and calls that math on release. `main.ts` wires it in per window, same place the existing `onFrameGeometryChanged` listener is wired.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-08-28-window-drag-reorder-design.md` — read before implementing

---

### Task 1: `nearestInsertionIndex` pure function

**Files:**
- Modify: `src/core/coordinates.ts`
- Test: `src/core/coordinates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/coordinates.test.ts`, alongside the existing `import` line (add `nearestInsertionIndex` to the import):

```typescript
import { columnOffsets, virtualWidth, columnRect, resizedEdge, rectsEqualRounded, nearestInsertionIndex } from './coordinates';
```

```typescript
describe('nearestInsertionIndex', () => {
    it('returns 0 when there are no other columns', () => {
        expect(nearestInsertionIndex([], [], 999)).toBe(0);
    });

    it('picks the only boundary before a single column', () => {
        // one other column at [0, 300): boundaries are [0, 300]
        expect(nearestInsertionIndex([0], [300], 50)).toBe(0);
    });

    it('picks the only boundary after a single column', () => {
        expect(nearestInsertionIndex([0], [300], 250)).toBe(1);
    });

    it('picks the closest of several boundaries', () => {
        // three columns: [0,300), [310,810), [820,1020) -> boundaries [0, 310, 820, 1020]
        const offsets = [0, 310, 820];
        const widths = [300, 500, 200];
        expect(nearestInsertionIndex(offsets, widths, 150)).toBe(0); // closer to 0 than 310
        expect(nearestInsertionIndex(offsets, widths, 200)).toBe(1); // closer to 310 than 0
        expect(nearestInsertionIndex(offsets, widths, 1000)).toBe(3); // closer to 1020 than 820
    });

    it('keeps the earlier index on an exact tie', () => {
        const offsets = [0, 310];
        const widths = [300, 200];
        // boundaries [0, 310, 510]; midpoint between 0 and 310 is 155, equidistant
        expect(nearestInsertionIndex(offsets, widths, 155)).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test`.
Expected: FAIL — `nearestInsertionIndex` is not exported yet.

- [ ] **Step 3: Implement `nearestInsertionIndex`**

Add to `src/core/coordinates.ts`, after the existing `rectsEqualRounded` function.
Note: this codebase's `no-restricted-syntax` ESLint rule bans spread syntax entirely (KWin's JS engine rejects it at parse time), so the boundaries array is built with `.slice()` + `.push()`, not `[...offsets, ...]`:

```typescript
/** Which insertion index among `offsets`/`widths` has a boundary closest to `x`.
 * Boundaries are each column's left edge plus the last column's right edge, so the
 * result is a valid `toIndex` for inserting a column into that same ordered list. */
export function nearestInsertionIndex(offsets: readonly number[], widths: readonly number[], x: number): number {
    if (offsets.length === 0) {
        return 0;
    }
    const lastIndex = offsets.length - 1;
    const boundaries = offsets.slice();
    boundaries.push(offsets[lastIndex] + widths[lastIndex]);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < boundaries.length; i++) {
        const distance = Math.abs(x - boundaries[i]);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }
    return bestIndex;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test`.
Expected: PASS — all `nearestInsertionIndex` tests green, existing `coordinates.test.ts` tests unaffected.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` function/parameter names, no `SpreadElement` usage (`npm run lint` must pass)
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS
- [ ] Run `npm test` — PASS

---

### Task 2: `Grid.insertionIndexForX`

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts`:

```typescript
describe('Grid — insertion index for a drag position', () => {
    it('returns 0 when the dragged column is the only column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.insertionIndexForX(a.id, 999)).toBe(0);
    });

    it('finds the closest boundary among the other columns', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const c = grid.addColumn(200);
        // with b excluded: a at [0,300), c at [310,510) -> boundaries [0, 310, 510]
        expect(grid.insertionIndexForX(b.id, 50)).toBe(0);
        expect(grid.insertionIndexForX(b.id, 200)).toBe(1); // b's original slot
        expect(grid.insertionIndexForX(b.id, 450)).toBe(2);
    });

    it('combines with moveColumn to reorder based on a drop position', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500); // b
        const c = grid.addColumn(200);
        const targetIndex = grid.insertionIndexForX(c.id, 50);
        grid.moveColumn(c.id, targetIndex);
        expect(grid.columns().map((col) => col.id)).toEqual([3, 1, 2]);
        expect(grid.columnRect(a.id).x).toBe(210); // a shifted right to make room for c
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test`.
Expected: FAIL — `insertionIndexForX` does not exist on `Grid`.

- [ ] **Step 3: Implement `Grid.insertionIndexForX`**

Modify `src/core/grid.ts`. Update the import line:

```typescript
import { columnOffsets, columnRect, virtualWidth, Rect, ResizeEdge, nearestInsertionIndex } from './coordinates';
```

Add this method to the `Grid` class, after `columnRect`:

```typescript
    /** Insertion index — a valid `moveColumn` target — closest to `virtualX`,
     * considering every column except `excludeId` (the one being dragged). */
    insertionIndexForX(excludeId: number, virtualX: number): number {
        const others = this.ordered.filter((column) => column.id !== excludeId);
        const widths = others.map((column) => column.width);
        const offsets = columnOffsets(widths, this.gap, this.originX);
        return nearestInsertionIndex(offsets, widths, virtualX);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test`.
Expected: PASS.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Method naming/visibility matches existing `Grid` style (`camelCase`, public API grouped with other geometry methods)
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS
- [ ] Run `npm test` — PASS

---

### Task 3: `toVirtualX` pure function

**Files:**
- Modify: `src/kwin/geometry-sync.ts`
- Test: `src/kwin/geometry-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/kwin/geometry-sync.test.ts`, updating the import line:

```typescript
import { toRealRect, toVirtualX } from './geometry-sync';
```

```typescript
describe('toVirtualX', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };

    it('is the inverse of toRealRect x mapping', () => {
        expect(toVirtualX(200, area, 800)).toBe(1000);
    });

    it('accounts for a non-zero area origin', () => {
        const shifted = { x: 1920, y: 0, width: 1920, height: 1080 };
        expect(toVirtualX(1920, shifted, 0)).toBe(0);
    });

    it('accounts for a zero viewport offset', () => {
        expect(toVirtualX(500, area, 0)).toBe(500);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run `npm test`.
Expected: FAIL — `toVirtualX` is not exported yet.

- [ ] **Step 3: Implement `toVirtualX`**

Add to `src/kwin/geometry-sync.ts`, directly after `toRealRect`:

```typescript
/** Maps a real screen x-coordinate (e.g. the cursor position) into virtual strip
 * coordinates — the inverse of `toRealRect`'s x mapping. */
export function toVirtualX(realX: number, area: Rect, viewportOffsetX: number): number {
    return realX - area.x + viewportOffsetX;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run `npm test`.
Expected: PASS.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Function sits next to `toRealRect`, same file, same export style
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS
- [ ] Run `npm test` — PASS

---

### Task 4: KWin type declarations for move signals and cursor position

**Files:**
- Modify: `src/types/kwin.d.ts`

No test — this file is ambient type declarations only, verified by `npm run typecheck` and by matching the already-confirmed KWin 6 API surface (`Window.move`, `interactiveMoveResizeStarted`/`Finished`, `Workspace.cursorPos`, all grepped from the installed Karousel bundle).

- [ ] **Step 1: Add a `QPoint` interface**

Modify `src/types/kwin.d.ts`. Add this new interface directly after the existing `QSize` interface:

```typescript
interface QPoint {
    x: number;
    y: number;
}
```

- [ ] **Step 2: Add the two move-lifecycle signals to `Window`**

In the same file, modify the `Window` interface — add two lines after the existing `readonly frameGeometryChanged: Signal<(oldGeometry: QRect) => void>;` line:

```typescript
    readonly frameGeometryChanged: Signal<(oldGeometry: QRect) => void>;
    readonly interactiveMoveResizeStarted: Signal<() => void>;
    readonly interactiveMoveResizeFinished: Signal<() => void>;
}
```

- [ ] **Step 3: Add `cursorPos` to `WorkspaceApi`**

In the same file, modify the `WorkspaceApi` interface — add one line after `readonly virtualScreenGeometry: QRect;`:

```typescript
    readonly virtualScreenGeometry: QRect;
    readonly cursorPos: QPoint;
```

- [ ] **Step 4: Run typecheck**

Run `npm run typecheck`.
Expected: PASS — pure ambient-declaration additions, nothing yet consumes them.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] New interfaces/fields follow existing naming and placement conventions in this file
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS

---

### Task 5: `WindowAdapter` move-lifecycle wrapper

**Files:**
- Modify: `src/kwin/window-adapter.ts`

No test — untestable without a live compositor (docs §8), same as the rest of this file.

- [ ] **Step 1: Add the three new methods**

Modify `src/kwin/window-adapter.ts`. Add these methods to the `WindowAdapter` class, directly after `isInteractiveResize()`:

```typescript
    isInteractiveResize(): boolean {
        return this.window.resize;
    }

    isInteractiveMove(): boolean {
        return this.window.move;
    }

    onInteractiveMoveResizeStarted(handler: () => void): () => void {
        this.window.interactiveMoveResizeStarted.connect(handler);
        return () => this.window.interactiveMoveResizeStarted.disconnect(handler);
    }

    onInteractiveMoveResizeFinished(handler: () => void): () => void {
        this.window.interactiveMoveResizeFinished.connect(handler);
        return () => this.window.interactiveMoveResizeFinished.disconnect(handler);
    }
```

- [ ] **Step 2: Run typecheck**

Run `npm run typecheck`.
Expected: PASS.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] New methods follow the existing connect/disconnect wrapper shape used by `onFrameGeometryChanged`
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS

---

### Task 6: `WorkspaceAdapter.cursorX`

**Files:**
- Modify: `src/kwin/workspace-adapter.ts`

No test — untestable without a live compositor (docs §8), same as the rest of this file.

- [ ] **Step 1: Add the method**

Modify `src/kwin/workspace-adapter.ts`. Add this method to the `WorkspaceAdapter` class, directly after `combinedGeometry()`:

```typescript
    /** The full combined area across all outputs, bezels ignored (docs §4, §7.2). */
    combinedGeometry(): Rect {
        return toRect(Workspace.virtualScreenGeometry);
    }

    /** The mouse cursor's x position in real (screen) coordinates. */
    cursorX(): number {
        return Workspace.cursorPos.x;
    }
```

- [ ] **Step 2: Run typecheck**

Run `npm run typecheck`.
Expected: PASS.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Method naming/doc-comment style matches the rest of `WorkspaceAdapter`
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS

---

### Task 7: `input/drag.ts` — the drag-to-reorder wiring module

**Files:**
- Create: `src/input/drag.ts`

No test — this module only wires KWin signals to `Grid`/`Viewport` calls; untestable without a live compositor (docs §8), same as `input/shortcuts.ts`.

- [ ] **Step 1: Create the file**

Create `src/input/drag.ts`:

```typescript
// Turns a window's interactive-move lifecycle into a column reorder on release
// (docs §2.1.7). The window moves freely under the cursor while dragging — Drift
// only acts once the drag ends, snapping the column into the nearest slot.

import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { Viewport } from '../viewport/viewport';

export interface DragReorderDeps {
    grid: Grid;
    viewport: Viewport;
    workspaceAdapter: WorkspaceAdapter;
    area: Rect;
    render(): void;
}

/** Wires `win`'s move lifecycle to reorder `columnId` in `deps.grid` on release.
 * Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, columnId: number, deps: DragReorderDeps): () => void {
    let dragging = false;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        const virtualX = toVirtualX(deps.workspaceAdapter.cursorX(), deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForX(columnId, virtualX);
        deps.grid.moveColumn(columnId, targetIndex);
        deps.render();
    });

    return () => {
        disconnectStarted();
        disconnectFinished();
    };
}
```

- [ ] **Step 2: Run typecheck**

Run `npm run typecheck`.
Expected: PASS.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] File follows `input/shortcuts.ts`'s style: a dependency interface plus one exported `register*` function
- [ ] Kebab-case filename, `camelCase` exports, no default export
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS

---

### Task 8: Wire `registerDragReorder` into `main.ts`

**Files:**
- Modify: `src/main.ts`

No test — integration wiring, untestable without a live compositor (docs §8), same as the rest of `main.ts`.

- [ ] **Step 1: Import the new module**

Modify `src/main.ts`. The existing imports are ordered alphabetically by path; insert the new one between `./core/grid` and `./input/shortcuts`:

```typescript
import { loadSettings } from './config/settings';
import { rectsEqualRounded, resizedEdge, Rect } from './core/coordinates';
import { Grid } from './core/grid';
import { registerDragReorder } from './input/drag';
import { registerShortcuts } from './input/shortcuts';
import { GeometrySync } from './kwin/geometry-sync';
```

- [ ] **Step 2: Combine the geometry-change and drag disconnects**

Modify the `workspaceAdapter.onWindowAdded` handler in `src/main.ts`. Replace:

```typescript
    workspaceAdapter.onWindowAdded((win) => {
        if (!win.isTileable()) {
            return;
        }
        const width = Math.round(win.frameGeometry().width) || settings.defaultColumnWidth;
        const column = grid.addColumn(width);
        windowsByColumn.set(column.id, win);
        disconnectByColumn.set(
            column.id,
            win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal)),
        );
        render();
        revealFocused();
    });
```

with:

```typescript
    workspaceAdapter.onWindowAdded((win) => {
        if (!win.isTileable()) {
            return;
        }
        const width = Math.round(win.frameGeometry().width) || settings.defaultColumnWidth;
        const column = grid.addColumn(width);
        windowsByColumn.set(column.id, win);
        const disconnectGeometry = win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal));
        const disconnectDrag = registerDragReorder(win, column.id, {
            grid,
            viewport,
            workspaceAdapter,
            area,
            render,
        });
        disconnectByColumn.set(column.id, () => {
            disconnectGeometry();
            disconnectDrag();
        });
        render();
        revealFocused();
    });
```

- [ ] **Step 3: Run typecheck**

Run `npm run typecheck`.
Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run `npm test`.
Expected: PASS — no existing test touches `main.ts`, this confirms nothing else broke.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Import grouping/order matches existing style in `main.ts`
- [ ] Run `npm run typecheck` — PASS
- [ ] Run `npm run lint` — PASS
- [ ] Run `npm test` — PASS

---

### Task 9: Full verification pass and packaging

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated check suite**

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all four PASS with zero errors/warnings.

- [ ] **Step 2: Reinstall the package**

```bash
npm run package:install
```

Expected: exits 0 (installs or upgrades the KWin script package).

- [ ] **Step 3: Note the manual verification requirement**

Per `docs/requirements-and-architecture.md` §6.2 and repo memory: a `declarativescript` KWin package only reliably (re)instantiates on a fresh login. Live behavior (dragging a real window by its titlebar and confirming it snaps into the nearest column border on release) can only be confirmed after a log out/log in cycle — do not trust live-reload feedback. Tell the user this task is code-complete and ask them to verify live after their next login, following the same journal-watching approach already established (`journalctl --user -f QT_CATEGORY=kwin_scripting QT_CATEGORY=js | grep -i drift`) if anything looks wrong.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `npm run typecheck` — PASS
- [ ] `npm test` — PASS
- [ ] `npm run lint` — PASS
- [ ] `npm run build` — PASS
- [ ] `npm run package:install` — exits 0
