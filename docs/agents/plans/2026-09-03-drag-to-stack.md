# Drag-to-Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a window onto another column's middle zone to stack them vertically (in either direction, into or out of an existing stack, or to reorder tiles within a stack), coexisting with the existing drag-to-reorder gesture.

**Architecture:** A new pure hover-resolution function decides, from the dragged window's live geometry, whether a drag tick is in a "stack zone" (middle 50% of a column's width) or a "reorder zone" (outer 25% each side). Stack-zone hovering drives a render-only live preview (`Column.previewRectsWithGapAt`/`previewRectsWithoutTile`) with exactly one real model mutation on release; reorder-zone hovering reuses today's existing live-commit reorder mechanism unchanged, gated off whenever a stack-zone hover is active. `registerDragReorder` stops closing over a fixed column id (a pre-existing bug once a window becomes a stacked tile) and instead resolves the dragged window's current column/tile fresh via `ColumnRegistry.tileOf` every tick, which is also what makes an already-stacked tile draggable at all.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing.

**Spec:** `docs/agents/specs/2026-09-03-drag-to-stack-design.md` — read before implementing.

---

## File Structure

- `src/core/column.ts` — gains `insertTileAt`, `moveTile`, `previewRectsWithGapAt`, `previewRectsWithoutTile`. `addTile` becomes a thin wrapper around `insertTileAt`.
- `src/core/grid.ts` — gains `columnAtVirtualX` (position→column lookup) and `moveTileIntoColumn` (general form of `absorbColumnRight`, for any source/target/slot).
- `src/input/drag-hover.ts` — **new file**. `resolveStackHover`, a pure function with no KWin dependency, deciding stack-zone-or-not from already-resolved geometry. Lives beside `drag.ts` (same feature area) but is independently unit-testable, per the design doc's explicit call to keep this pure and separate from KWin signal-wiring glue.
- `src/input/drag-hover.test.ts` — **new file**. Direct tests against real `Grid`/`Column` instances, no mocking needed.
- `src/input/drag.ts` — `registerDragReorder` stops taking a fixed `columnId`; resolves the window's current location via `registry.tileOf` every tick; wires in `resolveStackHover`; suppresses reorder-swap during a stack-hover; commits the stack operation on release.
- `src/runtime/strip.ts` — gains `commitTileIntoStack` (cross-column) and reuses `Column.moveTile` (same-column) as the two stack-commit paths; `render()` gains an optional stack-preview parameter; `addWindow` passes `registry` (not a fixed `columnId`) into `registerDragReorder`.

## Scope Check

This is one cohesive feature — all four drag directions (standalone→stack, stack→stack, stack→standalone, reorder-within-stack) share the single hover-resolution algorithm and commit-mapping table from the spec; there is no independent subsystem here to split into a separate plan.

---

### Task 1: `Column.insertTileAt` (generalizes `addTile`)

**Files:**
- Modify: `src/core/column.ts:80-92` (existing `addTile`)
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/column.test.ts`, inside the existing `describe('Column — tile stack', ...)` block:

```typescript
    it('insertTileAt inserts at an arbitrary index, splitting height evenly across the whole stack', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const newId = column.insertTileAt(0); // insert before the only existing tile
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.id)).toEqual([newId, firstId]);
        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]);
    });

    it('insertTileAt in the middle preserves the order of the tiles on either side', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        const middleId = column.insertTileAt(1);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, middleId, bottomId]);
        expect(column.tiles().map((t) => t.height)).toEqual([300, 300, 300]);
    });

    it('addTile is equivalent to insertTileAt at the end of the stack', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        expect(column.tiles().map((t) => t.id)).toEqual([firstId, secondId]);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- column.test.ts`
Expected: FAIL — `insertTileAt` does not exist yet (the third test passes already, since it exercises unchanged `addTile` behavior).

- [ ] **Step 3: Write the implementation**

Replace `addTile` in `src/core/column.ts:80-92` with:

```typescript
    /** Inserts a new tile at `index` (0 = top of the stack), shrinking existing tiles
     * proportionally to make room — the general form of `addTile`, which is now
     * `insertTileAt(tiles.length)`. Does not change which tile is focused. Returns
     * the new tile's id (docs: 2026-09-03-drag-to-stack-design). */
    insertTileAt(index: number): number {
        const totalHeight = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const evenHeight = totalHeight / (this.stack.length + 1);
        for (const tile of this.stack) {
            tile.height = evenHeight;
        }
        const id = this.nextTileId++;
        this.stack.splice(index, 0, { id, height: evenHeight });
        return id;
    }

    /** Appends a new tile at the bottom of the stack (absorb), splitting height evenly
     * across every tile including the new one. Does not change which tile is focused.
     * Returns the new tile's id. */
    addTile(): number {
        return this.insertTileAt(this.stack.length);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- column.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming: `camelCase` method, matches existing `Column` method style
- [ ] 4-space indent, single quotes, trailing commas, 120-char lines
- [ ] `npm test -- column.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `Column.moveTile` (same-stack reorder)

**Files:**
- Modify: `src/core/column.ts` (add after `insertTileAt`/`addTile`)
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/column.test.ts`:

```typescript
    it('moveTile reorders within the stack without touching any height', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        column.resizeTile(topId, 200, 'bottom'); // uneven heights: top=200, bottom=700

        column.moveTile(bottomId, 0); // move bottom to the top

        expect(column.tiles().map((t) => t.id)).toEqual([bottomId, topId]);
        expect(column.tiles().map((t) => t.height)).toEqual([700, 200]);
    });

    it('moveTile to the same index is a no-op', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        column.addTile();

        column.moveTile(firstId, 0);

        expect(column.tiles()[0].id).toBe(firstId);
    });

    it('moveTile throws on an unknown tile id', () => {
        const column = new Column(1, 300, 900);
        expect(() => column.moveTile(999, 0)).toThrow();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- column.test.ts`
Expected: FAIL — `moveTile` does not exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/core/column.ts`, after `addTile`:

```typescript
    /** Reorders a tile to `newIndex` within the stack, without touching any tile's
     * height — only its position (and therefore its derived y from `tileRect`)
     * changes. Used for drag-reordering within a single stack
     * (docs: 2026-09-03-drag-to-stack-design). */
    moveTile(id: number, newIndex: number): void {
        const index = this.requireTileIndex(id);
        const [tile] = this.stack.splice(index, 1);
        this.stack.splice(newIndex, 0, tile);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- column.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming/style matches existing `Column` methods
- [ ] `npm test -- column.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: `Column` preview helpers (`previewRectsWithGapAt`, `previewRectsWithoutTile`)

**Files:**
- Modify: `src/core/column.ts` (add after `tileRect`)
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/column.test.ts`:

```typescript
    it('previewRectsWithGapAt reserves gapHeight at index without mutating the column or resizing tiles', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // top=450, bottom=450
        const columnRect = { x: 100, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithGapAt(1, 200, columnRect); // gap between top and bottom

        expect(preview.get(topId)).toEqual({ x: 100, y: 0, width: 300, height: 450 });
        expect(preview.get(bottomId)).toEqual({ x: 100, y: 650, width: 300, height: 450 }); // shifted down by gapHeight
        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]); // unmutated
    });

    it('previewRectsWithGapAt at index 0 shifts every existing tile down', () => {
        const column = new Column(1, 300, 900);
        const onlyId = column.tiles()[0].id;
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithGapAt(0, 300, columnRect);

        expect(preview.get(onlyId)).toEqual({ x: 0, y: 300, width: 300, height: 900 });
    });

    it('previewRectsWithGapAt excludes excludeTileId from consideration entirely', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        // Same-stack reorder preview: move "top" to slot 1 (after bottom), excluding it from the base list.
        const preview = column.previewRectsWithGapAt(1, 450, columnRect, topId);

        expect(preview.has(topId)).toBe(false);
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 0, width: 300, height: 450 });
    });

    it('previewRectsWithoutTile closes the gap by shifting later tiles up, without redistributing height', () => {
        const column = new Column(1, 300, 900);
        const topId = column.tiles()[0].id;
        const middleId = column.addTile();
        const bottomId = column.addTile(); // three tiles, 300 each
        const columnRect = { x: 0, y: 0, width: 300, height: 900 };

        const preview = column.previewRectsWithoutTile(middleId, columnRect);

        expect(preview.has(middleId)).toBe(false);
        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 300, width: 300, height: 300 }); // shifted up
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- column.test.ts`
Expected: FAIL — neither method exists yet.

- [ ] **Step 3: Write the implementation**

Add to `src/core/column.ts`, after `tileRect`:

```typescript
    /** Preview-only: rects for every tile except `excludeTileId` (if given), as if a
     * new tile of `gapHeight` were being inserted at `index` — reserves that much
     * space and shifts everything from `index` on down, without mutating the column,
     * redistributing height, or touching any existing tile's own height. Used to
     * render a live drag-to-stack gap preview. The eventual committed insert
     * (`insertTileAt`) still evenly redistributes height across the whole stack, so a
     * cross-column drop can show a small one-time height jump on release — an
     * accepted, documented visual note, not solved here
     * (docs: 2026-09-03-drag-to-stack-design). */
    previewRectsWithGapAt(index: number, gapHeight: number, columnRect: Rect, excludeTileId?: number): Map<number, Rect> {
        const others = this.stack.filter((tile) => tile.id !== excludeTileId);
        const result = new Map<number, Rect>();
        let y = columnRect.y;
        let cursor = 0;
        for (let slot = 0; slot <= others.length; slot++) {
            if (slot === index) {
                y += gapHeight;
                continue;
            }
            const tile = others[cursor++];
            result.set(tile.id, { x: columnRect.x, y, width: columnRect.width, height: tile.height });
            y += tile.height;
        }
        return result;
    }

    /** Preview-only: rects for every tile except `excludeTileId`, as if it had already
     * been removed and the rest simply shifted up to close the gap it left — without
     * mutating the column, redistributing height, or touching any remaining tile's
     * own height. The eventual committed removal (`removeTile`) still redistributes
     * height proportionally, so this can show a small one-time height jump on
     * release too — same accepted trade-off as `previewRectsWithGapAt`
     * (docs: 2026-09-03-drag-to-stack-design). */
    previewRectsWithoutTile(excludeTileId: number, columnRect: Rect): Map<number, Rect> {
        const result = new Map<number, Rect>();
        let y = columnRect.y;
        for (const tile of this.stack) {
            if (tile.id === excludeTileId) {
                continue;
            }
            result.set(tile.id, { x: columnRect.x, y, width: columnRect.width, height: tile.height });
            y += tile.height;
        }
        return result;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- column.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] 120-char line limit respected (wrap the `previewRectsWithGapAt` signature if needed)
- [ ] `npm test -- column.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: `Grid.columnAtVirtualX` (position→column lookup)

**Files:**
- Modify: `src/core/grid.ts` (add after `columnRect`)
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts` (create a new `describe` block near the other column-rect/insertion-index tests):

```typescript
describe('Grid — columnAtVirtualX', () => {
    it('returns the column whose span contains virtualX', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300); // 0..300
        const b = grid.addColumn(300); // 300..600

        expect(grid.columnAtVirtualX(150)).toBe(a.id);
        expect(grid.columnAtVirtualX(450)).toBe(b.id);
    });

    it('clamps to the first column for virtualX before the strip', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        grid.addColumn(300);

        expect(grid.columnAtVirtualX(-500)).toBe(a.id);
    });

    it('clamps to the last visible column for virtualX past the strip', () => {
        const grid = new Grid(1000, 0);
        grid.addColumn(300);
        const b = grid.addColumn(300);

        expect(grid.columnAtVirtualX(9999)).toBe(b.id);
    });

    it('skips hidden columns', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300); // 0..300
        const hidden = grid.addColumn(300); // 1px slot at 300
        const c = grid.addColumn(300);
        grid.hideColumn(hidden.id);

        expect(grid.columnAtVirtualX(150)).toBe(a.id);
        expect(grid.columnAtVirtualX(305)).toBe(c.id); // past the 1px hidden slot, lands in c
    });

    it('returns null for an empty grid', () => {
        const grid = new Grid(1000, 0);
        expect(grid.columnAtVirtualX(0)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- grid.test.ts`
Expected: FAIL — `columnAtVirtualX` does not exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/core/grid.ts`, after `columnRect`:

```typescript
    /** Id of whichever column's horizontal span currently contains `virtualX` — used
     * to resolve a live drag's hover target. Clamped to the first/last visible column
     * when `virtualX` falls entirely outside the strip's content extent. Null only
     * when the grid has no visible columns at all
     * (docs: 2026-09-03-drag-to-stack-design). */
    columnAtVirtualX(virtualX: number): number | null {
        const offsets = this.layoutOffsets();
        const widths = this.layoutWidths();
        let lastVisible: Column | null = null;
        for (let i = 0; i < this.ordered.length; i++) {
            if (this.ordered[i].hidden) {
                continue;
            }
            lastVisible = this.ordered[i];
            if (virtualX < offsets[i] + widths[i]) {
                return this.ordered[i].id;
            }
        }
        return lastVisible ? lastVisible.id : null;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- grid.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Method placed with the rest of `Grid`'s public API, style matches neighbors
- [ ] `npm test -- grid.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: `Grid.moveTileIntoColumn` (general cross-column absorb)

**Files:**
- Modify: `src/core/grid.ts` (add after `absorbColumnRight`)
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts`:

```typescript
describe('Grid — moveTileIntoColumn', () => {
    it('moves a standalone column\'s tile into another column, removing the now-empty source column', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const aTileId = a.tiles()[0].id;

        const newTileId = grid.moveTileIntoColumn(a.id, aTileId, b.id, 0);

        expect(grid.columns().map((c) => c.id)).toEqual([b.id]); // a was removed entirely
        expect(b.tiles().map((t) => t.id)).toEqual([newTileId, b.tiles()[1].id]);
        expect(b.tileCount()).toBe(2);
    });

    it('moves one tile out of a multi-tile source column, leaving the rest', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const aTopId = a.tiles()[0].id;
        const aBottomId = a.addTile(); // a now has 2 tiles

        grid.moveTileIntoColumn(a.id, aBottomId, b.id, 1);

        expect(grid.columns().map((c) => c.id)).toEqual([a.id, b.id]); // a still exists
        expect(a.tiles().map((t) => t.id)).toEqual([aTopId]);
        expect(a.tiles()[0].height).toBe(1000); // redistributed to full height
        expect(b.tileCount()).toBe(2);
    });

    it('inserts at the requested slot within the target column', () => {
        const grid = new Grid(1000, 0);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const bTopId = b.tiles()[0].id;
        const aTileId = a.tiles()[0].id;

        const newTileId = grid.moveTileIntoColumn(a.id, aTileId, b.id, 0); // insert above b's existing tile

        expect(b.tiles().map((t) => t.id)).toEqual([newTileId, bTopId]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- grid.test.ts`
Expected: FAIL — `moveTileIntoColumn` does not exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/core/grid.ts`, after `absorbColumnRight`:

```typescript
    /** Removes `fromTileId` from `fromColumnId` (deleting that column entirely if it
     * was its only tile) and inserts it as a new tile at `slot` in `toColumnId` — the
     * general form of `absorbColumnRight`, for any source/target pair and slot,
     * driven by a live drag rather than a fixed keyboard shortcut. `fromColumnId` and
     * `toColumnId` must differ — same-column reordering uses `Column.moveTile`
     * directly instead, which preserves the tile's own identity and height
     * (docs: 2026-09-03-drag-to-stack-design). Returns the new tile's id. */
    moveTileIntoColumn(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): number {
        const fromColumn = this.requireColumn(fromColumnId);
        if (fromColumn.tileCount() === 1) {
            this.removeColumn(fromColumnId);
        } else {
            fromColumn.removeTile(fromTileId);
        }
        const toColumn = this.requireColumn(toColumnId);
        return toColumn.insertTileAt(slot);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- grid.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Style matches `absorbColumnRight`/`expelFocusedTile` immediately above it
- [ ] `npm test -- grid.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 6: `resolveStackHover` — pure hover-resolution function

**Files:**
- Create: `src/input/drag-hover.ts`
- Test: `src/input/drag-hover.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/input/drag-hover.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import { resolveStackHover } from './drag-hover';

describe('resolveStackHover', () => {
    it('returns null in the outer 25% of a column (reorder zone)', () => {
        const grid = new Grid(1000, 0);
        const target = grid.addColumn(300); // 0..300
        const dragged = grid.addColumn(300); // 300..600, this is the "dragged" column

        // virtualXCenter = 30 -> local fraction 0.1, well inside the left outer band
        expect(resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 30, 500)).toBeNull();
    });

    it('returns the target column and a slot in the middle 50% of a column (stack zone)', () => {
        const grid = new Grid(1000, 0);
        const target = grid.addColumn(300); // 0..300
        const dragged = grid.addColumn(300);

        // virtualXCenter = 150 -> local fraction 0.5, dead center
        const hover = resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 150, 500);

        expect(hover).not.toBeNull();
        expect(hover?.columnId).toBe(target.id);
    });

    it('resolves the slot from vertical position among the target column\'s tiles', () => {
        const grid = new Grid(1000, 0);
        const target = grid.addColumn(300);
        target.addTile(); // target now has 2 tiles, each 500 tall: [0..500), [500..1000)
        const dragged = grid.addColumn(300);

        const topHover = resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 150, 100);
        expect(topHover?.slot).toBe(0); // above the first tile's midpoint (250)

        const bottomHover = resolveStackHover(grid, dragged.id, dragged.tiles()[0].id, 150, 900);
        expect(bottomHover?.slot).toBe(2); // below every tile's midpoint -> append at bottom
    });

    it('excludes the dragged tile from its own column\'s slot computation', () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // [topId 0..500), [bottomId 500..1000)

        // Dragging bottomId within its own column, hovering near the top (y=100).
        const hover = resolveStackHover(grid, column.id, bottomId, 150, 100);

        expect(hover?.columnId).toBe(column.id);
        expect(hover?.slot).toBe(0); // topId is the only "other" tile, and its midpoint (250) is below yCenter
    });

    it('returns null for an empty grid', () => {
        const grid = new Grid(1000, 0);
        expect(resolveStackHover(grid, 1, 1, 0, 0)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- drag-hover.test.ts`
Expected: FAIL — `src/input/drag-hover.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/input/drag-hover.ts`:

```typescript
// Pure geometry decision for a live drag: is the dragged tile currently hovering a
// "stack zone" (the middle half of some column's width), and if so, which vertical
// slot within that column's tile stack would it land in? No KWin dependency — takes
// only already-resolved virtual-x/real-y geometry, so it's directly unit-testable
// without mocking any signal wiring (docs: 2026-09-03-drag-to-stack-design).

import { Grid } from '../core/grid';

export interface StackHover {
    columnId: number;
    slot: number;
}

/** `excludeColumnId`/`excludeTileId` identify the dragged tile itself, so hovering
 * its own current column excludes it from the slot computation rather than treating
 * it as a foreign tile to insert relative to. Returns null when the drag is in a
 * "reorder zone" (outer quarter of a column on either side) — ordinary column-reorder
 * logic applies instead — or when the grid has no visible columns at all. */
export function resolveStackHover(
    grid: Grid,
    excludeColumnId: number,
    excludeTileId: number,
    virtualXCenter: number,
    yCenter: number,
): StackHover | null {
    const targetColumnId = grid.columnAtVirtualX(virtualXCenter);
    if (targetColumnId === null) {
        return null;
    }
    const rect = grid.columnRect(targetColumnId);
    const localFraction = (virtualXCenter - rect.x) / rect.width;
    if (localFraction < 0.25 || localFraction > 0.75) {
        return null;
    }
    const targetColumn = grid.column(targetColumnId);
    if (targetColumn === null) {
        return null;
    }
    const sameColumn = targetColumnId === excludeColumnId;
    const others = targetColumn.tiles().filter((tile) => !sameColumn || tile.id !== excludeTileId);
    let y = 0;
    for (let i = 0; i < others.length; i++) {
        if (yCenter < y + others[i].height / 2) {
            return { columnId: targetColumnId, slot: i };
        }
        y += others[i].height;
    }
    return { columnId: targetColumnId, slot: others.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- drag-hover.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] File header comment matches the project's file-comment style (see `src/input/drag.ts:1-5`)
- [ ] Lowercase kebab-case filename (`drag-hover.ts`), explicit imports, no default export
- [ ] `npm test -- drag-hover.test.ts` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 7: `Strip` stack-commit methods and `render()` preview support

**Files:**
- Modify: `src/runtime/strip.ts:96-174` (`render`), and add new methods near `absorbRight`/`expel` (`src/runtime/strip.ts:411-442`)
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip.test.ts`, a new `describe` block after the existing `describe('Strip — absorb/expel', ...)` block:

```typescript
describe('Strip — commitTileIntoStack', () => {
    it('moves a standalone column\'s window into another column as a new tile, removing the source column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        const leftLocation = strip.locationOf('left')!;
        const rightLocation = strip.locationOf('right')!;

        strip.commitTileIntoStack(leftLocation.columnId, leftLocation.tileId, rightLocation.columnId, 0);
        strip.render();

        expect(strip.locationOf('left')!.columnId).toBe(rightLocation.columnId); // left now shares right's column
        const rightCalls = right.setFrameGeometry.mock.calls;
        const rightRect = rightCalls[rightCalls.length - 1][0];
        expect(rightRect.height).toBeLessThan(AREA.height); // now sharing the column
    });

    it('does not disturb the target column\'s other tiles beyond the requested slot', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a');
        const b = fakeWindow('b');
        const c = fakeWindow('c');
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column: [a, b]
        strip.addWindow(c.adapter);
        const stackColumnId = strip.locationOf('a')!.columnId;
        const cLocation = strip.locationOf('c')!;

        strip.commitTileIntoStack(cLocation.columnId, cLocation.tileId, stackColumnId, 0);
        strip.render();

        expect(strip.locationOf('a')!.columnId).toBe(stackColumnId);
        expect(strip.locationOf('b')!.columnId).toBe(stackColumnId);
        expect(strip.locationOf('c')!.columnId).toBe(stackColumnId);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test -- strip.test.ts`
Expected: FAIL — `commitTileIntoStack` and `locationOf` do not exist yet.

- [ ] **Step 3: Write the implementation**

Add a `locationOf` accessor and `commitTileIntoStack` to `src/runtime/strip.ts`, near `snapColumn` (`src/runtime/strip.ts:179-181`):

```typescript
    /** Which (column, tile) a window is currently registered under — used by drag
     * wiring to resolve the dragged window's live location on every tick instead of
     * a fixed id captured once (docs: 2026-09-03-drag-to-stack-design). */
    locationOf(windowId: string): { columnId: number; tileId: number } | null {
        return this.registry.tileOf(windowId);
    }
```

Then add, near `absorbRight`/`expel` (`src/runtime/strip.ts:411-442`):

```typescript
    /** Moves `fromTileId` out of `fromColumnId` and into `toColumnId` at `slot` —
     * the general, drag-driven form of `absorbRight`, for any source/target pair.
     * `fromColumnId` must differ from `toColumnId`; same-column reordering goes
     * through `Column.moveTile` directly (see drag.ts), which needs no registry or
     * bookkeeping changes at all (docs: 2026-09-03-drag-to-stack-design). */
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void {
        const toTileId = this.grid.moveTileIntoColumn(fromColumnId, fromTileId, toColumnId, slot);
        this.registry.moveWindow(fromColumnId, fromTileId, toColumnId, toTileId);
        this.fullScreenTiles.delete(this.tileKey(fromColumnId, fromTileId));
        this.minimizedTiles.delete(this.tileKey(fromColumnId, fromTileId));
        this.columnMotion.forget(fromColumnId);
    }
```

Now add stack-preview support to `render()`. Replace the signature and the per-column tile-rect lookup in `src/runtime/strip.ts:96-174`:

```typescript
    /** Optional live-drag stack preview: which tile rects to compute from a
     * hypothetical layout instead of the committed one. `enteringColumnId`/
     * `enteringIndex`/`enteringGapHeight` describe the column opening a gap for the
     * dragged tile; `leavingColumnId` (only set for a cross-column drag whose source
     * is itself a multi-tile stack) describes the column closing the gap the dragged
     * tile is leaving. The dragged tile's own window keeps being excluded from
     * geometry sync via `excludeWindowId`, unchanged (docs: 2026-09-03-drag-to-stack-design). */
    render(
        excludeWindowId?: string,
        instant = false,
        verticalOffsetY?: number,
        stackPreview?: {
            enteringColumnId: number;
            enteringIndex: number;
            enteringGapHeight: number;
            enteringExcludeTileId?: number;
            leavingColumnId?: number;
            leavingTileId?: number;
        },
    ): void {
```

Inside the visible-column branch (the loop that computes `x` via `columnMotion` and then iterates `column.tiles()`), add a preview-rect lookup right before that inner `for (const tile of column.tiles())` loop:

```typescript
            const previewRects =
                stackPreview && column.id === stackPreview.enteringColumnId
                    ? column.previewRectsWithGapAt(
                          stackPreview.enteringIndex,
                          stackPreview.enteringGapHeight,
                          columnRect,
                          stackPreview.enteringExcludeTileId,
                      )
                    : stackPreview && column.id === stackPreview.leavingColumnId
                      ? column.previewRectsWithoutTile(stackPreview.leavingTileId!, columnRect)
                      : null;
```

Then, inside that inner loop, replace `const rect = column.tileRect(tile.id, columnRect);` with:

```typescript
                const rect = previewRects?.get(tile.id) ?? column.tileRect(tile.id, columnRect);
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test -- strip.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `render()`'s new parameter stays under the 120-char line limit (wrap as shown)
- [ ] `npm test -- strip.test.ts` passing, and `npm test` (full suite) passing — `render()`'s signature change is source-compatible (new param is optional and last) but re-run everything to be sure no caller broke
- [ ] Any convention violations fixed before moving to next task

---

### Task 8: `registerDragReorder` — tile-aware wiring, stack preview, and commit-on-release

**Files:**
- Modify: `src/input/drag.ts` (full rewrite of the reorder/stack logic inside `registerDragReorder`)
- Modify: `src/runtime/strip.ts:213-255` (`addWindow`, the `registerDragReorder` call site)

This task is glue code wiring together Tasks 1–7 to real KWin signals — consistent with the rest of `src/input/`/`src/kwin/`, it stays outside the TDD test-first cycle (per the precedent set in `docs/agents/specs/2026-08-31-drag-reorder-live-preview-design.md`'s own Testing section, and reaffirmed in `docs/agents/specs/2026-09-03-drag-to-stack-design.md`'s Testing section). The pure decision logic it calls (`resolveStackHover`, the `Column`/`Grid` primitives) is already fully covered by Tasks 1–6.

- [ ] **Step 1: Rewrite `src/input/drag.ts`**

Replace the full contents of `src/input/drag.ts` with:

```typescript
// Turns a window's interactive-move lifecycle into a live column reorder or a live
// drag-to-stack, deciding per tick between the two via `resolveStackHover` (docs:
// 2026-09-03-drag-to-stack-design). Reorder mode is unchanged from the original
// design (docs §2.1.7): as the window's own leading edge crosses a neighbor's
// center, its neighbors slide out of the way, committed live every tick. Stack mode
// is render-only until release: the target (and, for a cross-column drag out of an
// existing stack, the source) column's tiles preview-reflow to open/close a gap,
// with exactly one real model mutation on `interactiveMoveResizeFinished`. The
// window's own real geometry is never touched while dragging in either mode — it
// keeps following the cursor untouched throughout.

import { Column } from '../core/column';
import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { Viewport } from '../viewport/viewport';
import { resolveStackHover, StackHover } from './drag-hover';

/** Minimal view of `ColumnRegistry` this module needs — resolving the dragged
 * window's CURRENT column/tile fresh on every tick, rather than closing over a
 * fixed id captured once at connection time. That fixed-id approach was the
 * pre-existing bug: a window that became a stacked tile via `absorbRight` kept a
 * stale connection pointing at its original, since-removed column id, so dragging
 * an already-stacked tile's title bar never worked correctly
 * (docs: 2026-09-03-drag-to-stack-design). */
export interface DragRegistryView {
    tileOf(windowId: string): { columnId: number; tileId: number } | null;
    moveWindow(fromColumnId: number, fromTileId: number, toColumnId: number, toTileId: number): void;
}

export interface DragReorderDeps {
    grid: Grid;
    registry: DragRegistryView;
    viewport: Viewport;
    area: Rect;
    render(
        excludeWindowId?: string,
        instant?: boolean,
        verticalOffsetY?: undefined,
        stackPreview?: {
            enteringColumnId: number;
            enteringIndex: number;
            enteringGapHeight: number;
            enteringExcludeTileId?: number;
            leavingColumnId?: number;
            leavingTileId?: number;
        },
    ): void;
    snapColumn(columnId: number): void;
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void;
    /** Row-crossing hooks (docs: 2026-09-02-cross-row-drag-design) — StripStack supplies
     * these to watch the pointer's vertical position on every drag tick without a second,
     * independent signal connection on the same window. All optional; omitted when not
     * row-aware (e.g. a Strip used outside a StripStack). */
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
    /** Called once, after the dragged column has settled into its final grid slot on
     * release — scrolls it back into view if a reorder near the strip's edge pushed that
     * slot (partially) outside the viewport. Never called mid-drag: doing so would fight
     * the live KWin interactive move (same rationale as skipping reveal on a mid-drag add,
     * see `Strip.addWindow`). */
    revealFocused(): void;
}

/** Virtual x of `win`'s own left and right edges — the anchors used to decide
 * whether it has crossed into a neighbor's territory, so the vote reflects the
 * dragged window itself rather than wherever the cursor happened to grab it. */
function windowEdgesVirtualX(win: WindowAdapter, area: Rect, viewportOffsetX: number): { left: number; right: number } {
    const rect = win.frameGeometry();
    return {
        left: toVirtualX(rect.x, area, viewportOffsetX),
        right: toVirtualX(rect.x + rect.width, area, viewportOffsetX),
    };
}

/** Virtual x of `win`'s own center, and its real y-center relative to `area` — the
 * anchor stack-hover resolution uses, since a column/tile's own middle-zone/slot
 * detection is naturally center-based rather than edge-based
 * (docs: 2026-09-03-drag-to-stack-design). */
function windowCenter(win: WindowAdapter, area: Rect, viewportOffsetX: number): { virtualX: number; y: number } {
    const rect = win.frameGeometry();
    return {
        virtualX: toVirtualX(rect.x + rect.width / 2, area, viewportOffsetX),
        y: rect.y + rect.height / 2 - area.y,
    };
}

/** Wires `win`'s move lifecycle to reorder or stack live, and to settle it on
 * release. `initiallyDragging` seeds the local dragging state for a connection
 * created mid-drag — e.g. when a cross-row move reparents the window into a new
 * row's Strip while the user is still holding the drag (docs:
 * 2026-09-02-cross-row-drag-design): the new connection never sees
 * `interactiveMoveResizeStarted`, since it already fired once on the connection this
 * one replaces. Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, deps: DragReorderDeps, initiallyDragging = false): () => void {
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        if (dragging) {
            deps.onDragStarted?.(win);
        }
    });

    /** Current column/tile the dragged window is registered under. Null only if the
     * window has already been removed from the registry mid-drag (e.g. it closed). */
    const currentLocation = (): { columnId: number; tileId: number } | null => deps.registry.tileOf(win.id);

    /** Reorders `columnId` to swap with its current left or right neighbor if the
     * window's own edge has crossed that neighbor's center. Returns whether the
     * order actually changed. Unchanged from the original reorder design, called
     * only when `resolveStackHover` says this tick is NOT in a stack zone. */
    const reorderToCurrentPosition = (columnId: number): boolean => {
        const { left, right } = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const targetIndex = deps.grid.insertionIndexForEdges(columnId, left, right);
        if (targetIndex === deps.grid.indexOf(columnId)) {
            return false;
        }
        deps.grid.moveColumn(columnId, targetIndex);
        return true;
    };

    /** Expels a stack tile into its own standalone column the first time a drag
     * carries it from a stack zone into a reorder zone — the existing edge-crossing
     * reorder mechanism above requires the dragged window to already own a real,
     * standalone Grid column, which a stack tile does not. Placement doesn't need to
     * be exact here: `reorderToCurrentPosition` converges it over the next tick or
     * two, the same way a mid-drag row-reparent already tolerates a short
     * convergence window (docs: 2026-09-03-drag-to-stack-design). */
    const expelToStandaloneColumn = (columnId: number, tileId: number): number => {
        const column = deps.grid.column(columnId) as Column;
        column.removeTile(tileId);
        const newColumn = deps.grid.addColumn(win.frameGeometry().width);
        deps.registry.moveWindow(columnId, tileId, newColumn.id, newColumn.tiles()[0].id);
        return newColumn.id;
    };

    const tick = (): void => {
        const location = currentLocation();
        if (location === null) {
            return;
        }
        const center = windowCenter(win, deps.area, deps.viewport.offset());
        const hover = resolveStackHover(deps.grid, location.columnId, location.tileId, center.virtualX, center.y);

        if (hover === null) {
            // Reorder zone. A currently-stacked tile must first become standalone.
            const homeColumn = deps.grid.column(location.columnId) as Column;
            const columnId = homeColumn.tileCount() === 1 ? location.columnId : expelToStandaloneColumn(location.columnId, location.tileId);
            lastStackHover = null;
            if (reorderToCurrentPosition(columnId)) {
                deps.render(win.id, false);
            }
            return;
        }

        // Stack zone: preview only, nothing committed until release.
        lastStackHover = hover;
        const sameColumn = hover.columnId === location.columnId;
        const gapHeight = win.frameGeometry().height;
        if (sameColumn) {
            deps.render(win.id, false, undefined, {
                enteringColumnId: hover.columnId,
                enteringIndex: hover.slot,
                enteringGapHeight: gapHeight,
                enteringExcludeTileId: location.tileId,
            });
            return;
        }
        const homeColumn = deps.grid.column(location.columnId) as Column;
        deps.render(win.id, false, undefined, {
            enteringColumnId: hover.columnId,
            enteringIndex: hover.slot,
            enteringGapHeight: gapHeight,
            leavingColumnId: homeColumn.tileCount() > 1 ? location.columnId : undefined,
            leavingTileId: homeColumn.tileCount() > 1 ? location.tileId : undefined,
        });
    };

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        deps.onDragTick?.(win);
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        const location = currentLocation();
        if (location === null) {
            deps.onDragFinished?.();
            return;
        }
        if (lastStackHover === null) {
            const homeColumn = deps.grid.column(location.columnId) as Column;
            const columnId = homeColumn.tileCount() === 1 ? location.columnId : expelToStandaloneColumn(location.columnId, location.tileId);
            reorderToCurrentPosition(columnId);
            deps.snapColumn(columnId);
        } else if (lastStackHover.columnId === location.columnId) {
            (deps.grid.column(location.columnId) as Column).moveTile(location.tileId, lastStackHover.slot);
        } else {
            deps.commitTileIntoStack(location.columnId, location.tileId, lastStackHover.columnId, lastStackHover.slot);
        }
        lastStackHover = null;
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
    };
}
```

- [ ] **Step 2: Update `Strip.addWindow`'s `registerDragReorder` call site**

In `src/runtime/strip.ts:213-255`, `registerDragReorder` is currently called with `(win, column.id, deps, initiallyDragging)`. Replace that call (and the surrounding `Object.assign` deps literal) with:

```typescript
        signals.add(
            registerDragReorder(
                win,
                Object.assign(
                    {
                        grid: this.grid,
                        registry: this.registry,
                        viewport: this.viewport,
                        area: this.area,
                        render: (excludeWindowId?: string, instant?: boolean, verticalOffsetY?: undefined, stackPreview?: Parameters<Strip['render']>[3]) =>
                            this.render(excludeWindowId, instant, verticalOffsetY, stackPreview),
                        snapColumn: (id: number) => this.snapColumn(id),
                        commitTileIntoStack: (fromColumnId: number, fromTileId: number, toColumnId: number, slot: number) =>
                            this.commitTileIntoStack(fromColumnId, fromTileId, toColumnId, slot),
                        revealFocused: () => this.revealFocused(),
                    },
                    rowDragHooks,
                ),
                initiallyDragging,
            ),
        );
```

Remove the now-unused `column.id` positional argument entirely — `registerDragReorder`'s new signature no longer takes a column id, resolving it fresh via `registry.tileOf(win.id)` on every tick instead (this is the fix for the stale-column-id bug).

Add the new import at the top of `src/runtime/strip.ts`, alongside the existing `registerDragReorder` import:

```typescript
import { DragReorderDeps } from '../input/drag';
```

(Only needed if not already imported as a type for the `Parameters<...>` reference above — check the existing import line for `registerDragReorder` and extend it rather than duplicating.)

- [ ] **Step 3: Run the full test suite**

`npm test`
Expected: PASS — Tasks 1–7's tests still pass; `drag.ts` itself has no direct tests (glue, per the established precedent), but nothing it calls should have regressed.

- [ ] **Step 4: Run lint**

`npm run lint`
Expected: PASS — in particular `qmllint` is unaffected (no QML touched), and TypeScript strict-mode checking accepts the new types.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` functions/parameters, `PascalCase` types/interfaces, 4-space indent, 120-char lines
- [ ] KWin API access stays isolated to `WindowAdapter`/`Viewport` calls already used by the original file — no new direct KWin globals introduced
- [ ] `npm test` and `npm run lint` both passing
- [ ] Any convention violations fixed before moving to next task

---

## Self-Review Notes (already applied above)

- **Spec coverage:** every section of `docs/agents/specs/2026-09-03-drag-to-stack-design.md` maps to a task — hover resolution (Task 6), core API additions (Tasks 1, 2, 4, 5), preview rendering (Tasks 3, 7), wiring/stale-id fix (Task 8), commit mapping (Tasks 5, 7, 8 together cover all four table rows: standalone→standalone via unchanged `reorderToCurrentPosition`, standalone→stack and stack→other-stack via `commitTileIntoStack`, stack→standalone via `expelToStandaloneColumn`, same-stack via `Column.moveTile`).
- **Type consistency:** `StackHover` (Task 6) is the single shape threaded through `drag.ts`'s `lastStackHover`; `commitTileIntoStack`'s parameter order (`fromColumnId, fromTileId, toColumnId, slot`) matches `Grid.moveTileIntoColumn`'s exactly, so no adapter/reshaping code is needed between them.
- **No placeholders:** every step above shows complete, compiling code — nothing marked TBD or "similar to above."

## Execution Handoff

Plan complete and saved to `docs/agents/plans/2026-09-03-drag-to-stack.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
