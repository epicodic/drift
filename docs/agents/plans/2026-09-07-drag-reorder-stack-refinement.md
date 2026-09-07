# Drag Reorder/Stack Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reorder firing too eagerly and stack-slot landing imprecision by (1) generalizing `Grid.insertionIndexForEdges` to fire near a swap's final position instead of at the neighbor's center, and (2) replacing the pointer-driven, continuous-midpoint-walk stack-slot resolution with one window-geometry-based overlap+direction-band algorithm shared identically by same-column and cross-column drags.

**Architecture:** `Grid.insertionIndexForEdges` gains a `thresholdFraction` parameter generalizing its old implicit 50% center-crossing check. `resolveStackSlot` (`src/input/drag-hover.ts`) is replaced by two pure functions — `resolveStackTarget` (rect-overlap + top-edge-band, no pointer, no `Grid` dependency at all) and `stackTargetIndex` (translates the resolved target into a tile-list index) — used identically whether the candidate tile is a sibling in the dragged tile's own column or a tile in an immediate neighbor. `src/input/drag.ts` gathers candidates from `Grid`/`Column` each tick (home column's siblings plus both immediate neighbors' tiles, via a new `Grid.visibleNeighborColumnIds`), replacing the old pointer-based "home territory vs. neighbor" branching entirely. The existing dwell mechanism (`EdgeDwell<T>`) is reused unchanged, now keyed on a compound `columnId:tileId:direction` string instead of a bare neighbor column id, and applied uniformly to same-column drags (which had no dwell before).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design doc:** `docs/agents/specs/2026-09-07-drag-reorder-stack-refinement-design.md`

---

## Task 1: `Grid` — parameterize the reorder threshold, add a neighbor-ids lookup

**Files:**
- Modify: `src/core/grid.ts`
- Modify: `src/core/grid.test.ts`

- [ ] **Step 1: Update existing `insertionIndexForEdges` tests to pass an explicit threshold, add new threshold-fraction tests, delete the now-superseded `columnAtVirtualX` tests**

In `src/core/grid.test.ts`, update the four existing `insertionIndexForEdges` calls in the `'Grid — insertion index for drag edges'` block to pass `0.5` as a fourth argument (reproducing today's exact center-crossing behavior), and the two calls in `'Grid — insertion index skips hidden columns'`:

```typescript
describe('Grid — insertion index for drag edges', () => {
    it('returns its own index when the dragged column is the only column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.insertionIndexForEdges(a.id, -999, 999, 0.5)).toBe(0);
    });

    it("swaps with the right neighbor once the dragged window's right edge crosses its center", () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300), center 150
        const b = grid.addColumn(500); // b (dragged): [310,810)
        grid.addColumn(200); // c: [820,1020), center 920
        // left edge stays well short of a's center throughout (b is 500 wide), so
        // only the right edge crossing c's center matters here.
        expect(grid.insertionIndexForEdges(b.id, 400, 900, 0.5)).toBe(1); // short of c's center -> stays put
        expect(grid.insertionIndexForEdges(b.id, 420, 920, 0.5)).toBe(1); // exactly at the center -> not yet crossed
        expect(grid.insertionIndexForEdges(b.id, 430, 930, 0.5)).toBe(2); // past c's center -> swap with c
    });

    it("swaps with the left neighbor once the dragged window's left edge crosses its center", () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300), center 150
        const b = grid.addColumn(500); // b (dragged): [310,810)
        grid.addColumn(200); // c: [820,1020)
        // right edge stays well short of c's center throughout (b is 500 wide), so
        // only the left edge crossing a's center matters here.
        expect(grid.insertionIndexForEdges(b.id, 160, 660, 0.5)).toBe(1); // short of a's center -> stays put
        expect(grid.insertionIndexForEdges(b.id, 150, 650, 0.5)).toBe(1); // exactly at the center -> not yet crossed
        expect(grid.insertionIndexForEdges(b.id, 140, 640, 0.5)).toBe(0); // past a's center -> swap with a
    });

    it('combines with moveColumn to reorder based on a drop position', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a
        const b = grid.addColumn(500); // b: [310,810), center 560
        const c = grid.addColumn(200); // c (dragged): [820,1020), immediate left neighbor is b
        const targetIndex = grid.insertionIndexForEdges(c.id, 500, 999, 0.5); // left edge past b's center (560)
        grid.moveColumn(c.id, targetIndex);
        expect(grid.columns().map((col) => col.id)).toEqual([1, 3, 2]);
        expect(grid.columnRect(c.id).x).toBe(310); // c moved into b's old slot
        expect(grid.columnRect(b.id).x).toBe(520); // b shifted right to make room for c
    });

    it('fires later than center-crossing with a higher threshold fraction (near-final-position)', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300), width 300
        const b = grid.addColumn(500); // b (dragged): [310,810)
        grid.addColumn(200); // c: [820,1020), width 200, 85% threshold at 820 + 200*0.85 = 990
        expect(grid.insertionIndexForEdges(b.id, 400, 920, 0.85)).toBe(1); // past center (920) but short of 85% -> stays put
        expect(grid.insertionIndexForEdges(b.id, 400, 991, 0.85)).toBe(2); // past 85% -> swap with c
    });

    it('fires later than center-crossing on the left side too, symmetrically', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: [0,300), width 300, 85% threshold (from the right) at 0 + 300*(1-0.85) = 45
        const b = grid.addColumn(500); // b (dragged): [310,810)
        grid.addColumn(200); // c: [820,1020)
        expect(grid.insertionIndexForEdges(b.id, 150, 650, 0.85)).toBe(1); // past center (150) but short of the 85% depth -> stays put
        expect(grid.insertionIndexForEdges(b.id, 44, 544, 0.85)).toBe(0); // past the 85% depth -> swap with a
    });
});

describe('Grid — insertion index skips hidden columns', () => {
    it('skips a hidden neighbor and swaps with the next visible one instead', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300); // a: visible, [0,300), center 150
        const b = grid.addColumn(500); // hidden — contributes no space
        const c = grid.addColumn(200); // c (dragged)
        grid.hideColumn(b.id);
        // with b hidden, c's only visible left neighbor is a.
        expect(grid.insertionIndexForEdges(c.id, 160, 999, 0.5)).toBe(2); // short of a's center -> stays put (own index)
        expect(grid.insertionIndexForEdges(c.id, 140, 999, 0.5)).toBe(0); // past a's center -> swap with a
    });
});
```

Delete the entire `describe('Grid — columnAtVirtualX', ...)` block (superseded — `columnAtVirtualX` has no remaining caller once `src/input/drag.ts` stops using pointer position to find a stack target; see Task 5).

Add a new test block for the new neighbor-ids lookup:

```typescript
describe('Grid — visibleNeighborColumnIds', () => {
    it('returns both neighbor ids for a column in the middle', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const c = grid.addColumn(300);
        expect(grid.visibleNeighborColumnIds(b.id)).toEqual([a.id, c.id]);
    });

    it('returns only the right neighbor for the first column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        expect(grid.visibleNeighborColumnIds(a.id)).toEqual([b.id]);
    });

    it('returns only the left neighbor for the last column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        expect(grid.visibleNeighborColumnIds(b.id)).toEqual([a.id]);
    });

    it('returns an empty array for the only column', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        expect(grid.visibleNeighborColumnIds(a.id)).toEqual([]);
    });

    it('skips a hidden neighbor', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(300);
        const c = grid.addColumn(300);
        grid.hideColumn(b.id);
        expect(grid.visibleNeighborColumnIds(a.id)).toEqual([c.id]);
        expect(grid.visibleNeighborColumnIds(c.id)).toEqual([a.id]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test`
Expected: FAIL — `insertionIndexForEdges` doesn't accept a 4th argument yet, `visibleNeighborColumnIds` doesn't exist, `columnAtVirtualX` still exists (TypeScript compile errors are the expected failure mode here, not runtime assertion failures).

- [ ] **Step 3: Implement in `src/core/grid.ts`**

Replace the `centerAt` private method (currently at `grid.ts:315-317`) with a generalized version, and update `insertionIndexForEdges` and add `visibleNeighborColumnIds`:

```typescript
    /** Real x position `fraction` of the way across the column at `index`, measured from its
     * own left offset. `fraction = 0.5` reproduces the old fixed center-crossing threshold
     * (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    private thresholdAt(index: number, fraction: number): number {
        return this.layoutOffsets()[index] + this.layoutWidths()[index] * fraction;
    }
```

```typescript
    /** Target `moveColumn` index for the dragged column `excludeId`, judged by its
     * own leading edges rather than its center: it trades places with its current
     * immediate right neighbor once its own right edge crosses `thresholdFraction`
     * of the way into that neighbor (measured from their shared boundary), or with
     * its immediate left neighbor symmetrically. `thresholdFraction = 0.5` is a
     * plain center-crossing swap; a higher fraction requires the drag to travel
     * further into the neighbor before firing — near its final post-swap position
     * rather than merely past the halfway point (docs:
     * 2026-09-07-drag-reorder-stack-refinement-design). Hidden columns are skipped
     * when looking for a neighbor. Returns `excludeId`'s own current index (i.e. no
     * move) when neither immediate neighbor has been crossed. */
    insertionIndexForEdges(
        excludeId: number,
        leftEdgeVirtualX: number,
        rightEdgeVirtualX: number,
        thresholdFraction: number,
    ): number {
        const index = this.requireIndex(excludeId);
        const rightIndex = this.visibleNeighborIndex(index, 1);
        if (rightIndex !== null && rightEdgeVirtualX > this.thresholdAt(rightIndex, thresholdFraction)) {
            return rightIndex;
        }
        const leftIndex = this.visibleNeighborIndex(index, -1);
        if (leftIndex !== null && leftEdgeVirtualX < this.thresholdAt(leftIndex, 1 - thresholdFraction)) {
            return leftIndex;
        }
        return index;
    }
```

```typescript
    /** Ids of `columnId`'s immediate visible left/right neighbors (skipping hidden
     * columns), in the same "immediate neighbor" sense `insertionIndexForEdges`
     * uses — `[left, right]` with either side omitted if it has no visible
     * neighbor. Used by drag-to-stack to gather cross-column stack candidates
     * without a pointer-position column lookup (docs:
     * 2026-09-07-drag-reorder-stack-refinement-design). */
    visibleNeighborColumnIds(columnId: number): number[] {
        const index = this.requireIndex(columnId);
        const ids: number[] = [];
        const leftIndex = this.visibleNeighborIndex(index, -1);
        if (leftIndex !== null) {
            ids.push(this.ordered[leftIndex].id);
        }
        const rightIndex = this.visibleNeighborIndex(index, 1);
        if (rightIndex !== null) {
            ids.push(this.ordered[rightIndex].id);
        }
        return ids;
    }
```

Delete the `columnAtVirtualX` method entirely (superseded — see Task 5's removal of its only caller).

- [ ] **Step 4: Run tests to verify they pass**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: `drag-hover.ts` — replace `resolveStackSlot` with `resolveStackTarget` + `stackTargetIndex`

**Files:**
- Modify: `src/input/drag-hover.ts`
- Modify: `src/input/drag-hover.test.ts`

- [ ] **Step 1: Write the new test file**

Replace the entire contents of `src/input/drag-hover.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { Rect } from '../core/coordinates';
import { resolveStackTarget, stackTargetIndex, StackCandidate } from './drag-hover';

function rect(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
}

describe('resolveStackTarget', () => {
    it('returns null when there are no candidates', () => {
        expect(resolveStackTarget(rect(0, 0, 300, 200), [], 0.5)).toBeNull();
    });

    it('returns null when the only candidate fails the horizontal overlap gate', () => {
        // candidate spans x=[300,600) (width 300); dragged window spans x=[0,300+299]=
        // [0,299], leaving essentially zero horizontal overlap.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(300, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 400, 299, 100), candidates, 0.5)).toBeNull();
    });

    it("resolves 'above' when the dragged window's top edge is in the candidate's top quarter", () => {
        // candidate: y=[0,1000). Top-quarter boundary is y=250. Dragged top edge at y=100.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5)).toEqual({
            columnId: 1,
            tileId: 10,
            direction: 'above',
        });
    });

    it("resolves 'below' when the dragged window's top edge is in the candidate's bottom quarter", () => {
        // candidate: y=[0,1000). Bottom-quarter boundary is y=750. Dragged top edge at y=900.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 900, 300, 200), candidates, 0.5)).toEqual({
            columnId: 1,
            tileId: 10,
            direction: 'below',
        });
    });

    it("returns null when the dragged window's top edge is in the candidate's middle dead zone", () => {
        // candidate: y=[0,1000). Middle band is (250,750). Dragged top edge at y=500.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 500, 300, 200), candidates, 0.5)).toBeNull();
    });

    it('picks the candidate with the most vertical overlap among several passing the gate', () => {
        const candidates: StackCandidate[] = [
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 200) }, // dragged overlaps y=[100,200) -> 100px
            { columnId: 1, tileId: 20, rect: rect(0, 200, 300, 400) }, // dragged overlaps y=[200,300) -> 100px... see below
            { columnId: 1, tileId: 30, rect: rect(0, 50, 300, 300) }, // dragged overlaps y=[100,300) -> 200px, most overlap
        ];
        // dragged window: y=[100,300)
        const target = resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5);
        expect(target?.tileId).toBe(30);
    });

    it('skips a candidate with more vertical overlap but insufficient horizontal overlap, picking a gate-passing one instead', () => {
        const candidates: StackCandidate[] = [
            // wins on vertical overlap alone, but only 10% horizontal overlap with the dragged window.
            { columnId: 1, tileId: 10, rect: rect(270, 0, 300, 1000) },
            // less generous vertical overlap, but fully within the dragged window horizontally.
            { columnId: 2, tileId: 20, rect: rect(0, 50, 300, 300) },
        ];
        const target = resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5);
        expect(target?.tileId).toBe(20);
    });
});

describe('stackTargetIndex', () => {
    it("resolves 'above' to the candidate tile's own index", () => {
        const tiles = [{ id: 10 }, { id: 20 }, { id: 30 }];
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'above' }, tiles)).toBe(1);
    });

    it("resolves 'below' to one past the candidate tile's own index", () => {
        const tiles = [{ id: 10 }, { id: 20 }, { id: 30 }];
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'below' }, tiles)).toBe(2);
    });

    it("resolves 'below' the last tile to an append index", () => {
        const tiles = [{ id: 10 }, { id: 20 }];
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'below' }, tiles)).toBe(2);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test`
Expected: FAIL — `resolveStackTarget`/`stackTargetIndex`/`StackCandidate` don't exist yet.

- [ ] **Step 3: Replace `src/input/drag-hover.ts`**

```typescript
// Pure geometry: which candidate tile a drag is aimed at, and above/below it, purely from
// rect overlap with the dragged window — the single mechanism shared by same-column
// (reordering within your own stack) and cross-column (stacking into a neighbor) drags
// alike. No KWin dependency and no `Grid` dependency: takes only already-resolved rects,
// so it's directly unit-testable without mocking any signal wiring or layout model
// (docs: 2026-09-07-drag-reorder-stack-refinement-design).

import { Rect } from '../core/coordinates';

export type StackDirection = 'above' | 'below';

/** One tile a drag could land on: which column it belongs to (its own column for a
 * same-column candidate, a neighbor's for a cross-column one), its tile id, and its
 * current on-screen rect. The dragged tile itself is never included — callers filter
 * it out before calling `resolveStackTarget`. */
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

/** Picks which candidate a drag is aimed at, and above/below it. Among candidates whose
 * horizontal overlap with `draggedRect` (as a fraction of the candidate's own width)
 * clears `overlapFraction`, the one with the most vertical overlap wins; its height is
 * then split into an above/below/dead-zone band by where `draggedRect`'s own top edge
 * falls: top 25% -> above, bottom 25% -> below, the middle 50% -> no target (this dead
 * zone is what keeps a near-boundary hover from flickering between adjacent slots).
 * Returns null when no candidate clears the gate, or the winning candidate's band is
 * the dead zone. */
export function resolveStackTarget(
    draggedRect: Rect,
    candidates: readonly StackCandidate[],
    overlapFraction: number,
): StackTarget | null {
    let best: StackCandidate | null = null;
    let bestOverlapY = 0;
    for (const candidate of candidates) {
        if (horizontalOverlapFraction(draggedRect, candidate.rect) < overlapFraction) {
            continue;
        }
        const overlapY = verticalOverlap(draggedRect, candidate.rect);
        if (overlapY <= 0) {
            continue;
        }
        if (best === null || overlapY > bestOverlapY) {
            best = candidate;
            bestOverlapY = overlapY;
        }
    }
    if (best === null) {
        return null;
    }
    const topFraction = (draggedRect.y - best.rect.y) / best.rect.height;
    if (topFraction < 0.25) {
        return { columnId: best.columnId, tileId: best.tileId, direction: 'above' };
    }
    if (topFraction > 0.75) {
        return { columnId: best.columnId, tileId: best.tileId, direction: 'below' };
    }
    return null;
}

/** Translates a resolved `StackTarget` into a tile-list index for `Column.insertTileAt`/
 * `Column.moveTile`, given the exact tile list the target column currently holds (the
 * dragged tile already excluded by the caller for a same-column list, exactly as
 * `StackCandidate`s themselves are). */
export function stackTargetIndex(target: StackTarget, tiles: readonly { id: number }[]): number {
    const index = tiles.findIndex((tile) => tile.id === target.tileId);
    return target.direction === 'above' ? index : index + 1;
}

function verticalOverlap(a: Rect, b: Rect): number {
    return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

function horizontalOverlapFraction(dragged: Rect, target: Rect): number {
    const overlap = Math.min(dragged.x + dragged.width, target.x + target.width) - Math.max(dragged.x, target.x);
    if (overlap <= 0) {
        return 0;
    }
    return overlap / target.width;
}
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: Settings — `reorderThresholdFraction` and `stackOverlapFraction`

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/config/settings-definitions.ts`
- Modify: `src/config/settings.test.ts`
- Modify: `drift/contents/ui/config.ui`

- [ ] **Step 1: Write the failing settings tests**

In `src/config/settings.test.ts`, add two new `it` blocks inside `describe('DEFAULT_SETTINGS', ...)`, next to the existing `columnDragDwellMs` one:

```typescript
    it('defaults the reorder threshold fraction to 0.85 (near-final-position, not center-crossing)', () => {
        expect(DEFAULT_SETTINGS.reorderThresholdFraction).toBe(0.85);
    });

    it('defaults the stack overlap fraction to 0.5', () => {
        expect(DEFAULT_SETTINGS.stackOverlapFraction).toBe(0.5);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test`
Expected: FAIL — `DEFAULT_SETTINGS.reorderThresholdFraction`/`stackOverlapFraction` don't exist yet.

- [ ] **Step 3: Add the definitions**

In `src/config/settings-definitions.ts`, add two entries right after `columnDragDwellMs` (`settings-definitions.ts:172`):

```typescript
    { name: 'columnDragDwellMs', type: 'UInt', default: 400 },
    { name: 'reorderThresholdFraction', type: 'Double', default: 0.85 },
    { name: 'stackOverlapFraction', type: 'Double', default: 0.5 },
```

In `src/config/settings.ts`, add the two fields to the `Settings` interface right after `columnDragDwellMs`:

```typescript
    columnDragDwellMs: number;
    /** Fraction of a neighbor column's width the dragged column's edge must penetrate
     * (measured from their shared boundary) before a reorder swap fires — generalizes the
     * old fixed 50% center-crossing threshold so a swap commits near the drag's final
     * post-swap position instead of at the halfway point, cutting down on swaps firing off
     * a drag that only grazed a neighbor (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    reorderThresholdFraction: number;
    /** Minimum horizontal overlap (as a fraction of the candidate tile's own width)
     * between the dragged window and a candidate tile before that tile is considered for
     * stacking at all (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    stackOverlapFraction: number;
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test`
Expected: PASS

- [ ] **Step 5: Add the config UI rows**

In `drift/contents/ui/config.ui`, add two new rows to `formLayout_dragging` (the **Dragging** section), right after the existing `row="2"` (`kcfg_columnDragDwellMs`) items (`config.ui:314-339`) and before that layout's closing `</layout>`:

```xml
                                        <item row="3" column="0">
                                            <widget class="QLabel" name="label_reorderThresholdFraction">
                                                <property name="text">
                                                    <string>Reorder threshold:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="3" column="1">
                                            <widget class="QDoubleSpinBox" name="kcfg_reorderThresholdFraction">
                                                <property name="toolTip">
                                                    <string>How far a dragged column's edge must penetrate a neighbor before a reorder swap fires, as a fraction of the neighbor's width</string>
                                                </property>
                                                <property name="decimals">
                                                    <number>2</number>
                                                </property>
                                                <property name="minimum">
                                                    <double>0.50</double>
                                                </property>
                                                <property name="maximum">
                                                    <double>0.99</double>
                                                </property>
                                                <property name="singleStep">
                                                    <double>0.05</double>
                                                </property>
                                                <property name="value">
                                                    <double>0.85</double>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="4" column="0">
                                            <widget class="QLabel" name="label_stackOverlapFraction">
                                                <property name="text">
                                                    <string>Stack overlap threshold:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="4" column="1">
                                            <widget class="QDoubleSpinBox" name="kcfg_stackOverlapFraction">
                                                <property name="toolTip">
                                                    <string>Minimum horizontal overlap between the dragged window and a candidate tile before it's considered for stacking</string>
                                                </property>
                                                <property name="decimals">
                                                    <number>2</number>
                                                </property>
                                                <property name="minimum">
                                                    <double>0.10</double>
                                                </property>
                                                <property name="maximum">
                                                    <double>1.00</double>
                                                </property>
                                                <property name="singleStep">
                                                    <double>0.05</double>
                                                </property>
                                                <property name="value">
                                                    <double>0.50</double>
                                                </property>
                                            </widget>
                                        </item>
```

- [ ] **Step 6: Regenerate `main.xml` and verify the build**

`npm run build`
Expected: succeeds; `drift/contents/config/main.xml` now includes `reorderThresholdFraction` and `stackOverlapFraction` entries (generated by `.build/generate-main-xml.cjs` from `SETTINGS_DEFINITIONS`).

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: `drag.ts` — rewire reorder/stack resolution

**Files:**
- Modify: `src/input/drag.ts`

No new test file — this module is untested glue by existing project precedent (see the design doc's Testing section and the priority-design doc it supersedes); verification is `npm test` (regression on Tasks 1-3's suites) and `npm run build` (type-checks this file's usage of the changed `Grid`/`drag-hover` APIs).

- [ ] **Step 1: Update imports and `DragReorderDeps`**

Replace the import line for `drag-hover` and the `cursorPos`/`createStackDwell` parts of `DragReorderDeps`:

```typescript
import { resolveStackTarget, stackTargetIndex, StackCandidate, StackTarget } from './drag-hover';
```

(Remove the old `import { resolveStackSlot, StackHover } from './drag-hover';` line and the `StackHover` import — `StackHover` becomes a local type in this file, see Step 2.)

In `DragReorderDeps`, replace the `cursorPos` field and update `createStackDwell`:

```typescript
export interface DragReorderDeps {
    grid: Grid;
    registry: DragRegistryView;
    viewport: Viewport;
    area: Rect;
    render(excludeWindowId?: string, instant?: boolean, verticalOffsetY?: undefined, stackPreview?: StackPreview): void;
    /** Fraction of a neighbor's width a reorder swap must penetrate before it fires
     * (`settings.reorderThresholdFraction`) — see `Grid.insertionIndexForEdges`. */
    reorderThresholdFraction: number;
    /** Minimum horizontal overlap a candidate tile needs before it's considered for
     * stacking (`settings.stackOverlapFraction`) — see `resolveStackTarget`. */
    stackOverlapFraction: number;
    /** Builds a dwell timer armed on a resolved stack target's compound key
     * (`` `${columnId}:${tileId}:${direction}` ``), firing `onFire` once hovered past
     * `columnDragDwellMs` — one instance per drag-reorder connection, reused across
     * every drag that window does. Applied uniformly to same-column and cross-column
     * stack hovers alike (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    createStackDwell(onFire: (key: string) => void): EdgeDwell<string>;
    snapColumn(columnId: number): void;
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void;
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
    revealFocused(): void;
}
```

Also delete the whole file-header comment's stale wording about "the real mouse pointer" and "cursorPos" (it currently describes the priority design being replaced) and replace it with:

```typescript
// Turns a window's interactive-move lifecycle into a live column reorder or a live
// drag-to-stack (docs: 2026-09-07-drag-reorder-stack-refinement-design). Reorder —
// the dragged window's own edge penetrating a neighbor past `reorderThresholdFraction`
// of its width (`Grid.insertionIndexForEdges`) — is checked first and, when it fires,
// commits `Grid.moveColumn` immediately, live. Only when reorder does NOT fire this
// tick is stacking considered: candidates are gathered purely from the dragged tile's
// own geometry — its column's siblings plus both immediate neighbor columns' tiles —
// and resolved by `resolveStackTarget`'s overlap-gate + top-edge-band, dwell-gated by
// `EdgeDwell` exactly like reorder's neighbor used to be, now applied uniformly to
// same-column and cross-column hovers alike. Stack stays preview-only until release,
// unlike reorder.
```

- [ ] **Step 2: Replace `windowEdgesVirtualX`'s companion helper and the file-scope types**

Add a second small helper next to `windowEdgesVirtualX` (`drag.ts:70-78`), for the full rect the stack candidate search needs:

```typescript
/** `win`'s own current rect, in virtual x / area-relative y — the same coordinate
 * space `Grid.columnRect`/`Column.tileRect` already produce, so it can be compared
 * directly against a candidate tile's rect (docs:
 * 2026-09-07-drag-reorder-stack-refinement-design). */
function windowRectVirtual(win: WindowAdapter, area: Rect, viewportOffsetX: number): Rect {
    const rect = win.frameGeometry();
    return {
        x: toVirtualX(rect.x, area, viewportOffsetX),
        y: rect.y - area.y,
        width: rect.width,
        height: rect.height,
    };
}
```

Add a local `StackHover` type (this file's own "resolved, ready-to-commit" shape — unchanged from before, just no longer imported from `drag-hover.ts` since that module no longer defines it):

```typescript
interface StackHover {
    columnId: number;
    slot: number;
}
```

- [ ] **Step 3: Replace the body of `registerDragReorder`**

Replace everything from `let lastStackHover` through the end of `tickInner` (`drag.ts:102-308`, i.e. everything between `let dragging = initiallyDragging;` and the `// TEMPORARY DEBUG INSTRUMENTATION` comment) with:

```typescript
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which stack target's compound key (`` `${columnId}:${tileId}:${direction}` ``) the
     * dwell has actually FIRED for — null while merely hovering, before the dwell elapses.
     * Only a fired key shows a preview. */
    let armedStackKey: string | null = null;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            deps.onDragStarted?.(win);
        }
    });

    /** Current column/tile the dragged window is registered under. Null only if the
     * window has already been removed from the registry mid-drag (e.g. it closed). */
    const currentLocation = (): { columnId: number; tileId: number } | null => deps.registry.tileOf(win.id);

    /** Expels a stack tile into its own standalone column the first time a drag
     * carries it into a reorder swap — reorder operates on standalone columns, which
     * a stack tile is not. Placement doesn't need to be exact here: subsequent ticks
     * converge it over the next tick or two, the same way a mid-drag strip-reparent
     * already tolerates a short convergence window (docs: 2026-09-03-drag-to-stack-design). */
    const expelToStandaloneColumn = (columnId: number, tileId: number): number => {
        const column = requireColumn(deps.grid, columnId);
        column.removeTile(tileId);
        const newColumn = deps.grid.addColumn(win.frameGeometry().width);
        deps.registry.moveWindow(columnId, tileId, newColumn.id, newColumn.tiles()[0].id);
        return newColumn.id;
    };

    /** Resolves the standalone column id a reorder swap should operate on for
     * `location` — the tile's own column if it's already standalone (single-tile), or a
     * freshly expelled one otherwise. */
    const resolveReorderColumn = (location: { columnId: number; tileId: number }): number => {
        const homeColumn = requireColumn(deps.grid, location.columnId);
        return homeColumn.tileCount() === 1
            ? location.columnId
            : expelToStandaloneColumn(location.columnId, location.tileId);
    };

    /** Renders a live stack-entry preview for `target`, and remembers the resulting
     * `{columnId, slot}` as `lastStackHover` for the eventual release commit. Shared by
     * same-column and cross-column hover alike — both resolve a target the same way, via
     * `resolveStackTarget`. */
    const renderStackPreview = (location: { columnId: number; tileId: number }, target: StackTarget): void => {
        const targetColumn = requireColumn(deps.grid, target.columnId);
        const sameColumn = target.columnId === location.columnId;
        const targetTiles = sameColumn
            ? targetColumn.tiles().filter((tile) => tile.id !== location.tileId)
            : targetColumn.tiles();
        const slot = stackTargetIndex(target, targetTiles);
        lastStackHover = { columnId: target.columnId, slot };
        if (sameColumn) {
            // Same-column reorder commits via Column.moveTile, which never redistributes
            // height — so the dragged tile's own current height is already what it will
            // actually end up at. Using anything else here would fight what's about to happen.
            deps.render(win.id, false, undefined, {
                enteringColumnId: target.columnId,
                enteringIndex: slot,
                enteringGapHeight: win.frameGeometry().height,
                enteringExcludeTileId: location.tileId,
            });
            return;
        }
        // Cross-column: the eventual commit (Column.insertTileAt) evenly redistributes the
        // target column's total height across its existing tiles PLUS the incoming one — so
        // approximate that here instead of using the dragged window's own current height
        // (docs: 2026-09-03-drag-to-stack-design).
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const targetTotalHeight = targetTiles.reduce((sum, tile) => sum + tile.height, 0);
        const gapHeight = targetTotalHeight / (targetTiles.length + 1);
        const stackPreview: StackPreview = {
            enteringColumnId: target.columnId,
            enteringIndex: slot,
            enteringGapHeight: gapHeight,
        };
        if (homeColumn.tileCount() > 1) {
            stackPreview.leavingColumnId = location.columnId;
            stackPreview.leavingTileId = location.tileId;
        }
        deps.render(win.id, false, undefined, stackPreview);
    };

    /** Gathers this tick's stack candidates from the dragged window's own geometry alone —
     * its home column's siblings (if it's currently in a multi-tile column) plus both
     * immediate neighbor columns' tiles — and resolves a target from them. No pointer
     * position involved at all (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    const resolveCurrentTarget = (location: { columnId: number; tileId: number }): StackTarget | null => {
        const draggedRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const candidates: StackCandidate[] = [];
        if (homeColumn.tileCount() > 1) {
            const homeRect = deps.grid.columnRect(location.columnId);
            for (const tile of homeColumn.tiles()) {
                if (tile.id === location.tileId) {
                    continue;
                }
                candidates.push({
                    columnId: location.columnId,
                    tileId: tile.id,
                    rect: homeColumn.tileRect(tile.id, homeRect),
                });
            }
        }
        for (const neighborId of deps.grid.visibleNeighborColumnIds(location.columnId)) {
            const neighborColumn = requireColumn(deps.grid, neighborId);
            const neighborRect = deps.grid.columnRect(neighborId);
            for (const tile of neighborColumn.tiles()) {
                candidates.push({ columnId: neighborId, tileId: tile.id, rect: neighborColumn.tileRect(tile.id, neighborRect) });
            }
        }
        return resolveStackTarget(draggedRect, candidates, deps.stackOverlapFraction);
    };

    // Fires once the resolved stack target has held steady past columnDragDwellMs.
    // Recomputes fresh against the window's CURRENT geometry rather than whatever it was
    // when the dwell armed — the dwell's own timer tick is independent of
    // frameGeometryChanged, so a few more pixels of drag may have happened since.
    const stackDwell = deps.createStackDwell((key) => {
        armedStackKey = key;
        const location = currentLocation();
        if (location === null) {
            return;
        }
        const target = resolveCurrentTarget(location);
        if (target === null) {
            return;
        }
        const currentKey = `${target.columnId}:${target.tileId}:${target.direction}`;
        if (currentKey !== key) {
            return; // moved on before the dwell fired; the next regular tick will reconcile
        }
        renderStackPreview(location, target);
    });

    const tickInner = (): void => {
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);

        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)})`,
        );

        // Reorder: checked first, live — the dragged column's own edge penetrating a
        // neighbor past reorderThresholdFraction of its width.
        const reorderIndex = deps.grid.insertionIndexForEdges(
            location.columnId,
            winEdges.left,
            winEdges.right,
            deps.reorderThresholdFraction,
        );
        if (reorderIndex !== homeIndex) {
            debug(`drag tick: reorder triggered col${location.columnId} idx${homeIndex}->${reorderIndex}`);
            stackDwell.update(null);
            armedStackKey = null;
            lastStackHover = null;
            const columnId = resolveReorderColumn(location);
            // Recompute fresh: expulsion may have appended a new column, shifting indices.
            const finalIndex = deps.grid.insertionIndexForEdges(
                columnId,
                winEdges.left,
                winEdges.right,
                deps.reorderThresholdFraction,
            );
            deps.grid.moveColumn(columnId, finalIndex);
            deps.render(win.id, false);
            return;
        }

        // Reorder didn't fire: edge-expel a multi-tile column's own tile past the grid's
        // outer boundary, on a side with no neighbor to reorder against at all.
        if (homeColumn.tileCount() > 1) {
            const expelDirection = deps.grid.expelDirectionForEdges(location.columnId, winEdges.left, winEdges.right);
            if (expelDirection !== null) {
                debug(`drag tick: edge-expel triggered col${location.columnId} dir=${expelDirection}`);
                stackDwell.update(null);
                armedStackKey = null;
                lastStackHover = null;
                const newColumnId = expelToStandaloneColumn(location.columnId, location.tileId);
                const homeIndexAfterExpel = deps.grid.indexOf(location.columnId);
                deps.grid.moveColumn(
                    newColumnId,
                    expelDirection === 'left' ? homeIndexAfterExpel : homeIndexAfterExpel + 1,
                );
                deps.render(win.id, false);
                return;
            }
        }

        // Stack: same mechanism whether the winning candidate is a sibling in the dragged
        // tile's own column or a tile in an immediate neighbor.
        const target = resolveCurrentTarget(location);
        if (target === null) {
            stackDwell.update(null);
            armedStackKey = null;
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }
        const key = `${target.columnId}:${target.tileId}:${target.direction}`;
        stackDwell.update(key);
        if (armedStackKey !== key) {
            // Not armed for this target yet — dwell still counting, no preview.
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }
        renderStackPreview(location, target);
    };
```

Everything from the `// TEMPORARY DEBUG INSTRUMENTATION` comment through the end of the file (`tick`, `disconnectGeometryChanged`, `finishedInner`, `disconnectFinished`, the returned disconnect function) stays exactly as-is — `finishedInner` already only reads `lastStackHover.columnId`/`.slot`, which keeps the same shape.

- [ ] **Step 4: Run the full test suite and build**

`npm test`
Expected: PASS (Tasks 1-3's suites, plus every other existing suite unaffected by this file — `drag.ts` itself has no direct tests, per existing project precedent for this file).

`npm run build`
Expected: succeeds — this is what catches any type mismatch in this task's rewiring (e.g. a stale `resolveStackSlot`/`cursorPos` reference).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: `strip.ts` — update the `registerDragReorder` wiring

**Files:**
- Modify: `src/runtime/strip.ts`

No new test file — this is the same pre-existing untested wiring glue Task 4 touches; verification is `npm test` (regression) and `npm run build` (type-checks the `DragReorderDeps` object literal against Task 4's updated interface).

- [ ] **Step 1: Update the `Object.assign` call in `wireTile`**

In `src/runtime/strip.ts` (`strip.ts:325-354`), remove the `cursorPos` field, change `createStackDwell`'s `EdgeDwell` generic from `number` to `string`, and add `reorderThresholdFraction`/`stackOverlapFraction` from settings:

```typescript
                Object.assign(
                    {
                        grid: this.grid,
                        registry: this.registry,
                        viewport: this.viewport,
                        area: this.area,
                        render: (
                            excludeWindowId?: string,
                            instant?: boolean,
                            verticalOffsetY?: undefined,
                            stackPreview?: StackPreview,
                        ) => this.render(excludeWindowId, instant, verticalOffsetY, stackPreview),
                        reorderThresholdFraction: this.settings.reorderThresholdFraction,
                        stackOverlapFraction: this.settings.stackOverlapFraction,
                        createStackDwell: (onFire: (key: string) => void) =>
                            new EdgeDwell<string>(
                                this.ticker.subscribe(),
                                () => Date.now(),
                                ANIMATION_TICK_MS,
                                this.settings.columnDragDwellMs,
                                onFire,
                            ),
                        snapColumn: (id: number) => this.snapColumn(id),
                        commitTileIntoStack: (
                            fromColumnId: number,
                            fromTileId: number,
                            toColumnId: number,
                            slot: number,
                        ) => this.commitTileIntoStack(fromColumnId, fromTileId, toColumnId, slot),
                        revealFocused: () => this.revealFocused(),
                    },
                    stripDragHooks,
                ),
```

- [ ] **Step 2: Run the full test suite and build**

`npm test`
Expected: PASS

`npm run build`
Expected: succeeds

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 6: Full repo verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

`npm test`
Expected: PASS, no skipped/failing suites.

- [ ] **Step 2: Run the full build**

`npm run build`
Expected: succeeds, `drift/contents/config/main.xml` includes the two new settings.

- [ ] **Step 3: Run lint**

`npm run lint`
Expected: PASS — JavaScript/TypeScript/QML checks, including `qmllint` (this task touches no QML directly, but `config.ui`'s generated `kcfg_*` bindings should be checked as part of the normal lint pass if the project's lint config covers them).

- [ ] **Step 4: Manual live-test note**

This plan's numeric defaults (`reorderThresholdFraction: 0.85`, `stackOverlapFraction: 0.5`, the fixed 25%/75% direction bands) are starting points per the design doc — every dwell/threshold value in this area of the codebase has needed live-tuning after its first pass. Flag to the user that a live-testing round (dragging real windows) is expected before considering this genuinely done, not just test-suite-green.
