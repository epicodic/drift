# Layout Margins and Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `topMargin`, `leftMargin`, `rightMargin`, and `verticalGap` settings, change `bottomMargin`'s default to 8px, rename `columnGap` to `horizontalGap`, and wire all six into the layout so every edge of the screen and every gap (between columns, and between tiles stacked in a column) is configurable.

**Architecture:** All four margins are applied in one place — `Strip` insets the raw work-area `Rect` by the margin settings (via the existing `shrinkRect` helper) before that rect is used to build `Grid`, `Viewport`, and `GeometrySync`, so every consumer of `Strip`'s coordinate space (rendering, drag math, multi-monitor offsets) sees the same margin-adjusted origin. The vertical gap is threaded into `Column` as a per-instance value (mirroring how `Grid` already holds the horizontal gap), which changes the column's internal tile-height budget from "sums to the column height" to "sums to `columnHeight - verticalGap × (tileCount − 1)"`, touched in every method that adds, removes, or rescales tiles.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design doc:** `docs/agents/specs/2026-09-09-layout-margins-gaps-design.md` — read before implementing

---

### Task 1: Settings — add, rename, and redefault

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/config/settings-definitions.ts`
- Test: `src/config/settings.test.ts`
- Test: `src/config/settings-definitions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/config/settings.test.ts` (inside the existing `describe('DEFAULT_SETTINGS', ...)` block, anywhere after the opening `{`):

```typescript
    it('defaults every margin to 8px', () => {
        expect(DEFAULT_SETTINGS.topMargin).toBe(8);
        expect(DEFAULT_SETTINGS.bottomMargin).toBe(8);
        expect(DEFAULT_SETTINGS.leftMargin).toBe(8);
        expect(DEFAULT_SETTINGS.rightMargin).toBe(8);
    });

    it('defaults the horizontal and vertical gaps to 8px', () => {
        expect(DEFAULT_SETTINGS.horizontalGap).toBe(8);
        expect(DEFAULT_SETTINGS.verticalGap).toBe(8);
    });
```

In `src/config/settings-definitions.test.ts`, change the entry count (line 11) from:

```typescript
        expect(names.length).toBe(51);
```

to:

```typescript
        expect(names.length).toBe(55);
```

(4 new entries — `topMargin`, `leftMargin`, `rightMargin`, `verticalGap`; renaming `columnGap` to `horizontalGap` doesn't change the count.)

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- settings settings-definitions`
Expected: FAIL — `DEFAULT_SETTINGS.topMargin` etc. are `undefined`; `names.length` is `51`, not `55`.

- [ ] **Step 3: Rename `columnGap` and add the new fields in `settings.ts`**

In the `Settings` interface, replace:

```typescript
    /** Horizontal gap between columns, in pixels. */
    columnGap: number;
    /** Width given to a newly opened window's column, in pixels. */
    defaultColumnWidth: number;
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Space reserved at the bottom of the screen (e.g. for a panel), in pixels. */
    bottomMargin: number;
```

with:

```typescript
    /** Horizontal gap between columns, in pixels. */
    horizontalGap: number;
    /** Vertical gap between tiles stacked within a column, in pixels. */
    verticalGap: number;
    /** Width given to a newly opened window's column, in pixels. */
    defaultColumnWidth: number;
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Space reserved at the top of the screen, in pixels. */
    topMargin: number;
    /** Space reserved at the bottom of the screen (e.g. for a panel), in pixels. */
    bottomMargin: number;
    /** Space reserved at the left edge of the screen, in pixels. */
    leftMargin: number;
    /** Space reserved at the right edge of the screen, in pixels. */
    rightMargin: number;
```

- [ ] **Step 4: Update `SETTINGS_DEFINITIONS` in `settings-definitions.ts`**

Replace:

```typescript
    { name: 'columnGap', type: 'UInt', default: 8 },
    { name: 'defaultColumnWidth', type: 'UInt', default: 800 },
    { name: 'animationDurationMs', type: 'UInt', default: 200 },
    { name: 'bottomMargin', type: 'UInt', default: 0 },
```

with:

```typescript
    { name: 'horizontalGap', type: 'UInt', default: 8 },
    { name: 'verticalGap', type: 'UInt', default: 8 },
    { name: 'defaultColumnWidth', type: 'UInt', default: 800 },
    { name: 'animationDurationMs', type: 'UInt', default: 200 },
    { name: 'topMargin', type: 'UInt', default: 8 },
    { name: 'bottomMargin', type: 'UInt', default: 8 },
    { name: 'leftMargin', type: 'UInt', default: 8 },
    { name: 'rightMargin', type: 'UInt', default: 8 },
```

- [ ] **Step 5: Run tests to verify they pass**

`npm test -- settings settings-definitions`
Expected: PASS

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` fields, JSDoc on every `Settings` field, matching the existing style)
- [ ] `npm run build` still succeeds (regenerates `main.xml` from `SETTINGS_DEFINITIONS` — confirms no TypeScript type mismatch between `Settings` and the definitions array)
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Config dialog — add and rename Layout tab rows

**Files:**
- Modify: `drift/contents/ui/config.ui`

`config.ui` is hand-maintained (not generated) and has no automated test — `KConfigDialogManager` binds each `kcfg_<name>` widget to the setting of that name at runtime, so the widget's `name` attribute must exactly match the renamed/new `SETTINGS_DEFINITIONS` entries from Task 1.

- [ ] **Step 1: Replace the Layout tab's `formLayout_layout`**

In `drift/contents/ui/config.ui`, replace the entire `<layout class="QFormLayout" name="formLayout_layout">...</layout>` block (currently rows 0–3: Column gap, Default column width, Bottom margin, the `undockKeepAbove` checkbox) with:

```xml
                                    <layout class="QFormLayout" name="formLayout_layout">
                                        <item row="0" column="0">
                                            <widget class="QLabel" name="label_horizontalGap">
                                                <property name="text">
                                                    <string>Horizontal gap:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="0" column="1">
                                            <widget class="QSpinBox" name="kcfg_horizontalGap">
                                                <property name="toolTip">
                                                    <string>Horizontal gap between columns</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>8</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="0">
                                            <widget class="QLabel" name="label_verticalGap">
                                                <property name="text">
                                                    <string>Vertical gap:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="1">
                                            <widget class="QSpinBox" name="kcfg_verticalGap">
                                                <property name="toolTip">
                                                    <string>Vertical gap between tiles stacked within a column</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>8</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="2" column="0">
                                            <widget class="QLabel" name="label_defaultColumnWidth">
                                                <property name="text">
                                                    <string>Default column width:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="2" column="1">
                                            <widget class="QSpinBox" name="kcfg_defaultColumnWidth">
                                                <property name="toolTip">
                                                    <string>Width given to a newly opened window's column</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>100</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>9999</number>
                                                </property>
                                                <property name="value">
                                                    <number>800</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="3" column="0">
                                            <widget class="QLabel" name="label_topMargin">
                                                <property name="text">
                                                    <string>Top margin:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="3" column="1">
                                            <widget class="QSpinBox" name="kcfg_topMargin">
                                                <property name="toolTip">
                                                    <string>Space reserved at the top of the screen</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>8</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="4" column="0">
                                            <widget class="QLabel" name="label_bottomMargin">
                                                <property name="text">
                                                    <string>Bottom margin:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="4" column="1">
                                            <widget class="QSpinBox" name="kcfg_bottomMargin">
                                                <property name="toolTip">
                                                    <string>Space reserved at the bottom of the screen, e.g. to keep a taskbar visible</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>8</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="5" column="0">
                                            <widget class="QLabel" name="label_leftMargin">
                                                <property name="text">
                                                    <string>Left margin:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="5" column="1">
                                            <widget class="QSpinBox" name="kcfg_leftMargin">
                                                <property name="toolTip">
                                                    <string>Space reserved at the left of the screen</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>8</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="6" column="0">
                                            <widget class="QLabel" name="label_rightMargin">
                                                <property name="text">
                                                    <string>Right margin:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="6" column="1">
                                            <widget class="QSpinBox" name="kcfg_rightMargin">
                                                <property name="toolTip">
                                                    <string>Space reserved at the right of the screen</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>8</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="7" column="1">
                                            <widget class="QCheckBox" name="kcfg_undockKeepAbove">
                                                <property name="toolTip">
                                                    <string>Keep an undocked (floating) window above still-docked windows</string>
                                                </property>
                                                <property name="text">
                                                    <string>Keep undocked windows above docked ones</string>
                                                </property>
                                                <property name="checked">
                                                    <bool>true</bool>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
```

- [ ] **Step 2: Verify manually**

`npm run lint` (validates QML, not `.ui`, but confirms nothing else broke). There is no automated check for `.ui` widget names — manually diff the new block's `kcfg_*` names against Task 1's `SETTINGS_DEFINITIONS` entries: `horizontalGap`, `verticalGap`, `defaultColumnWidth`, `topMargin`, `bottomMargin`, `leftMargin`, `rightMargin`, `undockKeepAbove`.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Every new/renamed `kcfg_<name>` widget name matches a `SETTINGS_DEFINITIONS` entry name exactly
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Column — thread the vertical gap through the tile-height budget

**Files:**
- Modify: `src/core/column.ts`
- Test: `src/core/column.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('Column — tile stack', ...)` block in `src/core/column.test.ts` (anywhere inside, e.g. right after the existing `'tileRect derives...'` test):

```typescript
    it('tileRect adds the vertical gap between stacked tiles', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        column.addTile();
        column.addTile(); // three even tiles of 300 each (budget 940 - 2*20 = 900)
        const columnRect = { x: 50, y: 0, width: 300, height: 940 };
        const [first, second, third] = column.tiles();
        expect(column.tileRect(first.id, columnRect)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
        expect(column.tileRect(second.id, columnRect)).toEqual({ x: 50, y: 320, width: 300, height: 300 });
        expect(column.tileRect(third.id, columnRect)).toEqual({ x: 50, y: 640, width: 300, height: 300 });
    });

    it('addTile splits the height budget evenly, minus the vertical gap between tiles', () => {
        const column = new Column(1, 300, 1020, 20); // rowGap = 20
        const firstId = column.tiles()[0].id;
        const secondId = column.addTile();
        expect(column.tiles().map((t) => t.height)).toEqual([500, 500]); // (1020 - 20) / 2
        expect(secondId).not.toBe(firstId);
    });

    it('removeTile redistributes height plus the freed gap to the rest', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        const secondId = column.addTile();
        column.addTile(); // three even tiles of 300 each
        column.removeTile(secondId);
        expect(column.tileCount()).toBe(2);
        expect(column.tiles().map((t) => t.height)).toEqual([460, 460]); // (940 - 20) / 2
    });

    it('rescaleHeight scales tiles to fit the new height, accounting for the vertical gap', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        column.addTile();
        column.addTile(); // three even tiles of 300 each

        column.rescaleHeight(640); // e.g. grid height dropped from 940 to 640

        expect(column.tiles().map((t) => t.height)).toEqual([200, 200, 200]); // budget 600, /3
    });

    it('rescaleHeight preserves an uneven split, not just an even one, with a vertical gap', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        const secondId = column.addTile(); // [460, 460]
        column.resizeTile(secondId, 600, 'top'); // [320, 600]

        column.rescaleHeight(1860); // e.g. grid height doubled the tile budget

        expect(column.tiles().map((t) => t.height)).toEqual([640, 1200]);
    });

    it('previewRectsWithGapAt adds the vertical gap around the reserved preview slot', () => {
        const column = new Column(1, 300, 920, 20); // rowGap = 20
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // top=450, bottom=450
        const columnRect = { x: 100, y: 0, width: 300, height: 920 };

        const preview = column.previewRectsWithGapAt(1, 200, columnRect); // gap between top and bottom

        expect(preview.get(topId)).toEqual({ x: 100, y: 0, width: 300, height: 450 });
        expect(preview.get(bottomId)).toEqual({ x: 100, y: 690, width: 300, height: 450 }); // 450 + 20 + 200 + 20
    });

    it('previewRectsWithGapAt at a trailing index also carves the vertical gap out of the preceding tile', () => {
        const column = new Column(1, 300, 920, 20); // rowGap = 20
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile(); // [450, 450]
        column.resizeTile(topId, 600); // [600, 300]
        const columnRect = { x: 0, y: 0, width: 300, height: 920 };

        const preview = column.previewRectsWithGapAt(2, 100, columnRect); // append after bottom

        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 600 }); // untouched
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 620, width: 300, height: 180 }); // 300 - 100 - 20
    });

    it('previewRectsWithoutTile leaves exactly one vertical gap where the excluded tile was', () => {
        const column = new Column(1, 300, 940, 20); // rowGap = 20
        const topId = column.tiles()[0].id;
        const middleId = column.addTile();
        const bottomId = column.addTile(); // three tiles, 300 each

        const preview = column.previewRectsWithoutTile(middleId, { x: 0, y: 0, width: 300, height: 940 });

        expect(preview.has(middleId)).toBe(false);
        expect(preview.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
        expect(preview.get(bottomId)).toEqual({ x: 0, y: 320, width: 300, height: 300 }); // 300 + rowGap
    });
```

Replace the two existing `rescaleHeight` tests (they call the old `factor`-based signature, which this task removes):

```typescript
    it('rescaleHeight scales every tile by the given factor, keeping their relative sizes', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile(); // three even tiles of 300 each

        column.rescaleHeight(2 / 3); // e.g. grid height dropped from 900 to 600

        expect(column.tiles().map((t) => t.height)).toEqual([200, 200, 200]);
    });

    it('rescaleHeight preserves an uneven split, not just an even one', () => {
        const column = new Column(1, 300, 900);
        const secondId = column.addTile(); // [450, 450]
        column.resizeTile(secondId, 600, 'top'); // [300, 600]

        column.rescaleHeight(2); // e.g. grid height doubled

        expect(column.tiles().map((t) => t.height)).toEqual([600, 1200]);
    });
```

with:

```typescript
    it('rescaleHeight scales every tile to fit the new height, keeping their relative sizes', () => {
        const column = new Column(1, 300, 900);
        column.addTile();
        column.addTile(); // three even tiles of 300 each

        column.rescaleHeight(600); // e.g. grid height dropped from 900 to 600

        expect(column.tiles().map((t) => t.height)).toEqual([200, 200, 200]);
    });

    it('rescaleHeight preserves an uneven split, not just an even one', () => {
        const column = new Column(1, 300, 900);
        const secondId = column.addTile(); // [450, 450]
        column.resizeTile(secondId, 600, 'top'); // [300, 600]

        column.rescaleHeight(1800); // e.g. grid height doubled

        expect(column.tiles().map((t) => t.height)).toEqual([600, 1200]);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- column`
Expected: FAIL — `Column`'s constructor doesn't accept a 4th argument yet, and `rescaleHeight`'s old `factor` semantics don't match the new absolute-height calls.

- [ ] **Step 3: Implement the vertical gap in `column.ts`**

Change the constructor (add the `rowGap` parameter):

```typescript
    constructor(
        public readonly id: number,
        width: number,
        height: number,
        private readonly rowGap: number = 0,
    ) {
        assertPositiveWidth(width);
        assertPositiveHeight(height);
        this.columnWidth = width;
        const firstId = this.nextTileId++;
        this.stack.push({ id: firstId, height });
        this.focusedTile = firstId;
    }
```

Add a private helper (place it near the other private helpers, e.g. right before `requireTileIndex`):

```typescript
    /** The column's total height budget, including the gaps between its stacked tiles —
     * derived rather than stored, since the tile heights are the only persisted state. */
    private totalHeight(): number {
        return this.stack.reduce((sum, tile) => sum + tile.height, 0) + this.rowGap * (this.stack.length - 1);
    }
```

Replace `insertTileAt`:

```typescript
    insertTileAt(index: number): number {
        const totalHeight = this.totalHeight();
        const newCount = this.stack.length + 1;
        const evenHeight = (totalHeight - this.rowGap * (newCount - 1)) / newCount;
        for (const tile of this.stack) {
            tile.height = evenHeight;
        }
        const id = this.nextTileId++;
        this.stack.splice(index, 0, { id, height: evenHeight });
        return id;
    }
```

Replace `removeTile`:

```typescript
    removeTile(id: number): void {
        if (this.stack.length <= 1) {
            throw new Error('Cannot remove the last tile in a column');
        }
        const totalHeight = this.totalHeight();
        const index = this.requireTileIndex(id);
        this.stack.splice(index, 1);
        const newBudget = totalHeight - this.rowGap * (this.stack.length - 1);
        const remainingHeight = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const scale = newBudget / remainingHeight;
        for (const tile of this.stack) {
            tile.height *= scale;
        }
        if (this.focusedTile === id) {
            this.focusedTile = this.stack[Math.min(index, this.stack.length - 1)].id;
        }
    }
```

Replace `rescaleHeight`:

```typescript
    /** Rescales every tile to fit `newHeight` (the column's new total height budget),
     * keeping their relative proportions. The right per-tile factor depends on this column's
     * own tile count (more tiles means more gaps eating into the budget), so this takes the
     * new absolute height rather than a precomputed factor. */
    rescaleHeight(newHeight: number): void {
        const oldBudget = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const newBudget = newHeight - this.rowGap * (this.stack.length - 1);
        const factor = newBudget / oldBudget;
        for (const tile of this.stack) {
            tile.height *= factor;
        }
    }
```

Replace `tileRect`:

```typescript
    tileRect(id: number, columnRect: Rect): Rect {
        const index = this.requireTileIndex(id);
        let y = columnRect.y;
        for (let i = 0; i < index; i++) {
            y += this.stack[i].height + this.rowGap;
        }
        return {
            x: columnRect.x,
            y,
            width: columnRect.width,
            height: this.stack[index].height,
        };
    }
```

Replace `previewRectsWithGapAt`:

```typescript
    previewRectsWithGapAt(
        index: number,
        gapHeight: number,
        columnRect: Rect,
        excludeTileId?: number,
    ): Map<number, Rect> {
        const others = this.stack.filter((tile) => tile.id !== excludeTileId);
        const result = new Map<number, Rect>();
        let y = columnRect.y;
        let cursor = 0;
        for (let slot = 0; slot <= others.length; slot++) {
            if (slot === index) {
                y += gapHeight + this.rowGap;
                continue;
            }
            const tileIndex = cursor++;
            const tile = others[tileIndex];
            const isTrailingNeighbor = index === others.length && tileIndex === others.length - 1;
            const height = isTrailingNeighbor ? Math.max(0, tile.height - gapHeight - this.rowGap) : tile.height;
            result.set(tile.id, { x: columnRect.x, y, width: columnRect.width, height });
            y += tile.height + this.rowGap;
        }
        return result;
    }
```

Replace `previewRectsWithoutTile`:

```typescript
    previewRectsWithoutTile(excludeTileId: number, columnRect: Rect): Map<number, Rect> {
        const result = new Map<number, Rect>();
        let y = columnRect.y;
        for (const tile of this.stack) {
            if (tile.id === excludeTileId) {
                continue;
            }
            result.set(tile.id, { x: columnRect.x, y, width: columnRect.width, height: tile.height });
            y += tile.height + this.rowGap;
        }
        return result;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- column`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`camelCase` parameter/field, `private readonly` per existing style)
- [ ] `npm run build` type-checks cleanly (confirms every `new Column(...)` call site elsewhere still compiles with the new optional 4th parameter)
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Grid — forward the vertical gap to columns

**Files:**
- Modify: `src/core/grid.ts`
- Test: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/core/grid.test.ts` (it already defines `const HEIGHT = 1080;` and `const GAP = 10;` at the top — reuse them):

```typescript
describe('Grid — vertical gap', () => {
    it('forwards rowGap to newly added columns', () => {
        const grid = new Grid(920, GAP, 20); // rowGap = 20
        const column = grid.addColumn(300);

        column.addTile();

        expect(column.tiles().map((t) => t.height)).toEqual([450, 450]); // (920 - 20) / 2
    });

    it('setHeight rescales a column accounting for its own rowGap', () => {
        const grid = new Grid(920, GAP, 20); // rowGap = 20
        const column = grid.addColumn(300);
        column.addTile(); // [450, 450]

        grid.setHeight(1820); // doubles the 900 tile-height budget to 1800

        expect(column.tiles().map((t) => t.height)).toEqual([900, 900]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- grid`
Expected: FAIL — `Grid`'s constructor doesn't accept a 3rd argument yet.

- [ ] **Step 3: Implement in `grid.ts`**

Change the constructor:

```typescript
    constructor(
        private height: number,
        private readonly gap: number = 0,
        private readonly rowGap: number = 0,
    ) {}
```

Change `addColumn` (pass `this.rowGap` through to `new Column`):

```typescript
    /** Adds a column to the right of the focused one (or at the end) and focuses it. */
    addColumn(width: number): Column {
        const column = new Column(this.nextId++, width, this.height, this.rowGap);
        const insertAt = this.focusedColumnId === null ? this.ordered.length : this.indexOf(this.focusedColumnId) + 1;
        this.ordered.splice(insertAt, 0, column);
        this.focusedColumnId = column.id;
        return column;
    }
```

Change `setHeight` (pass the new absolute height to each column instead of a precomputed factor):

```typescript
    /** Also rescales every existing column's tiles proportionally (see `Column.rescaleHeight`)
     * so already-tiled windows fill the new height too, not just columns created afterward. */
    setHeight(height: number): void {
        if (height === this.height) {
            return;
        }
        this.height = height;
        for (const column of this.ordered) {
            column.rescaleHeight(height);
        }
    }
```

(`expelFocusedTile` already creates its new column via `this.addColumn(newColumnWidth)`, so it needs no separate change.)

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- grid`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] Full suite run once: `npm test` (confirms Task 3's `Column` changes and Task 4's `Grid` changes compose correctly together)
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: Strip — margin-inset the content area, use the renamed gap settings

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`
- Test: `src/runtime/strip-manager.test.ts`
- Test: `src/runtime/strip-stack.test.ts`

Tasks 1–4 change two defaults that every existing geometry test in these three files implicitly depends on: `bottomMargin` goes from `0` to `8`, and three more margins (`topMargin`, `leftMargin`, `rightMargin`) newly default to `8` instead of not existing. Every test in these files that constructs a `Strip`/`StripManager`/`StripStack` with `DEFAULT_SETTINGS` and then asserts an exact pixel position will break unless it opts out of the new margins. Rather than recompute dozens of expected values, each file gets one zero-margin settings fixture that every existing test switches to, keeping today's assertions and their expected numbers unchanged; new tests are added separately to prove the real (non-zero) margins work.

- [ ] **Step 1: Neutralize the margin defaults in the existing test fixtures**

In `src/runtime/strip.test.ts`, right after the existing `const INSTANT_SETTINGS = { ...DEFAULT_SETTINGS, animationDurationMs: 0 };` line, add:

```typescript
const SETTINGS = { ...DEFAULT_SETTINGS, topMargin: 0, bottomMargin: 0, leftMargin: 0, rightMargin: 0 };
```

Then find every other occurrence of the bare identifier `DEFAULT_SETTINGS` in the file (every `new Strip(AREA, DEFAULT_SETTINGS, ...)` / `new Strip(MULTI_MONITOR_AREA, DEFAULT_SETTINGS, ...)` call, and anywhere `INSTANT_SETTINGS` isn't already being used) and replace it with `SETTINGS`. Do **not** touch the import line or the `SETTINGS`/`INSTANT_SETTINGS` definitions themselves (`INSTANT_SETTINGS` should now read `{ ...SETTINGS, animationDurationMs: 0 }`, spreading the zero-margin fixture instead of the raw defaults).

Apply the identical pattern to `src/runtime/strip-manager.test.ts` and `src/runtime/strip-stack.test.ts`: add the same `const SETTINGS = { ...DEFAULT_SETTINGS, topMargin: 0, bottomMargin: 0, leftMargin: 0, rightMargin: 0 };` near the top (after the `DEFAULT_SETTINGS` import), then replace every other bare `DEFAULT_SETTINGS` occurrence in each file with `SETTINGS` — including type positions like `strip-stack.test.ts`'s `function makeStack(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {})`, which becomes `Partial<typeof SETTINGS>`, and its body's `{ ...DEFAULT_SETTINGS, ...settingsOverride }`, which becomes `{ ...SETTINGS, ...settingsOverride }`.

- [ ] **Step 2: Run the full runtime suite to confirm the fixture swap alone is a no-op**

`npm test -- strip strip-manager strip-stack`
Expected: PASS — this step only neutralizes the new margin defaults for existing tests; it doesn't yet test the new margin behavior, so nothing should fail or change.

- [ ] **Step 3: Write the new failing tests for real margin wiring**

Add to `src/runtime/strip.test.ts`, inside `describe('Strip', ...)`:

```typescript
    it('insets the grid, viewport, and geometry sync by the configured margins', () => {
        const marginSettings = { ...SETTINGS, topMargin: 10, bottomMargin: 20, leftMargin: 30, rightMargin: 40 };
        const strip = new Strip(AREA, marginSettings, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');

        strip.addWindow(win.adapter);

        // AREA is { x: 0, y: 0, width: 1280, height: 1000 }; margins carve 30px off the left
        // and 10px off the top, and the column fills the remaining height (1000 - 10 - 20 = 970).
        expect(win.setFrameGeometry).toHaveBeenCalledWith(
            expect.objectContaining({ x: 30, y: 10, height: 970 }),
        );
    });

    it('re-applies margins to the new area on updateArea', () => {
        const marginSettings = { ...SETTINGS, topMargin: 10, bottomMargin: 20, leftMargin: 30, rightMargin: 40 };
        const strip = new Strip(AREA, marginSettings, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.updateArea({ x: 100, y: 200, width: 1280, height: 1000 });

        // New area origin (100, 200) plus the same left/top margins (30, 10).
        expect(win.setFrameGeometry).toHaveBeenCalledWith(
            expect.objectContaining({ x: 130, y: 210, height: 970 }),
        );
    });
```

- [ ] **Step 4: Run tests to verify they fail**

`npm test -- strip`
Expected: FAIL — `Strip` doesn't read `topMargin`/`leftMargin`/`rightMargin` yet, and still uses `settings.columnGap` (renamed away in Task 1, so this is also a compile error).

- [ ] **Step 5: Implement in `strip.ts`**

Change the import on line 6 from:

```typescript
import type { Rect } from '../core/coordinates';
```

to:

```typescript
import { Rect, shrinkRect } from '../core/coordinates';
```

(matching the existing non-type-only import style `workspace-adapter.ts` already uses for the same module.)

Add a private method (place it near `updateArea`):

```typescript
    /** Insets `area` by the four configured margins — the single place every coordinate
     * consumer (Grid, Viewport, GeometrySync, and by extension drag math and screenBounds,
     * which all read `this.area`) gets its origin from, so they agree on where the grid
     * actually starts. */
    private marginedArea(area: Rect): Rect {
        return shrinkRect(area, {
            top: this.settings.topMargin,
            bottom: this.settings.bottomMargin,
            left: this.settings.leftMargin,
            right: this.settings.rightMargin,
        });
    }
```

Replace the constructor body's first two statements:

```typescript
        this.grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
```

with:

```typescript
        this.area = this.marginedArea(area);
        this.grid = new Grid(Math.max(1, this.area.height), settings.horizontalGap, settings.verticalGap);
```

and change the following two constructor lines from:

```typescript
        this.viewport = new Viewport(area.width);
        this.geometrySync = new GeometrySync(area);
```

to:

```typescript
        this.viewport = new Viewport(this.area.width);
        this.geometrySync = new GeometrySync(this.area);
```

Replace `updateArea`:

```typescript
    updateArea(area: Rect): void {
        this.area = this.marginedArea(area);
        this.grid.setHeight(Math.max(1, this.area.height));
        this.viewport.setViewportWidth(this.area.width);
        this.geometrySync.setArea(this.area);
        this.render(undefined, true);
    }
```

- [ ] **Step 6: Run tests to verify they pass**

`npm test -- strip`
Expected: PASS

- [ ] **Step 7: Run the full suite**

`npm test`
Expected: PASS — confirms `strip-manager.test.ts` and `strip-stack.test.ts` (fixed in Step 1) still pass with the real `Strip` changes in place, and nothing elsewhere in the codebase referenced `settings.columnGap` or `settings.bottomMargin`'s old default.

- [ ] **Step 8: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules
- [ ] `npm run build` succeeds and `npm run lint` passes
- [ ] `npm test` passes in full (not just the files touched this task)
- [ ] Any convention violations fixed before moving to next task

---

### Task 6: Update `docs/features.md`'s settings list

**Files:**
- Modify: `docs/features.md`

- [ ] **Step 1: Update the settings list**

`docs/features.md` line 182 lists configurable settings by name, including `column gap` and `bottom margin`. Per `docs/coding-conventions.md`'s documentation rule (one sentence per line), find that line and update it to also mention the new margins and vertical gap — read the surrounding sentence first (`grep -n "column gap" docs/features.md`) to match its existing phrasing and list style exactly, then add `top margin`, `left margin`, `right margin`, and `vertical gap` alongside the renamed `horizontal gap`.

- [ ] **Step 2: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] One sentence per line maintained (per `AGENTS.md`'s documentation rule)
- [ ] No other stale mentions of `columnGap`/`column gap` remain in `docs/features.md` (`grep -n "column gap" docs/features.md`)

---

## Execution Handoff

After Task 6, run `npm test` and `npm run lint` one final time as a whole-repo sanity check.
