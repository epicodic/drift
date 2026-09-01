# Multi-monitor Reveal Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When focus reveals a column that fits within a single monitor, scroll it fully onto whichever screen requires the least movement, instead of only guaranteeing visibility somewhere in the combined multi-screen desktop.

**Architecture:** A new pure `Viewport.offsetToRevealOnScreen()` computes, per eligible screen, the minimal-movement offset that fully contains the column on that screen (falling back to the combined-area `offsetToReveal()` when no screen is wide enough), then `Strip.revealFocused()` reads live screen geometry from the already-injected `WorkspaceAdapter` and calls the new method instead of the old one.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design doc:** `docs/agents/specs/2026-09-01-multimonitor-reveal-design.md` — read before implementing

---

## Task 1: `Viewport.offsetToRevealOnScreen`

**Files:**
- Modify: `src/viewport/viewport.ts`
- Test: `src/viewport/viewport.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to the end of `src/viewport/viewport.test.ts` (after the existing `'Viewport — content that starts left of zero'` block):

```ts
describe('Viewport — offsetToRevealOnScreen (multi-monitor alignment)', () => {
    it('does not move when the column is already fully on the closer screen', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        viewport.scrollTo(500); // view [500,2500]
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // col [1600,1800] already fully within the right screen's view [1500,2500]
        expect(viewport.offsetToRevealOnScreen(1600, 200, screens)).toBe(500);
    });

    it('snaps a bezel-straddling column onto whichever screen needs less movement', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        viewport.scrollTo(500); // view [500,2500]
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // col [1450,1650] straddles the bezel at x=1500 in the current view.
        // Left screen would need offset 650 (delta 150); right screen needs offset 450 (delta 50).
        expect(viewport.offsetToRevealOnScreen(1450, 200, screens)).toBe(450);
    });

    it('still aligns a straddling column when total content is narrower than the combined desktop', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(1408); // only two columns open: [0,700] and [708,1408]
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // Without relaxing the "never show empty space" clamp, both screens' candidates would
        // clamp back to offset 0 (content narrower than the 2000-wide combined viewport) and the
        // column [708,1408] would stay straddling the bezel at x=1000. The right screen's ideal
        // (unclamped) offset -292 fully separates it instead, showing empty desktop past the
        // right screen's edge rather than at the bezel.
        expect(viewport.offsetToRevealOnScreen(708, 700, screens)).toBe(-292);
    });

    it('falls back to the combined-area reveal when the column is wider than every screen', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        expect(viewport.offsetToRevealOnScreen(1000, 1500, screens)).toBe(500);
        expect(viewport.offsetToRevealOnScreen(1000, 1500, screens)).toBe(viewport.offsetToReveal(1000, 1500));
    });

    it('picks the exact-width screen with zero movement over a wider, farther one', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // col [1000,2000] exactly matches the right screen's width and is already aligned to it.
        expect(viewport.offsetToRevealOnScreen(1000, 1000, screens)).toBe(0);
    });

    it('does not re-clamp a stale offset, unlike offsetToReveal — empty space is accepted, not avoided', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(2000);
        viewport.setOffset(5000); // stale offset, e.g. left over from an unclamped shiftViewport pan
        const screens = [{ left: 0, width: 2000 }];
        // offsetToReveal would clamp this back to 0 (no empty space); offsetToRevealOnScreen
        // always targets the exact minimal-movement position instead.
        expect(viewport.offsetToRevealOnScreen(1000, 1000, screens)).toBe(1000);
        expect(viewport.offsetToReveal(1000, 1000)).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test`
Expected: FAIL — `offsetToRevealOnScreen` does not exist yet on `Viewport` (TypeScript compile error / test failure).

- [ ] **Step 3: Implement `offsetToRevealOnScreen`**

In `src/viewport/viewport.ts`, `offsetToReveal` itself is left completely unchanged (its "already visible" branch deliberately returns `this.offsetX` unclamped — see the existing test `'does not move when a visible column follows a left-edge resize in narrow content'` — so it must not be routed through a shared clamped helper). Insert the new methods after it, before `revealColumn` (i.e. after line 87 of today's file):

```ts
    /** Minimal viewLeft that brings [rectX, rectX + rectWidth] fully into [viewLeft, viewLeft + viewWidth),
     * regardless of how far the starting viewLeft is from doing so already. Used by
     * offsetToRevealOnScreen's per-screen candidates. */
    private viewLeftToReveal(rectX: number, rectWidth: number, viewLeft: number, viewWidth: number): number {
        const viewRight = viewLeft + viewWidth;
        const rectRight = rectX + rectWidth;
        if (rectX < viewLeft) {
            return rectX;
        }
        if (rectRight > viewRight) {
            return rectRight - viewWidth;
        }
        return viewLeft;
    }

    /** Minimal-movement offset that reveals [rectX, rectX + rectWidth] fully within a single screen —
     * whichever eligible screen requires the least movement from the current offset. A screen is
     * eligible when it's at least as wide as the column; only an eligible screen can fully contain it.
     * Falls back to offsetToReveal (the combined-area behavior, clamped as always) when no screen is
     * eligible.
     *
     * Deliberately not run through the combined-content clamp() at all: each candidate is the exact
     * minimal-movement position, even if that means a neighboring screen shows empty desktop space —
     * normal for a tiling WM with few windows open. Without this, content narrower than the combined
     * desktop would clamp every candidate back to the same single offset and silently prevent
     * alignment from ever firing. */
    offsetToRevealOnScreen(rectX: number, rectWidth: number, screens: ScreenBounds[]): number {
        const candidates = screens
            .filter((screen) => rectWidth <= screen.width)
            .map((screen) => {
                const viewLeft = this.offsetX + screen.left;
                return this.viewLeftToReveal(rectX, rectWidth, viewLeft, screen.width) - screen.left;
            });
        if (candidates.length === 0) {
            return this.offsetToReveal(rectX, rectWidth);
        }
        return candidates.reduce((best, candidate) =>
            Math.abs(candidate - this.offsetX) < Math.abs(best - this.offsetX) ? candidate : best,
        );
    }

    revealColumn(rectX: number, rectWidth: number): void {
        this.scrollTo(this.offsetToReveal(rectX, rectWidth));
    }
```

Add the `ScreenBounds` interface near the top of the file, after the file header comment:

```ts
/** A screen's horizontal extent, in the same coordinate space as Viewport's offset. */
export interface ScreenBounds {
    left: number;
    width: number;
}
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test`
Expected: PASS — all new tests pass, and every pre-existing test in `viewport.test.ts` still passes unchanged (`offsetToReveal` itself is untouched).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`camelCase` methods/params, `PascalCase` interface)
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, trailing commas, 120-char lines)
- [ ] Task-level verification commands from the plan executed and passing (`npm test`)
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: Wire `Strip.revealFocused` to per-screen alignment

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/runtime/strip.test.ts`:

1. Add `ScreenInfo` to the existing workspace-adapter import:

```ts
import type { ScreenInfo, WorkspaceAdapter } from '../kwin/workspace-adapter';
```

2. Replace the existing `fakeWorkspaceAdapter` function:

```ts
function fakeWorkspaceAdapter(screens: ScreenInfo[] = []): WorkspaceAdapter {
    return { screens: () => screens } as unknown as WorkspaceAdapter;
}
```

3. Add a new constant next to `AREA`/`WIDE_AREA`:

```ts
const MULTI_MONITOR_AREA: Rect = { x: 0, y: 0, width: 2000, height: 1000 };
```

4. Add a new `describe` block (anywhere at the top level of the file, alongside the existing `describe('Strip', ...)` block):

```ts
describe('Strip — revealFocused multi-monitor alignment', () => {
    it('aligns a focused column that straddles a monitor bezel onto the closer screen', () => {
        const screens: ScreenInfo[] = [
            { name: 'L', geometry: { x: 0, y: 0, width: 1000, height: 1000 } },
            { name: 'R', geometry: { x: 1000, y: 0, width: 1000, height: 1000 } },
        ];
        const strip = new Strip(MULTI_MONITOR_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(screens));
        const win1 = fakeWindow('w1', { width: 900 });
        const win2 = fakeWindow('w2', { width: 200 });

        strip.addWindow(win1.adapter); // col1 @ x=0
        strip.addWindow(win2.adapter); // col2 @ x=908 — straddles the bezel at x=1000

        // Realigned fully onto the right screen: real x = 908 - (-92) = 1000
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1000 }));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — with today's combined-area-only `revealFocused`, `win2` renders at `x: 908` (still straddling the bezel), not `x: 1000`.

- [ ] **Step 3: Implement the wiring**

In `src/runtime/strip.ts`, replace `revealFocused()` (lines 105-116):

```ts
    revealFocused(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        const screens = this.workspaceAdapter.screens().map((screen) => ({
            left: screen.geometry.x - this.area.x,
            width: screen.geometry.width,
        }));
        this.animator.animate(
            this.viewport.offset(),
            this.viewport.offsetToRevealOnScreen(rect.x, rect.width, screens),
            this.settings.animationDurationMs,
        );
    }
```

No import changes are needed for this step — `ScreenBounds` isn't referenced by name in `strip.ts`; the inline object literals in the `.map()` above satisfy `offsetToRevealOnScreen`'s parameter type structurally.

- [ ] **Step 4: Run tests to verify they pass**

`npm test`
Expected: PASS — the new multi-monitor test passes, and every pre-existing test in `strip.test.ts` still passes unchanged (default `fakeWorkspaceAdapter()` now returns `screens: () => []`, which makes `offsetToRevealOnScreen` fall back to `offsetToReveal` — identical to today's behavior).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, trailing commas, 120-char lines)
- [ ] Task-level verification commands from the plan executed and passing (`npm test`)
- [ ] Full verification: `npm run build`, `npm test`, `npm run lint` all pass
- [ ] Any convention violations fixed before moving to next task
