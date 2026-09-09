# Window Motion Primitive and Keyboard Move Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `Strip` a single reusable "drift this window from here into wherever the layout puts it" primitive covering all four rect dimensions, and use it to make keyboard column moves animate like drag-drops already do.

**Architecture:** `Strip.render()` stays the sole writer of window geometry. Its three `AxisMotion` trackers become four, all keyed by window id instead of a mix of window id and column id, so any single window's motion can be seeded independently. Keyboard column moves stop force-snapping the moved column and simply let the render loop ease it.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-08-window-motion-primitive-design.md`

---

## Background you need

`src/runtime/strip.ts` is the only file that decides where a tiled window is drawn. Its `render()` walks every column, asks `Grid`/`Column` for each tile's *logical* target rect, and pushes x/y/height through `AxisMotion` instances before handing the result to `GeometrySync.apply()`. Width bypasses the trackers entirely today.

`AxisMotion` (`src/viewport/axis-motion.ts`) is a generic map from a key to "a value smoothly heading somewhere". Three calls matter:

- `update(id, target, nowMs, durationMs)` — returns the value to draw right now. If `target` differs from the last target it starts a new animation *from the current in-flight value*. If `id` has never been seen, it snaps and returns `target` (this is why a brand-new window never animates in).
- `snapTo(id, value)` — force the value to rest at `value`, cancelling any animation. This is how you *seed* a start position.
- `forget(id)` — drop all state, so the next `update` treats the id as brand new and snaps.

The trick used throughout: to make something drift from A to B, `snapTo(id, A)` and then let the next `render()` call `update(id, B)`.

**Do not** add a second code path that writes `setFrameGeometry` on a timer. It will fight `render()`. The spec explains why at length.

## File Structure

| File | Change |
|---|---|
| `src/runtime/strip.ts` | Four window-keyed motion trackers; new `seedMotionFrom` / `seedMotionFromCurrentGeometry`; remove `snapColumn`, `seedReorderRelease`, `seedStackRelease`; animate width; simplify the `allTilesExcluded` guard; drop `snapColumn` calls from the four keyboard move actions |
| `src/runtime/strip.test.ts` | Replace the `snapColumn` test; add keyboard-move animation, width animation, partial-seed, and stack-lockstep tests |
| `src/input/drag.ts` | `DragReorderDeps` collapses two seed hooks into one `seedMotionFrom`; release path seeds all four channels unconditionally |
| `docs/algorithms.md` | Update "Layout-Change Position Animation" and the drag-reorder release paragraph |

`src/viewport/axis-motion.ts` is **not** modified. It is already generic over its key type.

---

### Task 1: Rename the x tracker and add a width tracker

This task is pure mechanical re-keying plus one new channel. Behaviour changes that fall out of it are asserted in Task 2.

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/strip.test.ts`, inside the same `describe` block that holds the existing `renders a column at its exact logical position when instant=true` test:

```ts
it('animates a column width change instead of jumping to the new width', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
        const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter); // col1 @ x=0, width 800
        win1.setFrameGeometry.mockClear();

        strip.increaseColumnWidth(); // target width 800 + columnWidthStep

        vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
        strip.render();

        const [lastCall] = win1.setFrameGeometry.mock.calls.slice(-1);
        const width = (lastCall[0] as { width: number }).width;
        expect(width).toBeGreaterThan(800);
        expect(width).toBeLessThan(800 + DEFAULT_SETTINGS.columnWidthStep);
    } finally {
        vi.useRealTimers();
    }
});
```

Note: `800` is `DEFAULT_SETTINGS.defaultColumnWidth`. Confirm that by reading `src/config/settings.ts` before relying on it; if it differs, use `DEFAULT_SETTINGS.defaultColumnWidth` in the assertions instead of the literal.

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — width is written straight from the target rect, so it jumps to the full new width on the first frame.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip.ts`:

Rename the field and add the new one:

```ts
private readonly tileXMotion = new AxisMotion<string>();
private readonly tileYMotion = new AxisMotion<string>();
private readonly tileWidthMotion = new AxisMotion<string>();
private readonly tileHeightMotion = new AxisMotion<string>();
```

Rename `columnMotionTimer` to `motionTimer` (field declaration, the `this.ticker.subscribe()` assignment in the constructor, and both `start`/`stop` call sites in `render()`).

In `render()`, replace the per-column x block. It currently sits *outside* the tile loop and is keyed by `column.id`; it must move *inside* the tile loop and be keyed by `win.id`. The tile loop body becomes:

```ts
const targetRect = previewRects?.get(tile.id) ?? column.tileRect(tile.id, columnRect);
let x: number;
let y: number;
let width: number;
let height: number;
if (instant) {
    this.tileXMotion.snapTo(win.id, columnRect.x);
    this.tileYMotion.snapTo(win.id, targetRect.y);
    this.tileWidthMotion.snapTo(win.id, targetRect.width);
    this.tileHeightMotion.snapTo(win.id, targetRect.height);
    x = columnRect.x;
    y = targetRect.y;
    width = targetRect.width;
    height = targetRect.height;
} else {
    const now = Date.now();
    const duration = this.settings.animationDurationMs;
    x = this.tileXMotion.update(win.id, columnRect.x, now, duration);
    y = this.tileYMotion.update(win.id, targetRect.y, now, duration);
    width = this.tileWidthMotion.update(win.id, targetRect.width, now, duration);
    height = this.tileHeightMotion.update(win.id, targetRect.height, now, duration);
}
this.geometrySync.apply(
    win,
    Object.assign({}, targetRect, { x, y, width, height }),
    this.viewport.offset(),
    this.verticalOffsetY,
);
```

Delete the now-dead `const targetX = columnRect.x;` and the `let x` block that preceded the tile loop.

Delete the `allTilesExcluded` guard entirely (the `const allTilesExcluded = ...` computation and the `if (allTilesExcluded) { continue; }`). It existed only to protect a shared column-keyed tracker from re-establishing a stale x while nothing was drawn; per-window keying removes that hazard, and the tile loop already skips excluded tiles individually. Delete its explanatory comment with it.

Update the `isAnimating()` check to cover all four:

```ts
if (
    this.tileXMotion.isAnimating() ||
    this.tileYMotion.isAnimating() ||
    this.tileWidthMotion.isAnimating() ||
    this.tileHeightMotion.isAnimating()
) {
```

Now fix every remaining `columnMotion` reference. Add a private helper next to `tileKey`:

```ts
/** Drops all four motion channels for `windowId`, so its next appearance snaps
 * instead of animating from a stale pre-hide value. */
private forgetMotion(windowId: string): void {
    this.tileXMotion.forget(windowId);
    this.tileYMotion.forget(windowId);
    this.tileWidthMotion.forget(windowId);
    this.tileHeightMotion.forget(windowId);
}

/** `forgetMotion` for every window currently registered in `columnId`. */
private forgetColumnMotion(columnId: number): void {
    const column = this.grid.column(columnId);
    if (column === null) {
        return;
    }
    for (const tile of column.tiles()) {
        const win = this.registry.get(columnId, tile.id);
        if (win) {
            this.forgetMotion(win.id);
        }
    }
}
```

Then rewrite the call sites:

| Site | Was | Becomes |
|---|---|---|
| `removeWindow` (multi-tile branch) | `tileYMotion.forget(win.id)` + `tileHeightMotion.forget(win.id)` | `this.forgetMotion(win.id)` |
| `detachColumn` loop | same pair, plus `columnMotion.forget(columnId)` after the loop | `this.forgetMotion(win.id)` in the loop; delete the `columnMotion.forget` line |
| `absorbRight` | `this.columnMotion.forget(result.fromColumnId)` | **delete the line** — the absorbed window keeps existing, and its old x/width are the correct animation start point |
| `commitTileIntoStack` | `this.columnMotion.forget(fromColumnId)` | **delete the line**, same reason |
| `eventDeps().hideColumn` | `this.columnMotion.forget(columnId)` | `this.forgetColumnMotion(columnId)` — call it *before* `this.grid.hideColumn(columnId)` so the column is still resolvable |
| `eventDeps().hideTile` (single-tile fallback) | `this.columnMotion.forget(columnId)` | `this.forgetColumnMotion(columnId)`, again before `hideColumn` |
| `eventDeps().hideTile` (multi-tile branch) | the y/height forget pair | `this.forgetMotion(win.id)` |
| `eventDeps().setFullScreen` (true branch) | `columnMotion.forget(columnId)` + the y/height pair | `this.forgetMotion(win.id)` only — drop the column-level forget, since a fullscreen tile's siblings must keep their own motion |

Leave `snapColumn`, `seedReorderRelease`, and `seedStackRelease` alone for now; Task 3 replaces them. Point their bodies at the renamed trackers so the file compiles:

```ts
snapColumn(columnId: number): void {
    this.tileXMotion.snapTo(columnId as unknown as string, this.grid.columnRect(columnId).x);
}
```

That cast is deliberately ugly because it is temporary. If it offends, instead make `snapColumn` iterate the column's windows:

```ts
snapColumn(columnId: number): void {
    const x = this.grid.columnRect(columnId).x;
    const column = this.grid.column(columnId);
    for (const tile of column?.tiles() ?? []) {
        const win = this.registry.get(columnId, tile.id);
        if (win) {
            this.tileXMotion.snapTo(win.id, x);
        }
    }
}
```

Prefer the second. It keeps the existing `snapColumn` test meaningful until Task 4 deletes it.

`seedReorderRelease` becomes:

```ts
seedReorderRelease(windowId: string, _columnId: number, virtualX: number, virtualY: number, height: number): void {
    this.tileXMotion.snapTo(windowId, virtualX);
    this.tileYMotion.snapTo(windowId, virtualY);
    this.tileHeightMotion.snapTo(windowId, height);
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS, and **every pre-existing test in `strip.test.ts` still passes**. If `snaps a column back into place after fullscreen instead of animating from its pre-fullscreen position` fails, the `setFullScreen` rewrite is wrong — re-read the table row above.

- [ ] **Step 5: Run `npm run lint`**

Expected: clean. Fix any unused-variable warnings from the deleted `allTilesExcluded` block.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Verify a stack stays in lockstep

Per-window x/width keying means the tiles of one column each animate their own x. They *should* be indistinguishable from a shared value, because they resolve identical targets from identical resting values. This task pins that down so a future change cannot silently break it.

**Files:**
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the test**

```ts
it('keeps a stacked column\'s tiles at identical x and width while the column slides', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
        const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        const win3 = fakeWindow('w3');
        strip.addWindow(win1.adapter); // col1
        strip.addWindow(win2.adapter); // col2
        strip.focusLeft(); // focus col1
        strip.absorbRight(); // col2's window becomes a second tile of col1
        strip.addWindow(win3.adapter); // new column right of col1 — no push, col1 stays at x=0
        strip.focusFirst();
        strip.moveWindowRight(); // col1 slides right; both its tiles must move together
        win1.setFrameGeometry.mockClear();
        win2.setFrameGeometry.mockClear();

        vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
        strip.render();

        const [call1] = win1.setFrameGeometry.mock.calls.slice(-1);
        const [call2] = win2.setFrameGeometry.mock.calls.slice(-1);
        const rect1 = call1[0] as { x: number; width: number };
        const rect2 = call2[0] as { x: number; width: number };
        expect(rect2.x).toBe(rect1.x);
        expect(rect2.width).toBe(rect1.width);
    } finally {
        vi.useRealTimers();
    }
});
```

- [ ] **Step 2: Run it**

`npm test`
Expected: PASS immediately (Task 1 already produced the behaviour). If it fails, the two tiles were seeded at different resting values — investigate `absorbRight` rather than weakening the assertion.

Note: this test depends on Task 5's `moveWindowRight` change only for the *sliding*, not for the equality. If Task 5 has not landed yet, `moveWindowRight` still snaps, and both tiles will snap identically — the assertion still holds. Re-run this test after Task 5 to confirm it holds mid-animation too.

- [ ] **Step 3: Coding-guideline follow-up checklist**

Same checklist as Task 1.

---

### Task 3: Introduce `seedMotionFrom` and `seedMotionFromCurrentGeometry`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('seedMotionFrom drifts a window from the seeded rect into its layout slot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
        const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter); // col1 @ x=0
        win1.setFrameGeometry.mockClear();

        strip.seedMotionFrom(win1.adapter.id, { x: 400 });
        strip.render(); // t=0: still at the seeded x

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 400 }));

        vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
        strip.render();

        const [lastCall] = win1.setFrameGeometry.mock.calls.slice(-1);
        const x = (lastCall[0] as { x: number }).x;
        expect(x).toBeLessThan(400);
        expect(x).toBeGreaterThan(0);
    } finally {
        vi.useRealTimers();
    }
});

it('seedMotionFrom leaves omitted channels resting where they were', () => {
    const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
    const win1 = fakeWindow('w1');
    strip.addWindow(win1.adapter);
    win1.setFrameGeometry.mockClear();

    strip.seedMotionFrom(win1.adapter.id, { y: 300 });
    strip.render();

    expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0, y: 300 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `seedMotionFrom` does not exist (TypeScript compile error in the test file counts as failing).

- [ ] **Step 3: Write minimal implementation**

Replace `snapColumn`, `seedReorderRelease`, and `seedStackRelease` in `src/runtime/strip.ts` with:

```ts
/** Seeds `windowId`'s motion channels to start from `rect`, in virtual strip
 * coordinates (area-relative y). The next `render()` eases from there into whatever
 * the layout resolves for that window; omitted fields leave that channel alone,
 * which is how a caller animates only some dimensions (docs:
 * 2026-09-08-window-motion-primitive-design). */
seedMotionFrom(windowId: string, rect: Partial<Rect>): void {
    if (rect.x !== undefined) {
        this.tileXMotion.snapTo(windowId, rect.x);
    }
    if (rect.y !== undefined) {
        this.tileYMotion.snapTo(windowId, rect.y);
    }
    if (rect.width !== undefined) {
        this.tileWidthMotion.snapTo(windowId, rect.width);
    }
    if (rect.height !== undefined) {
        this.tileHeightMotion.snapTo(windowId, rect.height);
    }
}

/** `seedMotionFrom` seeded from the window's own current on-screen geometry —
 * "wherever it is right now, drift it to where the layout says it belongs." */
seedMotionFromCurrentGeometry(win: WindowAdapter): void {
    const real = win.frameGeometry();
    this.seedMotionFrom(win.id, {
        x: toVirtualX(real.x, this.area, this.viewport.offset()),
        y: real.y - this.area.y,
        width: real.width,
        height: real.height,
    });
}
```

Import `toVirtualX` from `../kwin/geometry-sync` (`Rect` is already imported).

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: the two new tests PASS. Existing `snapColumn` tests and the `drag.ts` wiring now fail to compile — Tasks 4 and 5 fix them. If you cannot tolerate a red intermediate state, do Tasks 3, 4, and 5 as one commit; the plan splits them only for reviewability.

- [ ] **Step 5: Coding-guideline follow-up checklist**

Same checklist as Task 1.

---

### Task 4: Rewire `drag.ts` onto the single primitive

**Files:**
- Modify: `src/input/drag.ts`
- Modify: `src/runtime/strip.ts` (the `wireTile` deps object)
- Modify: `src/runtime/strip.test.ts` (delete the `snapColumn` test)

- [ ] **Step 1: Update `DragReorderDeps`**

In `src/input/drag.ts`, delete the `seedReorderRelease` and `seedStackRelease` members and replace them with:

```ts
/** Seeds the dropped window's motion channels at its actual drop rect, so it eases
 * into its resolved slot instead of snapping (docs:
 * 2026-09-08-window-motion-primitive-design). */
seedMotionFrom(windowId: string, rect: Partial<Rect>): void;
```

- [ ] **Step 2: Simplify the release path**

In `finishedInner`, the block that branches on `lastStackHover === null` and then on `homeColumn.tileCount() === 1` exists purely to avoid seeding a *column-shared* x from one tile's rect. That hazard is gone. Replace the whole `if (lastStackHover === null) { ... } else { ... }` seed logic with an unconditional seed followed by the commit branch:

```ts
const dropRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
deps.seedMotionFrom(win.id, dropRect);
if (lastStackHover !== null) {
    if (lastStackHover.columnId === location.columnId) {
        requireColumn(deps.grid, location.columnId).moveTile(location.tileId, lastStackHover.slot);
    } else {
        deps.commitTileIntoStack(location.columnId, location.tileId, lastStackHover.columnId, lastStackHover.slot);
    }
}
```

`requireColumn` and `homeColumn` may now be unused in this function — remove the local, but keep the `requireColumn` helper itself, which the stack-commit branch still uses.

- [ ] **Step 3: Update the deps object in `Strip.wireTile`**

Replace the `seedReorderRelease` and `seedStackRelease` properties with:

```ts
seedMotionFrom: (windowId: string, rect: Partial<Rect>) => this.seedMotionFrom(windowId, rect),
```

- [ ] **Step 4: Delete the obsolete test**

Remove `snapColumn settles one column instantly while a separately-animating neighbor keeps sliding` from `src/runtime/strip.test.ts`. `snapColumn` no longer exists. Its intent — "one column settles while a neighbour keeps animating" — is now covered by the `seedMotionFrom` tests plus Task 5's keyboard-move tests.

- [ ] **Step 5: Run the suite**

`npm test` then `npm run lint`
Expected: PASS and clean. There is no direct test for `drag.ts`; it is glue, as its own header comment states.

- [ ] **Step 6: Coding-guideline follow-up checklist**

Same checklist as Task 1.

---

### Task 5: Make keyboard column moves animate

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Write one parameterised test covering all four actions:

```ts
describe('keyboard column moves animate instead of jumping', () => {
    const cases: { name: string; act: (strip: Strip) => void; targetX: number }[] = [
        { name: 'moveWindowRight', act: (s) => s.moveWindowRight(), targetX: 808 },
        { name: 'moveWindowToEnd', act: (s) => s.moveWindowToEnd(), targetX: 1616 },
    ];

    for (const { name, act, targetX } of cases) {
        it(`${name} eases the moved column from its old slot to its new one`, () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                const win2 = fakeWindow('w2');
                const win3 = fakeWindow('w3');
                strip.addWindow(win1.adapter); // col1 @ x=0
                strip.addWindow(win2.adapter); // col2 @ x=808
                strip.addWindow(win3.adapter); // col3 @ x=1616
                strip.focusFirst(); // focus col1 @ x=0
                win1.setFrameGeometry.mockClear();

                act(strip);

                vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
                strip.render();

                const [midCall] = win1.setFrameGeometry.mock.calls.slice(-1);
                const midX = (midCall[0] as { x: number }).x;
                expect(midX).toBeGreaterThan(0);
                expect(midX).toBeLessThan(targetX);

                vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs);
                strip.render();

                expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: targetX }));
            } finally {
                vi.useRealTimers();
            }
        });
    }
});
```

Then add the mirrored pair for `moveWindowLeft` and `moveWindowToStart`, starting from `strip.focusLast()` on col3 (`x=1616`) with `targetX` of `808` and `0` respectively, and the mid-flight assertion inverted (`midX` less than `1616`, greater than `targetX`).

The `808` and `1616` figures assume `defaultColumnWidth` 800 and `columnGap` 8. Verify against `DEFAULT_SETTINGS` in `src/config/settings.ts` and adjust if they differ — do not hardcode blindly.

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL on the mid-flight assertion — `midX` already equals `targetX`, because `snapColumn` forced it there.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip.ts`, delete the `this.snapColumn(focused.id);` line from each of `moveWindowLeft`, `moveWindowRight`, `moveWindowToStart`, and `moveWindowToEnd`. Nothing replaces it. Each method keeps its `this.grid.moveColumn(...)`, `this.render()`, and `this.revealFocused()` calls in that order.

Delete the `snapColumn` method itself if Task 4 left it in place.

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS, including Task 2's lockstep test (re-run it consciously — it is now exercising a genuine mid-animation frame).

- [ ] **Step 5: Run `npm run lint` and `npm run build`**

Expected: both clean.

- [ ] **Step 6: Coding-guideline follow-up checklist**

Same checklist as Task 1.

---

### Task 6: Update the algorithm documentation

**Files:**
- Modify: `docs/algorithms.md`

- [ ] **Step 1: Rewrite the "Layout-Change Position Animation" section**

The current text says `Strip` owns *three* `AxisMotion` instances, "one for a column's real x (keyed by column id), and two for a tile's real y/height (keyed by window id)". Replace with four instances, all keyed by window id, and state the reason: a tile id is only stable within one column, and window-id keying is what lets any single window be seeded independently for a release or a keyboard move. Mention that width is now an animated channel, so column resizes ease.

Keep the two existing paragraphs about first-appearance snapping and the `instant` flag — both are still accurate.

- [ ] **Step 2: Rewrite the drag-reorder release paragraph**

Line 48 names `Strip.seedReorderRelease` and `Strip.seedStackRelease` and describes the standalone-vs-stack branch. Replace with a single sentence: on release the dragged window is seeded at its actual drop rect via `Strip.seedMotionFrom` and eases into its resolved slot across all four dimensions, while its neighbours keep whatever slide they were already mid-flight on.

- [ ] **Step 3: Add the keyboard-move behaviour**

Add a sentence to "Layout-Change Position Animation" noting that keyboard column moves (`moveWindowLeft`/`Right`/`ToStart`/`ToEnd`) go through the same mechanism with no special casing — they mutate the grid and re-render, and the moved column eases from wherever it was drawn.

- [ ] **Step 4: Verify formatting**

One sentence per line — mandatory, see `AGENTS.md`. Re-read the diff and split any multi-sentence lines.

- [ ] **Step 5: Coding-guideline follow-up checklist**

Same checklist as Task 1.

---

## Final verification

- [ ] `npm test` — all green
- [ ] `npm run lint` — clean
- [ ] `npm run build` — succeeds
- [ ] `grep -rn "columnMotion\|snapColumn\|seedReorderRelease\|seedStackRelease" src/` returns nothing
- [ ] Manual check on a live session: `Ctrl+Meta+Left` / `Ctrl+Meta+Right` drift the focused window into its new slot; a drag-drop still drifts; a border-drag resize is still instant; a newly opened window still appears instantly rather than flying in from the left
