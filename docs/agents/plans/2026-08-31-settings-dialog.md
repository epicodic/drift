# Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Drift's currently-hardcoded numeric settings (column gap, default column width, animation duration, viewport shift step) plus the existing bottom margin in a tabbed config dialog, matching the KZones/Karousel reference projects' style.

**Architecture:** Three files change together: the kcfg schema (`drift/contents/config/main.xml`) gains 4 new `UInt` entries and one renamed entry; `src/config/settings.ts` reads the 4 new entries and switches `bottomMargin`'s config key; `drift/contents/ui/config.ui` is rebuilt from a single `QFormLayout` into a 3-tab `QTabWidget` (Layout / Animation / Shortcuts). No `Settings` interface or runtime logic changes — every field already exists in `Settings`.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-08-31-settings-dialog-design.md` — read before implementing

---

### Task 1: Config schema — `drift/contents/config/main.xml`

**Files:**
- Modify: `drift/contents/config/main.xml`

- [ ] **Step 1: Rename `marginBottom` to `bottomMargin` and add 4 new entries**

Replace the full contents of `drift/contents/config/main.xml` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kcfg xmlns="http://www.kde.org/standards/kcfg/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.kde.org/standards/kcfg/1.0 http://www.kde.org/standards/kcfg/1.0/kcfg.xsd">
    <kcfgfile name="kwinrc" />
    <group name="">
        <entry name="bottomMargin" type="UInt">
            <default>0</default>
        </entry>
        <entry name="columnGap" type="UInt">
            <default>8</default>
        </entry>
        <entry name="defaultColumnWidth" type="UInt">
            <default>800</default>
        </entry>
        <entry name="animationDurationMs" type="UInt">
            <default>200</default>
        </entry>
        <entry name="viewportShiftStep" type="UInt">
            <default>400</default>
        </entry>
        <entry name="shortcutFocusLeft" type="String">
            <default>Meta+Shift+Tab</default>
        </entry>
        <entry name="shortcutFocusRight" type="String">
            <default>Meta+Tab</default>
        </entry>
        <entry name="shortcutToggleDebugConsole" type="String">
            <default>Meta+Shift+D</default>
        </entry>
        <entry name="shortcutCycleAlignLeft" type="String">
            <default>Meta+Left</default>
        </entry>
        <entry name="shortcutCycleAlignRight" type="String">
            <default>Meta+Right</default>
        </entry>
        <entry name="shortcutViewportShiftLeft" type="String">
            <default>Meta+Shift+Left</default>
        </entry>
        <entry name="shortcutViewportShiftRight" type="String">
            <default>Meta+Shift+Right</default>
        </entry>
    </group>
</kcfg>
```

The 7 `shortcut*` entries are unchanged from the current file — only `marginBottom` (renamed to `bottomMargin`) and the 4 new `UInt` entries above it are new.

- [ ] **Step 2: Verify the file is well-formed XML**

```bash
xmllint --noout drift/contents/config/main.xml
```

Expected: no output, exit code 0.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (entry names match `Settings` field names — see Task 2)
- [ ] Language-specific guidelines are followed (this is glue XML per project convention, docs §8 — no dedicated unit test)
- [ ] Task-level verification commands from the plan executed and passing (`xmllint --noout` above)
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Settings — `src/config/settings.ts`

**Files:**
- Modify: `src/config/settings.ts`

No changes to the `Settings` interface or `DEFAULT_SETTINGS` — every field used below already exists there.

- [ ] **Step 1: Switch the `bottomMargin` config key and add 4 new reads**

In `loadSettings()`, replace:

```typescript
export function loadSettings(): Settings {
    // Object spread is unsupported by KWin's declarativescript JS engine — use Object.assign.
    return Object.assign({}, DEFAULT_SETTINGS, {
        bottomMargin: readNumberConfig('marginBottom', DEFAULT_SETTINGS.bottomMargin),
        shortcutFocusLeft: readStringConfig('shortcutFocusLeft', DEFAULT_SETTINGS.shortcutFocusLeft),
```

with:

```typescript
export function loadSettings(): Settings {
    // Object spread is unsupported by KWin's declarativescript JS engine — use Object.assign.
    return Object.assign({}, DEFAULT_SETTINGS, {
        bottomMargin: readNumberConfig('bottomMargin', DEFAULT_SETTINGS.bottomMargin),
        columnGap: readNumberConfig('columnGap', DEFAULT_SETTINGS.columnGap),
        defaultColumnWidth: readNumberConfig('defaultColumnWidth', DEFAULT_SETTINGS.defaultColumnWidth),
        animationDurationMs: readNumberConfig('animationDurationMs', DEFAULT_SETTINGS.animationDurationMs),
        viewportShiftStep: readNumberConfig('viewportShiftStep', DEFAULT_SETTINGS.viewportShiftStep),
        shortcutFocusLeft: readStringConfig('shortcutFocusLeft', DEFAULT_SETTINGS.shortcutFocusLeft),
```

Every line after `shortcutFocusLeft` in the existing function body (the remaining 6 `shortcut*` reads) stays exactly as-is — only the `bottomMargin` line's config key changes and the 4 new lines are inserted above the `shortcutFocusLeft` line.

- [ ] **Step 2: Run the type checker**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run the existing test suite**

```bash
npm test
```

Expected: all tests pass, including the existing `settings.test.ts` (`DEFAULT_SETTINGS` literal checks, unaffected by this change).

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (config keys equal `Settings` field names, per the existing shortcut-field convention)
- [ ] Language-specific guidelines are followed (4-space indent, single quotes, trailing commas)
- [ ] Task-level verification commands from the plan executed and passing (`npm run typecheck`, `npm test` above)
- [ ] Any convention violations fixed before moving to next task
- [ ] No new unit test added for `loadSettings`/`readNumberConfig` — this is untestable glue per project convention (docs §8), matching the existing `bottomMargin` precedent; confirm `settings.test.ts` is unchanged

---

### Task 3: Config UI — `drift/contents/ui/config.ui`

**Files:**
- Modify: `drift/contents/ui/config.ui`

- [ ] **Step 1: Rebuild the form as a 3-tab `QTabWidget`**

Replace the full contents of `drift/contents/ui/config.ui` with:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ui version="4.0">
    <class>KWin::DriftConfigForm</class>
    <widget class="QWidget" name="KWin::DriftConfigForm">
        <property name="windowTitle">
            <string>Drift</string>
        </property>
        <layout class="QVBoxLayout" name="layout_main">
            <item>
                <widget class="QTabWidget" name="tabWidget">
                    <property name="currentIndex">
                        <number>0</number>
                    </property>
                    <widget class="QWidget" name="tab_layout">
                        <attribute name="title">
                            <string>Layout</string>
                        </attribute>
                        <layout class="QFormLayout" name="formLayout_layout">
                            <item row="0" column="0">
                                <widget class="QLabel" name="label_columnGap">
                                    <property name="text">
                                        <string>Column gap:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="0" column="1">
                                <widget class="QSpinBox" name="kcfg_columnGap">
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
                                <widget class="QLabel" name="label_defaultColumnWidth">
                                    <property name="text">
                                        <string>Default column width:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="1" column="1">
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
                            <item row="2" column="0">
                                <widget class="QLabel" name="label_bottomMargin">
                                    <property name="text">
                                        <string>Bottom margin:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="2" column="1">
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
                                        <number>0</number>
                                    </property>
                                </widget>
                            </item>
                        </layout>
                    </widget>
                    <widget class="QWidget" name="tab_animation">
                        <attribute name="title">
                            <string>Animation</string>
                        </attribute>
                        <layout class="QFormLayout" name="formLayout_animation">
                            <item row="0" column="0">
                                <widget class="QLabel" name="label_animationDurationMs">
                                    <property name="text">
                                        <string>Animation duration:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="0" column="1">
                                <widget class="QSpinBox" name="kcfg_animationDurationMs">
                                    <property name="toolTip">
                                        <string>Duration of the focus-scroll animation</string>
                                    </property>
                                    <property name="suffix">
                                        <string> ms</string>
                                    </property>
                                    <property name="maximum">
                                        <number>5000</number>
                                    </property>
                                    <property name="value">
                                        <number>200</number>
                                    </property>
                                </widget>
                            </item>
                            <item row="1" column="0">
                                <widget class="QLabel" name="label_viewportShiftStep">
                                    <property name="text">
                                        <string>Viewport shift step:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="1" column="1">
                                <widget class="QSpinBox" name="kcfg_viewportShiftStep">
                                    <property name="toolTip">
                                        <string>Distance the viewport pans per shift shortcut press</string>
                                    </property>
                                    <property name="suffix">
                                        <string> px</string>
                                    </property>
                                    <property name="minimum">
                                        <number>1</number>
                                    </property>
                                    <property name="maximum">
                                        <number>9999</number>
                                    </property>
                                    <property name="value">
                                        <number>400</number>
                                    </property>
                                </widget>
                            </item>
                        </layout>
                    </widget>
                    <widget class="QWidget" name="tab_shortcuts">
                        <attribute name="title">
                            <string>Shortcuts</string>
                        </attribute>
                        <layout class="QVBoxLayout" name="verticalLayout_shortcuts">
                            <item>
                                <widget class="QLabel" name="label_shortcutsExplanation">
                                    <property name="text">
                                        <string>Configure Drift's keyboard shortcuts in System Settings → Shortcuts (search for &quot;Drift&quot;).</string>
                                    </property>
                                    <property name="wordWrap">
                                        <bool>true</bool>
                                    </property>
                                    <property name="alignment">
                                        <set>Qt::AlignmentFlag::AlignCenter</set>
                                    </property>
                                </widget>
                            </item>
                        </layout>
                    </widget>
                </widget>
            </item>
        </layout>
    </widget>
    <resources/>
</ui>
```

- [ ] **Step 2: Verify the file is well-formed XML**

```bash
xmllint --noout drift/contents/ui/config.ui
```

Expected: no output, exit code 0.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (every `kcfg_<name>` widget name matches its `main.xml` entry name from Task 1)
- [ ] Language-specific guidelines are followed (this is glue XML per project convention, docs §8 — no dedicated unit test; no tab icons, per the spec's decision to avoid the reference projects' stale Designer icon paths)
- [ ] Task-level verification commands from the plan executed and passing (`xmllint --noout` above)
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Manual verification (live KWin session)

**Files:** none (verification only)

- [ ] **Step 1: Build and install**

```bash
make install
```

Expected: builds successfully (lint + test + rollup), then installs/upgrades the `drift` KWin script via `kpackagetool6`.

- [ ] **Step 1a: Carry over any existing local `marginBottom` value (one-time, this machine only)**

Check for a pre-existing value under the old key, and if present, copy it to the new key before it's orphaned by the rename:

```bash
kreadconfig6 --file kwinrc --group Script-drift --key marginBottom
```

If that prints a non-empty value (e.g. `40`), write it to the new key with the same value:

```bash
kwriteconfig6 --file kwinrc --group Script-drift --key bottomMargin <value-from-above>
```

This is a one-time manual migration for this development machine only — not part of the shipped change (no release has used `marginBottom` yet, so no migration code is added to `settings.ts`).

- [ ] **Step 2: Reload KWin**

```bash
make restart-kwin
```

Per `docs/development.md`, confirm Drift is still functioning after the restart (e.g. open a couple of windows and check they still tile) before proceeding — `make restart-kwin` has previously needed verifying that it actually reloads Drift.

- [ ] **Step 3: Open the config dialog and check all 3 tabs**

Open System Settings → Window Management → KWin Scripts, find "Drift", open its configure dialog. Confirm:
- The dialog shows 3 tabs: **Layout**, **Animation**, **Shortcuts**.
- **Layout** tab shows "Column gap" (default 8 px), "Default column width" (default 800 px), "Bottom margin" (default 0 px).
- **Animation** tab shows "Animation duration" (default 200 ms), "Viewport shift step" (default 400 px).
- **Shortcuts** tab shows only the explanatory label pointing to System Settings → Shortcuts, no editable fields.

- [ ] **Step 4: Change a value and confirm it persists and takes effect**

Change "Column gap" to a different value (e.g. 20), click Apply/OK, then run:

```bash
kreadconfig6 --file kwinrc --group Script-drift --key columnGap
```

Expected: prints the new value (e.g. `20`).
Restart KWin (`make restart-kwin`) and visually confirm the gap between tiled columns changed.

- [ ] **Step 5: Confirm the renamed `bottomMargin` key round-trips**

```bash
kreadconfig6 --file kwinrc --group Script-drift --key bottomMargin
```

Expected: prints the current value from the dialog (not an empty/missing value — confirms the rename from `marginBottom` didn't silently break the read path). If this key comes back empty while an old `marginBottom` key still exists from a prior install, that's expected (the old key is now orphaned/unused) — not a bug, since no release has shipped `marginBottom` as a stable key yet.

- [ ] **Step 6: Final full check**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass.
