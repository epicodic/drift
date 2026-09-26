# Drag-to-Stack Phantom Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the zero-threshold live edge-expel with a previewed phantom standalone column, resolve the vertical stack slot from the pointer instead of the dragged window's top edge, and key the stack dwell on the target column so slot changes preview live.

**Architecture:** `Grid` gains a pure `previewLayout(phantom?)` that lays columns out with an optional phantom column inserted, and the insertion-index math is extracted so it runs on that layout too. A new pure `core/drag-preview.ts` defines `DragPreview` and `previewTileRects`, the single definition of "which tile rects are on screen" shared by `Strip.render` and hover resolution. `drag-hover.ts` keeps small pure helpers (overlap, pointer slot, initial phantom index); `drag.ts` becomes a three-mode glue (standalone / home / phantom) that never commits a stack tile before release. `Strip.commitTileToStandalone` commits the phantom via a generalized `Grid.expelTile`.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-18-drag-stack-phantom-design.md` — read before implementing

**Verification commands:** `make test` (vitest), `make lint` (eslint, tsc, qmllint). Both must pass at the end of every task.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `drift/src/core/grid.ts` | Column order and horizontal layout | Add `previewLayout`, `expelTile`, exported `insertionIndexForSlots`/`visibleNeighborSlot`; refactor private layout helpers onto them; remove `expelDirectionForEdges` (Task 8) |
| `drift/src/core/drag-preview.ts` | `DragPreview` shape and `previewTileRects` | Create |
| `drift/src/input/drag-hover.ts` | Pure hover geometry | Replace top-edge banding with pointer slot; add `initialPhantomIndex`; export `horizontalOverlapFraction` |
| `drift/src/input/drag.ts` | KWin drag lifecycle glue | Rewrite the post-pan tick as standalone/home/phantom modes; commit phantom on release |
| `drift/src/runtime/strip.ts` | Strip render and commits | `render` takes `DragPreview` and uses `previewLayout`; add `commitTileToStandalone`; drop `StackPreview` |
| `drift/src/config/settings-definitions.ts`, `drift/ui/config.ui`, `drift/src/config/settings.test.ts` | Settings | `columnDragDwellMs` default 400 → 200 |
| `docs/algorithms.md`, `docs/features.md`, `docs/known_bugs.md`, spec | Docs | Rewrite drag-to-stack sections, close known bug 1 |

Tests: `drift/src/core/grid.test.ts`, `drift/src/input/drag-hover.test.ts`, `drift/src/runtime/strip.test.ts`, `drift/src/config/settings.test.ts`.

---

## Task 1: `Grid.previewLayout` and the extracted insertion-index math

**Files:**
- Modify: `drift/src/core/grid.ts` (class `Grid`: `columnRect`, `virtualWidth`, `insertionIndexForEdges`, `visibleNeighborColumnIds`, `layoutOffsets`, `layoutWidths`, `thresholdAt`, `visibleNeighborIndex`)
- Test: `drift/src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `drift/src/core/grid.test.ts`:

```ts
import { insertionIndexForSlots, visibleNeighborSlot } from './grid';

describe('Grid — previewLayout', () => {
    it('matches columnRect and virtualWidth when no phantom is given', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        const layout = grid.previewLayout();
        expect(layout.slots.map((slot) => slot.columnId)).toEqual([a.id, b.id]);
        expect(layout.rects.get(a.id)).toEqual(grid.columnRect(a.id));
        expect(layout.rects.get(b.id)).toEqual(grid.columnRect(b.id));
        expect(layout.virtualWidth).toBe(grid.virtualWidth());
    });

    it('inserts a phantom slot at the given index and shifts every later column by its width plus the gap', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // [0,300)
        const b = grid.addColumn(500); // [310,810) without a phantom
        const layout = grid.previewLayout({ index: 1, width: 200 });
        expect(layout.slots.map((slot) => slot.columnId)).toEqual([a.id, null, b.id]);
        expect(layout.slots[1]).toEqual({ columnId: null, offset: 310, width: 200, hidden: false });
        expect(layout.rects.get(a.id)?.x).toBe(0);
        expect(layout.rects.get(b.id)?.x).toBe(520); // 310 + 200 + GAP
        expect(layout.virtualWidth).toBe(1020); // 520 + 500
    });

    it('places a phantom at index 0 before every column, and at the end after every column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const front = grid.previewLayout({ index: 0, width: 200 });
        expect(front.slots[0].columnId).toBeNull();
        expect(front.rects.get(a.id)?.x).toBe(210);
        const back = grid.previewLayout({ index: 1, width: 200 });
        expect(back.slots[1]).toEqual({ columnId: null, offset: 310, width: 200, hidden: false });
        expect(back.virtualWidth).toBe(510);
    });

    it('lays hidden columns out exactly as layoutOffsets does, with the phantom after them', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // [0,300)
        const b = grid.addColumn(400); // hidden: 1px wide, no gap after
        const c = grid.addColumn(200);
        grid.hideColumn(b.id);
        // a: 0, then +300 +GAP = 310 -> b (hidden, width 1, no gap) -> 311 -> c, then +200 +GAP
        const layout = grid.previewLayout({ index: 3, width: 100 });
        expect(layout.slots.map((slot) => slot.offset)).toEqual([0, 310, 311, 521]);
        expect(layout.slots[1].hidden).toBe(true);
        expect(layout.rects.get(b.id)?.width).toBe(400); // rect keeps the real width, as columnRect does
        expect(layout.rects.get(c.id)?.x).toBe(311);
    });
});

describe('insertionIndexForSlots', () => {
    const slots = [
        { columnId: 1, offset: 0, width: 300, hidden: false },
        { columnId: null, offset: 310, width: 200, hidden: false }, // the phantom, dragged
        { columnId: 2, offset: 520, width: 500, hidden: false },
    ];

    it('stays put while neither edge penetrates a neighbor past the threshold', () => {
        expect(insertionIndexForSlots(slots, 1, 320, 520, 0.85)).toBe(1);
    });

    it("moves right once the right edge passes the right neighbor's threshold", () => {
        // right neighbor threshold: 520 + 500 * 0.85 = 945
        expect(insertionIndexForSlots(slots, 1, 745, 945, 0.85)).toBe(1);
        expect(insertionIndexForSlots(slots, 1, 746, 946, 0.85)).toBe(2);
    });

    it("moves left once the left edge passes the left neighbor's threshold", () => {
        // left neighbor threshold: 0 + 300 * (1 - 0.85) = 45
        expect(insertionIndexForSlots(slots, 1, 45, 245, 0.85)).toBe(1);
        expect(insertionIndexForSlots(slots, 1, 44, 244, 0.85)).toBe(0);
    });

    it('skips hidden slots when looking for a neighbor', () => {
        const withHidden = [
            { columnId: 1, offset: 0, width: 300, hidden: false },
            { columnId: 9, offset: 310, width: 1, hidden: true },
            { columnId: null, offset: 311, width: 200, hidden: false },
        ];
        expect(visibleNeighborSlot(withHidden, 2, -1)).toBe(0);
        expect(visibleNeighborSlot(withHidden, 2, 1)).toBeNull();
        expect(insertionIndexForSlots(withHidden, 2, 44, 244, 0.85)).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`make test`
Expected: FAIL — `previewLayout`, `insertionIndexForSlots`, `visibleNeighborSlot` do not exist.

- [ ] **Step 3: Implement**

In `drift/src/core/grid.ts`, add after the `GridDebugState` interface:

```ts
/** A column-sized hole in the layout standing in for a dragged stack tile: previewed as if the
 * tile were already a standalone column at `index`, so the columns after it slide over to make
 * room (docs: 2026-09-18-drag-stack-phantom-design). */
export interface PhantomColumn {
    index: number;
    width: number;
}

/** One position in a laid-out column order — a real column (`columnId`) or the phantom (`null`).
 * `width` is the layout width (hidden columns take `HIDDEN_COLUMN_WIDTH`), matching what
 * `insertionIndexForSlots` thresholds against. */
export interface LayoutSlot {
    columnId: number | null;
    offset: number;
    width: number;
    hidden: boolean;
}

/** The horizontal layout `Strip.render` shows: every slot in order, each real column's rect (at
 * its real width, like `columnRect`), and the resulting virtual width. */
export interface PreviewLayout {
    slots: LayoutSlot[];
    rects: Map<number, Rect>;
    virtualWidth: number;
}

/** Index of the nearest non-hidden slot from `index` in direction `step`, or null at the edge. */
export function visibleNeighborSlot(slots: readonly LayoutSlot[], index: number, step: 1 | -1): number | null {
    for (let i = index + step; i >= 0 && i < slots.length; i += step) {
        if (!slots[i].hidden) {
            return i;
        }
    }
    return null;
}

/** Where the slot at `index` should move given the dragged window's own edges: the right
 * neighbor's index once `rightEdgeVirtualX` penetrates `thresholdFraction` of that neighbor's
 * width, the left neighbor's index symmetrically, else `index` itself. Pure over a slot list so
 * it serves both a real column (`Grid.insertionIndexForEdges`) and a phantom in a preview layout
 * (docs: 2026-09-07-drag-reorder-stack-refinement-design, 2026-09-18-drag-stack-phantom-design). */
export function insertionIndexForSlots(
    slots: readonly LayoutSlot[],
    index: number,
    leftEdgeVirtualX: number,
    rightEdgeVirtualX: number,
    thresholdFraction: number,
): number {
    const rightIndex = visibleNeighborSlot(slots, index, 1);
    if (rightIndex !== null && rightEdgeVirtualX > slots[rightIndex].offset + slots[rightIndex].width * thresholdFraction) {
        return rightIndex;
    }
    const leftIndex = visibleNeighborSlot(slots, index, -1);
    // `offset + width - width * f`, not `offset + width * (1 - f)`: `1 - 0.85` is inexact in
    // IEEE 754, so 300 * (1 - 0.85) is 45.00000000000001 and misfires on an exact-integer edge.
    if (
        leftIndex !== null &&
        leftEdgeVirtualX < slots[leftIndex].offset + slots[leftIndex].width - slots[leftIndex].width * thresholdFraction
    ) {
        return leftIndex;
    }
    return index;
}
```

Replace `columnRect`, `virtualWidth`, `insertionIndexForEdges`, `visibleNeighborColumnIds` and the private `layoutOffsets`, `layoutWidths`, `thresholdAt`, `visibleNeighborIndex` with:

```ts
    virtualWidth(): number {
        return this.previewLayout().virtualWidth;
    }

    columnRect(id: number): Rect {
        const rect = this.previewLayout().rects.get(id);
        if (rect === undefined) {
            throw new Error(`Unknown column id: ${id}`);
        }
        return rect;
    }

    /** Lays every column out in order, with `phantom` inserted at `phantom.index` when given —
     * the columns at or after that index shift right by `phantom.width + gap`. Pure: the grid
     * itself is untouched. Every other layout query on this class is derived from it. */
    previewLayout(phantom?: PhantomColumn): PreviewLayout {
        const entries: { columnId: number | null; width: number; hidden: boolean }[] = this.ordered.map((column) => ({
            columnId: column.id,
            width: column.hidden ? HIDDEN_COLUMN_WIDTH : column.width,
            hidden: column.hidden,
        }));
        if (phantom !== undefined) {
            entries.splice(phantom.index, 0, { columnId: null, width: phantom.width, hidden: false });
        }
        const slots: LayoutSlot[] = [];
        const rects = new Map<number, Rect>();
        let cursor = this.originX;
        entries.forEach((entry, index) => {
            slots.push({ columnId: entry.columnId, offset: cursor, width: entry.width, hidden: entry.hidden });
            if (entry.columnId !== null) {
                rects.set(entry.columnId, columnRect(cursor, this.requireColumn(entry.columnId).width, this.height));
            }
            cursor += entry.width;
            if (!entry.hidden && index < entries.length - 1) {
                cursor += this.gap;
            }
        });
        const last = slots[slots.length - 1];
        return { slots, rects, virtualWidth: last === undefined ? 0 : last.offset + last.width - this.originX };
    }

    insertionIndexForEdges(
        excludeId: number,
        leftEdgeVirtualX: number,
        rightEdgeVirtualX: number,
        thresholdFraction: number,
    ): number {
        return insertionIndexForSlots(
            this.previewLayout().slots,
            this.requireIndex(excludeId),
            leftEdgeVirtualX,
            rightEdgeVirtualX,
            thresholdFraction,
        );
    }

    visibleNeighborColumnIds(columnId: number): number[] {
        const slots = this.previewLayout().slots;
        const index = this.requireIndex(columnId);
        const ids: number[] = [];
        for (const step of [-1, 1] as const) {
            const neighbor = visibleNeighborSlot(slots, index, step);
            const id = neighbor === null ? null : slots[neighbor].columnId;
            if (id !== null) {
                ids.push(id);
            }
        }
        return ids;
    }
```

Keep `expelDirectionForEdges` compiling until Task 8 by rewriting its body on the new helpers:

```ts
    expelDirectionForEdges(
        columnId: number,
        leftEdgeVirtualX: number,
        rightEdgeVirtualX: number,
    ): 'left' | 'right' | null {
        const slots = this.previewLayout().slots;
        const index = this.requireIndex(columnId);
        if (visibleNeighborSlot(slots, index, 1) === null && rightEdgeVirtualX > slots[index].offset + slots[index].width) {
            return 'right';
        }
        if (visibleNeighborSlot(slots, index, -1) === null && leftEdgeVirtualX < slots[index].offset) {
            return 'left';
        }
        return null;
    }
```

Check the file for any remaining callers of the deleted private helpers (`layoutOffsets`, `layoutWidths`, `thresholdAt`, `visibleNeighborIndex`) — `nearestVisibleFrom`, `contentLeft`, `resizeColumn`, and `debugState` may use them; port each to `this.previewLayout().slots` (offset/width per index) the same way. Existing behavior must not change: the `left`-neighbor order in `visibleNeighborColumnIds` stays `[left, right]`.

- [ ] **Step 4: Run the tests to verify they pass**

`make test`
Expected: PASS, including every pre-existing `Grid —` suite unchanged.

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming: `PascalCase` interfaces, `camelCase` functions, 4-space indent, ≤ 120 chars
- [ ] `make lint` passes
- [ ] No convention violations left

---

## Task 2: `Grid.expelTile`

**Files:**
- Modify: `drift/src/core/grid.ts` (`expelFocusedTile`)
- Test: `drift/src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('Grid — expelTile', () => {
    it('removes the given (non-focused) tile and gives it a new focused column to the right', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(300);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        column.setFocusedTile(topId);
        grid.setFocus(column.id);

        const result = grid.expelTile(column.id, bottomId, 250);

        expect(result).not.toBeNull();
        expect(column.tiles().map((t) => t.id)).toEqual([topId]);
        expect(grid.columns().map((c) => c.id)).toEqual([column.id, result!.toColumnId]);
        expect(grid.focusedColumn()?.id).toBe(result!.toColumnId);
        expect(grid.column(result!.toColumnId)?.width).toBe(250);
        expect(grid.column(result!.toColumnId)?.tiles()[0].id).toBe(result!.toTileId);
    });

    it('returns null (no-op) when the column only has one tile', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(300);
        expect(grid.expelTile(column.id, column.tiles()[0].id, 250)).toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([column.id]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`make test`
Expected: FAIL — `expelTile` does not exist.

- [ ] **Step 3: Implement**

Replace `expelFocusedTile` in `grid.ts`:

```ts
    /** Moves `tileId` out of `columnId` into a brand-new standalone column of `newColumnWidth`,
     * inserted after the focused column and focused (see `addColumn`). Returns null (no-op) for a
     * single-tile column. The caller positions the new column with `moveColumn` if it belongs
     * somewhere else (docs: 2026-09-18-drag-stack-phantom-design). */
    expelTile(columnId: number, tileId: number, newColumnWidth: number): { toColumnId: number; toTileId: number } | null {
        const column = this.requireColumn(columnId);
        if (column.tileCount() <= 1) {
            return null;
        }
        column.removeTile(tileId);
        const newColumn = this.addColumn(newColumnWidth);
        return { toColumnId: newColumn.id, toTileId: newColumn.tiles()[0].id };
    }

    expelFocusedTile(
        columnId: number,
        newColumnWidth: number,
    ): { fromTileId: number; toColumnId: number; toTileId: number } | null {
        const fromTileId = this.requireColumn(columnId).focusedTileId;
        const result = this.expelTile(columnId, fromTileId, newColumnWidth);
        return result === null ? null : { fromTileId, toColumnId: result.toColumnId, toTileId: result.toTileId };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`make test`
Expected: PASS, including the existing `Grid — expelFocusedTile` suite.

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming and formatting match
- [ ] `make lint` passes
- [ ] No convention violations left

---

## Task 3: `DragPreview` and `previewTileRects`

**Files:**
- Create: `drift/src/core/drag-preview.ts`
- Test: `drift/src/core/drag-preview.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { Column } from './column';
import type { Rect } from './coordinates';
import { previewTileRects } from './drag-preview';

const COLUMN_RECT: Rect = { x: 0, y: 0, width: 300, height: 1000 };

function twoTileColumn(): { column: Column; topId: number; bottomId: number } {
    const column = new Column(1, 300, 1000, 0);
    const topId = column.tiles()[0].id;
    const bottomId = column.addTile();
    return { column, topId, bottomId };
}

describe('previewTileRects', () => {
    it('returns the committed tile rects when there is no preview', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, undefined);
        expect(rects.get(topId)).toEqual(column.tileRect(topId, COLUMN_RECT));
        expect(rects.get(bottomId)).toEqual(column.tileRect(bottomId, COLUMN_RECT));
    });

    it('returns the committed rects when the preview names other columns', () => {
        const { column, topId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, {
            leaving: { columnId: 99, tileId: 1 },
            entering: { columnId: 98, index: 0, gapHeight: 100 },
        });
        expect(rects.get(topId)).toEqual(column.tileRect(topId, COLUMN_RECT));
    });

    it('opens a gap when the preview enters this column', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, {
            entering: { columnId: 1, index: 0, gapHeight: 200 },
        });
        expect(rects).toEqual(column.previewRectsWithGapAt(0, 200, COLUMN_RECT, undefined));
        expect(rects.get(topId)?.y).toBe(200);
        expect(rects.get(bottomId)?.y).toBe(700);
    });

    it('closes up around the leaving tile when the preview leaves this column', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, { leaving: { columnId: 1, tileId: topId } });
        expect(rects.has(topId)).toBe(false);
        expect(rects.get(bottomId)?.y).toBe(0);
    });

    it('prefers entering over leaving for the same column (same-column reorder)', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, {
            leaving: { columnId: 1, tileId: bottomId },
            entering: { columnId: 1, index: 1, gapHeight: 200, excludeTileId: bottomId },
        });
        expect(rects.has(bottomId)).toBe(false);
        // The gap is the trailing slot, so previewRectsWithGapAt shrinks the last remaining tile
        // by the gap height: 500 - 200.
        expect(rects.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    });
});
```

Check `Column`'s constructor signature in `column.ts` before writing the helper; the `Grid` constructor calls `new Column(id, width, height, rowGap)`.

- [ ] **Step 2: Run the tests to verify they fail**

`make test`
Expected: FAIL — module `./drag-preview` not found.

- [ ] **Step 3: Implement**

```ts
// What a live drag is currently previewing, and the tile rects that preview puts on screen.
// Shared by Strip.render (to draw it) and drag.ts (to resolve the next hover against exactly
// what is drawn), so the two can never disagree about where a tile is
// (docs: 2026-09-18-drag-stack-phantom-design).

import type { Column } from './column';
import type { Rect } from './coordinates';
import type { PhantomColumn } from './grid';

export interface DragPreview {
    /** The dragged stack tile previewed as its own standalone column — see `Grid.previewLayout`. */
    phantom?: PhantomColumn;
    /** The column the dragged tile is leaving; its remaining tiles close up around the hole. */
    leaving?: { columnId: number; tileId: number };
    /** The column opening a gap of `gapHeight` at tile-list `index` for the dragged tile.
     * `excludeTileId` is set for a same-column reorder, where the dragged tile is also removed
     * from that column's list before the gap is placed. */
    entering?: { columnId: number; index: number; gapHeight: number; excludeTileId?: number };
}

/** The tile rects `Strip.render` shows for `column` under `preview`: the entering gap layout if
 * the preview enters this column, the closed-up layout if it leaves it, else the committed
 * rects. A tile absent from the result (the dragged one, in either preview branch) is drawn
 * nowhere — its real window follows the pointer. */
export function previewTileRects(column: Column, columnRect: Rect, preview: DragPreview | undefined): Map<number, Rect> {
    if (preview?.entering !== undefined && preview.entering.columnId === column.id) {
        const entering = preview.entering;
        return column.previewRectsWithGapAt(entering.index, entering.gapHeight, columnRect, entering.excludeTileId);
    }
    if (preview?.leaving !== undefined && preview.leaving.columnId === column.id) {
        return column.previewRectsWithoutTile(preview.leaving.tileId, columnRect);
    }
    const rects = new Map<number, Rect>();
    for (const tile of column.tiles()) {
        rects.set(tile.id, column.tileRect(tile.id, columnRect));
    }
    return rects;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`make test`
Expected: PASS.

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming and formatting match
- [ ] `make lint` passes
- [ ] No convention violations left

---

## Task 4: Pointer slot and phantom helpers in `drag-hover.ts`

**Files:**
- Modify: `drift/src/input/drag-hover.ts` (whole file)
- Test: `drift/src/input/drag-hover.test.ts` (whole file)

- [ ] **Step 1: Replace the test file**

```ts
import { describe, expect, it } from 'vitest';
import { Rect } from '../core/coordinates';
import {
    horizontalOverlapFraction,
    initialPhantomIndex,
    resolveSlotFromPointer,
    resolveStackTarget,
    stackTargetIndex,
    StackCandidate,
} from './drag-hover';

function rect(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
}

describe('horizontalOverlapFraction', () => {
    it('is 0 without overlap', () => {
        expect(horizontalOverlapFraction(rect(0, 0, 300, 100), rect(300, 0, 300, 100))).toBe(0);
    });

    it('divides by the narrower width so a narrow window fully inside a wide one is 1', () => {
        expect(horizontalOverlapFraction(rect(100, 0, 50, 100), rect(0, 0, 300, 100))).toBe(1);
        expect(horizontalOverlapFraction(rect(0, 0, 300, 100), rect(100, 0, 50, 100))).toBe(1);
    });

    it('is the overlapped fraction for equal widths', () => {
        expect(horizontalOverlapFraction(rect(150, 0, 300, 100), rect(0, 0, 300, 100))).toBe(0.5);
    });
});

describe('resolveSlotFromPointer', () => {
    const tiles: StackCandidate[] = [
        { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 400) },
        { columnId: 1, tileId: 20, rect: rect(0, 400, 300, 600) },
    ];

    it('returns null for an empty tile list', () => {
        expect(resolveSlotFromPointer(100, [])).toBeNull();
    });

    it("resolves 'above' in the upper half of the tile under the pointer", () => {
        expect(resolveSlotFromPointer(199, tiles)).toEqual({ tileId: 10, direction: 'above' });
        expect(resolveSlotFromPointer(600, tiles)).toEqual({ tileId: 20, direction: 'above' });
    });

    it("resolves 'below' from the midline down", () => {
        expect(resolveSlotFromPointer(200, tiles)).toEqual({ tileId: 10, direction: 'below' });
        expect(resolveSlotFromPointer(399, tiles)).toEqual({ tileId: 10, direction: 'below' });
        expect(resolveSlotFromPointer(950, tiles)).toEqual({ tileId: 20, direction: 'below' });
    });

    it('clamps a pointer above the first tile to above it, and below the last tile to below it', () => {
        expect(resolveSlotFromPointer(-50, tiles)).toEqual({ tileId: 10, direction: 'above' });
        expect(resolveSlotFromPointer(5000, tiles)).toEqual({ tileId: 20, direction: 'below' });
    });

    it('treats a pointer in the gap between two tiles as above the lower one', () => {
        const gapped: StackCandidate[] = [
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 400) },
            { columnId: 1, tileId: 20, rect: rect(0, 500, 300, 400) },
        ];
        expect(resolveSlotFromPointer(450, gapped)).toEqual({ tileId: 20, direction: 'above' });
    });
});

describe('resolveStackTarget', () => {
    it('returns null without candidates', () => {
        expect(resolveStackTarget(rect(0, 0, 300, 200), 100, [], 0.5)).toBeNull();
    });

    it('returns null when no column clears the overlap gate', () => {
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(300, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 0, 299, 200), 100, candidates, 0.5)).toBeNull();
    });

    it('picks the column with the most overlap and the slot from the pointer', () => {
        const candidates: StackCandidate[] = [
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) },
            { columnId: 2, tileId: 20, rect: rect(310, 0, 300, 500) },
            { columnId: 2, tileId: 21, rect: rect(310, 500, 300, 500) },
        ];
        // dragged [200,500): 100px over column 1, 190px over column 2
        expect(resolveStackTarget(rect(200, 0, 300, 200), 900, candidates, 0.5)).toEqual({
            columnId: 2,
            tileId: 21,
            direction: 'below',
        });
    });

    it("ignores the dragged window's own height and top edge entirely", () => {
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        const tall = resolveStackTarget(rect(0, 900, 300, 5000), 100, candidates, 0.5);
        const short = resolveStackTarget(rect(0, 0, 300, 10), 100, candidates, 0.5);
        expect(tall).toEqual(short);
        expect(tall?.direction).toBe('above');
    });
});

describe('initialPhantomIndex', () => {
    const home = rect(1000, 0, 400, 1000); // center 1200

    it("takes the home index when the dragged center is left of the home column's center", () => {
        expect(initialPhantomIndex(rect(700, 0, 400, 1000), home, 3)).toBe(3); // center 900
    });

    it('takes the next index when the dragged center is at or right of it', () => {
        expect(initialPhantomIndex(rect(1000, 0, 400, 1000), home, 3)).toBe(4); // center 1200
        expect(initialPhantomIndex(rect(1300, 0, 400, 1000), home, 3)).toBe(4);
    });
});

describe('stackTargetIndex', () => {
    const tiles = [{ id: 10 }, { id: 20 }, { id: 30 }];

    it("maps 'above' to the tile's own index", () => {
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'above' }, tiles)).toBe(1);
    });

    it("maps 'below' to the index after the tile", () => {
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'below' }, tiles)).toBe(2);
        expect(stackTargetIndex({ columnId: 1, tileId: 30, direction: 'below' }, tiles)).toBe(3);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`make test`
Expected: FAIL — new exports missing, `resolveStackTarget` has the old signature.

- [ ] **Step 3: Replace `drift/src/input/drag-hover.ts`**

```ts
// Pure geometry for drag-to-stack: which column a drag is aimed at (from the dragged window's
// own horizontal overlap), which slot inside it (from the pointer's y against the tile rects
// currently on screen), and where a stack tile's phantom column first appears. No KWin and no
// Grid dependency: everything takes already-resolved rects, so it's directly unit-testable
// (docs: 2026-09-18-drag-stack-phantom-design).

import { Rect } from '../core/coordinates';

export type StackDirection = 'above' | 'below';

/** One tile a drag could land next to: its column, its id, and the rect it is currently drawn
 * at (see `previewTileRects`). The dragged tile itself is never a candidate. */
export interface StackCandidate {
    columnId: number;
    tileId: number;
    rect: Rect;
}

export interface StackTarget {
    columnId: number;
    tileId: number;
    direction: StackDirection;
}

/** Horizontal overlap as a fraction of the NARROWER of the two widths — so a dragged window
 * narrower than the other rect can still reach 1 when fully inside it. */
export function horizontalOverlapFraction(a: Rect, b: Rect): number {
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (overlap <= 0) {
        return 0;
    }
    return overlap / Math.min(a.width, b.width);
}

/** The slot the pointer's y points at within one column's tiles (ordered top to bottom): the
 * first tile whose bottom edge is below the pointer, clamped to the last tile; `above` in its
 * upper half, `below` from its midline down. Never a dead zone. */
export function resolveSlotFromPointer(
    pointerY: number,
    tiles: readonly StackCandidate[],
): { tileId: number; direction: StackDirection } | null {
    if (tiles.length === 0) {
        return null;
    }
    const tile = tiles.find((candidate) => pointerY < candidate.rect.y + candidate.rect.height) ?? tiles[tiles.length - 1];
    const midline = tile.rect.y + tile.rect.height / 2;
    return { tileId: tile.tileId, direction: pointerY < midline ? 'above' : 'below' };
}

/** Which column the drag is aimed at (the candidate column with the most horizontal overlap,
 * provided it clears `overlapFraction`) and which slot in it (from `pointerY`). Candidates may
 * span several columns; a column's overlap is the same for all its tiles. */
export function resolveStackTarget(
    draggedRect: Rect,
    pointerY: number,
    candidates: readonly StackCandidate[],
    overlapFraction: number,
): StackTarget | null {
    let bestColumnId: number | null = null;
    let bestOverlap = 0;
    for (const candidate of candidates) {
        const overlap = horizontalOverlapFraction(draggedRect, candidate.rect);
        if (overlap < overlapFraction || overlap <= bestOverlap) {
            continue;
        }
        bestColumnId = candidate.columnId;
        bestOverlap = overlap;
    }
    if (bestColumnId === null) {
        return null;
    }
    const columnId = bestColumnId;
    const slot = resolveSlotFromPointer(
        pointerY,
        candidates.filter((candidate) => candidate.columnId === columnId),
    );
    return slot === null ? null : { columnId, tileId: slot.tileId, direction: slot.direction };
}

/** Where a stack tile's phantom column first appears: at `homeIndex` (left of home) when the
 * dragged window's center is left of the home column's center, else right after it. */
export function initialPhantomIndex(draggedRect: Rect, homeRect: Rect, homeIndex: number): number {
    const draggedCenter = draggedRect.x + draggedRect.width / 2;
    const homeCenter = homeRect.x + homeRect.width / 2;
    return draggedCenter < homeCenter ? homeIndex : homeIndex + 1;
}

/** Translates a resolved `StackTarget` into a tile-list index for `Column.insertTileAt`/
 * `Column.moveTile`, given the exact tile list the target column will hold (the dragged tile
 * already excluded by the caller for a same-column list). */
export function stackTargetIndex(target: StackTarget, tiles: readonly { id: number }[]): number {
    const index = tiles.findIndex((tile) => tile.id === target.tileId);
    return target.direction === 'above' ? index : index + 1;
}
```

- [ ] **Step 4: Run the tests**

`make test`
Expected: `drag-hover.test.ts` PASS. `drag.ts` no longer compiles (old `resolveStackTarget` signature) — that is expected until Task 7; `make lint`'s tsc step fails for the same reason. Do not paper over it; Task 7 restores it.

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming and formatting match
- [ ] Only the expected `drag.ts` compile error remains (record it)
- [ ] No other convention violations left

---

## Task 5: `Strip.render` on `DragPreview` and `previewLayout`

**Files:**
- Modify: `drift/src/runtime/strip.ts` (`StackPreview`, `render`, `wireTile`'s `render` wrapper)
- Test: `drift/src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new suite in `strip.test.ts` next to `Strip — commitTileIntoStack`:

```ts
describe('Strip — render with a phantom column', () => {
    it('shifts every column at or after the phantom index right by its width plus the horizontal gap', () => {
        const strip = new Strip(WIDE_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a', { width: 640 });
        const b = fakeWindow('b', { width: 640 });
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        const bBefore = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;

        strip.render(undefined, true, undefined, { phantom: { index: 1, width: 300 } });

        const aAfter = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        const bAfter = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        expect(aAfter.x).toBe(0);
        expect(bAfter.x).toBe(bBefore.x + 300 + SETTINGS.horizontalGap);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

`make test`
Expected: FAIL — `render`'s fourth argument is still `StackPreview` (no `phantom`).

- [ ] **Step 3: Implement**

In `strip.ts`:

1. Delete the `StackPreview` interface and its doc comment. Add `import { previewTileRects, type DragPreview } from '../core/drag-preview';`.
2. Change `render`'s signature to `render(excludeWindowId?: string, instant = false, verticalOffsetY?: number, preview?: DragPreview): void` and update its doc comment's last paragraph to: `preview` (see `DragPreview`): the live drag's phantom/leaving/entering preview; the dragged tile's own window keeps being excluded via `excludeWindowId` (docs: 2026-09-18-drag-stack-phantom-design).
3. Replace the body from `this.viewport.setContentGeometry(...)` through the `previewRects` computation with:

```ts
        const layout = this.grid.previewLayout(preview?.phantom);
        this.viewport.setContentGeometry(this.grid.contentLeft(), layout.virtualWidth);
        for (const column of this.grid.columns()) {
            const columnRect = layout.rects.get(column.id) ?? this.grid.columnRect(column.id);
            if (column.hidden) {
                // ... unchanged hidden-column loop, still using `columnRect` ...
                continue;
            }
            const previewRects = previewTileRects(column, columnRect, preview);
            for (const tile of column.tiles()) {
                // ... unchanged, `targetRect = previewRects.get(tile.id) ?? column.tileRect(tile.id, columnRect)` ...
```

4. In the motion-continuation branch, pass `preview` instead of `stackPreview`: `this.render(excludeWindowId, false, undefined, preview)`.
5. In `wireTile`'s `render` wrapper, rename the parameter and type to `preview?: DragPreview`.

- [ ] **Step 4: Run the test**

`make test`
Expected: the new suite PASSES; `drag.ts` still fails to compile (Task 7).

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming and formatting match
- [ ] Only the expected `drag.ts` compile error remains
- [ ] No other convention violations left

---

## Task 6: `Strip.commitTileToStandalone`

**Files:**
- Modify: `drift/src/runtime/strip.ts` (next to `commitTileIntoStack`)
- Test: `drift/src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('Strip — commitTileToStandalone', () => {
    function stackWithNeighbor(): { strip: Strip; a: FakeWindow; b: FakeWindow; c: FakeWindow } {
        const strip = new Strip(WIDE_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a', { width: 640 });
        const b = fakeWindow('b', { width: 640 });
        const c = fakeWindow('c', { width: 640 });
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column A: [a, b]
        strip.addWindow(c.adapter); // column C to the right of A
        return { strip, a, b, c };
    }

    it('moves the tile into its own column at the given grid index, keeping the source width', () => {
        const { strip, a, b, c } = stackWithNeighbor();
        const home = strip.locationOf('b')!;

        strip.commitTileToStandalone(home.columnId, home.tileId, 0); // left of A
        strip.render();

        const aRect = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        const bRect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        const cRect = c.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        expect(strip.locationOf('b')!.columnId).not.toBe(home.columnId);
        expect(bRect.x).toBe(0);
        expect(bRect.width).toBe(640);
        expect(bRect.height).toBe(WIDE_AREA.height);
        expect(aRect.x).toBe(640 + SETTINGS.horizontalGap);
        expect(aRect.height).toBe(WIDE_AREA.height); // a now fills its column
        expect(cRect.x).toBeGreaterThan(aRect.x);
    });

    it('can place the new column between its home and the neighbor', () => {
        const { strip, a, b, c } = stackWithNeighbor();
        const home = strip.locationOf('b')!;

        strip.commitTileToStandalone(home.columnId, home.tileId, 1);
        strip.render();

        const aRect = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        const bRect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        const cRect = c.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
        expect(aRect.x).toBeLessThan(bRect.x);
        expect(bRect.x).toBeLessThan(cRect.x);
    });

    it('is a no-op for a single-tile column', () => {
        const strip = new Strip(WIDE_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a', { width: 640 });
        strip.addWindow(a.adapter);
        const home = strip.locationOf('a')!;
        strip.commitTileToStandalone(home.columnId, home.tileId, 0);
        expect(strip.locationOf('a')).toEqual(home);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`make test`
Expected: FAIL — `commitTileToStandalone` does not exist.

- [ ] **Step 3: Implement**

Add to `Strip` right after `commitTileIntoStack`:

```ts
    /** Commits a phantom-mode drop: `fromTileId` leaves `fromColumnId` for a brand-new standalone
     * column of the source column's width at grid `index` — the same mutation keyboard `expel`
     * performs, positioned where the phantom was previewed (docs:
     * 2026-09-18-drag-stack-phantom-design). No-op for a single-tile source column. */
    commitTileToStandalone(fromColumnId: number, fromTileId: number, index: number): void {
        const fromColumn = this.grid.column(fromColumnId);
        if (fromColumn === null) {
            throw new Error(`Unknown column id: ${fromColumnId}`);
        }
        const result = this.grid.expelTile(fromColumnId, fromTileId, fromColumn.width);
        if (result === null) {
            return;
        }
        this.grid.moveColumn(result.toColumnId, index);
        this.registry.moveWindow(fromColumnId, fromTileId, result.toColumnId, result.toTileId);
        this.fullScreenTiles.delete(this.tileKey(fromColumnId, fromTileId));
        this.minimizedTiles.delete(this.tileKey(fromColumnId, fromTileId));
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`make test`
Expected: the new suite PASSES; `drag.ts` still fails to compile (Task 7).

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming and formatting match
- [ ] Only the expected `drag.ts` compile error remains
- [ ] No other convention violations left

---

## Task 7: Rewrite `drag.ts` as standalone / home / phantom modes

**Files:**
- Modify: `drift/src/input/drag.ts` (whole file)
- Modify: `drift/src/runtime/strip.ts` (`wireTile`: pass `commitTileToStandalone`)
- Test: `drift/src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new suite in `strip.test.ts` after `Strip — stack dwell preview`:

```ts
describe('Strip — phantom column drag (docs: 2026-09-18-drag-stack-phantom-design)', () => {
    function stackWithNeighbor(
        timer: ManualTimer,
        workspaceAdapter: FakeWorkspaceAdapter,
    ): { strip: Strip; a: FakeWindow; b: FakeWindow; c: FakeWindow } {
        const strip = new Strip(WIDE_AREA, { ...INSTANT_SETTINGS, columnDragDwellMs: 100 }, timer, workspaceAdapter);
        const a = fakeWindow('a', { width: 640 });
        const b = fakeWindow('b', { width: 640 });
        const c = fakeWindow('c', { width: 640 });
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column A = [a (y 0..500), b (y 500..1000)] at x=0
        strip.addWindow(c.adapter); // column C at x = 640 + gap
        return { strip, a, b, c };
    }

    it('previews a phantom column beside home once more than half the tile has left it, after the dwell', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const { strip, b, c } = stackWithNeighbor(timer, workspaceAdapter);
            const cBefore = (c.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).x;

            b.startDrag();
            // b at x=400 overlaps its home column [0,640) by 240px = 37.5% < 50%: phantom mode.
            // Its center (720) is right of home's center (320): phantom index 1, between A and C.
            b.setFrameGeometryValue({ x: 400, y: 500, width: 640, height: 500 });
            b.triggerFrameGeometryChanged({ x: 0, y: 500, width: 640, height: 500 });

            // Dwelling: nothing has moved yet.
            expect((c.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).x).toBe(cBefore);

            vi.setSystemTime(100);
            timer.fire(); // 'phantom' dwell elapses

            // C slid right to make room for a 640px phantom plus the gap.
            expect((c.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).x).toBe(
                cBefore + 640 + SETTINGS.horizontalGap,
            );

            b.finishDrag();

            // Committed: b is its own column between A and C.
            strip.render();
            const bRect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
            const cRect = c.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
            expect(strip.locationOf('b')!.columnId).not.toBe(strip.locationOf('a')!.columnId);
            expect(bRect.x).toBe(640 + SETTINGS.horizontalGap);
            expect(bRect.height).toBe(WIDE_AREA.height);
            expect(cRect.x).toBe(bRect.x + 640 + SETTINGS.horizontalGap);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not commit anything when released before the phantom dwell fires', () => {
        const workspaceAdapter = fakeWorkspaceAdapter();
        const timer = new ManualTimer();
        const { strip, a, b } = stackWithNeighbor(timer, workspaceAdapter);
        const home = strip.locationOf('b')!.columnId;

        b.startDrag();
        b.setFrameGeometryValue({ x: 400, y: 500, width: 640, height: 500 });
        b.triggerFrameGeometryChanged({ x: 0, y: 500, width: 640, height: 500 });
        b.finishDrag();

        expect(strip.locationOf('b')!.columnId).toBe(home);
        expect(strip.locationOf('a')!.columnId).toBe(home);
    });

    it('never expels a tile that drifts one pixel past the grid boundary', () => {
        const workspaceAdapter = fakeWorkspaceAdapter();
        const timer = new ManualTimer();
        const { strip, b } = stackWithNeighbor(timer, workspaceAdapter);
        const home = strip.locationOf('b')!.columnId;

        b.startDrag();
        b.setFrameGeometryValue({ x: -1, y: 500, width: 640, height: 500 }); // 99.8% still over home
        b.triggerFrameGeometryChanged({ x: 0, y: 500, width: 640, height: 500 });
        timer.fire();
        b.finishDrag();

        expect(strip.locationOf('b')!.columnId).toBe(home);
    });
});

describe('Strip — pointer-resolved stack slot (docs: 2026-09-18-drag-stack-phantom-design)', () => {
    it("stacks below a full-height neighbor when the pointer is in its lower half, regardless of the window's top edge", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const strip = new Strip(WIDE_AREA, { ...INSTANT_SETTINGS, columnDragDwellMs: 100 }, timer, workspaceAdapter);
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter);
            strip.addWindow(b.adapter);
            const bRealX = (b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).x;

            b.startDrag();
            workspaceAdapter.cursor = { x: 300, y: 900 }; // lower half of a's [0,1000) tile
            b.setFrameGeometryValue({ x: 200, y: 0, width: 640, height: 1000 }); // top edge flush with a's
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 });
            vi.setSystemTime(100);
            timer.fire();

            const aPreview = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
            expect(aPreview.y).toBe(0); // gap opened BELOW a, not above
            expect(aPreview.height).toBeLessThan(1000);

            b.finishDrag();
            strip.render();
            const aRect = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
            const bRect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect;
            expect(bRect.y).toBeGreaterThan(aRect.y);
        } finally {
            vi.useRealTimers();
        }
    });

    it('moves the previewed slot live when the pointer crosses the midline, without a second dwell', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const strip = new Strip(WIDE_AREA, { ...INSTANT_SETTINGS, columnDragDwellMs: 100 }, timer, workspaceAdapter);
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter);
            strip.addWindow(b.adapter);
            const bRealX = (b.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).x;

            b.startDrag();
            workspaceAdapter.cursor = { x: 300, y: 100 };
            b.setFrameGeometryValue({ x: 200, y: 0, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 });
            vi.setSystemTime(100);
            timer.fire();
            expect((a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).y).toBeGreaterThan(0); // above

            workspaceAdapter.cursor = { x: 300, y: 900 };
            b.setFrameGeometryValue({ x: 201, y: 0, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: 200, y: 0, width: 640, height: 1000 }); // no timer.fire()
            expect((a.setFrameGeometry.mock.calls.slice(-1)[0][0] as Rect).y).toBe(0); // below, live

            b.finishDrag();
        } finally {
            vi.useRealTimers();
        }
    });
});
```

`FakeWorkspaceAdapter` must expose `cursor` as a writable `{ x; y }`; if its interface type in the test file lacks it, add `cursor: { x: number; y: number };` to that interface.

- [ ] **Step 2: Run the tests to verify they fail**

`make test`
Expected: FAIL to compile (Task 4's `resolveStackTarget` change) — that is the failure this task fixes.

- [ ] **Step 3: Replace `drift/src/input/drag.ts`**

Declaration order inside `registerDragReorder` matters for readability and for any use-before-define lint: place `resetTargets` and `setMode` before `disconnectStarted`, `enteringFor` before `currentPreview`, and `stackDwell` before `settleStackTarget`; declare `tick` as a hoisted `function tick(): void { ... }` so `stackDwell`'s callback can call it. The listing below is otherwise complete.

Implementation note: `tileCandidates` resolves against committed tile rects (`column.tileRect`), not `previewTileRects` — see the spec's Vertical slot paragraph; the listing below predates that correction.

```ts
// Turns a window's interactive-move lifecycle into a live column reorder, a previewed
// drag-to-stack, or a previewed unstack (docs: 2026-09-18-drag-stack-phantom-design, building
// on 2026-09-07-drag-reorder-stack-refinement-design). Three modes, decided fresh every tick:
//
// - standalone: the dragged window is a single-tile column. Reorder commits live the instant
//   its own edge penetrates a neighbor past `reorderThresholdFraction` (`Grid.moveColumn`);
//   otherwise a neighbor stack slot is previewed once horizontal overlap clears
//   `stackOverlapFraction`.
// - home: a stack tile still overlapping its own column by `stackOverlapFraction` — previews
//   a same-column slot.
// - phantom: a stack tile more than that out of its column — previewed as if it were already a
//   standalone column (a phantom of its width in the layout; its home closes up around the
//   hole). The phantom moves past neighbors by the same reorder rule, and a neighbor stack slot
//   is layered on top by the same overlap rule, exactly like a real standalone column. Nothing
//   about a stack tile is committed before release.
//
// The vertical slot always comes from the pointer's y against the tile rects currently on
// screen (`previewTileRects`). The dwell is keyed on the target column (`stack:<id>`) or on
// entering phantom mode (`phantom`); slot and phantom-index changes inside an armed target
// preview live, and the last armed preview stays on screen while a new key is dwelling.

import { Column } from '../core/column';
import { Rect } from '../core/coordinates';
import { previewTileRects, type DragPreview } from '../core/drag-preview';
import { Grid, insertionIndexForSlots, visibleNeighborSlot, type PreviewLayout } from '../core/grid';
import { debug } from '../debug';
import { toVirtualX } from '../kwin/geometry-sync';
import type { PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
import { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { DwellTimer } from '../utils/dwell-timer';
import { Viewport } from '../viewport/viewport';
import {
    horizontalOverlapFraction,
    initialPhantomIndex,
    resolveSlotFromPointer,
    resolveStackTarget,
    stackTargetIndex,
    StackCandidate,
    StackTarget,
} from './drag-hover';

const PHANTOM_KEY = 'phantom';
const STACK_KEY_PREFIX = 'stack:';

type DragMode = 'standalone' | 'home' | 'phantom';

interface TileLocation {
    columnId: number;
    tileId: number;
}

/** Minimal view of `ColumnRegistry` this module needs — resolving the dragged window's
 * CURRENT column/tile fresh on every tick rather than closing over a fixed id captured at
 * connection time (docs: 2026-09-03-drag-to-stack-design). */
export interface DragRegistryView {
    tileOf(windowId: string): TileLocation | null;
    moveWindow(fromColumnId: number, fromTileId: number, toColumnId: number, toTileId: number): void;
}

export interface DragReorderDeps {
    grid: Grid;
    registry: DragRegistryView;
    viewport: Viewport;
    area: Rect;
    /** Fraction of a neighbor's width a reorder (real column or phantom) must penetrate before
     * it moves past that neighbor (`settings.reorderThresholdFraction`). */
    reorderThresholdFraction: number;
    /** Minimum horizontal overlap for a stack target, and the home-column overlap below which a
     * stack tile enters phantom mode (`settings.stackOverlapFraction`). */
    stackOverlapFraction: number;
    /** Whether dragging defaults to pan mode with a pull-to-free gesture, or is fully inert
     * (`settings.dragPanEnabled`) — see the threshold checks in `tickInner` below (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical pull, in pixels, that frees the drag immediately — no hold, no dwell
     * (`settings.dragPanVerticalTriggerPx`). */
    dragPanVerticalTriggerPx: number;
    /** Cumulative horizontal drift, in pixels, measured from drag start, that permanently aborts
     * the pull for the rest of this drag once reached before the vertical trigger is
     * (`settings.dragPanHorizontalTolerancePx`). */
    dragPanHorizontalTolerancePx: number;
    /** Read access to the real pointer position — re-seeds the dragged window when the pull frees
     * (docs: 2026-09-12-drag-pan-dwell-design) and resolves the vertical stack slot. */
    workspace: Pick<WorkspaceAdapter, 'cursorPos'>;
    /** Grows/fades the pull indicator overlay while a pull is in progress — one shared instance
     * threaded through every drag-reorder connection (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). */
    pullIndicator: PullIndicatorOverlay;
    render(excludeWindowId?: string, instant?: boolean, verticalOffsetY?: undefined, preview?: DragPreview): void;
    /** Builds a dwell timer keyed on a target column (`stack:<columnId>`) or on entering phantom
     * mode (`phantom`), firing `onFire` once the key has held past `columnDragDwellMs` — one
     * instance per drag-reorder connection, reused across every drag that window does. */
    createStackDwell(onFire: (key: string) => void): DwellTimer<string>;
    /** Seeds the dropped window's motion channels at its actual drop rect, so it eases into
     * its resolved slot instead of snapping (docs: 2026-09-08-window-motion-primitive-design). */
    seedMotionFrom(windowId: string, rect: Partial<Rect>): void;
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void;
    /** Commits a phantom-mode drop: the tile becomes its own column at grid `index`. */
    commitTileToStandalone(fromColumnId: number, fromTileId: number, index: number): void;
    /** Strip-crossing hooks (docs: 2026-09-02-cross-row-drag-design). All optional. */
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
    /** Called once, after the dragged column has settled into its final grid slot on release. */
    revealFocused(): void;
}

/** `win`'s own current rect, in virtual x / area-relative y — the same coordinate space
 * `Grid.previewLayout`/`Column.tileRect` produce, so it compares directly against them. */
function windowRectVirtual(win: WindowAdapter, area: Rect, viewportOffsetX: number): Rect {
    const rect = win.frameGeometry();
    return {
        x: toVirtualX(rect.x, area, viewportOffsetX),
        y: rect.y - area.y,
        width: rect.width,
        height: rect.height,
    };
}

/** Fetches `columnId`'s `Column`, throwing a descriptive error instead of silently
 * dereferencing null if the registry and grid have desynced — this file is glue code with
 * no direct unit coverage, so a clear error here matters more than in tested core code. */
function requireColumn(grid: Grid, columnId: number): Column {
    const column = grid.column(columnId);
    if (column === null) {
        throw new Error(`Unknown column id: ${columnId}`);
    }
    return column;
}

/** Wires `win`'s move lifecycle to reorder, stack, or unstack, and to settle it on release.
 * `initiallyDragging`/`initiallyFreed` seed a connection created mid-drag by a cross-strip
 * reparent (docs: 2026-09-02-cross-row-drag-design). Returns a disconnect function. */
export function registerDragReorder(
    win: WindowAdapter,
    deps: DragReorderDeps,
    initiallyDragging = false,
    initiallyFreed = false,
): () => void {
    let dragging = initiallyDragging;
    /** The dragged window's real (screen) y/x at the start of the current drag — the baseline
     * both the vertical free-threshold and horizontal abort-threshold are measured against
     * (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    let startY = win.frameGeometry().y;
    let startX = win.frameGeometry().x;
    /** The dragged window's real (screen) x as of the last tick. */
    let lastX = win.frameGeometry().x;
    /** `startY` minus the real pointer's y at drag start (docs: 2026-09-12-drag-pan-dwell-design). */
    let grabOffsetY = startY - deps.workspace.cursorPos().y;
    /** Whether this drag has earned full reorder/stack/cross-strip-drag behavior. */
    let freed = initiallyFreed;
    /** Latches once cumulative horizontal drift exceeds `dragPanHorizontalTolerancePx` before
     * the pull frees (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    let pullAborted = false;
    /** Re-entrancy guard: `win.setFrameGeometry` fires `onFrameGeometryChanged` synchronously. */
    let applyingPin = false;

    /** Which of the three modes the last tick resolved; a change clears every armed target. */
    let mode: DragMode | null = null;
    /** Grid index the phantom occupies while in phantom mode, null otherwise. */
    let phantomIndex: number | null = null;
    /** Whether the `phantom` dwell key has fired for the current phantom-mode stint. */
    let phantomArmed = false;
    /** Column whose `stack:` dwell key has fired — the only column an entering preview shows for. */
    let armedStackColumnId: number | null = null;
    /** The last slot previewed in `armedStackColumnId`; what release commits. */
    let armedStackTarget: StackTarget | null = null;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            startX = rect.x;
            lastX = rect.x;
            grabOffsetY = startY - deps.workspace.cursorPos().y;
            freed = false;
            pullAborted = false;
            resetTargets();
            deps.onDragStarted?.(win);
        }
    });

    const currentLocation = (): TileLocation | null => deps.registry.tileOf(win.id);

    const resetTargets = (): void => {
        mode = null;
        phantomIndex = null;
        phantomArmed = false;
        armedStackColumnId = null;
        armedStackTarget = null;
    };

    const setMode = (next: DragMode): void => {
        if (mode === next) {
            return;
        }
        mode = next;
        armedStackColumnId = null;
        armedStackTarget = null;
        if (next !== 'phantom') {
            phantomIndex = null;
            phantomArmed = false;
        }
    };

    /** The preview currently on screen: the phantom + leaving pair once phantom mode has armed,
     * plus the entering gap for the armed stack target, if any. */
    const currentPreview = (location: TileLocation): DragPreview | undefined => {
        const preview: DragPreview = {};
        if (phantomIndex !== null && phantomArmed) {
            preview.phantom = { index: phantomIndex, width: win.frameGeometry().width };
            preview.leaving = { columnId: location.columnId, tileId: location.tileId };
        }
        if (armedStackTarget !== null) {
            preview.entering = enteringFor(location, armedStackTarget);
        }
        return preview.phantom === undefined && preview.entering === undefined ? undefined : preview;
    };

    const enteringFor = (location: TileLocation, target: StackTarget): NonNullable<DragPreview['entering']> => {
        const targetColumn = requireColumn(deps.grid, target.columnId);
        const sameColumn = target.columnId === location.columnId;
        const targetTiles = sameColumn
            ? targetColumn.tiles().filter((tile) => tile.id !== location.tileId)
            : targetColumn.tiles();
        const index = stackTargetIndex(target, targetTiles);
        if (sameColumn) {
            // Column.moveTile never redistributes height, so the tile's own current height is
            // exactly what it will end up at.
            return { columnId: target.columnId, index, gapHeight: win.frameGeometry().height, excludeTileId: location.tileId };
        }
        // Column.insertTileAt evenly redistributes the target's total height across its tiles
        // plus the incoming one — approximate that (docs: 2026-09-03-drag-to-stack-design).
        const totalHeight = targetTiles.reduce((sum, tile) => sum + tile.height, 0);
        return { columnId: target.columnId, index, gapHeight: totalHeight / (targetTiles.length + 1) };
    };

    /** `column`'s tiles as stack candidates, at the rects `Strip.render` is currently showing. */
    const tileCandidates = (
        column: Column,
        columnRect: Rect,
        preview: DragPreview | undefined,
        excludeTileId?: number,
    ): StackCandidate[] => {
        const rects = previewTileRects(column, columnRect, preview);
        const candidates: StackCandidate[] = [];
        for (const tile of column.tiles()) {
            const rect = rects.get(tile.id);
            if (tile.id === excludeTileId || rect === undefined) {
                continue;
            }
            candidates.push({ columnId: column.id, tileId: tile.id, rect });
        }
        return candidates;
    };

    /** Candidates from the visible slots immediately left and right of `slotIndex`, skipping
     * the dragged tile's own column (`excludeColumnId`), which the home mode handles. */
    const neighborCandidates = (
        layout: PreviewLayout,
        slotIndex: number,
        excludeColumnId: number,
        preview: DragPreview | undefined,
    ): StackCandidate[] => {
        const candidates: StackCandidate[] = [];
        for (const step of [-1, 1] as const) {
            const neighborIndex = visibleNeighborSlot(layout.slots, slotIndex, step);
            if (neighborIndex === null) {
                continue;
            }
            const columnId = layout.slots[neighborIndex].columnId;
            const rect = columnId === null ? undefined : layout.rects.get(columnId);
            if (columnId === null || columnId === excludeColumnId || rect === undefined) {
                continue;
            }
            candidates.push(...tileCandidates(requireColumn(deps.grid, columnId), rect, preview));
        }
        return candidates;
    };

    /** Feeds this tick's stack target to the dwell and renders. `baseKey` is what the dwell
     * holds when no stack target is hovered: `phantom` in phantom mode, else null (clear). */
    const settleStackTarget = (location: TileLocation, target: StackTarget | null, baseKey: string | null): void => {
        if (target === null) {
            armedStackColumnId = null;
            armedStackTarget = null;
            stackDwell.update(baseKey);
        } else {
            stackDwell.update(`${STACK_KEY_PREFIX}${target.columnId}`);
            if (armedStackColumnId === target.columnId) {
                armedStackTarget = target; // slot changes preview live once the column is armed
            }
            // else: a different column is dwelling; the last armed entering preview stays on screen
        }
        deps.render(win.id, false, undefined, currentPreview(location));
    };

    const stackDwell = deps.createStackDwell((key) => {
        if (key === PHANTOM_KEY) {
            phantomArmed = true;
        } else {
            armedStackColumnId = Number(key.slice(STACK_KEY_PREFIX.length));
            armedStackTarget = null;
        }
        tick(); // re-resolve against the window's CURRENT geometry and render the newly armed preview
    });

    /** Frees the drag from pan mode (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
    const freeFromPan = (): void => {
        freed = true;
        deps.pullIndicator.hide();
        const raw = win.frameGeometry();
        const cursor = deps.workspace.cursorPos();
        applyingPin = true;
        win.setFrameGeometry({ x: raw.x, y: cursor.y + grabOffsetY, width: raw.width, height: raw.height });
        applyingPin = false;
    };

    const tickInner = (): void => {
        if (applyingPin) {
            return;
        }
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        // Pan step: while dragPanEnabled and not yet freed, the drag is pinned pan-only — y stays
        // at startY, x's movement redirects into the viewport, and none of the mode logic below
        // runs (docs: 2026-09-16-drag-pull-threshold-indicator-design). Gating on
        // `deps.dragPanEnabled && !freed` together matters: `freed` never becomes true when the
        // feature is disabled.
        if (deps.dragPanEnabled && !freed) {
            const raw = win.frameGeometry();
            const dyTotal = Math.abs(raw.y - startY);
            const dxTotal = Math.abs(raw.x - startX);

            if (!pullAborted && dyTotal >= deps.dragPanVerticalTriggerPx) {
                freeFromPan();
                deps.render(win.id, false);
                return;
            }

            if (!pullAborted && dxTotal >= deps.dragPanHorizontalTolerancePx) {
                pullAborted = true;
                deps.pullIndicator.fadeOut();
            } else if (!pullAborted) {
                deps.pullIndicator.update(win, startY, dyTotal, deps.dragPanVerticalTriggerPx);
            }

            const dxTick = raw.x - lastX;
            if (dxTick !== 0) {
                deps.viewport.setOffset(deps.viewport.offset() - dxTick);
            }
            lastX = raw.x;

            applyingPin = true;
            win.setFrameGeometry({ x: raw.x, y: startY, width: raw.width, height: raw.height });
            applyingPin = false;
            deps.render(win.id, false);
            return;
        }

        const draggedRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
        const pointerY = deps.workspace.cursorPos().y - deps.area.y;
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);
        const leftEdge = draggedRect.x;
        const rightEdge = draggedRect.x + draggedRect.width;
        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} mode=${mode} ` +
                `rect=(${leftEdge.toFixed(0)},${draggedRect.y.toFixed(0)},${draggedRect.width.toFixed(0)},` +
                `${draggedRect.height.toFixed(0)}) pointerY=${pointerY.toFixed(0)} phantom=${phantomIndex}`,
        );

        if (homeColumn.tileCount() === 1) {
            // Standalone column: live reorder first, exactly as before.
            setMode('standalone');
            const reorderIndex = deps.grid.insertionIndexForEdges(
                location.columnId,
                leftEdge,
                rightEdge,
                deps.reorderThresholdFraction,
            );
            if (reorderIndex !== homeIndex) {
                debug(`drag tick: reorder triggered col${location.columnId} idx${homeIndex}->${reorderIndex}`);
                armedStackColumnId = null;
                armedStackTarget = null;
                stackDwell.update(null);
                deps.grid.moveColumn(location.columnId, reorderIndex);
                deps.render(win.id, false);
                return;
            }
            const preview = currentPreview(location);
            const layout = deps.grid.previewLayout();
            const target = resolveStackTarget(
                draggedRect,
                pointerY,
                neighborCandidates(layout, homeIndex, location.columnId, preview),
                deps.stackOverlapFraction,
            );
            settleStackTarget(location, target, null);
            return;
        }

        // Stack tile. Home overlap is measured against the COMMITTED home rect on purpose: in
        // phantom mode the home column may be drawn shifted, and measuring against the shifted
        // rect would flip the decision back and forth at the threshold.
        const homeRect = deps.grid.columnRect(location.columnId);
        if (horizontalOverlapFraction(draggedRect, homeRect) >= deps.stackOverlapFraction) {
            setMode('home');
            const preview = currentPreview(location);
            const siblings = tileCandidates(homeColumn, homeRect, preview, location.tileId);
            const slot = resolveSlotFromPointer(pointerY, siblings);
            settleStackTarget(
                location,
                slot === null ? null : { columnId: location.columnId, tileId: slot.tileId, direction: slot.direction },
                null,
            );
            return;
        }

        setMode('phantom');
        if (phantomIndex === null) {
            phantomIndex = initialPhantomIndex(draggedRect, homeRect, homeIndex);
            debug(`drag tick: phantom mode entered at index ${phantomIndex}`);
        }
        const phantomWidth = draggedRect.width;
        let layout = deps.grid.previewLayout({ index: phantomIndex, width: phantomWidth });
        const movedIndex = insertionIndexForSlots(
            layout.slots,
            phantomIndex,
            leftEdge,
            rightEdge,
            deps.reorderThresholdFraction,
        );
        if (movedIndex !== phantomIndex) {
            debug(`drag tick: phantom reorder ${phantomIndex}->${movedIndex}`);
            phantomIndex = movedIndex;
            layout = deps.grid.previewLayout({ index: phantomIndex, width: phantomWidth });
            // Like live reorder, moving past a neighbor drops any stack target hovered in it.
            armedStackColumnId = null;
            armedStackTarget = null;
        }
        if (!phantomArmed) {
            stackDwell.update(PHANTOM_KEY);
            deps.render(win.id, false, undefined, currentPreview(location));
            return;
        }
        const preview = currentPreview(location);
        const target = resolveStackTarget(
            draggedRect,
            pointerY,
            neighborCandidates(layout, phantomIndex, location.columnId, preview),
            deps.stackOverlapFraction,
        );
        settleStackTarget(location, target, PHANTOM_KEY);
    };

    // TEMPORARY DEBUG INSTRUMENTATION: writes to the OSD debug console (enable
    // debugConsoleEnabled in the settings dialog's Debug tab). Remove once no further
    // live-testing rounds are needed.
    const tick = (): void => {
        try {
            tickInner();
        } catch (error) {
            debug(`drag tick ERROR: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
        }
    };

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        // Cross-strip moves must be structurally impossible during active panning (docs:
        // 2026-09-12-drag-pan-dwell-design).
        if (!deps.dragPanEnabled || freed) {
            deps.onDragTick?.(win);
        }
    });

    const finishedInner = (): void => {
        if (!dragging) {
            debug('drag finished: ignored, dragging flag already false');
            return;
        }
        dragging = false;
        stackDwell.stop();
        deps.pullIndicator.hide();
        const location = currentLocation();
        debug(
            `drag finished: win=${win.id} loc=${location ? `col${location.columnId}/tile${location.tileId}` : 'null'} ` +
                `stackTarget=${armedStackTarget ? `${armedStackTarget.columnId}:${armedStackTarget.tileId}:${armedStackTarget.direction}` : 'none'} ` +
                `phantom=${phantomIndex}/${phantomArmed}`,
        );
        if (location === null) {
            resetTargets();
            deps.onDragFinished?.();
            return;
        }
        // The window's own actual rect right at release is the animation's starting point
        // (docs: 2026-09-08-window-motion-primitive-design).
        deps.seedMotionFrom(win.id, windowRectVirtual(win, deps.area, deps.viewport.offset()));
        if (armedStackTarget !== null) {
            const target = armedStackTarget;
            const targetColumn = requireColumn(deps.grid, target.columnId);
            if (target.columnId === location.columnId) {
                const others = targetColumn.tiles().filter((tile) => tile.id !== location.tileId);
                targetColumn.moveTile(location.tileId, stackTargetIndex(target, others));
            } else {
                deps.commitTileIntoStack(
                    location.columnId,
                    location.tileId,
                    target.columnId,
                    stackTargetIndex(target, targetColumn.tiles()),
                );
            }
        } else if (phantomIndex !== null && phantomArmed) {
            deps.commitTileToStandalone(location.columnId, location.tileId, phantomIndex);
        }
        resetTargets();
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    };

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        try {
            finishedInner();
        } catch (error) {
            debug(
                `drag finished ERROR: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`,
            );
            dragging = false;
            stackDwell.stop();
            deps.pullIndicator.hide();
            resetTargets();
            deps.onDragFinished?.();
        }
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
        // Guarded on `dragging`: every wireTile connection in a strip shares the same overlay
        // instance, so an unrelated window's teardown mid-drag must not hide another window's
        // live indicator (docs: 2026-09-16-drag-pull-threshold-indicator-design).
        if (dragging) {
            deps.pullIndicator.hide();
        }
    };
}
```

Then in `strip.ts` `wireTile`, add to the deps object after `commitTileIntoStack`:

```ts
                    commitTileToStandalone: (fromColumnId: number, fromTileId: number, index: number) =>
                        this.commitTileToStandalone(fromColumnId, fromTileId, index),
```

- [ ] **Step 4: Run the tests to verify they pass**

`make test`
Expected: PASS — the new phantom and pointer suites, and every pre-existing drag suite (`live reorder commit`, `reorder release eases into place`, `stack release eases into place`, `stack dwell preview`, `drag handler after column membership changes`). The pre-existing stack tests keep passing because `fakeWorkspaceAdapter().cursor` defaults to `(0, 0)`, which is the first tile's upper half → `above`, the same slot they asserted before. If `Strip — stack release eases into place › same-column` fails on slot, check that `tileCandidates` excludes the dragged tile and that `stackTargetIndex` is given the `others` list.

`make lint`
Expected: PASS (tsc compiles again).

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] KWin access stays isolated: `drag.ts` touches KWin only via `WindowAdapter`/`WorkspaceAdapter`
- [ ] Naming and formatting match; lines ≤ 120 chars (wrap the `debug` strings if needed)
- [ ] `make test` and `make lint` pass
- [ ] No convention violations left

---

## Task 8: Remove `expelDirectionForEdges`, lower the dwell default

**Files:**
- Modify: `drift/src/core/grid.ts` (delete `expelDirectionForEdges`)
- Modify: `drift/src/core/grid.test.ts` (delete `Grid — expel direction for drag edges`)
- Modify: `drift/src/config/settings-definitions.ts:169`
- Modify: `drift/ui/config.ui` (`kcfg_columnDragDwellMs` `value` 400 → 200, tooltip)
- Modify: `drift/src/config/settings.test.ts:23-25`

- [ ] **Step 1: Update the failing settings test**

```ts
    it('defaults the column-stack drag dwell to 200ms', () => {
        expect(DEFAULT_SETTINGS.columnDragDwellMs).toBe(200);
    });
```

- [ ] **Step 2: Run the tests to verify it fails**

`make test`
Expected: FAIL — default is still 400.

- [ ] **Step 3: Implement**

- `settings-definitions.ts`: `{ name: 'columnDragDwellMs', type: 'UInt', default: 200 },`
- `config.ui`: the `kcfg_columnDragDwellMs` spin box `<number>400</number>` → `<number>200</number>`; tooltip → `How long a drag must hover a column (or sit more than half out of its own) before the stack preview appears; slot changes inside that column then preview live`.
- `grid.ts`: delete `expelDirectionForEdges` and its doc comment. Use Serena's `safe_delete_symbol` so any remaining reference is reported.
- `grid.test.ts`: delete the `Grid — expel direction for drag edges` suite.
- Search the repo (`rg expelDirectionForEdges`) — no matches may remain, including in docs.

- [ ] **Step 4: Run the tests to verify they pass**

`make test` and `make lint`
Expected: PASS.

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] `make test`, `make lint` (including `qmllint`/the `.ui` check the Makefile runs) pass
- [ ] No convention violations left

---

## Task 9: Documentation

**Files:**
- Modify: `docs/algorithms.md` (§ Drag-to-Stack Hover Resolution, lines 50-62)
- Modify: `docs/features.md` (§ Drag-to-stack, lines 79-91)
- Modify: `docs/known_bugs.md` (remove entry 1; keep entry 2 numbered 2)
- Modify: `docs/agents/specs/2026-09-18-drag-stack-phantom-design.md` (§ Target model)

Write one sentence per line.

- [ ] **Step 1: Rewrite `docs/algorithms.md` § Drag-to-Stack Hover Resolution**

```markdown
## Drag-to-Stack Hover Resolution

Source: [`resolveStackTarget`, `resolveSlotFromPointer`, `initialPhantomIndex`](../drift/src/input/drag-hover.ts) in `drag-hover.ts`, [`previewTileRects`](../drift/src/core/drag-preview.ts) in `drag-preview.ts`, [`Grid.previewLayout`, `insertionIndexForSlots`](../drift/src/core/grid.ts) in `grid.ts`, driven by [`registerDragReorder`](../drift/src/input/drag.ts) in `drag.ts`.

Every `frameGeometryChanged` tick after the pull has freed the drag resolves one of three modes from the dragged window's own geometry.

A **standalone** single-tile column reorders live first (see above) and otherwise previews a slot in whichever immediate neighbor it overlaps most horizontally, provided that overlap clears `settings.stackOverlapFraction` (default `0.5`, measured against the narrower of the two widths).

A stack tile still overlapping its committed home column by that fraction is in **home** mode and previews a slot among its siblings.

A stack tile further out than that is in **phantom** mode: `Grid.previewLayout` lays the columns out with a phantom column of the tile's width inserted beside home (`initialPhantomIndex`, on the side the window's center is on), and the home column closes up around the hole.
The phantom then obeys the reorder rule as a preview, moving past a neighbor once the window's edge penetrates `reorderThresholdFraction` of that neighbor's previewed width (`insertionIndexForSlots`), and a neighbor slot is previewed on top by the same overlap rule a standalone column uses.
The phantom stays open while a neighbor slot is previewed, so the previewed layout only changes when the phantom index moves.
Home overlap is measured against the committed rect, never the previewed one, so entering phantom mode cannot flip the decision back.

The vertical slot comes from the pointer's area-relative y, not from the dragged window: `resolveSlotFromPointer` finds the target column's tile under the pointer among the rects `previewTileRects` says are on screen, clamped to the first and last tile, and resolves `above` in its upper half and `below` from its midline down.
There is no dead zone.

The dwell (`DwellTimer`, `settings.columnDragDwellMs`, default `200`) is keyed on the target column or on entering phantom mode, not on the slot.
Slot and phantom-index changes inside an armed target preview live, and the last armed preview stays on screen while a new key is dwelling.

Release commits whatever is previewed: `Column.moveTile` for a same-column slot, `Strip.commitTileIntoStack` for a neighbor slot, or `Strip.commitTileToStandalone` for the phantom.
Nothing about a stack tile is committed before release.
```

- [ ] **Step 2: Rewrite `docs/features.md` § Drag-to-stack body**

```markdown
Absorb/expel is keyboard-only; drag-to-stack is the mouse equivalent.
Drag a window more than halfway over a neighbor column and, after a short dwell, that column opens a gap at the slot your pointer is over — upper half of a tile stacks above it, lower half below it — and the gap follows the pointer live.
Drag a stacked tile more than halfway out of its column and it is previewed as a column of its own: its old column closes up and the neighbors slide over to make room, and from there it reorders and stacks exactly like any other column.
Releasing commits whatever is previewed; nothing about a stacked tile changes before you let go.
Implementation: [algorithms.md § Drag-to-Stack Hover Resolution](algorithms.md#drag-to-stack-hover-resolution) and
[`2026-09-18-drag-stack-phantom-design.md`](agents/specs/2026-09-18-drag-stack-phantom-design.md).
```

Keep the `<!-- MEDIA -->` block and heading as they are.

- [ ] **Step 3: Remove known bug 1**

Delete the `## 1. Windows expelled too early …` section from `docs/known_bugs.md`, leaving the header rules and entry 2 untouched (numbers are stable identifiers).

- [ ] **Step 4: Align the spec's Target model wording**

In the spec's "Target model" section, replace the first sentence with:
`The spec's three-way target is realized as the mode decision in drag.ts (standalone, home, phantom) over the pure helpers resolveStackTarget, resolveSlotFromPointer, and initialPhantomIndex in drag-hover.ts, rather than one resolveDragTarget function, because the phantom-aware neighbor rects depend on the mode chosen that tick.`

- [ ] **Step 5: Verify**

`make build`
Expected: lint, tests, and package assembly all PASS. Then `rg -n "top 25|top-25|expelDirectionForEdges|StackPreview" docs drift/src` returns nothing outside `docs/archive/` and the dated specs.

- [ ] **Step 6: Coding-guideline follow-up checklist**

- [ ] One sentence per line in every edited doc
- [ ] `make build` passes
- [ ] No convention violations left

---

## Self-Review

- **Spec coverage:** Target model → Tasks 4, 7. Resolution per tick (three modes, committed home basis, phantom stays open, pointer slot) → Task 7. Dwell and persistence → Task 7 (`settleStackTarget`, `setMode`), default → Task 8. Commit on release → Tasks 2, 6, 7. Rendering (`DragPreview`, `previewLayout`, shared `previewTileRects`, extracted insertion math) → Tasks 1, 3, 5. Superseded items → Tasks 4, 7, 8. Settings → Task 8. Testing → every task. Documentation → Task 9.
- **Placeholder scan:** none.
- **Type consistency:** `PhantomColumn { index; width }`, `LayoutSlot`, `PreviewLayout { slots; rects; virtualWidth }` (Task 1) are what Tasks 3, 5, 7 import; `DragPreview.entering` field names match `enteringFor` in Task 7; `expelTile` returns `{ toColumnId; toTileId }` as Task 6 consumes; `resolveStackTarget(draggedRect, pointerY, candidates, overlapFraction)` matches Tasks 4 and 7; `commitTileToStandalone(fromColumnId, fromTileId, index)` matches Tasks 6 and 7.
