# User-Controlled Widths and Neighbor Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each window keep the width the user or application gives it, and make resizing a window push its neighbors along the strip, backed by an explicit internal geometry model.

**Architecture:** The layout keeps its ordered `Column` widths and adds one new piece of state to `Grid`: `originX`, the virtual x of the leftmost column's left edge (implicitly `0` until a left-border resize moves it). Every geometry derivation stays in the pure `coordinates` module, now parameterised by that origin. Resizes arrive on KWin's `frameGeometryChanged(oldGeometry)` signal; a single rule — `newRect.x !== oldRect.x` means the left border moved, otherwise the right border — decides direction for both interactive user drags and programmatic application resizes. Interactive resizes leave the dragged window to KWin and only reposition neighbors; programmatic resizes additionally re-impose Drift's own position and full height on the window. An echo guard (comparing against the geometry Drift last applied) prevents feedback loops.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing.

---

## Background and Constraints (read once before starting)

Verified facts from the working Karousel bundle on this compositor (`~/.local/share/kwin/scripts/karousel/contents/code/main.js`) and from the current Drift code:

- KWin 6 `frameGeometryChanged` delivers the **previous** geometry as a handler argument: `Signal<(oldGeometry: QRect) => void>`. Drift's `src/types/kwin.d.ts` currently mistypes it as `Signal<() => void>`.
- `Window.resize` is a boolean that is `true` only while an interactive resize drag is in progress. `Window.move` is the analogous flag for interactive moves.
- Wayland can report fractional geometry; round before comparing or storing.
- Today `src/main.ts` forces every window to `settings.defaultColumnWidth` on every `render()` and never reacts to `frameGeometryChanged`. This is exactly what changes.

**Scope for this step (locked): WIDTH ONLY.** Columns stay full-height. Adopt the user/app width; ignore height-only and move-only changes. Vertical stacking is a later feature.

**Locked behavior decisions:**

- Direction rule (both interactive and programmatic): `Math.round(newRect.x) !== Math.round(oldRect.x)` → **left** border moved; else **right** border moved.
- Left border moved → hold the window's right edge fixed by shifting `originX` left by the width delta (left neighbors slide left). Right border moved → `originX` unchanged (right neighbors slide right).
- During an **interactive** resize, do **not** rewrite the dragged window (KWin owns it mid-drag); only reposition neighbors. Its own change is what drives the model.
- During a **programmatic** resize, adopt the width and rewrite the window to its column offset and full height (Drift owns position).
- A resize never triggers focus auto-scroll (`revealFocused` stays out of the resize path).
- Echo guard: ignore any `frameGeometryChanged` whose new geometry matches the geometry Drift last applied to that window.

**Not in this step (do not implement):** rate-limiting the programmatic path, interactive-move/reorder handling, height/vertical tiling, multi-monitor. A move-only change (width unchanged) is simply ignored.

## File Structure

- `src/core/coordinates.ts` — add an `origin` parameter to `columnOffsets`; add pure helpers `resizedEdge` (+ `ResizeEdge` type) and `rectsEqualRounded`. Pure, unit-tested.
- `src/core/grid.ts` — add `originX` state, `contentLeft()`, and an edge-aware `resizeColumn` overload. Pure, unit-tested.
- `src/viewport/viewport.ts` — track a (possibly negative) content-left so scrolling can reach content pushed left of `0`; add `setContentGeometry(left, width)`, keep `setContentWidth` as a thin wrapper. Pure, unit-tested.
- `src/types/kwin.d.ts` — fix the `frameGeometryChanged` signature; add `move` and `resize` booleans. Ambient types, no tests.
- `src/kwin/window-adapter.ts` — pass `oldGeometry` through `onFrameGeometryChanged` and return a disconnect function; add `isInteractiveResize()`. Adapter glue, no unit tests (docs §8).
- `src/kwin/geometry-sync.ts` — record the last applied real rect per window; add `isEcho()` and `forget()`. Thin glue over the tested `rectsEqualRounded`.
- `src/main.ts` — adopt each window's own width on add, wire the resize dispatch, render with an optional excluded window, disconnect handlers on removal. Integration glue, no unit tests (docs §8).
- `src/config/settings.ts` — unchanged; `defaultColumnWidth` becomes a fallback only.

---

### Task 1: `coordinates` — origin-aware `columnOffsets`

**Files:**
- Modify: `src/core/coordinates.ts`
- Test: `src/core/coordinates.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('columnOffsets', ...)` block in `src/core/coordinates.test.ts`:

```typescript
    it('starts the accumulation at the given origin', () => {
        expect(columnOffsets([300, 500, 200], 10, -100)).toEqual([-100, 210, 720]);
    });

    it('defaults the origin to 0', () => {
        expect(columnOffsets([300, 500], 0)).toEqual([0, 300]);
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `columnOffsets` ignores the third argument.

- [ ] **Step 3: Write minimal implementation**

In `src/core/coordinates.ts`, replace the `columnOffsets` function with:

```typescript
/** Cumulative x-offset of each column, starting at `origin`, with `gap` between columns. */
export function columnOffsets(widths: readonly number[], gap: number, origin = 0): number[] {
    const offsets: number[] = [];
    let cursor = origin;
    for (let i = 0; i < widths.length; i++) {
        offsets.push(cursor);
        cursor += widths[i] + gap;
    }
    return offsets;
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS (existing `columnOffsets` and `virtualWidth` tests still pass — the origin defaults to `0`).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, 120-col)
- [ ] `npm test` passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `coordinates` — `resizedEdge` and `ResizeEdge`

**Files:**
- Modify: `src/core/coordinates.ts`
- Test: `src/core/coordinates.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new block to `src/core/coordinates.test.ts` (and add `resizedEdge` to the existing import from `./coordinates`):

```typescript
describe('resizedEdge', () => {
    it('reports the left border when the x position changed', () => {
        const oldRect = { x: 100, y: 0, width: 300, height: 1080 };
        const newRect = { x: 60, y: 0, width: 340, height: 1080 };
        expect(resizedEdge(oldRect, newRect)).toBe('left');
    });

    it('reports the right border when x is unchanged', () => {
        const oldRect = { x: 100, y: 0, width: 300, height: 1080 };
        const newRect = { x: 100, y: 0, width: 360, height: 1080 };
        expect(resizedEdge(oldRect, newRect)).toBe('right');
    });

    it('ignores sub-pixel x jitter and reports the right border', () => {
        const oldRect = { x: 100, y: 0, width: 300, height: 1080 };
        const newRect = { x: 100.4, y: 0, width: 360, height: 1080 };
        expect(resizedEdge(oldRect, newRect)).toBe('right');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `resizedEdge` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/coordinates.ts`:

```typescript
export type ResizeEdge = 'left' | 'right';

/** Which border moved between two geometries of the same window: a changed left
 * edge (x) means the left border was dragged, otherwise the right border moved. */
export function resizedEdge(oldRect: Rect, newRect: Rect): ResizeEdge {
    return Math.round(newRect.x) !== Math.round(oldRect.x) ? 'left' : 'right';
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] `PascalCase` type `ResizeEdge`, `camelCase` function `resizedEdge`
- [ ] 4-space indent, single quotes, 120-col
- [ ] `npm test` passing
- [ ] Violations fixed

---

### Task 3: `coordinates` — `rectsEqualRounded`

**Files:**
- Modify: `src/core/coordinates.ts`
- Test: `src/core/coordinates.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/core/coordinates.test.ts` (add `rectsEqualRounded` to the import):

```typescript
describe('rectsEqualRounded', () => {
    it('treats rects equal after rounding each field', () => {
        const a = { x: 100.2, y: 0.4, width: 300.1, height: 1080.0 };
        const b = { x: 100, y: 0, width: 300, height: 1080 };
        expect(rectsEqualRounded(a, b)).toBe(true);
    });

    it('detects a real difference in any field', () => {
        const a = { x: 100, y: 0, width: 300, height: 1080 };
        const b = { x: 100, y: 0, width: 360, height: 1080 };
        expect(rectsEqualRounded(a, b)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `rectsEqualRounded` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/coordinates.ts`:

```typescript
/** Rect equality after rounding — KWin/Wayland can report fractional geometry. */
export function rectsEqualRounded(a: Rect, b: Rect): boolean {
    return (
        Math.round(a.x) === Math.round(b.x) &&
        Math.round(a.y) === Math.round(b.y) &&
        Math.round(a.width) === Math.round(b.width) &&
        Math.round(a.height) === Math.round(b.height)
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] `camelCase` function `rectsEqualRounded`
- [ ] 4-space indent, single quotes, 120-col
- [ ] `npm test` passing
- [ ] Violations fixed

---

### Task 4: `Grid` — `originX`, `contentLeft()`, and edge-aware `resizeColumn`

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new block to `src/core/grid.test.ts` (imports there already include `Grid`; the constants `HEIGHT` and `GAP` already exist):

```typescript
describe('Grid — content origin and edge-aware resizing', () => {
    it('starts with a content-left of 0', () => {
        const grid = new Grid(HEIGHT, GAP);
        grid.addColumn(300);
        expect(grid.contentLeft()).toBe(0);
    });

    it('right-border resize grows rightward and shifts only right neighbors', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        const b = grid.addColumn(500);
        grid.resizeColumn(a.id, 400, 'right');
        expect(grid.contentLeft()).toBe(0);
        expect(grid.columnRect(a.id).x).toBe(0);
        expect(grid.columnRect(b.id).x).toBe(410);
    });

    it('left-border resize holds the right edge and slides the strip left', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300); // a.x = 0
        const b = grid.addColumn(500); // b.x = 310, right edge = 810
        grid.resizeColumn(b.id, 600, 'left'); // +100 on the left border
        expect(grid.contentLeft()).toBe(-100);
        expect(grid.columnRect(a.id).x).toBe(-100); // left neighbor slid left
        const rectB = grid.columnRect(b.id);
        expect(rectB.x).toBe(210);
        expect(rectB.x + rectB.width).toBe(810); // right edge unchanged
        expect(grid.virtualWidth()).toBe(910);
    });

    it('defaults to right-border semantics when no edge is given', () => {
        const grid = new Grid(HEIGHT, GAP);
        const a = grid.addColumn(300);
        grid.addColumn(500);
        grid.resizeColumn(a.id, 400);
        expect(grid.contentLeft()).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `contentLeft` does not exist and `resizeColumn` ignores the edge.

- [ ] **Step 3: Write minimal implementation**

In `src/core/grid.ts`:

Update the import to include `ResizeEdge`:

```typescript
import { columnOffsets, columnRect, virtualWidth, Rect, ResizeEdge } from './coordinates';
```

Add the field next to the other private fields:

```typescript
    private readonly ordered: Column[] = [];
    private focusedColumnId: number | null = null;
    private nextId = 1;
    private originX = 0;
```

Replace the existing `resizeColumn` method with:

```typescript
    resizeColumn(id: number, width: number, edge: ResizeEdge = 'right'): void {
        const column = this.requireColumn(id);
        const delta = width - column.width;
        column.setWidth(width);
        if (edge === 'left') {
            this.originX -= delta;
        }
    }
```

Add a `contentLeft` accessor (place it near `virtualWidth`):

```typescript
    contentLeft(): number {
        return this.originX;
    }
```

Update `columnRect` to thread the origin through:

```typescript
    columnRect(id: number): Rect {
        const index = this.requireIndex(id);
        const offset = columnOffsets(this.widths(), this.gap, this.originX)[index];
        return columnRect(offset, this.ordered[index].width, this.height);
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS (the existing `Grid — resizing shifts neighbors` test still passes: default edge is `'right'`, so `originX` stays `0`).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] `camelCase` members, `private` origin field
- [ ] KWin-free core preserved (no KWin globals in `grid.ts`)
- [ ] `npm test` passing
- [ ] Violations fixed

---

### Task 5: `Viewport` — reach content pushed left of zero

**Files:**
- Modify: `src/viewport/viewport.ts`
- Test: `src/viewport/viewport.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new block to `src/viewport/viewport.test.ts`:

```typescript
describe('Viewport — content that starts left of zero', () => {
    it('clamps the low end to the content-left, not to zero', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(-200, 3000); // content spans [-200, 2800]
        viewport.scrollTo(-500);
        expect(viewport.offset()).toBe(-200);
    });

    it('clamps the high end to content-left + width - viewportWidth', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(-200, 3000); // maxOffset = -200 + 3000 - 1000
        viewport.scrollTo(9000);
        expect(viewport.offset()).toBe(1800);
    });

    it('reveals a column that sits left of zero', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(-200, 3000);
        viewport.scrollTo(500); // view [500, 1500]
        expect(viewport.offsetToReveal(-100, 200)).toBe(-100);
    });

    it('setContentWidth keeps the origin at zero', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(-50);
        expect(viewport.offset()).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `setContentGeometry` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `src/viewport/viewport.ts`:

Add the `contentLeft` field beside the existing state:

```typescript
    private offsetX = 0;
    private contentWidth = 0;
    private contentLeft = 0;
```

Replace `setContentWidth` with the pair below (keep the name as a thin wrapper so the existing tests and `main.ts` stay valid):

```typescript
    setContentWidth(width: number): void {
        this.setContentGeometry(0, width);
    }

    setContentGeometry(left: number, width: number): void {
        this.contentLeft = left;
        this.contentWidth = width;
        this.offsetX = this.clamp(this.offsetX);
    }
```

Replace `maxOffset` and `clamp` with origin-aware versions:

```typescript
    private maxOffset(): number {
        return Math.max(this.contentLeft, this.contentLeft + this.contentWidth - this.viewportWidth);
    }

    private clamp(offset: number): number {
        return Math.min(Math.max(offset, this.contentLeft), this.maxOffset());
    }
```

Leave `offsetToReveal`, `revealColumn`, `scrollTo`, `scrollBy`, and `setViewportWidth` unchanged — they already funnel through `clamp`.

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS (existing `Viewport` tests still pass: `setContentWidth` now delegates with `left = 0`).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] `camelCase` members, KWin-free viewport preserved
- [ ] 4-space indent, single quotes, 120-col
- [ ] `npm test` passing
- [ ] Violations fixed

---

### Task 6: KWin types and `WindowAdapter` — resize signal surface

**Files:**
- Modify: `src/types/kwin.d.ts`
- Modify: `src/kwin/window-adapter.ts`

There is no unit test here (ambient types plus live-compositor adapter glue, docs §8). Verification is the type-checker and build.

- [ ] **Step 1: Fix the `frameGeometryChanged` signature and add the resize flags**

In `src/types/kwin.d.ts`, inside `interface Window`, replace the geometry-changed line and add the two booleans:

```typescript
    readonly minSize: QSize;
    readonly maxSize: QSize;
    readonly move: boolean;
    readonly resize: boolean;
    readonly frameGeometryChanged: Signal<(oldGeometry: QRect) => void>;
```

- [ ] **Step 2: Thread `oldGeometry` and add `isInteractiveResize`, return a disconnect**

In `src/kwin/window-adapter.ts`, replace `onFrameGeometryChanged` and add `isInteractiveResize`:

```typescript
    isInteractiveResize(): boolean {
        return this.window.resize;
    }

    onFrameGeometryChanged(handler: (oldGeometry: Rect) => void): () => void {
        const wrapped = (oldGeometry: QRect): void => {
            handler({
                x: oldGeometry.x,
                y: oldGeometry.y,
                width: oldGeometry.width,
                height: oldGeometry.height,
            });
        };
        this.window.frameGeometryChanged.connect(wrapped);
        return () => this.window.frameGeometryChanged.disconnect(wrapped);
    }
```

- [ ] **Step 3: Verify types and build**

`npm run typecheck && npm run build`
Expected: PASS — no type errors. (`main.ts` still compiles because its current `onFrameGeometryChanged` is unused; it is rewired in Task 8.)

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] KWin access stays inside `kwin/` and the type file
- [ ] `camelCase` methods; `QRect`→`Rect` conversion kept in the adapter
- [ ] `npm run typecheck` and `npm run build` passing
- [ ] Violations fixed

---

### Task 7: `GeometrySync` — echo tracking

**Files:**
- Modify: `src/kwin/geometry-sync.ts`

`isEcho`/`forget` are thin glue over the already-tested `rectsEqualRounded`; the existing `toRealRect` unit tests remain the tested surface (docs §8). Verification is the type-checker plus the unchanged `toRealRect` tests.

- [ ] **Step 1: Record applied geometry and add `isEcho`/`forget`**

In `src/kwin/geometry-sync.ts`, update the import and the class:

```typescript
import { Rect, rectsEqualRounded } from '../core/coordinates';
import { WindowAdapter } from './window-adapter';
```

```typescript
export class GeometrySync {
    private readonly lastApplied = new Map<string, Rect>();

    constructor(private readonly area: Rect) {}

    apply(window: WindowAdapter, virtualRect: Rect, viewportOffsetX: number): void {
        const real = toRealRect(virtualRect, this.area, viewportOffsetX);
        window.setFrameGeometry(real);
        this.lastApplied.set(window.id, real);
    }

    /** True when `rect` matches the geometry Drift itself last wrote to this window. */
    isEcho(windowId: string, rect: Rect): boolean {
        const last = this.lastApplied.get(windowId);
        return last !== undefined && rectsEqualRounded(last, rect);
    }

    forget(windowId: string): void {
        this.lastApplied.delete(windowId);
    }
}
```

Leave the exported `toRealRect` function above the class unchanged.

- [ ] **Step 2: Verify types and existing tests**

`npm run typecheck && npm test`
Expected: PASS — `toRealRect` tests unchanged and green; no type errors.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] KWin access stays inside `kwin/`; pure `rectsEqualRounded` reused (DRY)
- [ ] `camelCase` methods, `private` map
- [ ] `npm run typecheck` and `npm test` passing
- [ ] Violations fixed

---

### Task 8: `main.ts` — adopt widths and wire the resize dispatch

**Files:**
- Modify: `src/main.ts`

Integration glue (docs §8): no unit test. Verified by typecheck, build, lint, and the manual login run in Task 9.

- [ ] **Step 1: Import the new pure helpers**

In `src/main.ts`, add to the imports:

```typescript
import { rectsEqualRounded, resizedEdge, Rect } from './core/coordinates';
```

- [ ] **Step 2: Track handler disconnects and support excluding a window from `render`**

Add the disconnect map beside `windowsByColumn`:

```typescript
    const windowsByColumn = new Map<number, WindowAdapter>();
    const disconnectByColumn = new Map<number, () => void>();
```

Replace `render` with a version that can skip the actively-resized window and uses the content origin:

```typescript
    function render(excludeWindowId?: string): void {
        viewport.setContentGeometry(grid.contentLeft(), grid.virtualWidth());
        for (const column of grid.columns()) {
            const win = windowsByColumn.get(column.id);
            if (win && win.id !== excludeWindowId) {
                geometrySync.apply(win, grid.columnRect(column.id), viewport.offset());
            }
        }
    }
```

- [ ] **Step 3: Add the resize dispatch**

Add this function next to `columnOf` in `init`:

```typescript
    function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect): void {
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        const newReal = win.frameGeometry();
        if (rectsEqualRounded(oldReal, newReal)) {
            return;
        }
        if (geometrySync.isEcho(win.id, newReal)) {
            return;
        }
        if (Math.round(newReal.width) === Math.round(oldReal.width)) {
            return; // width-only step: ignore pure moves and height-only changes
        }
        grid.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
        render(win.isInteractiveResize() ? win.id : undefined);
    }
```

- [ ] **Step 4: Adopt the window's own width on add and connect the handler**

Replace the `onWindowAdded` handler body:

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

- [ ] **Step 5: Disconnect and forget on removal**

Replace the `onWindowRemoved` handler body:

```typescript
    workspaceAdapter.onWindowRemoved((win) => {
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        const disconnect = disconnectByColumn.get(columnId);
        if (disconnect) {
            disconnect();
        }
        disconnectByColumn.delete(columnId);
        geometrySync.forget(win.id);
        windowsByColumn.delete(columnId);
        grid.removeColumn(columnId);
        render();
        revealFocused();
    });
```

Leave `onWindowActivated`, `registerShortcuts`, and the `animator` wiring unchanged.

- [ ] **Step 6: Verify types, build, and lint**

`npm run typecheck && npm run build && npm run lint`
Expected: PASS — no type errors, bundle builds, eslint/prettier/qmllint clean.

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] KWin access stays behind adapters; `main.ts` orchestrates only
- [ ] `camelCase` functions/vars; no global mutable state added
- [ ] `npm run typecheck`, `npm run build`, `npm run lint` passing
- [ ] Violations fixed

---

### Task 9: Full verification and live run

**Files:** none (verification only).

- [ ] **Step 1: Run the whole quality gate**

`npm run typecheck && npm test && npm run lint && npm run build`
Expected: PASS — all unit tests green, lint clean, bundle built.

- [ ] **Step 2: Install the package**

`npm run package:install`
Expected: `kpackagetool6` reports install or upgrade success.

- [ ] **Step 3: Live run (manual, requires a fresh login)**

Per repo memory, declarativescript packages only reliably re-instantiate on **login** (live reload is unreliable on Wayland). Log out and back in, then verify:
- New windows keep their own opening width (no snap to 800 px).
- Dragging a window's **right** border widens it and pushes the windows to its right along the strip; the left neighbors stay put.
- Dragging a window's **left** border widens it while its right edge stays fixed; the windows to its left slide left.
- An application that resizes itself (e.g. a dialog growing) reflows neighbors the same way and the window snaps back to full column height.
- `Meta+A` / `Meta+D` still scroll focus, and focus scrolling can reach a window that a left-border drag pushed left of the screen origin.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] All automated gates green (typecheck, test, lint, build)
- [ ] Live behaviors in Step 3 confirmed
- [ ] Any regressions filed or fixed before closing the task

---

## Self-Review

**Spec coverage:**
- Goal 1 (windows keep their user/app width): Task 8 Step 4 adopts `win.frameGeometry().width` on add and stops force-writing `defaultColumnWidth`; the resize dispatch (Task 8 Step 3) adopts the reported width on every change.
- Goal 2 (resizing pushes neighbors): Task 2 (`resizedEdge`), Task 4 (edge-aware `resizeColumn` with `originX`), and Task 8 (dispatch + `render` exclusion) together shift neighbors per the dragged border. Task 5 lets the viewport follow content pushed left of zero.
- Goal 3 (internal geometry representation): `originX` + origin-aware `columnOffsets`/`columnRect` (Tasks 1, 4), the echo record in `GeometrySync` (Task 7), and the `oldGeometry`-bearing signal (Task 6) form the explicit model.
- Programmatic vs interactive distinction: `isInteractiveResize()` (Task 6) drives the `render(exclude?)` choice in Task 8 Step 3.

**Placeholder scan:** No TBD/placeholder steps; every code step shows complete code.

**Type consistency:** `ResizeEdge` defined in Task 2 and consumed in Task 4; `resizedEdge`/`rectsEqualRounded` defined in Tasks 2-3 and consumed in Tasks 7-8; `setContentGeometry`/`contentLeft` defined in Tasks 4-5 and consumed in Task 8; `onFrameGeometryChanged` returns `() => void` in Task 6 and is stored in `disconnectByColumn` in Task 8; `isEcho`/`forget` defined in Task 7 and consumed in Task 8. Signatures match across tasks.
