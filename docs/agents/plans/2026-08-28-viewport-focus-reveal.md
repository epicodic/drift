# Viewport Focus Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent focus changes from moving the viewport when an oversized focused window already overlaps it.

**Architecture:** Keep `Viewport.offsetToReveal()` as the sole calculation for focus-scroll targets.
For a window at least as wide as the viewport, preserve the camera while the window overlaps the visible range and reveal only its nearest edge when it lies completely outside that range.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## File Structure

- Modify: `src/viewport/viewport.ts` to distinguish normal and oversized rectangles in `Viewport.offsetToReveal()`.
- Modify: `src/viewport/viewport.test.ts` to specify the oversized focus-reveal behavior.

### Task 1: Oversized Focus Reveal

**Files:**
- Modify: `src/viewport/viewport.test.ts`
- Modify: `src/viewport/viewport.ts`
- Test: `src/viewport/viewport.test.ts`

- [ ] **Step 1: Read the TypeScript conventions**

Read `docs/coding-conventions.md`.

- [ ] **Step 2: Write the failing tests**

Add these cases to `describe('Viewport — revealing a column (focus scroll)')`.

```ts
it('does not move when an oversized column already overlaps the viewport', () => {
    const viewport = new Viewport(1000);
    viewport.setContentWidth(3000);
    expect(viewport.offsetToReveal(100, 1200)).toBe(0);
});

it('reveals the nearest edge when an oversized column is completely right of the viewport', () => {
    const viewport = new Viewport(1000);
    viewport.setContentWidth(3000);
    expect(viewport.offsetToReveal(1500, 1200)).toBe(1500);
});
```

- [ ] **Step 3: Run the focused test file to verify it fails**

Run `npm test -- src/viewport/viewport.test.ts`.

Expected: FAIL because the first test currently returns `300`, which aligns the oversized column's right edge.

- [ ] **Step 4: Implement the minimal reveal calculation**

At the beginning of `Viewport.offsetToReveal()`, preserve the current offset for a rectangle at least as wide as the viewport that intersects the visible range.
For an oversized rectangle completely left of the viewport, return its right edge minus the viewport width.
For one completely right of the viewport, return its left edge.

```ts
if (rectWidth >= this.viewportWidth) {
    if (rectX + rectWidth <= viewLeft) {
        return this.clamp(rectX + rectWidth - this.viewportWidth);
    }
    if (rectX >= viewRight) {
        return this.clamp(rectX);
    }
    return this.offsetX;
}
```

Leave the current fully-visible logic unchanged for normal-width columns.

- [ ] **Step 5: Run the focused test file to verify it passes**

Run `npm test -- src/viewport/viewport.test.ts`.

Expected: PASS with the new cases and all existing viewport tests passing.

- [ ] **Step 6: Run the repository checks**

Run `npm run build`, `npm test`, and `npm run lint`.

Expected: all commands pass.

- [ ] **Step 7: Coding-guideline follow-up checklist**

- [ ] Conventions file read for TypeScript: `docs/coding-conventions.md`.
- [ ] Naming and four-space indentation match the repository conventions.
- [ ] The calculation remains pure and contains no KWin API access.
- [ ] `npm test -- src/viewport/viewport.test.ts`, `npm run build`, `npm test`, and `npm run lint` pass.