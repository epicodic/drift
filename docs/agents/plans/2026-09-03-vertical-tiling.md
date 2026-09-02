# Vertical Tiling (Column Stacking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a column hold more than one window, stacked vertically, with absorb/expel keyboard shortcuts to move windows between column-hood and tile-hood, resizable tile heights (mouse-driven, matching the existing column-width model), and keyboard/click focus navigation within a stack.

**Architecture:** `Column` (`src/core/column.ts`) gains an ordered list of *tiles* — pure, unit-tested layout state exactly like it already owns `width`. `ColumnRegistry` becomes tile-keyed instead of column-keyed. Everything above that (`Grid`, `Strip`, `StripStack`, shortcuts, settings) threads a `tileId` alongside the existing `columnId` wherever it resolves a specific window. See [`docs/agents/specs/2026-09-03-vertical-tiling-design.md`](../specs/2026-09-03-vertical-tiling-design.md) for the approved design and rationale.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/coordinates.ts` | Modify: add `VerticalResizeEdge` + `verticalResizedEdge`, the vertical sibling of `ResizeEdge`/`resizedEdge`. |
| `src/core/column.ts` | Modify: `Column` gains a `Tile[]` stack, `focusedTileId`, and tile CRUD/resize/focus/rect methods. |
| `src/core/grid.ts` | Modify: `addColumn` seeds the first tile with the grid's screen height; new `column()`, `absorbColumnRight()`, `expelFocusedTile()`; `debugState()` reports tile count. |
| `src/runtime/column-registry.ts` | Modify: rewritten from `columnId → Entry` to `columnId → tileId → Entry`, with `tileOf`/`moveWindow`/`windowsInColumn`/`deleteTile`/`deleteColumn` replacing the old single-window API. |
| `src/debug/snapshot.ts`, `src/ui/minimap.ts` | Modify: both read a column's *focused* tile's window instead of "the" window (MVP fallback per design doc: minimap/debug show the active tile only). |
| `src/runtime/window-events.ts` | Modify: a height-only geometry change now resizes a tile (when the window is part of a stack) instead of being ignored; fullscreen/minimize handlers become tile-aware. |
| `src/runtime/strip.ts` | Modify: `render()` iterates tiles per column; `addWindow`/`removeWindow`/`detachColumn`/`detachFocusedColumn`/`activateWindow` become tile-aware; new `focusUp`/`focusDown`/`absorbRight`/`expel`; fullscreen/minimize tracking becomes per-tile. |
| `src/runtime/strip-stack.ts` | Modify: `moveFocusedWindowToRow` handles every tile in the detached column, not just one; new `focusUp`/`focusDown`/`absorbRight`/`expel` passthroughs to the active `Strip`. |
| `src/config/settings.ts` | Modify: 4 new shortcut settings (`shortcutFocusUp`, `shortcutFocusDown`, `shortcutAbsorbRight`, `shortcutExpel`) with defaults and config loading. |
| `src/input/shortcuts.ts` | Modify: 4 new `ShortcutActions` entries and their `createShortcut` registrations. |
| `src/runtime/controller.ts` | Modify: wires the 4 new actions to `StripStack`. |
| `drift/contents/config/main.xml`, `drift/contents/bin/setup-shortcuts.sh` | Modify: mirror the 4 new shortcut defaults (required by `src/config/shortcuts-consistency.test.ts`, which fails the build otherwise). |
| `docs/architecture.md`, `docs/roadmap.md`, `docs/comparison-paperwm.md`, `docs/comparison-keybindings.md` | Modify: document the shipped feature, remove it from the roadmap, update the keybinding comparison's stale "Drift Target" cells. |

Every `.ts` file above with existing logic already has a co-located `*.test.ts` — each task's Test file is that same file, extended, not a new one.

## Two implementation notes that came up while planning (flagging since they weren't in the approved design doc verbatim)

1. **No gap between stacked tiles.** The design doc doesn't specify inter-tile spacing. This plan uses `0` — tiles sit back to back, unlike columns (which do have `columnGap` between them). Reason: introducing a vertical gap would mean tile heights sum to `screenHeight - (n-1) * gap` instead of `screenHeight`, an extra invariant with no functional requirement behind it yet. Easy to add later as a single constant if it turns out to look wrong in practice.
2. **Fullscreen and minimize both need to become per-tile, not just fullscreen.** The approved design says fullscreening one tile must leave the others "visible... underneath," which only holds if `render()` keeps repositioning them — so `Strip`'s existing `fullScreenColumns: Set<number>` becomes a per-tile-keyed set. The same reasoning applies to minimizing one window in a stack: today's `hideColumn(columnId)` collapses the *whole* column's width, which would incorrectly hide a sibling tile that's still open. Both get the same tile-scoped tracking (Task 7); a single-tile column keeps behaving exactly as it does today (both old code paths are preserved for that case, not replaced).

## Chosen shortcuts

`Meta+I` (absorb from the right) / `Meta+O` (expel to the right) — matches PaperWM's own bindings, and matches `docs/comparison-keybindings.md`'s existing "Drift Target" cell for this action. `Meta+Alt+Up` / `Meta+Alt+Down` for focus-up/down within a stack — `docs/comparison-keybindings.md`'s "Drift Target" cell for this one currently says `Meta+Up`/`Meta+Down`, but those are already taken by `shortcutRowUp`/`shortcutRowDown` in the shipped `src/config/settings.ts` (that doc predates or missed that collision — Task 12 corrects it). `Meta+Alt+Up`/`Down` is free and pairs with the existing `Meta+Alt+Left`/`Right` (viewport pan) as the vertical half of the same modifier tier.

---

### Task 1: Vertical resize-edge detection

**Files:**
- Modify: `src/core/coordinates.ts`
- Test: `src/core/coordinates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/coordinates.test.ts` (mirroring the existing `resizedEdge` describe block):

```typescript
import { verticalResizedEdge } from './coordinates';

describe('verticalResizedEdge', () => {
    it('reports "top" when the top edge (y) moved', () => {
        const oldRect = { x: 0, y: 100, width: 200, height: 300 };
        const newRect = { x: 0, y: 50, width: 200, height: 350 };
        expect(verticalResizedEdge(oldRect, newRect)).toBe('top');
    });

    it('reports "bottom" when only the height changed and y stayed put', () => {
        const oldRect = { x: 0, y: 100, width: 200, height: 300 };
        const newRect = { x: 0, y: 100, width: 200, height: 350 };
        expect(verticalResizedEdge(oldRect, newRect)).toBe('bottom');
    });

    it('rounds before comparing, like resizedEdge does for x', () => {
        const oldRect = { x: 0, y: 100.4, width: 200, height: 300 };
        const newRect = { x: 0, y: 100.49, width: 200, height: 300 };
        expect(verticalResizedEdge(oldRect, newRect)).toBe('bottom');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `verticalResizedEdge` is not exported from `./coordinates`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/coordinates.ts`, immediately after `resizedEdge`'s definition, add:

```typescript
export type VerticalResizeEdge = 'top' | 'bottom';

/** Which border moved between two geometries of the same window, vertically — the
 * sibling of `resizedEdge` for tile-height resize within a column (docs:
 * 2026-09-03-vertical-tiling-design). A changed top edge (y) means the top border
 * was dragged, otherwise the bottom border moved. */
export function verticalResizedEdge(oldRect: Rect, newRect: Rect): VerticalResizeEdge {
    return Math.round(newRect.y) !== Math.round(oldRect.y) ? 'top' : 'bottom';
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming: `VerticalResizeEdge`/`verticalResizedEdge` match the existing `ResizeEdge`/`resizedEdge` casing convention
- [ ] `npm run lint` passing
- [ ] `npm test` passing

---

### Task 2: `Column` gains a tile stack

**Files:**
- Modify: `src/core/column.ts`
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `src/core/column.test.ts` entirely with:

```typescript
import { describe, it, expect } from 'vitest';
import { Column } from './column';

describe('Column', () => {
    it('exposes its id and width', () => {
        const column = new Column(1, 300, 1000);
        expect(column.id).toBe(1);
        expect(column.width).toBe(300);
    });

    it('updates its width', () => {
        const column = new Column(1, 300, 1000);
        column.setWidth(500);
        expect(column.width).toBe(500);
    });

    it('rejects a non-positive width on construction', () => {
        expect(() => new Column(1, 0, 1000)).toThrow();
        expect(() => new Column(1, -10, 1000)).toThrow();
    });

    it('rejects a non-positive width on resize', () => {
        const column = new Column(1, 300, 1000);
        expect(() => column.setWidth(0)).toThrow();
    });

    it('rejects a non-positive height on construction', () => {
        expect(() => new Column(1, 300, 0)).toThrow();
        expect(() => new Column(1, 300, -10)).toThrow();
    });
});

describe('Column — hidden flag', () => {
    it('starts visible', () => {
        const column = new Column(1, 300, 1000);
        expect(column.hidden).toBe(false);
    });

    it('toggles hidden via setHidden', () => {
        const column = new Column(1, 300, 1000);
        column.setHidden(true);
        expect(column.hidden).toBe(true);
        column.setHidden(false);
        expect(column.hidden).toBe(false);
    });
});

describe('Column — tile stack', () => {
    it('starts with exactly one tile spanning the full height, focused', () => {
        const column = new Column(1, 300, 1000);
        expect(column.tileCount()).toBe(1);
        const [tile] = column.tiles();
        expect(tile.height).toBe(1000);
        expect(column.focusedTileId).toBe(tile.id);
    });

    it('addTile appends a tile, splitting height evenly across the whole stack', () => {
        const column = new Column(1, 300, 1000);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.height)).toEqual([500, 500]);
        expect(secondId).not.toBe(firstId);
        // addTile does not change focus — absorbing a window shouldn't steal it.
        expect(column.focusedTileId).toBe(firstId);
    });

    it('addTile keeps splitting evenly as the stack grows', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile();
        expect(column.tiles().map((t) => t.height)).toEqual([300, 300, 300]);
    });

    it('removeTile redistributes height proportionally to the rest', () => {
        const column = new Column(1, 300, 900);
        const secondId = column.addTile();
        column.addTile(); // three even tiles of 300 each
        column.removeTile(secondId);
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]);
    });

    it('removeTile reassigns focus to a remaining tile if the removed one was focused', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        column.setFocusedTile(secondId);
        column.removeTile(secondId);
        expect(column.focusedTileId).toBe(firstId);
    });

    it('removeTile throws when called on a column with only one tile', () => {
        const column = new Column(1, 300, 900);
        expect(() => column.removeTile(column.tiles()[0].id)).toThrow();
    });

    it('removeTile throws for an unknown tile id', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        expect(() => column.removeTile(9999)).toThrow();
    });

    it('setFocusedTile throws for an unknown tile id', () => {
        const column = new Column(1, 300, 900);
        expect(() => column.setFocusedTile(9999)).toThrow();
    });

    it('focusUp/focusDown move focus within the stack and no-op at the ends', () => {
        const column = new Column(1, 300, 900);
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        const thirdId = column.addTile();

        column.focusUp(); // already at the top tile — no-op
        expect(column.focusedTileId).toBe(firstId);

        column.focusDown();
        expect(column.focusedTileId).toBe(secondId);
        column.focusDown();
        expect(column.focusedTileId).toBe(thirdId);
        column.focusDown(); // already at the bottom tile — no-op
        expect(column.focusedTileId).toBe(thirdId);

        column.focusUp();
        expect(column.focusedTileId).toBe(secondId);
    });

    it('resizeTile takes the delta from the neighbor on the moved edge side', () => {
        const column = new Column(1, 300, 900); // one tile: 900
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // 450 / 450

        column.resizeTile(bottomId, 500, 'top');
        expect(column.tiles().map((t) => t.height)).toEqual([400, 500]);
        expect(column.tiles().map((t) => t.id)).toEqual([topId, bottomId]);
    });

    it('resizeTile is a no-op when there is no neighbor on the moved edge side', () => {
        const column = new Column(1, 300, 900);
        const onlyId = column.tiles()[0].id;
        column.resizeTile(onlyId, 700, 'top'); // no tile above the first one
        expect(column.tiles()[0].height).toBe(900);
    });

    it('resizeTile rejects a resize that would push the neighbor to zero or below', () => {
        const column = new Column(1, 300, 900);
        column.addTile(); // 450 / 450
        const bottomId = column.tiles()[1].id;
        expect(() => column.resizeTile(bottomId, 950, 'top')).toThrow();
    });

    it('tileRect derives each tile\'s y/height from the column rect, stacked with no gap', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile(); // 300 / 300 / 300
        const columnRect = { x: 50, y: 0, width: 300, height: 900 };
        const [first, second, third] = column.tiles();
        expect(column.tileRect(first.id, columnRect)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
        expect(column.tileRect(second.id, columnRect)).toEqual({ x: 50, y: 300, width: 300, height: 300 });
        expect(column.tileRect(third.id, columnRect)).toEqual({ x: 50, y: 600, width: 300, height: 300 });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Column`'s constructor takes 2 args, not 3; `tiles`/`tileCount`/`addTile`/etc. don't exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace `src/core/column.ts` entirely with:

```typescript
// A single column in the strip: identity, width, and an ordered vertical stack of
// tiles. A column with exactly one tile behaves exactly like a plain single-window
// column (docs: 2026-09-03-vertical-tiling-design).

import type { Rect, VerticalResizeEdge } from './coordinates';

function assertPositiveWidth(width: number): void {
    if (!(width > 0)) {
        throw new Error(`Column width must be positive, got ${width}`);
    }
}

function assertPositiveHeight(height: number): void {
    if (!(height > 0)) {
        throw new Error(`Tile height must be positive, got ${height}`);
    }
}

export interface Tile {
    readonly id: number;
    height: number;
}

export class Column {
    private columnWidth: number;
    private isHidden = false;
    private readonly stack: Tile[] = [];
    private nextTileId = 1;
    private focusedTile: number;

    constructor(
        public readonly id: number,
        width: number,
        height: number,
    ) {
        assertPositiveWidth(width);
        assertPositiveHeight(height);
        this.columnWidth = width;
        const firstId = this.nextTileId++;
        this.stack.push({ id: firstId, height });
        this.focusedTile = firstId;
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
        return this.isHidden;
    }

    setHidden(hidden: boolean): void {
        this.isHidden = hidden;
    }

    /** Every tile in the stack, top to bottom. A plain column has exactly one. */
    tiles(): readonly Tile[] {
        return this.stack.slice();
    }

    tileCount(): number {
        return this.stack.length;
    }

    get focusedTileId(): number {
        return this.focusedTile;
    }

    setFocusedTile(id: number): void {
        this.requireTileIndex(id);
        this.focusedTile = id;
    }

    /** Appends a new tile at the bottom of the stack (absorb), splitting height evenly
     * across every tile including the new one. Does not change which tile is focused.
     * Returns the new tile's id. */
    addTile(): number {
        const totalHeight = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const evenHeight = totalHeight / (this.stack.length + 1);
        for (const tile of this.stack) {
            tile.height = evenHeight;
        }
        const id = this.nextTileId++;
        this.stack.push({ id, height: evenHeight });
        return id;
    }

    /** Removes a tile (expel), redistributing its height proportionally to the rest.
     * Reassigns focus to the nearest remaining tile if the removed one was focused.
     * Throws if `id` is the column's only tile — callers must check `tileCount() > 1`
     * first (expel is a no-op on a 1-tile column, docs: 2026-09-03-vertical-tiling-design). */
    removeTile(id: number): void {
        if (this.stack.length <= 1) {
            throw new Error('Cannot remove the last tile in a column');
        }
        const index = this.requireTileIndex(id);
        const [removed] = this.stack.splice(index, 1);
        const remainingHeight = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const scale = (remainingHeight + removed.height) / remainingHeight;
        for (const tile of this.stack) {
            tile.height *= scale;
        }
        if (this.focusedTile === id) {
            this.focusedTile = this.stack[Math.min(index, this.stack.length - 1)].id;
        }
    }

    /** Resizes one tile, taking the delta from its neighbor on the moved edge's side —
     * heights always sum to the column's fixed total, there is no "grow the column"
     * option vertically the way `Grid.resizeColumn` has horizontally. A no-op if there
     * is no neighbor on that side (resizing past the top/bottom of the stack); throws
     * if the resize would push either tile to zero or below. */
    resizeTile(id: number, height: number, edge: VerticalResizeEdge = 'bottom'): void {
        assertPositiveHeight(height);
        const index = this.requireTileIndex(id);
        const neighborIndex = edge === 'top' ? index - 1 : index + 1;
        const neighbor = this.stack[neighborIndex];
        if (neighbor === undefined) {
            return;
        }
        const delta = height - this.stack[index].height;
        const neighborHeight = neighbor.height - delta;
        assertPositiveHeight(neighborHeight);
        this.stack[index].height = height;
        neighbor.height = neighborHeight;
    }

    /** Derives a tile's y/height sub-rect from the column's own full rect (from
     * `Grid.columnRect`). Tiles sit back to back with no vertical gap this pass. */
    tileRect(id: number, columnRect: Rect): Rect {
        const index = this.requireTileIndex(id);
        let y = columnRect.y;
        for (let i = 0; i < index; i++) {
            y += this.stack[i].height;
        }
        return { x: columnRect.x, y, width: columnRect.width, height: this.stack[index].height };
    }

    /** Moves tile focus up (toward the top of the stack). No-op at the top. */
    focusUp(): void {
        this.moveTileFocus(-1);
    }

    /** Moves tile focus down (toward the bottom of the stack). No-op at the bottom. */
    focusDown(): void {
        this.moveTileFocus(1);
    }

    private moveTileFocus(step: number): void {
        const index = this.stack.findIndex((tile) => tile.id === this.focusedTile);
        const target = index + step;
        if (target < 0 || target >= this.stack.length) {
            return;
        }
        this.focusedTile = this.stack[target].id;
    }

    private requireTileIndex(id: number): number {
        const index = this.stack.findIndex((tile) => tile.id === id);
        if (index === -1) {
            throw new Error(`Unknown tile id: ${id}`);
        }
        return index;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS. This will also break `src/core/grid.ts` and `src/core/grid.test.ts` (they call `new Column(id, width)` with 2 args via `addColumn`) — that's expected here, Task 3 fixes it.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming matches project rules for all new symbols (`Tile`, `tiles`, `tileCount`, `addTile`, `removeTile`, `resizeTile`, `tileRect`, `focusUp`, `focusDown`)
- [ ] `npm run lint` run (will still fail on `grid.ts` until Task 3 — confirm the only failures are there)

---

### Task 3: `Grid` threads column height and owns absorb/expel

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/core/grid.test.ts` (reuse whatever `Grid` construction helper the file already has — a `new Grid(height, gap)` call is already used throughout it):

```typescript
describe('Grid — column()', () => {
    it('returns the Column instance for a known id, or null for an unknown one', () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        expect(grid.column(column.id)).toBe(column);
        expect(grid.column(9999)).toBeNull();
    });

    it('seeds a new column\'s first tile with the grid\'s screen height', () => {
        const grid = new Grid(1000, 0);
        const column = grid.addColumn(300);
        expect(column.tiles()[0].height).toBe(1000);
    });
});

describe('Grid — absorbColumnRight', () => {
    it('merges the right-neighbor column into the focused column as a new tile, removing it from the strip', () => {
        const grid = new Grid(1000, 8);
        const left = grid.addColumn(300);
        const right = grid.addColumn(300);
        grid.setFocus(left.id);

        const result = grid.absorbColumnRight(left.id);

        expect(result).toEqual({ fromColumnId: right.id, fromTileId: right.tiles()[0].id, toTileId: expect.any(Number) });
        expect(grid.columns().map((c) => c.id)).toEqual([left.id]);
        expect(left.tileCount()).toBe(2);
    });

    it('returns null when there is no right neighbor', () => {
        const grid = new Grid(1000, 8);
        const only = grid.addColumn(300);
        expect(grid.absorbColumnRight(only.id)).toBeNull();
    });

    it('returns null when the right neighbor is already a stack', () => {
        const grid = new Grid(1000, 8);
        const left = grid.addColumn(300);
        const right = grid.addColumn(300);
        right.addTile();
        expect(grid.absorbColumnRight(left.id)).toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([left.id, right.id]);
    });
});

describe('Grid — expelFocusedTile', () => {
    it('removes the focused tile and gives it a new column to the right, focused', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(300);
        column.addTile();
        grid.setFocus(column.id);

        const result = grid.expelFocusedTile(column.id, 250);

        expect(column.tileCount()).toBe(1);
        expect(result).not.toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([column.id, result!.toColumnId]);
        expect(grid.focusedColumn()?.id).toBe(result!.toColumnId);
        expect(grid.column(result!.toColumnId)?.width).toBe(250);
    });

    it('returns null (no-op) when the column only has one tile', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(300);
        expect(grid.expelFocusedTile(column.id, 250)).toBeNull();
        expect(grid.columns().map((c) => c.id)).toEqual([column.id]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Grid.column`, `absorbColumnRight`, `expelFocusedTile` don't exist yet, and `new Column(this.nextId++, width)` inside `addColumn` is still 2-arg (compile error from Task 2's change).

- [ ] **Step 3: Write minimal implementation**

In `src/core/grid.ts`:

Change `addColumn`'s `Column` construction:

```typescript
    addColumn(width: number): Column {
        const column = new Column(this.nextId++, width, this.height);
        const insertAt = this.focusedColumnId === null ? this.ordered.length : this.indexOf(this.focusedColumnId) + 1;
        this.ordered.splice(insertAt, 0, column);
        this.focusedColumnId = column.id;
        return column;
    }
```

Add these public methods (near `columnRect`, after `indexOf`):

```typescript
    /** Direct access to a column instance for callers that need its per-tile methods
     * (Strip) — unlike the rest of Grid's API, which is id-based. Null if unknown. */
    column(id: number): Column | null {
        return this.columnById(id);
    }

    /** Absorb: pull the column immediately to the right of `columnId` into its stack,
     * appended as a new tile. Null (no-op) if there is no right neighbor, or it
     * already holds more than one tile (docs: 2026-09-03-vertical-tiling-design). */
    absorbColumnRight(columnId: number): { fromColumnId: number; fromTileId: number; toTileId: number } | null {
        const index = this.requireIndex(columnId);
        const rightIndex = this.visibleNeighborIndex(index, 1);
        if (rightIndex === null) {
            return null;
        }
        const rightColumn = this.ordered[rightIndex];
        if (rightColumn.tileCount() !== 1) {
            return null;
        }
        const targetColumn = this.ordered[index];
        const fromTileId = rightColumn.tiles()[0].id;
        this.ordered.splice(rightIndex, 1);
        const toTileId = targetColumn.addTile();
        return { fromColumnId: rightColumn.id, fromTileId, toTileId };
    }

    /** Expel: remove `columnId`'s focused tile and give it a brand-new column
     * immediately to its right, at `newColumnWidth`, focused. Null (no-op) if
     * `columnId` only has one tile — there's nothing to expel. */
    expelFocusedTile(
        columnId: number,
        newColumnWidth: number,
    ): { fromTileId: number; toColumnId: number; toTileId: number } | null {
        const column = this.requireColumn(columnId);
        if (column.tileCount() <= 1) {
            return null;
        }
        const fromTileId = column.focusedTileId;
        column.removeTile(fromTileId);
        const newColumn = this.addColumn(newColumnWidth);
        return { fromTileId, toColumnId: newColumn.id, toTileId: newColumn.tiles()[0].id };
    }
```

In `debugState()`, extend the mapped column shape:

```typescript
    debugState(): GridDebugState {
        return {
            focusedColumnId: this.focusedColumnId,
            nextId: this.nextId,
            originX: this.originX,
            columns: this.ordered.map((column) => ({
                id: column.id,
                width: column.width,
                hidden: column.hidden,
                tileCount: column.tileCount(),
            })),
        };
    }
```

And extend `GridDebugState`'s interface:

```typescript
export interface GridDebugState {
    focusedColumnId: number | null;
    nextId: number;
    originX: number;
    columns: { id: number; width: number; hidden: boolean; tileCount: number }[];
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS for `grid.test.ts` and `column.test.ts`. `src/core/debug-format.ts`/`debug-format.test.ts` may need their `WindowDebugRow`/formatting to tolerate the new `tileCount` field if they snapshot `GridDebugState` shape directly — check `src/core/debug-format.test.ts` output; if it does a deep-equality check against a hardcoded debug-state object literal, add `tileCount` to that literal too.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run lint` passing
- [ ] `npm test` passing (whole suite, not just `core/`)

---

### Task 4: `ColumnRegistry` becomes tile-keyed

**Files:**
- Modify: `src/runtime/column-registry.ts`
- Test: `src/runtime/column-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `src/runtime/column-registry.test.ts` entirely with:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import { SignalManager } from '../utils/signal-manager';
import { ColumnRegistry } from './column-registry';

function fakeWindow(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

describe('ColumnRegistry', () => {
    it('maps a (column, tile) pair to its window', () => {
        const registry = new ColumnRegistry();
        const win = fakeWindow('w1');

        registry.set(1, 1, win, new SignalManager());

        expect(registry.get(1, 1)).toBe(win);
        expect(registry.get(1, 2)).toBeUndefined();
        expect(registry.get(2, 1)).toBeUndefined();
    });

    it('supports more than one tile under the same column', () => {
        const registry = new ColumnRegistry();
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');
        registry.set(1, 1, top, new SignalManager());
        registry.set(1, 2, bottom, new SignalManager());

        expect(registry.get(1, 1)).toBe(top);
        expect(registry.get(1, 2)).toBe(bottom);
        expect(registry.windowsInColumn(1)).toEqual(expect.arrayContaining([top, bottom]));
        expect(registry.windowsInColumn(1)).toHaveLength(2);
    });

    it('finds the (column, tile) location for a window id via tileOf, and columnOf as a convenience', () => {
        const registry = new ColumnRegistry();
        registry.set(1, 1, fakeWindow('w1'), new SignalManager());
        registry.set(2, 1, fakeWindow('w2'), new SignalManager());

        expect(registry.tileOf('w2')).toEqual({ columnId: 2, tileId: 1 });
        expect(registry.tileOf('missing')).toBeNull();
        expect(registry.columnOf('w2')).toBe(2);
        expect(registry.columnOf('missing')).toBeNull();
    });

    it('moveWindow relocates a window between (column, tile) slots without destroying its signals', () => {
        const registry = new ColumnRegistry();
        const signals = new SignalManager();
        const disconnect = vi.fn();
        signals.add(disconnect);
        const win = fakeWindow('w1');
        registry.set(1, 1, win, signals);

        registry.moveWindow(1, 1, 2, 5);

        expect(registry.get(1, 1)).toBeUndefined();
        expect(registry.get(2, 5)).toBe(win);
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('deleteTile destroys that tile\'s signals and leaves sibling tiles alone', () => {
        const registry = new ColumnRegistry();
        const topSignals = new SignalManager();
        const topDisconnect = vi.fn();
        topSignals.add(topDisconnect);
        registry.set(1, 1, fakeWindow('top'), topSignals);
        registry.set(1, 2, fakeWindow('bottom'), new SignalManager());

        registry.deleteTile(1, 1);

        expect(topDisconnect).toHaveBeenCalledTimes(1);
        expect(registry.get(1, 1)).toBeUndefined();
        expect(registry.get(1, 2)).toBeDefined();
    });

    it('deleteColumn destroys every tile\'s signals under that column', () => {
        const registry = new ColumnRegistry();
        const disconnectA = vi.fn();
        const disconnectB = vi.fn();
        const signalsA = new SignalManager();
        signalsA.add(disconnectA);
        const signalsB = new SignalManager();
        signalsB.add(disconnectB);
        registry.set(1, 1, fakeWindow('a'), signalsA);
        registry.set(1, 2, fakeWindow('b'), signalsB);

        registry.deleteColumn(1);

        expect(disconnectA).toHaveBeenCalledTimes(1);
        expect(disconnectB).toHaveBeenCalledTimes(1);
        expect(registry.windowsInColumn(1)).toEqual([]);
    });

    it('reports empty only when it holds no columns', () => {
        const registry = new ColumnRegistry();
        expect(registry.isEmpty()).toBe(true);

        registry.set(1, 1, fakeWindow('w1'), new SignalManager());
        expect(registry.isEmpty()).toBe(false);

        registry.deleteColumn(1);
        expect(registry.isEmpty()).toBe(true);
    });

    it('lists every registered window across every column and tile', () => {
        const registry = new ColumnRegistry();
        const w1 = fakeWindow('w1');
        const w2 = fakeWindow('w2');
        registry.set(1, 1, w1, new SignalManager());
        registry.set(2, 1, w2, new SignalManager());

        expect(registry.windows()).toEqual(expect.arrayContaining([w1, w2]));
        expect(registry.windows()).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `set`/`get` are still single-arg (column-only), `tileOf`/`moveWindow`/`windowsInColumn`/`deleteTile`/`deleteColumn` don't exist.

- [ ] **Step 3: Write minimal implementation**

Replace `src/runtime/column-registry.ts` entirely with:

```typescript
// Maps (columnId, tileId) pairs to the live WindowAdapter tiled there, plus that
// window's signal connections — the only place runtime code holds a KWin window
// reference per tile (docs: 2026-09-03-vertical-tiling-design).

import type { WindowAdapter } from '../kwin/window-adapter';
import type { SignalManager } from '../utils/signal-manager';

interface Entry {
    window: WindowAdapter;
    signals: SignalManager;
}

export interface TileLocation {
    columnId: number;
    tileId: number;
}

export class ColumnRegistry {
    private readonly byColumn = new Map<number, Map<number, Entry>>();

    set(columnId: number, tileId: number, window: WindowAdapter, signals: SignalManager): void {
        let tiles = this.byColumn.get(columnId);
        if (tiles === undefined) {
            tiles = new Map();
            this.byColumn.set(columnId, tiles);
        }
        tiles.set(tileId, { window, signals });
    }

    get(columnId: number, tileId: number): WindowAdapter | undefined {
        return this.byColumn.get(columnId)?.get(tileId)?.window;
    }

    tileOf(windowId: string): TileLocation | null {
        for (const [columnId, tiles] of this.byColumn) {
            for (const [tileId, entry] of tiles) {
                if (entry.window.id === windowId) {
                    return { columnId, tileId };
                }
            }
        }
        return null;
    }

    columnOf(windowId: string): number | null {
        return this.tileOf(windowId)?.columnId ?? null;
    }

    /** Every window registered under a column, in no particular tile order — used
     * where a whole column is being torn down or moved as a unit. */
    windowsInColumn(columnId: number): WindowAdapter[] {
        const tiles = this.byColumn.get(columnId);
        return tiles === undefined ? [] : Array.from(tiles.values(), (entry) => entry.window);
    }

    isEmpty(): boolean {
        return this.byColumn.size === 0;
    }

    windows(): WindowAdapter[] {
        const result: WindowAdapter[] = [];
        for (const tiles of this.byColumn.values()) {
            for (const entry of tiles.values()) {
                result.push(entry.window);
            }
        }
        return result;
    }

    /** Moves one window's registration between (column, tile) slots, preserving its
     * signal connections — used by absorb/expel, which relocate a window between
     * column-hood and tile-hood without tearing down its listeners. */
    moveWindow(fromColumnId: number, fromTileId: number, toColumnId: number, toTileId: number): void {
        const tiles = this.byColumn.get(fromColumnId);
        if (tiles === undefined) {
            return;
        }
        const entry = tiles.get(fromTileId);
        if (entry === undefined) {
            return;
        }
        tiles.delete(fromTileId);
        if (tiles.size === 0) {
            this.byColumn.delete(fromColumnId);
        }
        this.set(toColumnId, toTileId, entry.window, entry.signals);
    }

    deleteTile(columnId: number, tileId: number): void {
        const tiles = this.byColumn.get(columnId);
        if (tiles === undefined) {
            return;
        }
        const entry = tiles.get(tileId);
        if (entry === undefined) {
            return;
        }
        entry.signals.destroy();
        tiles.delete(tileId);
        if (tiles.size === 0) {
            this.byColumn.delete(columnId);
        }
    }

    deleteColumn(columnId: number): void {
        const tiles = this.byColumn.get(columnId);
        if (tiles === undefined) {
            return;
        }
        for (const entry of tiles.values()) {
            entry.signals.destroy();
        }
        this.byColumn.delete(columnId);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS for `column-registry.test.ts`. `src/runtime/strip.ts`, `src/debug/snapshot.ts`, and `src/ui/minimap.ts` will now fail to compile (`registry.get(id)`/`registry.delete(id)` no longer exist) — expected here, fixed in Tasks 5–7.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run lint` run (confirm remaining failures are only in `strip.ts`/`snapshot.ts`/`minimap.ts`, addressed next)

---

### Task 5: Debug console and minimap read the focused tile

**Files:**
- Modify: `src/debug/snapshot.ts`, `src/ui/minimap.ts`
- Test: `src/debug/snapshot.test.ts`, `src/ui/minimap.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/debug/snapshot.test.ts`, find the existing test(s) that call `registry.set(columnId, window, signals)` and update them to the new 4-arg `set(columnId, tileId, window, signals)` — pass the column's actual tile id (from `column.tiles()[0].id` if the test constructs a real `Column`/`Grid`, or a literal `1` if it fakes the registry directly). Add one new case:

```typescript
it('shows the focused tile\'s window for a stacked column', () => {
    const grid = new Grid(1000, 0);
    const registry = new ColumnRegistry();
    const column = grid.addColumn(300);
    const topId = column.tiles()[0].id;
    const bottomId = column.addTile();
    registry.set(column.id, topId, { id: 'top', caption: 'Top', frameGeometry: () => ({ x: 0, y: 0, width: 300, height: 500 }) } as unknown as WindowAdapter, new SignalManager());
    registry.set(column.id, bottomId, { id: 'bottom', caption: 'Bottom', frameGeometry: () => ({ x: 0, y: 500, width: 300, height: 500 }) } as unknown as WindowAdapter, new SignalManager());
    column.setFocusedTile(bottomId);

    const [row] = debugRows(grid, registry);

    expect(row.id).toBe('bottom');
});
```

Add matching imports (`Grid`, `ColumnRegistry`, `SignalManager`, `WindowAdapter` type) at the top if not already present.

Apply the same pattern to `src/ui/minimap.test.ts`: update existing `registry.set(...)` calls to the 4-arg form, and add an equivalent "shows the focused tile's icon/thumbnail" case for `buildMinimapSnapshot`.

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `registry.set`/`registry.get` calls with the old arity are compile errors; the new focused-tile case fails because `debugRows`/`buildMinimapSnapshot` still call `registry.get(column.id)`.

- [ ] **Step 3: Write minimal implementation**

In `src/debug/snapshot.ts`, change:

```typescript
        const win = registry.get(column.id);
```

to:

```typescript
        const win = registry.get(column.id, column.focusedTileId);
```

In `src/ui/minimap.ts`, change:

```typescript
            const window = registry.get(column.id);
```

to:

```typescript
            const window = registry.get(column.id, column.focusedTileId);
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS for both test files.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run lint` passing

---

### Task 6: `window-events.ts` resizes tiles and tracks fullscreen/minimize per tile

**Files:**
- Modify: `src/runtime/window-events.ts`
- Test: `src/runtime/window-events.test.ts`

- [ ] **Step 1: Write the failing tests**

Read the existing `src/runtime/window-events.test.ts` first to match its fake-`WindowEventDeps`/fake-`WindowAdapter` helper style exactly (it already builds a deps object with `vi.fn()` for each method — extend that same fake with the new methods below rather than introducing a second helper). Add these cases, adapting variable names to whatever the file's existing fakes are called:

```typescript
describe('onWindowGeometryChanged — tile height resize', () => {
    it('resizes the tile when a stacked window\'s height-only change is interactive', () => {
        const win = fakeWindow('w1', { isInteractiveResize: true });
        const deps = fakeDeps({ tileOf: () => ({ columnId: 1, tileId: 2 }) });
        const oldRect = { x: 0, y: 0, width: 300, height: 500 };
        win.setGeometry({ x: 0, y: 0, width: 300, height: 550 });

        onWindowGeometryChanged(win, oldRect, deps);

        expect(deps.resizeTile).toHaveBeenCalledWith(1, 2, 550, 'bottom');
        expect(deps.render).toHaveBeenCalledWith('w1', true);
    });

    it('does nothing for a height-only change on a plain (non-stacked) column', () => {
        const win = fakeWindow('w1');
        const deps = fakeDeps({ tileOf: () => null });
        const oldRect = { x: 0, y: 0, width: 300, height: 500 };
        win.setGeometry({ x: 0, y: 0, width: 300, height: 550 });

        onWindowGeometryChanged(win, oldRect, deps);

        expect(deps.resizeTile).not.toHaveBeenCalled();
        expect(deps.resizeColumn).not.toHaveBeenCalled();
    });

    it('ignores a pure move (neither width nor height changed)', () => {
        const win = fakeWindow('w1');
        const deps = fakeDeps({ tileOf: () => ({ columnId: 1, tileId: 2 }) });
        const oldRect = { x: 0, y: 0, width: 300, height: 500 };
        win.setGeometry({ x: 50, y: 0, width: 300, height: 500 });

        onWindowGeometryChanged(win, oldRect, deps);

        expect(deps.resizeTile).not.toHaveBeenCalled();
    });
});

describe('onFullScreenChanged — tile-aware', () => {
    it('calls setFullScreen with the window\'s (columnId, tileId), not just columnId', () => {
        const win = fakeWindow('w1', { fullScreen: true });
        const deps = fakeDeps({ tileOf: () => ({ columnId: 3, tileId: 7 }) });

        onFullScreenChanged(win, deps);

        expect(deps.setFullScreen).toHaveBeenCalledWith(3, 7, true);
    });

    it('does nothing when the window is not registered to any tile', () => {
        const win = fakeWindow('w1');
        const deps = fakeDeps({ tileOf: () => null });

        onFullScreenChanged(win, deps);

        expect(deps.setFullScreen).not.toHaveBeenCalled();
    });
});

describe('onMinimizedChanged — tile-aware', () => {
    it('calls hideTile/showTile with (columnId, tileId), not hideColumn/showColumn directly', () => {
        const deps = fakeDeps({ tileOf: () => ({ columnId: 3, tileId: 7 }) });
        const win = fakeWindow('w1', { minimized: true });

        onMinimizedChanged(win, deps);
        expect(deps.hideTile).toHaveBeenCalledWith(3, 7);

        win.setMinimized(false);
        onMinimizedChanged(win, deps);
        expect(deps.showTile).toHaveBeenCalledWith(3, 7);
    });
});
```

Adjust each test to whatever the file's existing `fakeWindow`/deps-builder helpers actually look like — reuse them, don't duplicate. If the file's fake deps object is built inline per test rather than via a `fakeDeps()` helper, add `tileOf`, `resizeTile`, `hideTile`, `showTile` as `vi.fn()` entries alongside the existing ones in that inline object at each call site instead.

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `WindowEventDeps` has no `tileOf`/`resizeTile`/`hideTile`/`showTile`; `setFullScreen` is still 2-arg; existing `hideColumn`/`showColumn` calls in `onMinimizedChanged` don't match the new expectations.

- [ ] **Step 3: Write minimal implementation**

Replace `src/runtime/window-events.ts` entirely with:

```typescript
// KWin window-signal handlers, extracted from main.ts's init() closures into pure
// functions that take their dependencies explicitly (a Strip satisfies WindowEventDeps),
// so the guard logic is unit-testable without a live compositor.

import {
    rectsEqualRounded,
    resizedEdge,
    verticalResizedEdge,
    type Rect,
    type ResizeEdge,
    type VerticalResizeEdge,
} from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { TileLocation } from './column-registry';

export interface WindowEventDeps {
    columnOf(windowId: string): number | null;
    tileOf(windowId: string): TileLocation | null;
    isHidden(columnId: number): boolean;
    isEcho(windowId: string, rect: Rect): boolean;
    resizeColumn(columnId: number, width: number, edge: ResizeEdge): void;
    resizeTile(columnId: number, tileId: number, height: number, edge: VerticalResizeEdge): void;
    hideColumn(columnId: number): void;
    showColumn(columnId: number): void;
    /** Hides/shows one tile's window without collapsing the rest of the column's
     * layout — used instead of hideColumn/showColumn when the window belongs to a
     * multi-tile stack (docs: 2026-09-03-vertical-tiling-design). */
    hideTile(columnId: number, tileId: number): void;
    showTile(columnId: number, tileId: number): void;
    setFullScreen(columnId: number, tileId: number, fullScreen: boolean): void;
    /** `instant`, when true, skips per-column position animation entirely — used for a
     * live interactive resize's neighbors, which must track the cursor with zero lag. */
    render(excludeWindowId?: string, instant?: boolean): void;
    revealFocused(): void;
    /** Whether `win`'s geometry already covers its output's fullscreen area (see workspace-adapter.ts). */
    isFullScreenGeometry(win: WindowAdapter): boolean;
}

export function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect, deps: WindowEventDeps): void {
    if (win.isFullScreen()) {
        return; // Drift never resizes columns/tiles or re-lays-out for a fullscreen window.
    }
    const columnId = deps.columnOf(win.id);
    if (columnId === null || deps.isHidden(columnId)) {
        return;
    }
    const newReal = win.frameGeometry();
    if (rectsEqualRounded(oldReal, newReal)) {
        return;
    }
    if (deps.isEcho(win.id, newReal)) {
        return;
    }
    if (Math.round(newReal.width) === Math.round(oldReal.width)) {
        if (Math.round(newReal.height) === Math.round(oldReal.height)) {
            return; // pure move: neither dimension changed
        }
        const location = deps.tileOf(win.id);
        if (location === null) {
            return; // height-only change on a plain (non-stacked) column: still ignored
        }
        deps.resizeTile(location.columnId, location.tileId, Math.round(newReal.height), verticalResizedEdge(oldReal, newReal));
        deps.render(win.id, true);
        return;
    }
    if (win.isInteractiveResize()) {
        // A live border drag can tell us the left edge genuinely moved, and needs to render
        // immediately (excluding itself, and skipping neighbor animation) to track the pointer
        // without stutter.
        deps.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
        deps.render(win.id, true);
        return;
    }
    // This can be the compositor resizing the frame to cover the screen as the *first* step of
    // entering fullscreen, before it flips `fullScreen` / emits fullScreenChanged (the two
    // events' relative order isn't guaranteed) — `win.isFullScreen()` above cannot be trusted for
    // this specific transition. Check the geometry's shape instead of the live property.
    if (deps.isFullScreenGeometry(win)) {
        return;
    }
    // A programmatic jump (maximize, quick-tile, snap) reports whatever x the compositor chose
    // for the new size, which is meaningless as a drag direction and would otherwise corrupt the
    // strip's origin — treat it as a right-edge resize that leaves the column's own virtual x
    // untouched.
    deps.resizeColumn(columnId, Math.round(newReal.width), 'right');
    deps.render();
    // A programmatic resize (e.g. maximize) can grow a column out of view without any focus
    // change to trigger a reveal — re-check now, not just on the next focus switch.
    deps.revealFocused();
}

export function onMinimizedChanged(win: WindowAdapter, deps: WindowEventDeps): void {
    const location = deps.tileOf(win.id);
    if (location === null) {
        return;
    }
    if (win.isMinimized()) {
        deps.hideTile(location.columnId, location.tileId);
        deps.render();
        // Collapsing the hidden column's gap can slide a still-visible neighbor out from
        // under the (unchanged) viewport offset — re-check now, not just on the next focus
        // switch. Restoring deliberately skips this: it must not move the camera (docs:
        // 2026-08-30-minimized-windows-design).
        deps.revealFocused();
    } else {
        deps.showTile(location.columnId, location.tileId);
        deps.render();
    }
}

export function onFullScreenChanged(win: WindowAdapter, deps: WindowEventDeps): void {
    const location = deps.tileOf(win.id);
    if (location === null) {
        return;
    }
    deps.setFullScreen(location.columnId, location.tileId, win.isFullScreen());
    deps.render();
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: FAIL until Task 7 supplies matching `hideTile`/`showTile`/`resizeTile`/`tileOf`/`setFullScreen`(3-arg) on `Strip.eventDeps()` — the pure `window-events.test.ts` cases above should already PASS on their own, since they test the pure functions against a fake `deps` object, not the real `Strip`.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm test -- window-events` passing in isolation

---

### Task 7: `Strip` becomes tile-aware

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

This is the largest task — it wires everything from Tasks 1–6 into the runtime orchestration layer. Read the whole of `src/runtime/strip.ts` and the top ~150 lines of `src/runtime/strip.test.ts` (its `fakeWindow`/`FakeWindow` helper) before starting, since several edits below reference exact existing line ranges.

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip.test.ts`, reusing its existing `fakeWindow`/`fakeTimer`/`fakeWorkspaceAdapter` helpers and `AREA`/`INSTANT_SETTINGS` constants:

```typescript
describe('Strip — absorb/expel', () => {
    it('absorbRight merges the right column into the focused one as a new tile', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        // addWindow focuses the newly added column each time — refocus "left" explicitly.
        strip.focusLeft();

        strip.absorbRight();

        expect(left.setFrameGeometry).toHaveBeenCalled();
        expect(right.setFrameGeometry).toHaveBeenCalled();
        const leftCalls = left.setFrameGeometry.mock.calls;
        const rightCalls = right.setFrameGeometry.mock.calls;
        const leftRect = leftCalls[leftCalls.length - 1][0];
        const rightRect = rightCalls[rightCalls.length - 1][0];
        expect(leftRect.x).toBe(rightRect.x); // same column now
        expect(leftRect.y).toBe(0);
        expect(rightRect.y).toBe(leftRect.height); // stacked below
    });

    it('absorbRight is a no-op with no right neighbor', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);
        const callsBefore = only.setFrameGeometry.mock.calls.length;

        strip.absorbRight();

        expect(only.setFrameGeometry.mock.calls.length).toBe(callsBefore);
    });

    it('expel moves the focused tile back into its own column to the right', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column now has 2 tiles: left (focused), right

        strip.expel();

        const leftRect = left.setFrameGeometry.mock.calls.at(-1)![0];
        const rightRect = right.setFrameGeometry.mock.calls.at(-1)![0];
        expect(leftRect.height).toBe(AREA.height); // left is alone in its column again
        expect(rightRect.x).toBeGreaterThan(leftRect.x); // right got its own column to the right
    });

    it('expel is a no-op on a single-tile column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);
        const callsBefore = only.setFrameGeometry.mock.calls.length;

        strip.expel();

        expect(only.setFrameGeometry.mock.calls.length).toBe(callsBefore);
    });
});

describe('Strip — focusUp/focusDown', () => {
    it('move activation between tiles in the focused column\'s stack', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column: [left (focused), right]
        left.activate.mockClear();
        right.activate.mockClear();

        strip.focusDown();
        expect(right.activate).toHaveBeenCalledTimes(1);

        strip.focusDown(); // already at the bottom — no-op
        expect(right.activate).toHaveBeenCalledTimes(1);

        strip.focusUp();
        expect(left.activate).toHaveBeenCalledTimes(1);
    });
});

describe('Strip — removeWindow on a stacked column', () => {
    it('removes just that tile, redistributing height, when siblings remain', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column: [left, right]

        strip.removeWindow(right.adapter);

        const leftRect = left.setFrameGeometry.mock.calls.at(-1)![0];
        expect(leftRect.height).toBe(AREA.height); // left alone again, full height
    });

    it('removes the whole column when it was the only tile', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);

        strip.removeWindow(only.adapter);

        expect(strip.isEmpty()).toBe(true);
    });
});

describe('Strip — detachFocusedColumn returns every tile\'s window', () => {
    it('returns all windows in a stacked column, and clears the strip', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight();

        const detached = strip.detachFocusedColumn();

        expect(detached.map((w) => w.id)).toEqual(expect.arrayContaining(['left', 'right']));
        expect(detached).toHaveLength(2);
        expect(strip.isEmpty()).toBe(true);
    });

    it('returns an empty array when the strip has no columns', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(strip.detachFocusedColumn()).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `absorbRight`/`expel`/`focusUp`/`focusDown` don't exist; `detachFocusedColumn` still returns `WindowAdapter | null`; the whole file fails to compile against Task 4's new `ColumnRegistry` API.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip.ts`:

Rename the fullscreen-tracking field and add a minimize-tracking one, plus a shared key helper. Replace:

```typescript
    // Tracks fullscreen state per column, updated only by the window's fullScreenChanged
    // signal (never by re-reading the live property from an unrelated render() call — KWin's
    // own docs warn the property is only reliably observed via its notify signal).
    private readonly fullScreenColumns = new Set<number>();
```

with:

```typescript
    // Tracks fullscreen/minimized state per TILE (not per column, since a stacked column
    // can have one tile fullscreen/minimized while its siblings stay visible underneath),
    // keyed by `${columnId}:${tileId}`. Fullscreen state is updated only by the window's
    // fullScreenChanged signal (never by re-reading the live property from an unrelated
    // render() call — KWin's own docs warn the property is only reliably observed via its
    // notify signal). Minimized state mirrors this for the same "don't corrupt siblings"
    // reason — a 1-tile column keeps using Grid's column-level hideColumn/showColumn
    // instead, unchanged (docs: 2026-09-03-vertical-tiling-design).
    private readonly fullScreenTiles = new Set<string>();
    private readonly minimizedTiles = new Set<string>();
```

Add this private helper near the bottom of the class, alongside the other private helpers:

```typescript
    private tileKey(columnId: number, tileId: number): string {
        return `${columnId}:${tileId}`;
    }
```

Replace `render()`'s body:

```typescript
    render(excludeWindowId?: string, instant = false, verticalOffsetY?: number): void {
        if (verticalOffsetY !== undefined) {
            this.verticalOffsetY = verticalOffsetY;
        }
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            const columnRect = this.grid.columnRect(column.id);
            if (column.hidden) {
                for (const tile of column.tiles()) {
                    const win = this.registry.get(column.id, tile.id);
                    if (!win || win.id === excludeWindowId || this.fullScreenTiles.has(this.tileKey(column.id, tile.id))) {
                        continue;
                    }
                    // No position animation for a minimized window — nothing on screen to smooth,
                    // and this keeps its real x tracking the viewport pan instead of freezing it
                    // (a taskbar sorted by real x would otherwise see it drift out of order).
                    this.geometrySync.apply(win, column.tileRect(tile.id, columnRect), this.viewport.offset(), this.verticalOffsetY);
                }
                continue;
            }
            let x: number;
            if (instant) {
                this.columnMotion.snapTo(column.id, columnRect.x);
                x = columnRect.x;
            } else {
                x = this.columnMotion.update(column.id, columnRect.x, Date.now(), this.settings.animationDurationMs);
            }
            for (const tile of column.tiles()) {
                const key = this.tileKey(column.id, tile.id);
                if (this.fullScreenTiles.has(key) || this.minimizedTiles.has(key)) {
                    continue;
                }
                const win = this.registry.get(column.id, tile.id);
                if (!win || win.id === excludeWindowId) {
                    continue;
                }
                const rect = column.tileRect(tile.id, columnRect);
                this.geometrySync.apply(win, Object.assign({}, rect, { x }), this.viewport.offset(), this.verticalOffsetY);
            }
        }
        if (this.columnMotion.isAnimating()) {
            // Preserve excludeWindowId: a live drag-reorder must keep skipping the
            // dragged window's own geometry across continuation ticks, not just the first.
            this.columnMotionTimer.start(this.settings.animationTickMs, () => this.render(excludeWindowId, false));
        } else {
            this.columnMotionTimer.stop();
        }
        setDebugState(
            formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()),
        );
    }
```

Replace `addWindow`'s registry line and fullscreen-init line:

```typescript
        this.registry.set(column.id, column.focusedTileId, win, signals);
        if (win.isMinimized()) {
            this.grid.hideColumn(column.id);
        }
        if (win.isFullScreen()) {
            this.fullScreenTiles.add(this.tileKey(column.id, column.focusedTileId));
        }
```

Replace `removeWindow`:

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
            this.fullScreenTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.minimizedTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.render();
            this.revealFocused();
            return;
        }
        this.detachColumn(location.columnId, [win]);
    }
```

Replace `detachFocusedColumn` and `detachColumn`:

```typescript
    /** Detaches the whole focused column — every tile's window, as a unit — from this
     * strip, returning them so a caller (StripStack's cross-row move) can re-add them
     * elsewhere. A stacked column's tiles are NOT preserved as a stack in the target
     * row this pass — each is re-added via addWindow as its own column there (docs:
     * 2026-09-03-vertical-tiling-design, Out of Scope). Empty array if there's nothing
     * to detach. */
    detachFocusedColumn(): WindowAdapter[] {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return [];
        }
        const windows = this.registry.windowsInColumn(focused.id);
        if (windows.length === 0) {
            return [];
        }
        this.detachColumn(focused.id, windows);
        return windows;
    }

    /** Shared teardown for `removeWindow` (single-tile column case) and
     * `detachFocusedColumn`: forgets every one of `windows`' geometry-sync/motion/
     * fullscreen/minimize state, removes the column from the grid, and re-renders. */
    private detachColumn(columnId: number, windows: WindowAdapter[]): void {
        this.registry.deleteColumn(columnId);
        for (const win of windows) {
            this.geometrySync.forget(win.id);
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

Replace `activateWindow` and `activateColumn`:

```typescript
    activateWindow(win: WindowAdapter): void {
        const location = this.registry.tileOf(win.id);
        if (location === null) {
            return;
        }
        this.grid.setFocus(location.columnId);
        this.grid.column(location.columnId)?.setFocusedTile(location.tileId);
        this.revealFocused();
    }
```

```typescript
    private activateColumn(column: Column | null): void {
        if (column !== null) {
            this.registry.get(column.id, column.focusedTileId)?.activate();
        }
        this.revealFocused();
    }
```

Add these new public methods, near `focusLeft`/`focusRight`:

```typescript
    /** Moves tile focus up within the focused column's stack and activates the newly
     * focused tile's window. No-op if there's no focused column or it's not a stack. */
    focusUp(): void {
        this.moveTileFocus((column) => column.focusUp());
    }

    /** Moves tile focus down within the focused column's stack. */
    focusDown(): void {
        this.moveTileFocus((column) => column.focusDown());
    }

    private moveTileFocus(move: (column: Column) => void): void {
        const column = this.grid.focusedColumn();
        if (column === null) {
            return;
        }
        move(column);
        this.registry.get(column.id, column.focusedTileId)?.activate();
        this.revealFocused();
    }

    /** Absorb: pull the column to the right of the focused one into its stack, as a
     * new tile at the bottom. No-op if there's no right neighbor or it's already a
     * stack (docs: 2026-09-03-vertical-tiling-design). */
    absorbRight(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const result = this.grid.absorbColumnRight(focused.id);
        if (result === null) {
            return;
        }
        this.registry.moveWindow(result.fromColumnId, result.fromTileId, focused.id, result.toTileId);
        this.fullScreenTiles.delete(this.tileKey(result.fromColumnId, result.fromTileId));
        this.minimizedTiles.delete(this.tileKey(result.fromColumnId, result.fromTileId));
        this.columnMotion.forget(result.fromColumnId);
        this.render();
        this.revealFocused();
    }

    /** Expel: remove the focused tile from the focused column's stack and give it its
     * own new column to the right. No-op on a single-tile column. */
    expel(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const result = this.grid.expelFocusedTile(focused.id, this.settings.defaultColumnWidth);
        if (result === null) {
            return;
        }
        this.registry.moveWindow(focused.id, result.fromTileId, result.toColumnId, result.toTileId);
        this.render();
        this.revealFocused();
    }
```

Update `eventDeps()` to supply the new/changed dependencies:

```typescript
    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            tileOf: (windowId) => this.registry.tileOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
            resizeTile: (columnId, tileId, height, edge) => {
                this.grid.column(columnId)?.resizeTile(tileId, height, edge);
            },
            hideColumn: (columnId) => {
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
            showColumn: (columnId) => this.grid.showColumn(columnId),
            hideTile: (columnId, tileId) => {
                const column = this.grid.column(columnId);
                if (column !== null && column.tileCount() > 1) {
                    this.minimizedTiles.add(this.tileKey(columnId, tileId));
                    return;
                }
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
            showTile: (columnId, tileId) => {
                const column = this.grid.column(columnId);
                if (column !== null && column.tileCount() > 1) {
                    this.minimizedTiles.delete(this.tileKey(columnId, tileId));
                    return;
                }
                this.grid.showColumn(columnId);
            },
            setFullScreen: (columnId, tileId, fullScreen) => {
                const key = this.tileKey(columnId, tileId);
                if (fullScreen) {
                    this.fullScreenTiles.add(key);
                    this.columnMotion.forget(columnId);
                } else {
                    this.fullScreenTiles.delete(key);
                }
            },
            render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
            revealFocused: () => this.revealFocused(),
            isFullScreenGeometry: (win) => this.workspaceAdapter.isFullScreenGeometry(win),
        };
    }
```

Update the two existing `strip.test.ts` tests that call `detachFocusedColumn()` expecting a single `WindowAdapter | null` (search the file for `detachFocusedColumn`) to expect an array instead — e.g. `expect(detached).toEqual([win.adapter])` instead of `expect(detached).toBe(win.adapter)`, and `expect(strip.detachFocusedColumn()).toEqual([])` instead of `toBeNull()`.

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: FAIL until Task 8 updates `strip-stack.ts`'s call site (`moveFocusedWindowToRow`) to match the new `detachFocusedColumn(): WindowAdapter[]` signature — `strip.test.ts` itself should PASS in isolation: `npm test -- strip.test`

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm test -- strip.test` passing in isolation
- [ ] `npm run lint` run (confirm remaining failures are only in `strip-stack.ts`, addressed next)

---

### Task 8: `StripStack` passthroughs and cross-row move fix

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Read `src/runtime/strip-stack.test.ts`'s existing mock-`Strip` setup first (it builds a fake `Strip` per row with `vi.fn()` methods — the grep below shows every current `detachFocusedColumn` mock call site needs updating). Add:

```typescript
describe('StripStack — focusUp/focusDown/absorbRight/expel', () => {
    it('delegate to the active row\'s Strip', () => {
        const stack = new StripStack(/* ...existing constructor args from other tests in this file... */);
        stack.focusUp();
        stack.focusDown();
        stack.absorbRight();
        stack.expel();
        const activeStrip = /* however this file's other tests retrieve the created Strip mock for the active row, e.g. created[0] */;
        expect(activeStrip.focusUp).toHaveBeenCalledTimes(1);
        expect(activeStrip.focusDown).toHaveBeenCalledTimes(1);
        expect(activeStrip.absorbRight).toHaveBeenCalledTimes(1);
        expect(activeStrip.expel).toHaveBeenCalledTimes(1);
    });
});

describe('StripStack — moveFocusedWindowToRow with a stacked column', () => {
    it('re-adds every window detachFocusedColumn returns, each to its own column in the target row', () => {
        const win1 = /* fake WindowAdapter, id 'w1' */;
        const win2 = /* fake WindowAdapter, id 'w2' */;
        // Follow this file's existing pattern (see the single-window moveWindowToRowBelow
        // tests already in this file) for constructing the stack and stubbing the source
        // row's Strip mock, but mock detachFocusedColumn to return [win1, win2]:
        created[0].detachFocusedColumn.mockReturnValue([win1, win2]);

        stack.moveWindowToRowBelow();

        expect(created[1].addWindow).toHaveBeenCalledWith(win1, false, expect.anything());
        expect(created[1].addWindow).toHaveBeenCalledWith(win2, false, expect.anything());
    });

    it('is a no-op when detachFocusedColumn returns an empty array', () => {
        created[0].detachFocusedColumn.mockReturnValue([]);
        const targetAddWindowCallsBefore = created[1].addWindow.mock.calls.length;

        stack.moveWindowToRowBelow();

        expect(created[1].addWindow.mock.calls.length).toBe(targetAddWindowCallsBefore);
    });
});
```

The two placeholder-style blocks above are intentionally written to match this file's *existing* fixture conventions rather than invent new ones — before writing them for real, look at how the existing `moveWindowToRowAbove`/`moveWindowToRowBelow` tests in this file construct `stack` and `created[]`, and copy that setup verbatim. Also update every existing `detachFocusedColumn.mockReturnValue(win)` in this file (there are ~10, listed by `grep -n "detachFocusedColumn.mockReturnValue" src/runtime/strip-stack.test.ts`) to `mockReturnValue([win])`, and every `detachFocusedColumn.mockReturnValue(null)` to `mockReturnValue([])`, plus the default `detachFocusedColumn: vi.fn(() => null)` in the mock-`Strip` factory to `vi.fn(() => [])`. Also add `focusUp: vi.fn()`, `focusDown: vi.fn()`, `absorbRight: vi.fn()`, `expel: vi.fn()` to that same mock-`Strip` factory, alongside its existing `focusLeft`/`cycleAlignLeft`/etc. entries.

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `StripStack` has no `focusUp`/`focusDown`/`absorbRight`/`expel`; `moveFocusedWindowToRow` still expects a single `WindowAdapter | null` from `detachFocusedColumn`.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip-stack.ts`, add these methods near `focusLeft`/`cycleAlignLeft`:

```typescript
    focusUp(): void {
        this.activeStrip().focusUp();
    }

    focusDown(): void {
        this.activeStrip().focusDown();
    }

    absorbRight(): void {
        this.activeStrip().absorbRight();
    }

    expel(): void {
        this.activeStrip().expel();
    }
```

Replace `moveFocusedWindowToRow`:

```typescript
    private moveFocusedWindowToRow(
        targetIndex: number,
        options: { excludeWindowId?: string; initiallyDragging?: boolean } = {},
    ): void {
        const sourceIndex = this.activeRowIndex;
        const windows = this.requireRow(sourceIndex).detachFocusedColumn();
        if (windows.length === 0) {
            return;
        }
        for (const win of windows) {
            this.rowByWindow.delete(win.id);
        }
        // If this emptied the source row, switchToRow's trailing pruneIfEmpty(oldIndex) removes it —
        // no separate cleanup needed here. Must run before addWindow so the target row's remembered
        // offset is primed to its correct resting position before anything renders into it.
        this.switchToRow(targetIndex, options.excludeWindowId);
        const targetStrip = this.row(targetIndex);
        // A stacked column's tiles are NOT kept stacked across rows this pass — each window
        // becomes its own column in the target row (docs: 2026-09-03-vertical-tiling-design,
        // Out of Scope). The overwhelmingly common case is a single window here, unaffected.
        for (const win of windows) {
            targetStrip.addWindow(win, options.initiallyDragging ?? false, this.rowDragHooks());
            this.rowByWindow.set(win.id, targetIndex);
        }
    }
```

Update `ShortcutActions`-adjacent usages if `StripStack` implements any shared interface listing these methods explicitly — check whether `Strip` and `StripStack` share a TypeScript interface anywhere (`grep -n "focusLeft(): void" src/runtime/*.ts`); if so, add `focusUp`/`focusDown`/`absorbRight`/`expel` to it too, matching the existing entries.

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS for `strip-stack.test.ts`.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run lint` passing
- [ ] `npm test` passing (full suite — this should be the first point where everything is green again)

---

### Task 9: Settings — 4 new shortcuts

**Files:**
- Modify: `src/config/settings.ts`
- Test: `src/config/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Read `src/config/settings.test.ts`'s existing pattern for one of the shortcut settings (e.g. `shortcutRowUp`) and add four matching cases for `shortcutFocusUp`, `shortcutFocusDown`, `shortcutAbsorbRight`, `shortcutExpel` — both the `DEFAULT_SETTINGS` default-value assertion and the `loadSettings()`-reads-from-config-override assertion, following that file's existing structure exactly (likely a table-driven `it.each` or repeated `it()` blocks — match whichever it already uses).

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — the four keys don't exist on `Settings`/`DEFAULT_SETTINGS` yet.

- [ ] **Step 3: Write minimal implementation**

In `src/config/settings.ts`, add to the `Settings` interface, after `shortcutMoveWindowToRowBelow`:

```typescript
    /** Shortcut sequence for moving tile focus up within the focused column's stack
     * (docs: 2026-09-03-vertical-tiling-design). */
    shortcutFocusUp: string;
    /** Shortcut sequence for moving tile focus down within the focused column's stack. */
    shortcutFocusDown: string;
    /** Shortcut sequence for absorbing the column to the right into the focused
     * column's stack, as a new tile. */
    shortcutAbsorbRight: string;
    /** Shortcut sequence for expelling the focused tile into its own new column
     * to the right. */
    shortcutExpel: string;
```

Add to `DEFAULT_SETTINGS`, after `shortcutMoveWindowToRowBelow`:

```typescript
    shortcutFocusUp: 'Meta+Alt+Up',
    shortcutFocusDown: 'Meta+Alt+Down',
    shortcutAbsorbRight: 'Meta+I',
    shortcutExpel: 'Meta+O',
```

Add to `loadSettings()`'s `Object.assign`, after the `shortcutMoveWindowToRowBelow` entry:

```typescript
        shortcutFocusUp: readStringConfig('shortcutFocusUp', DEFAULT_SETTINGS.shortcutFocusUp),
        shortcutFocusDown: readStringConfig('shortcutFocusDown', DEFAULT_SETTINGS.shortcutFocusDown),
        shortcutAbsorbRight: readStringConfig('shortcutAbsorbRight', DEFAULT_SETTINGS.shortcutAbsorbRight),
        shortcutExpel: readStringConfig('shortcutExpel', DEFAULT_SETTINGS.shortcutExpel),
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS for `settings.test.ts`. `src/config/shortcuts-consistency.test.ts` will now FAIL (the new `DEFAULT_SETTINGS` keys have no matching entry in `main.xml` yet) — expected here, fixed in Task 11.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm test -- settings.test` passing in isolation

---

### Task 10: Shortcut wiring

**Files:**
- Modify: `src/input/shortcuts.ts`, `src/runtime/controller.ts`
- Test: none dedicated (existing shortcut-registration tests, if any, are in `shortcuts-consistency.test.ts`, covered by Task 11)

- [ ] **Step 1: Write the failing test**

Skip TDD's red/green cycle for this task — `registerShortcuts`/`Controller.start` are thin wiring with no independent unit test today (confirm via `grep -rn "registerShortcuts" src/**/*.test.ts`; if that turns up a test file, read it first and add a case asserting the 4 new `createShortcut` calls, following its existing pattern, before proceeding to Step 3).

- [ ] **Step 2: N/A**

- [ ] **Step 3: Write the implementation**

In `src/input/shortcuts.ts`, add to `ShortcutActions`, after `moveWindowToRowBelow`:

```typescript
    focusUp(): void;
    focusDown(): void;
    absorbRight(): void;
    expel(): void;
```

Add to `registerShortcuts`, after the `DriftMoveWindowToRowBelow` registration:

```typescript
    createShortcut(parent, 'DriftFocusUp', 'Drift: Focus Tile Up', settings.shortcutFocusUp, actions.focusUp);
    createShortcut(parent, 'DriftFocusDown', 'Drift: Focus Tile Down', settings.shortcutFocusDown, actions.focusDown);
    createShortcut(
        parent,
        'DriftAbsorbRight',
        'Drift: Absorb Column Right',
        settings.shortcutAbsorbRight,
        actions.absorbRight,
    );
    createShortcut(parent, 'DriftExpel', 'Drift: Expel Focused Tile', settings.shortcutExpel, actions.expel);
```

In `src/runtime/controller.ts`, add to the `registerShortcuts` call inside `start()`, after `moveWindowToRowBelow`:

```typescript
            focusUp: () => this.focusAndShowMinimap((stack) => stack.focusUp()),
            focusDown: () => this.focusAndShowMinimap((stack) => stack.focusDown()),
            absorbRight: () => this.focusAndShowMinimap((stack) => stack.absorbRight()),
            expel: () => this.focusAndShowMinimap((stack) => stack.expel()),
```

- [ ] **Step 4: Run test to verify it passes**

`npm test` and `npm run build`
Expected: PASS / clean build.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run lint` passing
- [ ] `npm run build` passing

---

### Task 11: `main.xml` and `setup-shortcuts.sh` mirror the new defaults

**Files:**
- Modify: `drift/contents/config/main.xml`, `drift/contents/bin/setup-shortcuts.sh`
- Test: `src/config/shortcuts-consistency.test.ts` (already exists, no changes needed — it auto-discovers new `shortcut*` keys)

- [ ] **Step 1: Confirm the test is already failing for the right reason**

`npm test -- shortcuts-consistency`
Expected: FAIL — `has no DEFAULT_SETTINGS shortcut key that main.xml does not declare` fails for the 4 new keys from Task 9.

- [ ] **Step 2: N/A (no new test to write — this task exists to satisfy the existing one)**

- [ ] **Step 3: Write the implementation**

In `drift/contents/config/main.xml`, add before the closing `</group>`, after the existing `shortcutMoveWindowToRowBelow` entry:

```xml
        <entry name="shortcutFocusUp" type="String">
            <default>Meta+Alt+Up</default>
        </entry>
        <entry name="shortcutFocusDown" type="String">
            <default>Meta+Alt+Down</default>
        </entry>
        <entry name="shortcutAbsorbRight" type="String">
            <default>Meta+I</default>
        </entry>
        <entry name="shortcutExpel" type="String">
            <default>Meta+O</default>
        </entry>
```

In `drift/contents/bin/setup-shortcuts.sh`, add to the `DRIFT_BINDINGS` table, after the `DriftMoveWindowToRowBelow` line, before the closing `'`:

```
DriftFocusUp|Drift: Focus Tile Up|Meta+Alt+Up
DriftFocusDown|Drift: Focus Tile Down|Meta+Alt+Down
DriftAbsorbRight|Drift: Absorb Column Right|Meta+I
DriftExpel|Drift: Expel Focused Tile|Meta+O
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- shortcuts-consistency`
Expected: PASS.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm test` (full suite) passing
- [ ] `npm run lint` passing
- [ ] `npm run build` passing

---

### Task 12: Documentation

**Files:**
- Modify: `docs/architecture.md`, `docs/roadmap.md`, `docs/comparison-paperwm.md`, `docs/comparison-keybindings.md`

- [ ] **Step 1: N/A (documentation task, no test)**

- [ ] **Step 2: N/A**

- [ ] **Step 3: Write the documentation updates**

In `docs/roadmap.md`, remove the "Vertical tiling" bullet entirely (it's now shipped, not roadmap).

In `docs/architecture.md`, replace this sentence in the "Columns" section:

```
Column height always equals the available screen height (minus any reserved margin); there is no vertical tiling within a column yet.
```

with:

```
Column height always equals the available screen height (minus any reserved margin). A column can hold more than one window stacked vertically — an ordered list of *tiles*, each with its own height, summing to the column's fixed total. Absorb (`Meta+I`) pulls the column to the right into the focused column's stack as a new tile; expel (`Meta+O`) pops the focused tile back out into its own column to the right, matching PaperWM's model. `focusUp`/`focusDown` (`Meta+Alt+Up`/`Down`) move focus within a stack; `focusLeft`/`focusRight` keep moving between columns and land on whichever tile was last focused there. See [`docs/agents/specs/2026-09-03-vertical-tiling-design.md`](agents/specs/2026-09-03-vertical-tiling-design.md).
```

In `docs/comparison-paperwm.md`, update the "Vertical (in-column) stacking" comparison-table row from:

```
| Vertical (in-column) stacking | Not yet, see [roadmap](roadmap.md) | Yes — absorb/expel windows into a column, resize stacked heights |
```

to:

```
| Vertical (in-column) stacking | Yes — `Meta+I`/`Meta+O` absorb/expel, resizable tile heights | Yes — absorb/expel windows into a column, resize stacked heights |
```

And update the "Where Drift Has a Real Gap" (or equivalent) bullet that currently reads:

```
- **Vertical stacking** (already on the roadmap) — PaperWM's absorb/expel keybinding pair (`Super+I`/`Super+O`) is a simple, well-tested interaction model to borrow from once Drift's `Column` supports more than one window.
```

Remove this bullet entirely (read the surrounding section first — if it's a numbered/bulleted "gaps" list, removing this item may need renumbering or a note that it's no longer a gap; use judgment based on the actual current text, which may have shifted since this plan was written).

In `docs/comparison-keybindings.md`, in the action-by-action table:

- Row "Focus window above (in-column)": change the Drift and Drift Target columns from `— (no vertical stacking yet)` / `Meta+Up` to `Meta+Alt+Up` / `Meta+Alt+Up` (both — it's shipped now, not a future target, and the old target collided with the already-shipped `shortcutRowUp`).
- Row "Focus window below (in-column)": same pattern, `Meta+Alt+Down` / `Meta+Alt+Down`.
- Row "Move window up/down (in-column)": this plan does not implement moving a tile's *position* within its own stack (only absorb/expel and focus-within-stack) — leave this row's Drift/Drift Target cells as `—` / `Meta+Ctrl+Up / Meta+Ctrl+Down`, unchanged.
- Row "Absorb/expel window (vertical stacking)": change Drift and Drift Target from `— (no vertical stacking yet, see roadmap)` / `Meta+I (absorb)/ Meta+O (expel)` to `Meta+I (absorb) / Meta+O (expel)` / `Meta+I (absorb) / Meta+O (expel)` (both, shipped).

Also update the "Observations for a future keybinding decision" bullet:

```
- **Vertical stacking bindings are a gap by design, not oversight** — Drift doesn't yet support more than one window per column, so absorb/expel and in-column focus/move have no Drift equivalent. When that roadmap item lands, PaperWM's `Super+I`/`Super+O` (absorb/expel) and Niri's `Mod+[`/`Mod+]` (consume/expel) are the two existing naming conventions to choose between.
```

to:

```
- **Vertical stacking bindings shipped using PaperWM's naming convention** — `Meta+I`/`Meta+O` for absorb/expel, matching `Super+I`/`Super+O`. In-column focus (`Meta+Alt+Up`/`Down`) could not reuse this doc's earlier "Drift Target" guess of `Meta+Up`/`Meta+Down`, since those were already claimed by row paging (`shortcutRowUp`/`shortcutRowDown`) by the time this shipped — a reminder that this doc's "Drift Target" column can drift out of sync with `src/config/settings.ts` and should be cross-checked against it, not trusted alone, before implementing a target.
```

- [ ] **Step 4: N/A**

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Writing conventions followed: `docs/coding-conventions.md` and the top-level `AGENTS.md` "Writing Documentation" section (one sentence per line, mandatory)
- [ ] Every internal doc link (`agents/specs/...`, `roadmap.md`, etc.) resolves to a real file
- [ ] `npm run lint` passing (covers markdown/QML lint if configured; confirm scope with `npm run lint -- --help` or the `package.json` script definition if unsure)

---

## Final Verification

After Task 12:

- [ ] `npm test` — full suite passes
- [ ] `npm run lint` — passes
- [ ] `npm run build` — passes
- [ ] Manual smoke test (per the `run` skill, if available, or by loading the built package into a KWin session): open two windows, `Meta+I` to absorb one into the other's column, confirm both are visible stacked with resizable heights (drag the internal window border), `Meta+Alt+Up`/`Down` to move focus between them, `Meta+O` to expel the focused one back into its own column, `Meta+Right`/`Meta+Left` from a stacked column to confirm the adjacent column's own focused tile activates correctly.

## Self-Review Notes (completed during plan authoring)

- **Spec coverage:** every section of the design doc (core model, focus/navigation, absorb/expel, resize, rendering, fallbacks, testing) maps to a task above. The two additions beyond the literal design doc text (per-tile fullscreen/minimize tracking in Task 7, and the `detachFocusedColumn` array-return correctness fix in Task 8) are both flagged in the "implementation notes" section up top and in the design doc's corrected Cross-Row-Drag bullet — neither is silent scope creep.
- **Type consistency check:** `{ fromColumnId, fromTileId, toTileId }` (absorb) and `{ fromTileId, toColumnId, toTileId }` (expel) are used identically in `Grid` (Task 3) and `Strip` (Task 7); `TileLocation { columnId, tileId }` is used identically in `ColumnRegistry` (Task 4) and `WindowEventDeps.tileOf` (Task 6); `VerticalResizeEdge` (Task 1) is used identically in `Column.resizeTile` (Task 2) and `WindowEventDeps.resizeTile` (Task 6).
- **No placeholders:** the two `describe` blocks in Task 8 that say "follow this file's existing pattern" are the one deliberate exception — they depend on `strip-stack.test.ts`'s current fixture shape, which must be read at execution time rather than guessed at plan-writing time, and the plan says exactly what to read and what to copy rather than leaving the shape unspecified.
