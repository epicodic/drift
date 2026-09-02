# Multi-strip minimap overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the minimap overlay show every strip in the active `StripStack` at once, aligned to their real relative positions, with the white viewport indicator following the active row vertically.

**Architecture:** `Strip.minimapSnapshot()` stays a pure per-row builder. A new pure `combineStripStackSnapshot()` in `src/ui/minimap.ts` merges every row's snapshot into one `StripStackMinimapSnapshot`, which `StripStack.minimapSnapshot()` now returns. `src/kwin/minimap-overlay.ts` renders it with a nested per-row `Repeater` and a row-aware viewport box; `Controller`'s empty-strip guard is updated to match the new shape.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-02-multi-strip-minimap-design.md` — read before implementing

**Ordering note:** Tasks 2, 3, and 4 change one link each in the same call chain (`StripStack.minimapSnapshot()` → `Controller.focusAndShowMinimap()` → `MinimapOverlay.show()`), so the project only typechecks cleanly again once Task 4 is done — that's expected, not a sign anything went wrong partway through. Task 1's tests run standalone throughout. Run the full verification in Task 5 as the actual completion gate.

---

### Task 1: Pure multi-row aggregation (`src/ui/minimap.ts`)

**Files:**
- Modify: `src/ui/minimap.ts:63` (append after `buildMinimapSnapshot`)
- Test: `src/ui/minimap.test.ts:58` (append after the existing `describe('buildMinimapSnapshot', ...)` block)

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/minimap.test.ts` (add `combineStripStackSnapshot` to the existing import from `./minimap` on line 7, so it reads `import { buildMinimapSnapshot, combineStripStackSnapshot } from './minimap';`):

```ts
describe('combineStripStackSnapshot', () => {
    const viewportA = { offset: 0, width: 1280, contentLeft: 0, contentWidth: 2000 };

    function row(
        rowIndex: number,
        columns: MinimapColumn[],
        viewport: MinimapViewport = viewportA,
        gridHeight = 1000,
    ): { rowIndex: number; snapshot: MinimapSnapshot } {
        return { rowIndex, snapshot: { columns, viewport, gridHeight } };
    }

    it('merges every row, tagging each with its own rowIndex', () => {
        const rowMinus1 = row(-1, [{ id: 1, x: 0, width: 400, focused: false, icon: null, thumbnail: null }]);
        const row0 = row(0, [{ id: 2, x: 0, width: 600, focused: true, icon: null, thumbnail: null }]);

        const combined = combineStripStackSnapshot([rowMinus1, row0], 0, 1000);

        expect(combined.rows).toEqual([
            { rowIndex: -1, columns: rowMinus1.snapshot.columns },
            { rowIndex: 0, columns: row0.snapshot.columns },
        ]);
    });

    it('suppresses focused on every row except the active one', () => {
        const inactive = row(-1, [{ id: 1, x: 0, width: 400, focused: true, icon: null, thumbnail: null }]);
        const active = row(0, [{ id: 2, x: 0, width: 600, focused: true, icon: null, thumbnail: null }]);

        const combined = combineStripStackSnapshot([inactive, active], 0, 1000);

        expect(combined.rows[0].columns[0].focused).toBe(false);
        expect(combined.rows[1].columns[0].focused).toBe(true);
    });

    it('takes viewport and gridHeight from the active row, tagged with its rowIndex', () => {
        const inactive = row(-1, [], { offset: 999, width: 1, contentLeft: 999, contentWidth: 1 }, 1);
        const active = row(2, [], viewportA, 1000);

        const combined = combineStripStackSnapshot([inactive, active], 2, 1000);

        expect(combined.viewport).toEqual({ rowIndex: 2, ...viewportA });
        expect(combined.gridHeight).toBe(1000);
    });

    it('passes rowPitch through unchanged', () => {
        const combined = combineStripStackSnapshot([row(0, [])], 0, 1234);

        expect(combined.rowPitch).toBe(1234);
    });

    it('throws when no row matches the active index', () => {
        expect(() => combineStripStackSnapshot([row(0, [])], 5, 1000)).toThrow('5');
    });
});
```

Also add `MinimapColumn` and `MinimapViewport` to the existing type-only import block at the top of the test file (currently only `buildMinimapSnapshot` is imported as a value from `./minimap`; add `import type { MinimapColumn, MinimapViewport, MinimapSnapshot } from './minimap';` as a separate line).

- [ ] **Step 2: Run tests to verify they fail**

`npx vitest run src/ui/minimap.test.ts`
Expected: FAIL — `combineStripStackSnapshot` is not exported yet (TypeScript/module error).

- [ ] **Step 3: Write the implementation**

Append to `src/ui/minimap.ts`:

```ts
export interface MinimapRow {
    rowIndex: number;
    columns: MinimapColumn[];
}

/** A stack-level viewport: where the user is actually looking, in both dimensions — which
 * row (`rowIndex`) plus the horizontal scroll/content extent within it. Only the active row
 * ever has a real on-screen viewport, so a stack snapshot carries exactly one of these. */
export interface StripStackMinimapViewport {
    rowIndex: number;
    offset: number;
    width: number;
    contentLeft: number;
    contentWidth: number;
}

export interface StripStackMinimapSnapshot {
    rows: MinimapRow[];
    viewport: StripStackMinimapViewport;
    gridHeight: number;
    /** Real-pixel vertical distance between adjacent rows' origins (`StripStack`'s own
     * `area.height`) — may exceed `gridHeight` (which excludes `settings.bottomMargin`),
     * leaving a real gap between rows in the rendered map, matching their on-screen look. */
    rowPitch: number;
}

/** Merges every row currently in a `StripStack` into one aggregate snapshot. A row's own
 * `Grid` always remembers its last-focused column even while inactive — that isn't real
 * (OS-level) focus, so every row except `activeRowIndex` has `focused` forced to `false`
 * on its columns (docs: 2026-09-02-multi-strip-minimap-design). */
export function combineStripStackSnapshot(
    rows: { rowIndex: number; snapshot: MinimapSnapshot }[],
    activeRowIndex: number,
    rowPitch: number,
): StripStackMinimapSnapshot {
    const active = rows.find((row) => row.rowIndex === activeRowIndex);
    if (active === undefined) {
        throw new Error(`combineStripStackSnapshot: no row at active index ${activeRowIndex}`);
    }
    return {
        rows: rows.map((row) => ({
            rowIndex: row.rowIndex,
            columns:
                row.rowIndex === activeRowIndex
                    ? row.snapshot.columns
                    : row.snapshot.columns.map((column) => Object.assign({}, column, { focused: false })),
        })),
        viewport: Object.assign({ rowIndex: activeRowIndex }, active.snapshot.viewport),
        gridHeight: active.snapshot.gridHeight,
        rowPitch,
    };
}
```

**Note:** use `Object.assign(...)`, not object-spread (`{...column, ...}`) — this codebase's ESLint config bans spread syntax in every non-test `src/**/*.ts` file (KWin's JS engine rejects it at parse time). See `src/runtime/strip.ts:116` for existing precedent. (This is already how Task 1 was actually implemented and approved — the code above reflects that, not the literal spread form.)

- [ ] **Step 4: Run tests to verify they pass**

`npx vitest run src/ui/minimap.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`PascalCase` types, `camelCase` functions)
- [ ] Language-specific guidelines are followed (pure function, no KWin imports, matches existing file's style)
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Wire `StripStack.minimapSnapshot()` to aggregate every row

**Files:**
- Modify: `src/runtime/strip-stack.ts:17` (import), `src/runtime/strip-stack.ts:137-139` (`minimapSnapshot()`)
- Test: `src/runtime/strip-stack.test.ts:78` (fake default), `src/runtime/strip-stack.test.ts:175-195` (existing delegation test), `src/runtime/strip-stack.test.ts:319` (new test, appended just before the `describe('StripStack row paging', ...)` block's closing `});`)

- [ ] **Step 1: Write/adjust the failing tests**

In `src/runtime/strip-stack.test.ts`, replace the `minimapSnapshot` line inside `fakeStrip()`'s `fns` object (line 78) so the fake returns a complete per-row `MinimapSnapshot` (the aggregate needs real `viewport`/`gridHeight` from the active row, not just `columns`):

```ts
        minimapSnapshot: vi.fn(() => ({
            columns: [],
            viewport: { offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 0 },
            gridHeight: AREA.height,
        })),
```

Replace the existing test at lines 175-195 (`'delegates render, focusLeft/Right, cycleAlign, shiftViewport, and minimapSnapshot to the active row'`) with:

```ts
    it('delegates render, focusLeft/Right, cycleAlign, shiftViewport, and minimapSnapshot to the active row', () => {
        const { stack, created } = makeStack();

        stack.render();
        stack.focusLeft();
        stack.focusRight();
        stack.cycleAlignLeft();
        stack.cycleAlignRight();
        stack.shiftViewportLeft();
        stack.shiftViewportRight();
        const snapshot = stack.minimapSnapshot();

        expect(created[0].render).toHaveBeenCalled();
        expect(created[0].focusLeft).toHaveBeenCalled();
        expect(created[0].focusRight).toHaveBeenCalled();
        expect(created[0].cycleAlignLeft).toHaveBeenCalled();
        expect(created[0].cycleAlignRight).toHaveBeenCalled();
        expect(created[0].shiftViewportLeft).toHaveBeenCalled();
        expect(created[0].shiftViewportRight).toHaveBeenCalled();
        expect(created[0].minimapSnapshot).toHaveBeenCalled();
        expect(snapshot.rows).toEqual([{ rowIndex: 0, columns: [] }]);
        expect(snapshot.viewport).toEqual({ rowIndex: 0, offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 0 });
        expect(snapshot.rowPitch).toBe(AREA.height);
    });
```

Append a new test just before the closing `});` of the `describe('StripStack row paging', ...)` block (currently line 320):

```ts
    it('aggregates every currently existing row, leaving a gap where a pruned row was', () => {
        const { stack, created } = makeStack();
        created[0].minimapSnapshot.mockReturnValue({
            columns: [{ id: 1, x: 0, width: 400, focused: true, icon: null, thumbnail: null }],
            viewport: { offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 400 },
            gridHeight: AREA.height,
        });
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.rowDown(); // row 1 active; row 1 stays empty (default isEmpty() === true)
        stack.rowDown(); // row 2 active; leaving empty row 1 prunes it, leaving a gap at index 1
        created[2].minimapSnapshot.mockReturnValue({
            columns: [{ id: 2, x: 0, width: 300, focused: true, icon: null, thumbnail: null }],
            viewport: { offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 300 },
            gridHeight: AREA.height,
        });

        const snapshot = stack.minimapSnapshot();

        expect(snapshot.rows.map((row) => row.rowIndex)).toEqual([0, 2]); // row 1 pruned, gap preserved
        expect(snapshot.rows[0].columns[0].focused).toBe(false); // row 0 no longer active
        expect(snapshot.rows[1].columns[0].focused).toBe(true); // row 2 is active
        expect(snapshot.viewport.rowIndex).toBe(2);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

`npx vitest run src/runtime/strip-stack.test.ts`
Expected: FAIL — `StripStack.minimapSnapshot()` still returns the old single-row shape, so `snapshot.rows`/`snapshot.viewport.rowIndex`/`snapshot.rowPitch` are `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/runtime/strip-stack.ts`, change the import on line 17 from:

```ts
import type { MinimapSnapshot } from '../ui/minimap';
```

to:

```ts
import { combineStripStackSnapshot, type StripStackMinimapSnapshot } from '../ui/minimap';
```

Replace the `minimapSnapshot()` method (lines 137-139):

```ts
    minimapSnapshot(): StripStackMinimapSnapshot {
        const rows = Array.from(this.rows.entries())
            .map(([rowIndex, strip]) => ({ rowIndex, snapshot: strip.minimapSnapshot() }))
            .sort((a, b) => a.rowIndex - b.rowIndex);
        return combineStripStackSnapshot(rows, this.activeRowIndex, this.area.height);
    }
```

**Note:** use `Array.from(this.rows.entries())`, not `[...this.rows.entries()]` — this codebase's ESLint config (`eslint.config.mjs`) bans spread syntax (`SpreadElement`) in every non-test `src/**/*.ts` file, since KWin's JS engine rejects it at parse time. See `src/runtime/strip-manager.ts:77` for existing precedent.

- [ ] **Step 4: Run tests to verify they pass**

`npx vitest run src/runtime/strip-stack.test.ts`
Expected: PASS

(The project as a whole will not typecheck yet — `Controller` and `MinimapOverlay` still expect the old single-row `MinimapSnapshot` shape. That's expected per the Ordering note above; Tasks 3 and 4 resolve it.)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Render every row in the minimap overlay (`src/kwin/minimap-overlay.ts`)

This file touches KWin/QML and cannot be unit-tested outside a live compositor (see `docs/agents/specs/2026-09-01-minimap-design.md`'s Testing section) — no test file exists for it today, and this task doesn't add one, matching that established convention. Verification is via `npm run typecheck` and `npm run lint` (which runs `qmllint` on the embedded QML), plus a manual sanity check in a live session if available.

**Files:**
- Modify: `src/kwin/minimap-overlay.ts` (whole file — the QML template, both interfaces, `show()`, and all three layout functions change)

- [ ] **Step 1: Write the implementation**

Replace the full contents of `src/kwin/minimap-overlay.ts` with:

```ts
// A centered OSD overlay showing every strip in the active StripStack, aligned to their real
// relative positions, shown on Meta+Tab/Meta+Shift+Tab/Meta+PgUp/Meta+PgDown (docs:
// 2026-09-01-minimap-design, 2026-09-01-minimap-thumbnails-design,
// 2026-09-02-multi-strip-minimap-design). Built via `Qt.createQmlObject`, the same pattern as
// `debug-console.ts`.

import type { Rect } from '../core/coordinates';
import type { StripStackMinimapSnapshot } from '../ui/minimap';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const MINIMAP_OVERLAY_WINDOW_TITLE = 'Drift Minimap';

const PANEL_WIDTH = 900;
const MAX_MINIMAP_HEIGHT = 600;
const PANEL_MARGIN = 20;

const MINIMAP_QML = `import QtQuick 6.0
import QtQuick.Effects
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
import org.kde.kwin 3.0 as KWinComponents
PlasmaCore.Dialog {
    id: dialog
    property var rows: []
    property var viewportBox: ({ x: 0, y: 0, width: 0 })
    property real panelWidth: ${PANEL_WIDTH}
    property real panelHeight: ${MAX_MINIMAP_HEIGHT}
    property real rowHeight: ${MAX_MINIMAP_HEIGHT}
    property bool showThumbnails: false
    title: "${MINIMAP_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Rectangle {
        radius: 8
        color: Qt.rgba(0, 0, 0, 0.75)
        implicitWidth: dialog.panelWidth + ${PANEL_MARGIN * 2}
        implicitHeight: dialog.panelHeight + ${PANEL_MARGIN * 2}
        Item {
            anchors.fill: parent
            anchors.margins: ${PANEL_MARGIN}
            Repeater {
                model: dialog.rows
                delegate: Item {
                    x: 0
                    y: modelData.y
                    width: parent.width
                    height: dialog.rowHeight
                    Repeater {
                        model: modelData.columns
                        delegate: Rectangle {
                            x: modelData.x
                            width: Math.max(modelData.width, 2)
                            height: dialog.rowHeight
                            radius: 4
                            color: modelData.focused ? "#3daee9" : "#5c5c5c"
                            clip: true
                            KWinComponents.WindowThumbnail {
                                client: modelData.thumbnail
                                visible: dialog.showThumbnails && modelData.thumbnail !== null
                                anchors.fill: parent
                            }
                            Kirigami.Icon {
                                anchors.centerIn: parent
                                width: Math.min(parent.width - 8, 32)
                                height: width
                                source: modelData.icon
                                visible: !dialog.showThumbnails && modelData.icon !== null && parent.width > 12
                            }
                            Kirigami.Icon {
                                anchors {
                                    right: parent.right
                                    bottom: parent.bottom
                                    margins: 2
                                }
                                width: Math.min(parent.width - 4, 20)
                                height: width
                                source: modelData.icon
                                visible: dialog.showThumbnails && modelData.icon !== null && parent.width > 12
                            }
                            // Painted last so the focus indicator stays on top of the window
                            // thumbnail, regardless of when its async live content arrives.
                            Item {
                                id: focusRingSource
                                anchors.fill: parent
                                visible: false
                                Rectangle {
                                    anchors.fill: parent
                                    radius: 4
                                    color: "transparent"
                                    border.color: "#3daee9"
                                    border.width: 4
                                }
                            }
                            MultiEffect {
                                anchors.fill: focusRingSource
                                source: focusRingSource
                                visible: modelData.focused
                                blurEnabled: true
                                blur: 1.0
                                blurMax: 24
                                brightness: 0.15
                            }
                            Rectangle {
                                anchors.fill: parent
                                radius: 4
                                color: "transparent"
                                border.color: "#3daee9"
                                border.width: 2
                                visible: modelData.focused
                            }
                        }
                    }
                }
            }
            Rectangle {
                x: dialog.viewportBox.x
                y: dialog.viewportBox.y - 6
                width: Math.max(dialog.viewportBox.width, 2)
                height: dialog.rowHeight + 12
                radius: 4
                color: "transparent"
                border.color: "#ffffff"
                border.width: 2
            }
        }
    }
}`;

interface PanelColumn {
    x: number;
    width: number;
    focused: boolean;
    icon: QIcon | null;
    thumbnail: Window | null;
}

interface PanelRow {
    y: number;
    columns: PanelColumn[];
}

interface PanelViewportBox {
    x: number;
    y: number;
    width: number;
}

export interface MinimapOverlay {
    show(snapshot: StripStackMinimapSnapshot, screen: Rect): void;
}

export function createMinimapOverlay(parent: QmlObject, autoHideMs: number, showThumbnails: boolean): MinimapOverlay {
    const dialog = Qt.createQmlObject(MINIMAP_QML, parent) as QmlMinimapDialog;
    dialog.showThumbnails = showThumbnails;
    const hideTimer = createQmlTimer(parent);

    return {
        show(snapshot: StripStackMinimapSnapshot, screen: Rect): void {
            const { panelWidth, panelHeight, rowHeight } = panelLayout(snapshot);
            dialog.rows = toPanelRows(snapshot);
            dialog.viewportBox = toPanelViewportBox(snapshot);
            dialog.panelWidth = panelWidth;
            dialog.panelHeight = panelHeight;
            dialog.rowHeight = rowHeight;
            const dialogWidth = panelWidth + PANEL_MARGIN * 2;
            const dialogHeight = panelHeight + PANEL_MARGIN * 2;
            dialog.width = dialogWidth;
            dialog.height = dialogHeight;
            dialog.x = Math.round(screen.x + (screen.width - dialogWidth) / 2);
            dialog.y = Math.round(screen.y + (screen.height - dialogHeight) / 2);
            dialog.visible = true;
            hideTimer.start(autoHideMs, () => {
                hideTimer.stop();
                dialog.visible = false;
            });
        },
    };
}

/** The uniform scale factor is `min` of the two per-axis fits (not each axis scaled
 * independently) so that a column's rendered width:height ratio always matches its true
 * `columnWidth : gridHeight` ratio (docs: 2026-09-01-minimap-thumbnails-design). Spans every
 * row's columns (plus the active viewport's own extent) horizontally, and every row's real
 * `rowIndex * rowPitch` position vertically — a row with no entry between the lowest and
 * highest existing `rowIndex` (pruned or never created) is simply never drawn, leaving real
 * blank space at its position (docs: 2026-09-02-multi-strip-minimap-design). */
function panelLayout(snapshot: StripStackMinimapSnapshot): {
    left: number;
    top: number;
    scale: number;
    panelWidth: number;
    panelHeight: number;
    rowHeight: number;
} {
    const { viewport } = snapshot;
    let left = Math.min(viewport.contentLeft, viewport.offset);
    let right = Math.max(viewport.contentLeft + viewport.contentWidth, viewport.offset + viewport.width);
    let minRowIndex = viewport.rowIndex;
    let maxRowIndex = viewport.rowIndex;
    for (const row of snapshot.rows) {
        minRowIndex = Math.min(minRowIndex, row.rowIndex);
        maxRowIndex = Math.max(maxRowIndex, row.rowIndex);
        for (const column of row.columns) {
            left = Math.min(left, column.x);
            right = Math.max(right, column.x + column.width);
        }
    }
    const top = minRowIndex * snapshot.rowPitch;
    const bottom = maxRowIndex * snapshot.rowPitch + snapshot.gridHeight;

    const virtualWidth = Math.max(right - left, 1);
    const virtualHeight = Math.max(bottom - top, 1);
    const scale = Math.min(PANEL_WIDTH / virtualWidth, MAX_MINIMAP_HEIGHT / virtualHeight);
    return {
        left,
        top,
        scale,
        panelWidth: virtualWidth * scale,
        panelHeight: virtualHeight * scale,
        rowHeight: snapshot.gridHeight * scale,
    };
}

function toPanelRows(snapshot: StripStackMinimapSnapshot): PanelRow[] {
    const { left, top, scale } = panelLayout(snapshot);
    return snapshot.rows.map((row) => ({
        y: (row.rowIndex * snapshot.rowPitch - top) * scale,
        columns: row.columns.map((column) => ({
            x: (column.x - left) * scale,
            width: column.width * scale,
            focused: column.focused,
            icon: column.icon,
            thumbnail: column.thumbnail,
        })),
    }));
}

function toPanelViewportBox(snapshot: StripStackMinimapSnapshot): PanelViewportBox {
    const { left, top, scale } = panelLayout(snapshot);
    return {
        x: (snapshot.viewport.offset - left) * scale,
        y: (snapshot.viewport.rowIndex * snapshot.rowPitch - top) * scale,
        width: snapshot.viewport.width * scale,
    };
}
```

- [ ] **Step 2: Run typecheck and lint to verify the file itself is well-formed**

`npm run typecheck 2>&1 | grep minimap-overlay || true`
Expected: no output referencing `minimap-overlay.ts` itself (errors about `controller.ts` still expecting the old shape are expected until Task 4 — see the Ordering note).

`npm run lint`
Expected: `qmllint`/ESLint/Prettier report no new issues in this file. (This step may also surface pre-existing unrelated failures from `controller.ts`'s not-yet-updated call site — ignore those until Task 4.)

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (QML: `lowerCamelCase` properties/IDs — `rows`, `rowHeight`, `viewportBox` all match)
- [ ] Language-specific guidelines are followed (embedded QML expressions stay short; geometry math lives in the pure TS functions, not inline in QML)
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Update the controller's empty-strip guard

**Files:**
- Modify: `src/runtime/controller.ts:67-75` (`focusAndShowMinimap`)

No test file exists for `controller.ts` today (it's pure orchestration/wiring, consistent with `minimap-overlay.ts`'s untested status) — this task doesn't add one, matching that convention.

- [ ] **Step 1: Write the implementation**

Replace the `focusAndShowMinimap` method (lines 67-75):

```ts
    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        move(stack);
        const snapshot = stack.minimapSnapshot();
        const activeRow = snapshot.rows.find((row) => row.rowIndex === snapshot.viewport.rowIndex);
        if (!activeRow?.columns.some((column) => column.focused)) {
            return;
        }
        this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    }
```

- [ ] **Step 2: Run the full test suite and typecheck**

`npm test`
Expected: PASS (all suites, including Tasks 1-2's new/updated tests)

`npm run typecheck`
Expected: PASS — this is the first point since Task 2 where the whole project typechecks again (see the Ordering note at the top of this plan).

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

`npm test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

`npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint (includes `qmllint` over the embedded QML)**

`npm run lint`
Expected: PASS

- [ ] **Step 4: Manual sanity check (if a live KWin/Plasma 6 session is available)**

Per `docs/development.md`'s testing guidance for `declarativescript` packages: install the script (`npm run package:install`), open several windows across at least two strips (`Meta+PgDown`/`Meta+PgUp` to create/switch rows), and press `Meta+Tab` or `Meta+PgDown`. Confirm:
- Every existing row is visible, all at the same scale.
- A row's own horizontal scroll position (its columns' real x, independent of other rows) is reflected accurately.
- The blue focus border appears only in the active row.
- The white viewport border sits over the active row and jumps to the new row's vertical position on `Meta+PgUp`/`Meta+PgDown`.

If no live session is available, state explicitly that this step was skipped and why, rather than claiming it passed.

- [ ] **Step 5: Report completion**

Summarize what changed and confirm all of Steps 1-3 passed (and Step 4's outcome) before considering this plan complete.
