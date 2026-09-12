# Drag Viewport Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An almost-purely-horizontal window drag pans the viewport instead of triggering a column reorder, blending smoothly into today's reorder/stack behavior as vertical drag movement grows, gated by a `dragPanEnabled` setting.

**Architecture:** A new pure function `dragPanBlend(dyTotal, tolerancePx)` (in a new `src/input/drag-pan.ts`) computes a 0–1 blend factor from cumulative vertical drag movement. `registerDragReorder` (`src/input/drag.ts`) tracks each drag's start-y and per-tick raw x, and — before any of its existing reorder/stack logic runs — shifts the viewport by `-blend * dxTick` via `Viewport.scrollBy`. Because reorder/stack/edge-expel all already resolve from the window's *virtual* position (which the viewport offset feeds into via `toVirtualX`), no other logic in `drag.ts` needs to change. Two new settings (`dragPanEnabled`, `dragPanVerticalTolerancePx`) are threaded through `Strip.wireTile` into `DragReorderDeps`, following the exact existing pattern used for `reorderThresholdFraction`/`stackOverlapFraction`.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-10-drag-viewport-pan-design.md` — read before implementing

---

### Task 1: Pure blend function

**Files:**
- Create: `src/input/drag-pan.ts`
- Test: `src/input/drag-pan.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { dragPanBlend } from './drag-pan';

describe('dragPanBlend', () => {
    it('returns 1 (pure pan) when there has been no vertical movement at all', () => {
        expect(dragPanBlend(0, 40)).toBe(1);
    });

    it('returns 0 once vertical movement reaches the tolerance', () => {
        expect(dragPanBlend(40, 40)).toBe(0);
    });

    it('returns 0 (clamped) once vertical movement exceeds the tolerance', () => {
        expect(dragPanBlend(100, 40)).toBe(0);
    });

    it('returns a linear midpoint blend', () => {
        expect(dragPanBlend(20, 40)).toBe(0.5);
    });

    it('treats a non-positive tolerance as "panning off" for any real movement', () => {
        expect(dragPanBlend(0, 0)).toBe(1);
        expect(dragPanBlend(1, 0)).toBe(0);
        expect(dragPanBlend(1, -5)).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- drag-pan`
Expected: FAIL — `./drag-pan` module does not exist yet

- [ ] **Step 3: Write minimal implementation**

```typescript
// Pure geometry: how much of a drag's horizontal movement should be absorbed into panning
// the viewport, vs. left as real (reorder/stack-triggering) movement — the single mechanism
// shared by every drag, no KWin/Grid/Viewport dependency (docs:
// 2026-09-10-drag-viewport-pan-design).

/** Linear blend factor for how much of the dragged window's horizontal movement this tick
 * should pan the viewport rather than move the window's virtual position. 1 at `dyTotal = 0`
 * (pure pan), 0 at `dyTotal >= tolerancePx` (today's reorder/stack behavior, unchanged),
 * linear in between. A non-positive `tolerancePx` returns 0 for any `dyTotal > 0` (panning
 * effectively off) and 1 only at exactly `dyTotal = 0`. */
export function dragPanBlend(dyTotal: number, tolerancePx: number): number {
    if (tolerancePx <= 0) {
        return dyTotal <= 0 ? 1 : 0;
    }
    return Math.min(Math.max(1 - dyTotal / tolerancePx, 0), 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- drag-pan`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`camelCase` function, `dragPanBlend`/`dyTotal`/`tolerancePx`)
- [ ] Language-specific guidelines are followed (4-space indent, doc comment explaining WHY/behavior, not restating the code)
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: New settings — `dragPanEnabled`, `dragPanVerticalTolerancePx`

**Files:**
- Modify: `src/config/settings-definitions.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/config/settings.test.ts`
- Modify: `src/config/settings-definitions.test.ts`
- Regenerate (gitignored build artifact, not committed): `drift/contents/config/main.xml`

- [ ] **Step 1: Write the failing tests**

In `src/config/settings.test.ts`, add (anywhere among the other `DEFAULT_SETTINGS` tests, e.g. right after the `stackOverlapFraction` one):

```typescript
    it('defaults dragPanEnabled to true', () => {
        expect(DEFAULT_SETTINGS.dragPanEnabled).toBe(true);
    });

    it('defaults dragPanVerticalTolerancePx to 40', () => {
        expect(DEFAULT_SETTINGS.dragPanVerticalTolerancePx).toBe(40);
    });
```

In `src/config/settings-definitions.test.ts`, update the total-count assertion (currently 55; two new entries make it 57):

```typescript
        expect(names.length).toBe(57);
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- settings`
Expected: FAIL — `dragPanEnabled`/`dragPanVerticalTolerancePx` are `undefined` on `DEFAULT_SETTINGS`, and the count assertion is off by 2

- [ ] **Step 3: Add the definitions**

In `src/config/settings-definitions.ts`, add two entries directly after the existing `stackOverlapFraction` entry:

```typescript
    { name: 'reorderThresholdFraction', type: 'Double', default: 0.85 },
    { name: 'stackOverlapFraction', type: 'Double', default: 0.5 },
    { name: 'dragPanEnabled', type: 'Bool', default: true },
    { name: 'dragPanVerticalTolerancePx', type: 'UInt', default: 40 },
```

In `src/config/settings.ts`, add the corresponding `Settings` interface fields directly after the existing `stackOverlapFraction` field (`buildDefaultSettings`/`loadSettings` already derive everything generically from `SETTINGS_DEFINITIONS`, so no other code in this file changes):

```typescript
    /** Minimum horizontal overlap (as a fraction of the candidate tile's own width)
     * between the dragged window and a candidate tile before that tile is considered for
     * stacking at all (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    stackOverlapFraction: number;
    /** Whether an almost-purely-horizontal drag pans the viewport instead of reordering the
     * dragged window's column (docs: 2026-09-10-drag-viewport-pan-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, at which drag-pan fades to 0 and today's
     * reorder/stack behavior takes over fully (docs: 2026-09-10-drag-viewport-pan-design). */
    dragPanVerticalTolerancePx: number;
```

- [ ] **Step 4: Regenerate `main.xml`**

`npm run generate:config`

This regenerates `drift/contents/config/main.xml` (and `drift/contents/bin/shortcut-bindings.generated.sh`, unaffected here) from `SETTINGS_DEFINITIONS`. Confirm the two new `<entry>` elements appear:

`grep -A1 'name="dragPan' drift/contents/config/main.xml`
Expected: both `dragPanEnabled` (type `Bool`) and `dragPanVerticalTolerancePx` (type `UInt`, default `40`) present

- [ ] **Step 5: Run tests to verify they pass**

`npm test -- settings`
Expected: PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`dragPanEnabled`, `dragPanVerticalTolerancePx` — `camelCase`, `Px`/no-suffix-for-bool matching existing `stripDragEdgeBorderPx`/`minimapShowThumbnails` style)
- [ ] Doc comments explain WHY/what, referencing the design doc, matching neighboring fields
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Settings dialog UI

**Files:**
- Modify: `drift/contents/ui/config.ui`

- [ ] **Step 1: Add the two widgets**

In `drift/contents/ui/config.ui`, inside `tab_behavior`'s `groupBox_dragging` → `formLayout_dragging`, add two new rows (5 and 6) directly after the existing row 4 (`kcfg_stackOverlapFraction`), following the exact pattern of the neighboring rows and of `kcfg_minimapShowThumbnails`'s label-less checkbox row:

```xml
                                        <item row="5" column="1">
                                            <widget class="QCheckBox" name="kcfg_dragPanEnabled">
                                                <property name="toolTip">
                                                    <string>An almost-purely-horizontal drag pans the viewport instead of reordering the dragged window's column</string>
                                                </property>
                                                <property name="text">
                                                    <string>Pan the viewport on a horizontal drag</string>
                                                </property>
                                                <property name="checked">
                                                    <bool>true</bool>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="6" column="0">
                                            <widget class="QLabel" name="label_dragPanVerticalTolerancePx">
                                                <property name="text">
                                                    <string>Drag-pan vertical tolerance:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="6" column="1">
                                            <widget class="QSpinBox" name="kcfg_dragPanVerticalTolerancePx">
                                                <property name="toolTip">
                                                    <string>Cumulative vertical drag movement, in pixels, at which drag-pan fades out and reordering takes over fully</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>500</number>
                                                </property>
                                                <property name="value">
                                                    <number>40</number>
                                                </property>
                                            </widget>
                                        </item>
```

- [ ] **Step 2: Verify the file is well-formed and lints clean**

`npm run lint`
Expected: PASS — no XML/QML errors. (`config.ui` has no dedicated unit test; this is glue UI, verified by lint plus the manual settings-dialog check in Task 5.)

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Widget names/order match the existing `groupBox_dragging` pattern exactly (`kcfg_<settingName>`, `label_<settingName>`)
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Pan step in `registerDragReorder`, wired into `Strip`

**Files:**
- Modify: `src/input/drag.ts`
- Modify: `src/runtime/strip.ts`
- Modify: `src/runtime/strip.test.ts`

No new automated test for the `drag.ts`/`strip.ts` wiring itself — `drag.ts` is documented, existing glue code with no direct test coverage (see the file's own top-of-file comment and `requireColumn`'s doc comment), consistent with how the rest of the file's tick-by-tick wiring is verified today: the pure logic it calls (`dragPanBlend`, tested in Task 1) is unit-tested, and the wiring itself is verified by the existing `strip.test.ts` drag-reorder/stack suite (Step 8) plus manual live-testing (Task 5).

**Important — this task must land as one unit.** `DragReorderDeps` gains two *required* fields (Step 2) whose only construction site is `Strip.wireTile` (Step 7): the build will not compile between those two steps. Do not stop partway through this task with the interface changed but `wireTile` not yet updated.

- [ ] **Step 1: Import the new pure function**

In `src/input/drag.ts`, add to the existing import block:

```typescript
import { dragPanBlend } from './drag-pan';
```

- [ ] **Step 2: Add `dragPanEnabled`/`dragPanVerticalTolerancePx` to `DragReorderDeps`**

Directly after the existing `stackOverlapFraction` field in the `DragReorderDeps` interface:

```typescript
    /** Minimum horizontal overlap a candidate tile needs before it's considered for
     * stacking (`settings.stackOverlapFraction`) — see `resolveStackTarget`. */
    stackOverlapFraction: number;
    /** Whether an almost-purely-horizontal drag pans the viewport instead of reordering
     * (`settings.dragPanEnabled`) — see `dragPanBlend` (docs:
     * 2026-09-10-drag-viewport-pan-design). */
    dragPanEnabled: boolean;
    /** Cumulative vertical drag movement, in pixels, at which drag-pan fades to 0
     * (`settings.dragPanVerticalTolerancePx`) — see `dragPanBlend`. */
    dragPanVerticalTolerancePx: number;
```

- [ ] **Step 3: Track each drag's start-y and last-x**

In `registerDragReorder`, directly after the existing `let armedStackKey: string | null = null;` line:

```typescript
    /** The dragged window's real (screen) y at the start of the current drag — the baseline
     * `dragPanBlend`'s cumulative `dyTotal` is measured against. Seeded here (not just in
     * `onInteractiveMoveResizeStarted`) so an `initiallyDragging` connection — created
     * mid-drag by a cross-strip reparent — has a sane starting value even though it never
     * sees that signal fire (docs: 2026-09-10-drag-viewport-pan-design). */
    let startY = win.frameGeometry().y;
    /** The dragged window's real (screen) x as of the last tick — this tick's raw
     * horizontal delta (`dxTick`) is measured against it. */
    let lastX = win.frameGeometry().x;
```

- [ ] **Step 4: Reseed both on every fresh drag start**

Replace the existing `onInteractiveMoveResizeStarted` handler:

```typescript
    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            deps.onDragStarted?.(win);
        }
    });
```

with:

```typescript
    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            const rect = win.frameGeometry();
            startY = rect.y;
            lastX = rect.x;
            deps.onDragStarted?.(win);
        }
    });
```

- [ ] **Step 5: Apply the pan step at the top of `tickInner`, before reorder/stack logic reads virtual edges**

Replace:

```typescript
    const tickInner = (): void => {
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);

        const raw = win.frameGeometry();
        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)}) ` +
                `raw=(${raw.x.toFixed(0)},${raw.y.toFixed(0)},${raw.width.toFixed(0)},${raw.height.toFixed(0)}) ` +
                `viewportOffset=${deps.viewport.offset().toFixed(0)}`,
        );
```

with:

```typescript
    const tickInner = (): void => {
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        // Pan step: absorb some/all of this tick's raw horizontal movement into the
        // viewport instead of leaving it as real (reorder/stack-triggering) movement. Must
        // run before winEdges/resolveCurrentTarget below, since both read the window's
        // virtual position, which this changes via viewport.offset() (docs:
        // 2026-09-10-drag-viewport-pan-design).
        const raw = win.frameGeometry();
        if (deps.dragPanEnabled) {
            const dyTotal = Math.abs(raw.y - startY);
            const dxTick = raw.x - lastX;
            const blend = dragPanBlend(dyTotal, deps.dragPanVerticalTolerancePx);
            if (dxTick !== 0 && blend > 0) {
                deps.viewport.scrollBy(-blend * dxTick);
            }
        }
        lastX = raw.x;

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);

        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)}) ` +
                `raw=(${raw.x.toFixed(0)},${raw.y.toFixed(0)},${raw.width.toFixed(0)},${raw.height.toFixed(0)}) ` +
                `viewportOffset=${deps.viewport.offset().toFixed(0)}`,
        );
```

Note this both adds the pan step and removes the old, now-redundant second `const raw = win.frameGeometry();` declaration — `raw` is fetched once, at the top.

- [ ] **Step 6: Disable drag-pan in the `strip.test.ts` settings fixture**

Every existing drag-reorder/stack/edge-expel test in `strip.test.ts` simulates a purely-horizontal drag (`y` held at a constant value, e.g. `y: 0`, across every tick) and asserts that it triggers a real, immediate reorder/stack — that is exactly the `dyTotal = 0` case this feature repurposes into pure panning (`dragPanBlend(0, tolerancePx) === 1`). Those tests are validating reorder/stack logic, not drag-pan (which has its own dedicated, isolated tests in Task 1), so disable the new feature in the shared fixture they all derive from, next to the file's existing settings overrides:

```typescript
const SETTINGS = {
    ...DEFAULT_SETTINGS,
    topMargin: 0,
    bottomMargin: 0,
    leftMargin: 0,
    rightMargin: 0,
    verticalGap: 0,
    // Every existing drag test here simulates a purely-horizontal drag (constant y) and
    // asserts it triggers an immediate reorder/stack — exactly the case drag-pan (docs:
    // 2026-09-10-drag-viewport-pan-design) repurposes into panning. Keep those tests
    // exercising reorder/stack logic only; drag-pan itself is covered by drag-pan.test.ts.
    dragPanEnabled: false,
};
```

(`INSTANT_SETTINGS`/`SHIFT_SETTINGS`/`STEP_SETTINGS`/`marginSettings` and every other fixture in this file spread from `SETTINGS`, so this one change covers all of them.)

- [ ] **Step 7: Thread the two settings into `Strip.wireTile`**

In `Strip.wireTile`, directly after the existing `stackOverlapFraction: this.settings.stackOverlapFraction,` line inside the `registerDragReorder(...)` call's deps object:

```typescript
                        reorderThresholdFraction: this.settings.reorderThresholdFraction,
                        stackOverlapFraction: this.settings.stackOverlapFraction,
                        dragPanEnabled: this.settings.dragPanEnabled,
                        dragPanVerticalTolerancePx: this.settings.dragPanVerticalTolerancePx,
```

This is also the point where the build starts compiling again (see the note at the top of this task).

- [ ] **Step 8: Run the full test suite and build**

`npm test && npm run build`
Expected: PASS — including every existing `strip.test.ts` drag-reorder/stack/edge-expel test, unmodified in behavior thanks to Step 6.

- [ ] **Step 9: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`startY`, `lastX`, `dyTotal`, `dxTick`, `blend` — `camelCase`)
- [ ] Doc comments explain WHY, matching each file's existing density and style
- [ ] New `wireTile` lines match the exact style/order of the neighboring `reorderThresholdFraction`/`stackOverlapFraction` lines
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete test suite**

`npm test`
Expected: PASS, all suites

- [ ] **Step 2: Run lint**

`npm run lint`
Expected: PASS — TypeScript, JavaScript, and `qmllint` checks all clean

- [ ] **Step 3: Run the build**

`npm run build`
Expected: PASS — confirms `drift/contents/config/main.xml` regenerates cleanly and rollup compiles with the new `drag-pan.ts` module and `drag.ts`/`strip.ts` changes

- [ ] **Step 4: Manual live-test (per `docs/development.md`'s install/reload flow)**

Install the built package and, with a strip containing at least 3-4 columns:
1. Drag a window almost perfectly horizontally (steady `y`) across the strip — confirm the strip visibly pans/scrolls while the dragged window stays roughly anchored under the cursor, and releasing drops it back into (approximately) its original column.
2. Start the same drag, then introduce clear vertical movement partway through — confirm it smoothly hands off into today's reorder behavior (no snap/jump), and completing the drag reorders the column as expected.
3. Drag with `y` movement already well past `dragPanVerticalTolerancePx` (40px default) — confirm behavior is pixel-for-pixel identical to before this feature (plain reorder/stack, no panning).
4. Pan a window all the way to the strip's start/end — confirm panning stops cleanly at the content bound rather than overscrolling.
5. In the settings dialog (`tab_behavior` → Dragging), toggle "Pan the viewport on a horizontal drag" off — confirm dragging reverts fully to today's behavior; toggle it back on and adjust the vertical-tolerance spin box — confirm the fade-out distance changes accordingly.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] All automated checks (Steps 1-3) pass
- [ ] All manual scenarios (Step 4) behave as described
- [ ] Any issues found are fixed and this task re-run before considering the plan complete
