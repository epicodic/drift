# Window Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user match newly opened windows by class/caption in a JSON `windowRules` setting and have Drift automatically float them, set a starting column width, jump to a starting alignment, or (as an inert stub) tag a target screen.

**Architecture:** A new KWin-free module (`src/core/window-rules.ts`) owns parsing the JSON, validating each rule, and first-match-wins matching. `WindowManager.addWindow` (the single point every new tileable window already passes through) matches the rule once, at creation time, and either diverts the window straight to floating or asks `StripManager` to nudge the just-created column's width/alignment via two new pass-through methods threaded down to `Strip`. `screen` is parsed and logged but never acted on — no code moves windows across monitors yet.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design spec:** `docs/agents/specs/2026-09-06-window-rules-design.md` — read before implementing; this plan implements it exactly.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/window-rules.ts` (new) | Parse `windowRules` JSON, validate each rule, first-match-wins lookup, resolve a `"NN%"` width. Pure, no KWin types. |
| `src/core/window-rules.test.ts` (new) | Unit tests for the above. |
| `src/kwin/window-adapter.ts` | Add `resourceClass` getter and `screenWidth()` method, mirroring the existing `caption`/`output()` pattern. |
| `src/kwin/window-adapter.test.ts` | Tests for the two additions. |
| `src/config/settings.ts` | Add `windowRules: string` to `Settings`/`DEFAULT_SETTINGS` and its `readStringConfig` read. |
| `drift/contents/config/main.xml` | Add the `windowRules` kcfg entry. |
| `drift/contents/ui/config.ui` | Add a "Window Rules" tab with a `QPlainTextEdit` bound to `kcfg_windowRules`. |
| `src/runtime/strip.ts` | Add `setFocusedColumnWidth(width)` and `alignFocusedColumn(align)` — apply to the currently-focused column (always the just-created one, per `Grid.addColumn`'s existing focus-on-add behavior). |
| `src/runtime/strip.test.ts` | Tests for the two additions. |
| `src/runtime/strip-stack.ts` | Add matching pass-through methods, delegating to `this.activeStrip()`. |
| `src/runtime/strip-stack.test.ts` | Tests for the two additions. |
| `src/runtime/strip-manager.ts` | Add `applyRuleOverrides(win, overrides)` — looks up the owning strip stack and delegates. |
| `src/runtime/strip-manager.test.ts` | Tests for the addition. |
| `src/runtime/window-manager.ts` | Parse rules once at construction; `addWindow` matches and dispatches float/width/align/screen-log. Extracts a shared `undock()` helper (used by both the float-rule path and the existing `toggleFloating`). |
| `src/runtime/window-manager.test.ts` | Tests for the new dispatch logic. |

No file in this list is touched by more than one task below, except `strip.test.ts`'s existing `INSTANT_SETTINGS`/`fakeWindow` fixtures, which Task 4 reuses as-is (no changes needed to them).

---

## Task 1: Core window-rules module

**Files:**
- Create: `src/core/window-rules.ts`
- Test: `src/core/window-rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/core/window-rules.test.ts
import { describe, expect, it } from 'vitest';
import { matchRule, parseWindowRules, resolveWidth } from './window-rules';

describe('parseWindowRules', () => {
    it('parses a rule with every field set', () => {
        const { rules, warnings } = parseWindowRules(
            '[{"class":"firefox","caption":"Picture","float":true,"width":900,"align":"left","screen":1}]',
        );

        expect(warnings).toEqual([]);
        expect(rules).toHaveLength(1);
        expect(rules[0].float).toBe(true);
        expect(rules[0].width).toBe(900);
        expect(rules[0].align).toBe('left');
        expect(rules[0].screen).toBe(1);
        expect(rules[0].matchesClass?.('Firefox')).toBe(true);
        expect(rules[0].matchesCaption?.('Picture-in-Picture')).toBe(true);
    });

    it('parses a rule with every field left out except a matcher', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"slack"}]');

        expect(warnings).toEqual([]);
        expect(rules[0].float).toBeUndefined();
        expect(rules[0].width).toBeUndefined();
        expect(rules[0].align).toBeUndefined();
        expect(rules[0].screen).toBeUndefined();
    });

    it('falls back to no rules on invalid JSON', () => {
        const { rules, warnings } = parseWindowRules('not json');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it('falls back to no rules when the top level is not an array', () => {
        const { rules, warnings } = parseWindowRules('{"class":"firefox"}');

        expect(rules).toEqual([]);
        expect(warnings).toEqual(['windowRules: expected a JSON array, no rules loaded']);
    });

    it('skips one malformed entry but keeps the rest', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"firefox","width":"banana"},{"class":"slack"}]');

        expect(rules).toHaveLength(1);
        expect(rules[0].matchesClass?.('slack')).toBe(true);
        expect(warnings).toHaveLength(1);
    });

    it('compiles a /pattern/flags matcher as a real regex', () => {
        const { rules } = parseWindowRules('[{"caption":"/^zoom($| )/i"}]');

        expect(rules[0].matchesCaption?.('Zoom Meeting')).toBe(true);
        expect(rules[0].matchesCaption?.('not a match')).toBe(false);
    });

    it('skips an entry with an invalid regex', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"/(unclosed/"}]');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it('rejects a non-positive width', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"x","width":0}]');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it('rejects an align value outside left/center/right', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"x","align":"up"}]');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });
});

describe('matchRule', () => {
    it('matches a case-insensitive substring by default', () => {
        const { rules } = parseWindowRules('[{"class":"firefox"}]');

        expect(matchRule(rules, 'Firefox-esr', 'anything')).toBe(rules[0]);
    });

    it('requires both class and caption to match when both are set (AND, not OR)', () => {
        const { rules } = parseWindowRules('[{"class":"zoom","caption":"Meeting"}]');

        expect(matchRule(rules, 'zoom', 'Meeting')).toBe(rules[0]);
        expect(matchRule(rules, 'other-app', 'Meeting')).toBeNull();
    });

    it('matches everything for a rule with no matcher at all', () => {
        const { rules } = parseWindowRules('[{"float":true}]');

        expect(matchRule(rules, 'anything', 'anything')).toBe(rules[0]);
    });

    it('returns the first matching rule (first-match-wins)', () => {
        const { rules } = parseWindowRules(
            '[{"class":"firefox","align":"left"},{"class":"firefox","align":"right"}]',
        );

        expect(matchRule(rules, 'firefox', 'x')?.align).toBe('left');
    });

    it('returns null when nothing matches', () => {
        const { rules } = parseWindowRules('[{"class":"firefox"}]');

        expect(matchRule(rules, 'slack', 'x')).toBeNull();
    });
});

describe('resolveWidth', () => {
    it('passes a plain number through unchanged', () => {
        expect(resolveWidth(900, 1920)).toBe(900);
    });

    it('resolves a percentage string against the given screen width', () => {
        expect(resolveWidth('50%', 1920)).toBe(960);
    });

    it('returns undefined for an undefined width', () => {
        expect(resolveWidth(undefined, 1920)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- window-rules`
Expected: FAIL — `src/core/window-rules.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/window-rules.ts
// Per-application window rules: matches a window by resourceClass/caption (case-insensitive
// substring, or /regex/flags for precise matching) and returns float/width/align/screen
// overrides. Pure and KWin-free — parsing, matching, and width resolution only; no window
// mutation (docs: 2026-09-06-window-rules-design).

export type ColumnAlign = 'left' | 'center' | 'right';

export interface WindowRule {
    matchesClass: ((resourceClass: string) => boolean) | null;
    matchesCaption: ((caption: string) => boolean) | null;
    float?: boolean;
    width?: number | string;
    align?: ColumnAlign;
    screen?: number;
}

export interface WindowRuleOverrides {
    width?: number;
    align?: ColumnAlign;
}

const REGEX_FORM = /^\/(.*)\/([a-z]*)$/;
const PERCENT_FORM = /^(\d+(?:\.\d+)?)%$/;

function makeMatcher(pattern: string): ((value: string) => boolean) | null {
    const regexForm = REGEX_FORM.exec(pattern);
    if (regexForm !== null) {
        try {
            const regex = new RegExp(regexForm[1], regexForm[2]);
            return (value: string) => regex.test(value);
        } catch (error) {
            void error;
            return null;
        }
    }
    const needle = pattern.toLowerCase();
    return (value: string) => value.toLowerCase().includes(needle);
}

function parseRuleEntry(entry: unknown, index: number, warnings: string[]): WindowRule | null {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        warnings.push(`windowRules[${index}]: not an object, skipped`);
        return null;
    }
    const raw = entry as Record<string, unknown>;

    let matchesClass: ((value: string) => boolean) | null = null;
    if (raw.class !== undefined) {
        if (typeof raw.class !== 'string') {
            warnings.push(`windowRules[${index}]: "class" must be a string, skipped`);
            return null;
        }
        matchesClass = makeMatcher(raw.class);
        if (matchesClass === null) {
            warnings.push(`windowRules[${index}]: invalid "class" regex, skipped`);
            return null;
        }
    }

    let matchesCaption: ((value: string) => boolean) | null = null;
    if (raw.caption !== undefined) {
        if (typeof raw.caption !== 'string') {
            warnings.push(`windowRules[${index}]: "caption" must be a string, skipped`);
            return null;
        }
        matchesCaption = makeMatcher(raw.caption);
        if (matchesCaption === null) {
            warnings.push(`windowRules[${index}]: invalid "caption" regex, skipped`);
            return null;
        }
    }

    let float: boolean | undefined;
    if (raw.float !== undefined) {
        if (typeof raw.float !== 'boolean') {
            warnings.push(`windowRules[${index}]: "float" must be a boolean, skipped`);
            return null;
        }
        float = raw.float;
    }

    let width: number | string | undefined;
    if (raw.width !== undefined) {
        if (typeof raw.width === 'number') {
            if (raw.width <= 0) {
                warnings.push(`windowRules[${index}]: "width" must be a positive number, skipped`);
                return null;
            }
            width = raw.width;
        } else if (typeof raw.width === 'string' && PERCENT_FORM.test(raw.width)) {
            width = raw.width;
        } else {
            warnings.push(`windowRules[${index}]: "width" must be a positive number or a "NN%" string, skipped`);
            return null;
        }
    }

    let align: ColumnAlign | undefined;
    if (raw.align !== undefined) {
        if (raw.align === 'left' || raw.align === 'center' || raw.align === 'right') {
            align = raw.align;
        } else {
            warnings.push(`windowRules[${index}]: "align" must be "left", "center", or "right", skipped`);
            return null;
        }
    }

    let screen: number | undefined;
    if (raw.screen !== undefined) {
        if (typeof raw.screen !== 'number' || !Number.isInteger(raw.screen) || raw.screen < 0) {
            warnings.push(`windowRules[${index}]: "screen" must be a non-negative integer, skipped`);
            return null;
        }
        screen = raw.screen;
    }

    return { matchesClass, matchesCaption, float, width, align, screen };
}

/** Parses the raw `windowRules` config string into validated rules, plus a warning for
 * every entry (or the whole string) that had to be skipped. Never throws — the caller is
 * expected to log `warnings` (e.g. via `debug()`) and use `rules` regardless. */
export function parseWindowRules(json: string): { rules: WindowRule[]; warnings: string[] } {
    const warnings: string[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        void error;
        warnings.push(`windowRules: invalid JSON (${String(error)}), no rules loaded`);
        return { rules: [], warnings };
    }
    if (!Array.isArray(parsed)) {
        warnings.push('windowRules: expected a JSON array, no rules loaded');
        return { rules: [], warnings };
    }
    const rules: WindowRule[] = [];
    parsed.forEach((entry, index) => {
        const rule = parseRuleEntry(entry, index, warnings);
        if (rule !== null) {
            rules.push(rule);
        }
    });
    return { rules, warnings };
}

/** First-match-wins lookup: both `class` and `caption` must match when both are set on a
 * rule (AND, not OR). A rule with neither matcher matches every window and doubles as a
 * default/catch-all. */
export function matchRule(rules: WindowRule[], resourceClass: string, caption: string): WindowRule | null {
    for (const rule of rules) {
        const classOk = rule.matchesClass === null || rule.matchesClass(resourceClass);
        const captionOk = rule.matchesCaption === null || rule.matchesCaption(caption);
        if (classOk && captionOk) {
            return rule;
        }
    }
    return null;
}

/** Resolves a rule's `width` against the screen it's opening on: a plain number passes
 * through unchanged, a `"NN%"` string resolves to that percentage of `screenWidth`. Returns
 * `undefined` for a missing width or a non-positive result. */
export function resolveWidth(width: number | string | undefined, screenWidth: number): number | undefined {
    if (width === undefined) {
        return undefined;
    }
    if (typeof width === 'number') {
        return width;
    }
    const match = PERCENT_FORM.exec(width);
    if (match === null) {
        return undefined;
    }
    const resolved = Math.round((Number(match[1]) / 100) * screenWidth);
    return resolved > 0 ? resolved : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- window-rules`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming: `PascalCase` for `WindowRule`/`WindowRuleOverrides`/`ColumnAlign`, `camelCase` for functions, `UPPER_SNAKE_CASE` for `REGEX_FORM`/`PERCENT_FORM` — matches
- [ ] No KWin types/globals referenced anywhere in `window-rules.ts` — confirm via `grep -n "KWin\|Workspace\|Output\|Window\b" src/core/window-rules.ts` returns nothing
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: WindowAdapter additions

**Files:**
- Modify: `src/kwin/window-adapter.ts`
- Test: `src/kwin/window-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/kwin/window-adapter.test.ts` (the file already has a `createWindow()` fixture — reuse it):

```typescript
describe('WindowAdapter.resourceClass', () => {
    it('reads the underlying window resourceClass', () => {
        const window = createWindow({ resourceClass: 'firefox' });

        expect(new WindowAdapter(window).resourceClass).toBe('firefox');
    });
});

describe('WindowAdapter.screenWidth', () => {
    it("reads the width of the window's current output", () => {
        const window = createWindow({
            output: { name: 'output-1', geometry: { x: 0, y: 0, width: 2560, height: 1440 } },
        });

        expect(new WindowAdapter(window).screenWidth()).toBe(2560);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- window-adapter`
Expected: FAIL — `resourceClass`/`screenWidth` don't exist on `WindowAdapter` yet.

- [ ] **Step 3: Write the implementation**

In `src/kwin/window-adapter.ts`, add a getter right after the existing `caption` getter:

```typescript
    get resourceClass(): string {
        return this.window.resourceClass;
    }
```

And add a method right after the existing `output()` method:

```typescript
    /** The width of the screen this window is currently on — used to resolve a window
     * rule's `"NN%"` width against the right monitor (docs: 2026-09-06-window-rules-design). */
    screenWidth(): number {
        return this.window.output.geometry.width;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- window-adapter`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `resourceClass` follows the existing `caption` getter convention exactly (both are simple pass-through getters)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: Config plumbing (settings, kcfg schema, UI tab)

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `drift/contents/config/main.xml`
- Modify: `drift/contents/ui/config.ui`

This task has no dedicated unit tests: `settings.ts`'s config-reading path and `config.ui`/`main.xml` are already established as untestable glue in this project (docs §8 — see `docs/agents/specs/2026-08-31-settings-dialog-design.md`, which added five settings the same way with no new tests). Verification is `npm run typecheck` plus a manual System Settings check, same as that prior spec.

- [ ] **Step 1: Add `windowRules` to `Settings` and `DEFAULT_SETTINGS`**

In `src/config/settings.ts`, add to the `Settings` interface (anywhere alongside the other fields, e.g. right after `shortcutToggleFloating`):

```typescript
    /** Raw JSON array of window rules, matched by resourceClass/caption to override a newly
     * opened window's float/width/align, and (currently inert) screen (docs:
     * 2026-09-06-window-rules-design). */
    windowRules: string;
```

Add to `DEFAULT_SETTINGS`, in the same relative position:

```typescript
    windowRules: '[]',
```

- [ ] **Step 2: Read it in `loadSettings()`**

Add one more line to the `Object.assign` call in `loadSettings()`:

```typescript
        windowRules: readStringConfig('windowRules', DEFAULT_SETTINGS.windowRules),
```

- [ ] **Step 3: Add the kcfg entry**

In `drift/contents/config/main.xml`, add before the closing `</group>`:

```xml
        <entry name="windowRules" type="String">
            <default>[]</default>
        </entry>
```

- [ ] **Step 4: Add the config UI tab**

In `drift/contents/ui/config.ui`, add a new tab as the last child of `tabWidget`, right after the existing `tab_shortcuts` widget block (i.e. immediately before the `</widget>` that closes `tabWidget` itself, around line 399):

```xml
                    <widget class="QWidget" name="tab_windowRules">
                        <attribute name="title">
                            <string>Window Rules</string>
                        </attribute>
                        <layout class="QVBoxLayout" name="verticalLayout_windowRules">
                            <item>
                                <widget class="QLabel" name="label_windowRulesExplanation">
                                    <property name="text">
                                        <string>JSON array of rules matching a window's class/caption, to set its float, width, align, or screen. See docs/agents/specs/2026-09-06-window-rules-design.md for the schema.</string>
                                    </property>
                                    <property name="wordWrap">
                                        <bool>true</bool>
                                    </property>
                                </widget>
                            </item>
                            <item>
                                <widget class="QPlainTextEdit" name="kcfg_windowRules">
                                    <property name="tabChangesFocus">
                                        <bool>true</bool>
                                    </property>
                                    <property name="lineWrapMode">
                                        <enum>QPlainTextEdit::NoWrap</enum>
                                    </property>
                                    <property name="font">
                                        <font>
                                            <family>Monospace</family>
                                        </font>
                                    </property>
                                </widget>
                            </item>
                        </layout>
                    </widget>
```

- [ ] **Step 5: Verify and manually check**

`npm run typecheck` — expected: PASS
`npm run lint` — expected: PASS (includes `qmllint`; `config.ui`/`main.xml` are not QML and aren't linted by it, but confirm the command still completes)
Manual: `npm run package:install`, open System Settings → Window Management → KWin Scripts → Drift's config icon, confirm a "Window Rules" tab appears with a monospace text box, and that typing `[{"class":"x"}]` and applying doesn't error.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `windowRules` field naming matches the existing config-key-equals-field-name convention
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Manual System Settings check performed and recorded (pass/fail)

---

## Task 4: Strip — `setFocusedColumnWidth` and `alignFocusedColumn`

**Files:**
- Modify: `src/runtime/strip.ts`
- Test: `src/runtime/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/runtime/strip.test.ts` (reuses the file's existing `AREA`, `INSTANT_SETTINGS`, `DEFAULT_SETTINGS`, `fakeTimer`, `fakeWorkspaceAdapter`, `fakeWindow` fixtures):

```typescript
describe('Strip.setFocusedColumnWidth', () => {
    it("resizes the focused column's window and re-renders", () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 400 });
        strip.addWindow(win.adapter);

        strip.setFocusedColumnWidth(900);

        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 900 }));
    });
});

describe('Strip.alignFocusedColumn', () => {
    it('jumps directly to the left/center/right edge, without cycling through phases', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 1600 });
        strip.addWindow(win.adapter);

        strip.alignFocusedColumn('right');
        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -320 }));

        strip.alignFocusedColumn('center');
        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -160 }));

        strip.alignFocusedColumn('left');
        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
    });

    it('does nothing when the focused column is hidden (minimized)', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { minimized: true });
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.alignFocusedColumn('right');

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- strip.test.ts -t "setFocusedColumnWidth|alignFocusedColumn"`
Expected: FAIL — neither method exists on `Strip` yet.

- [ ] **Step 3: Write the implementation**

Add one import to the top of `src/runtime/strip.ts`, alongside the existing `../core/*` imports:

```typescript
import type { ColumnAlign } from '../core/window-rules';
```

Add two public methods to the `Strip` class — a natural place is right after the existing `cycleAlignLeft`/`cycleAlignRight` methods:

```typescript
    /** Sets the focused column's width directly — used once, right after a window is
     * created, to apply a window rule's `width` (docs: 2026-09-06-window-rules-design).
     * A no-op if nothing is focused (shouldn't happen on the caller's actual call path,
     * since `Grid.addColumn` always focuses the column it just created). */
    setFocusedColumnWidth(width: number): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        focused.setWidth(width);
        this.render();
    }

    /** Jumps the focused column directly to `align`'s edge/center, without cycling through
     * phases the way `cycleAlignLeft`/`cycleAlignRight` do — used once, right after a window
     * is created, to apply a window rule's `align` (docs: 2026-09-06-window-rules-design).
     * Deliberately duplicates cycleAlign's screen-resolution logic instead of factoring it
     * out: cycleAlign's own multi-monitor wraparound behavior is separately tuned and
     * tested, and this method doesn't need it. */
    alignFocusedColumn(align: ColumnAlign): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        const screens = this.screenBounds();
        const offset = this.viewport.offset();
        const screenIndex = currentScreenIndex(rect.x, rect.width, offset, screens);
        const screen = screenIndex === null ? { left: 0, width: this.viewport.viewportWidth() } : screens[screenIndex];
        const offsets = alignOffsets(rect.x, rect.width, screen);
        const target = align === 'left' ? offsets.left : align === 'right' ? offsets.right : offsets.center;
        this.animator.animate(offset, target, this.settings.animationDurationMs);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- strip.test.ts`
Expected: PASS (full file, to confirm nothing else regressed)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `camelCase` method names, matches existing `cycleAlignLeft`/`cycleAlignRight` style
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: StripStack — pass-through methods

**Files:**
- Modify: `src/runtime/strip-stack.ts`
- Test: `src/runtime/strip-stack.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/runtime/strip-stack.test.ts`, extend the existing `FakeStrip` interface and `fakeStrip()` fixture with the two new mocked methods:

```typescript
// In the FakeStrip interface, alongside the existing addWindow/removeWindow/etc:
    setFocusedColumnWidth: ReturnType<typeof vi.fn>;
    alignFocusedColumn: ReturnType<typeof vi.fn>;

// In fakeStrip()'s `fns` object, alongside the existing addWindow/removeWindow/etc:
        setFocusedColumnWidth: vi.fn(),
        alignFocusedColumn: vi.fn(),
```

Then add:

```typescript
describe('StripStack.setFocusedColumnWidth / alignFocusedColumn', () => {
    it('delegates setFocusedColumnWidth to the active strip', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.setFocusedColumnWidth(900);

        expect(created[0].setFocusedColumnWidth).toHaveBeenCalledWith(900);
    });

    it('delegates alignFocusedColumn to the active strip', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.alignFocusedColumn('left');

        expect(created[0].alignFocusedColumn).toHaveBeenCalledWith('left');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- strip-stack.test.ts -t "setFocusedColumnWidth|alignFocusedColumn"`
Expected: FAIL — neither method exists on `StripStack` yet, and the fake doesn't define them either (TypeScript compile error until Step 1's fixture edit is in place, then a runtime "not a function" failure).

- [ ] **Step 3: Write the implementation**

In `src/runtime/strip-stack.ts`, add an import (alongside the existing `Strip`-related imports):

```typescript
import type { ColumnAlign } from '../core/window-rules';
```

Add two public methods, right after the existing `addWindow`:

```typescript
    setFocusedColumnWidth(width: number): void {
        this.activeStrip().setFocusedColumnWidth(width);
    }

    alignFocusedColumn(align: ColumnAlign): void {
        this.activeStrip().alignFocusedColumn(align);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- strip-stack.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Method names/signatures match `Strip`'s exactly (Task 4)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

## Task 6: StripManager — `applyRuleOverrides`

**Files:**
- Modify: `src/runtime/strip-manager.ts`
- Test: `src/runtime/strip-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/runtime/strip-manager.test.ts`, extend `FakeStripStack`/`fakeStripStack()` the same way as Task 5:

```typescript
// In the FakeStripStack interface:
    setFocusedColumnWidth: ReturnType<typeof vi.fn>;
    alignFocusedColumn: ReturnType<typeof vi.fn>;

// In fakeStripStack():
    const setFocusedColumnWidth = vi.fn();
    const alignFocusedColumn = vi.fn();
    const stack = {
        addWindow,
        removeWindow,
        activateWindow,
        render,
        setFocusedColumnWidth,
        alignFocusedColumn,
    } as unknown as StripStack;
    return { stack, addWindow, removeWindow, activateWindow, render, setFocusedColumnWidth, alignFocusedColumn };
```

Then add:

```typescript
describe('StripManager.applyRuleOverrides', () => {
    it('applies a width override to the strip stack owning the window', () => {
        const { manager, created } = makeManager();
        const win = fakeWin('w1');
        manager.addTo('a', 'd1', win);

        manager.applyRuleOverrides(win, { width: 900 });

        expect(created[0].setFocusedColumnWidth).toHaveBeenCalledWith(900);
        expect(created[0].alignFocusedColumn).not.toHaveBeenCalled();
    });

    it('applies an align override to the strip stack owning the window', () => {
        const { manager, created } = makeManager();
        const win = fakeWin('w1');
        manager.addTo('a', 'd1', win);

        manager.applyRuleOverrides(win, { align: 'left' });

        expect(created[0].alignFocusedColumn).toHaveBeenCalledWith('left');
        expect(created[0].setFocusedColumnWidth).not.toHaveBeenCalled();
    });

    it('does nothing for a window with no owning strip stack', () => {
        const { manager, created } = makeManager();

        manager.applyRuleOverrides(fakeWin('unowned'), { width: 900 });

        expect(created).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- strip-manager.test.ts -t "applyRuleOverrides"`
Expected: FAIL — `applyRuleOverrides` doesn't exist on `StripManager` yet.

- [ ] **Step 3: Write the implementation**

In `src/runtime/strip-manager.ts`, add an import:

```typescript
import type { WindowRuleOverrides } from '../core/window-rules';
```

Add a public method, right after the existing `addTo`:

```typescript
    /** Applies a matched window rule's width/align overrides to the column that owns
     * `win` — called once, immediately after `addTo`, from `WindowManager.addWindow`
     * (docs: 2026-09-06-window-rules-design). */
    applyRuleOverrides(win: WindowAdapter, overrides: WindowRuleOverrides): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        const stack = this.stacks.get(key);
        if (stack === undefined) {
            return;
        }
        if (overrides.width !== undefined) {
            stack.setFocusedColumnWidth(overrides.width);
        }
        if (overrides.align !== undefined) {
            stack.alignFocusedColumn(overrides.align);
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- strip-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Method follows the existing `remove`/`activate` pattern (look up owner key, guard on `undefined`, delegate)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

## Task 7: WindowManager — match and dispatch

**Files:**
- Modify: `src/runtime/window-manager.ts`
- Test: `src/runtime/window-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

First, extend `window-manager.test.ts`'s fixtures. Extend `fakeStripManager()` with the new method:

```typescript
function fakeStripManager() {
    const owners = new Map<string, string>();
    const addTo = vi.fn((activity: string, desktop: string, win: WindowAdapter) =>
        owners.set(win.id, `${activity}|${desktop}`),
    );
    const remove = vi.fn((win: WindowAdapter) => owners.delete(win.id));
    const activate = vi.fn();
    const ownerOf = vi.fn((id: string) => owners.get(id) ?? null);
    const applyRuleOverrides = vi.fn();
    const keyOf = (activity: string, desktop: string) => `${activity}|${desktop}`;
    const manager = { addTo, remove, activate, ownerOf, applyRuleOverrides, keyOf } as unknown as StripManager;
    return { manager, addTo, remove, activate, ownerOf, applyRuleOverrides };
}
```

Extend `fakeSettings` with a second, optional, positional parameter (every existing call site passes 0 or 1 arguments, so this is backward compatible):

```typescript
function fakeSettings(undockKeepAbove = true, windowRules = '[]'): Settings {
    return { undockKeepAbove, windowRules } as unknown as Settings;
}
```

Extend `fakeWin`'s options and returned window object with `resourceClass`/`caption`/`screenWidth`:

```typescript
function fakeWin(
    id: string,
    options: {
        tileable?: boolean;
        assignment?: { activity: string; desktop: string } | null;
        resourceClass?: string;
        caption?: string;
        screenWidth?: number;
    } = {},
): FakeWin {
    let assignment = options.assignment === undefined ? { activity: 'a', desktop: 'd1' } : options.assignment;
    let activitiesHandler = (): void => {};
    let desktopsHandler = (): void => {};
    const disconnectActivities = vi.fn();
    const disconnectDesktops = vi.fn();
    const win = {
        id,
        isTileable: () => options.tileable ?? true,
        singleAssignment: () => assignment,
        resourceClass: options.resourceClass ?? 'test-app',
        caption: options.caption ?? 'Test Window',
        screenWidth: () => options.screenWidth ?? 1920,
        onActivitiesChanged: (handler: () => void) => {
            activitiesHandler = handler;
            return disconnectActivities;
        },
        onDesktopsChanged: (handler: () => void) => {
            desktopsHandler = handler;
            return disconnectDesktops;
        },
        setKeepAbove: vi.fn(),
    } as unknown as WindowAdapter;
    return {
        win,
        setAssignment: (next) => {
            assignment = next;
        },
        fireActivities: () => activitiesHandler(),
        fireDesktops: () => desktopsHandler(),
        disconnectActivities,
        disconnectDesktops,
        setKeepAbove: win.setKeepAbove as ReturnType<typeof vi.fn>,
    };
}
```

Add a module-level mock for `../debug` (place this right after the existing imports, before any `describe` block) and import `debug` from it:

```typescript
vi.mock('../debug', () => ({ debug: vi.fn() }));

import { debug } from '../debug';
```

Then add:

```typescript
describe('WindowManager — window rules', () => {
    it('floats a window matched by a float:true rule instead of tiling it', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'firefox' });
        const settings = fakeSettings(true, '[{"class":"firefox","float":true}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
        expect(win.setKeepAbove).toHaveBeenCalledWith(true);
    });

    it('does not set keepAbove for a floated rule window when undockKeepAbove is false', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'firefox' });
        const settings = fakeSettings(false, '[{"class":"firefox","float":true}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(win.setKeepAbove).not.toHaveBeenCalled();
    });

    it('resizes a newly tiled window via a matched width rule', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'slack' });
        const settings = fakeSettings(true, '[{"class":"slack","width":900}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
        expect(sm.applyRuleOverrides).toHaveBeenCalledWith(win.win, { width: 900 });
    });

    it('resolves a percentage width against the window\'s current screen width', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'slack', screenWidth: 1920 });
        const settings = fakeSettings(true, '[{"class":"slack","width":"50%"}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.applyRuleOverrides).toHaveBeenCalledWith(win.win, { width: 960 });
    });

    it('applies an align rule via the strip manager', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'code' });
        const settings = fakeSettings(true, '[{"class":"code","align":"left"}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.applyRuleOverrides).toHaveBeenCalledWith(win.win, { align: 'left' });
    });

    it('combines width and align overrides from the same rule into one call', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'code' });
        const settings = fakeSettings(true, '[{"class":"code","width":900,"align":"left"}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.applyRuleOverrides).toHaveBeenCalledWith(win.win, { width: 900, align: 'left' });
    });

    it('does not call applyRuleOverrides when the matched rule sets neither width nor align', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'firefox' });
        const settings = fakeSettings(true, '[{"class":"firefox"}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.applyRuleOverrides).not.toHaveBeenCalled();
    });

    it('logs a debug message when a matched rule sets screen, without moving anything', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'steam' });
        const settings = fakeSettings(true, '[{"class":"steam","screen":1}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
        expect(debug).toHaveBeenCalledWith(expect.stringContaining('screen'));
    });

    it('leaves an unmatched window untouched', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { resourceClass: 'other-app' });
        const settings = fakeSettings(true, '[{"class":"firefox","float":true}]');

        new WindowManager(sm.manager, settings).addWindow(win.win);

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
        expect(win.setKeepAbove).not.toHaveBeenCalled();
        expect(sm.applyRuleOverrides).not.toHaveBeenCalled();
    });

    it('logs parse warnings via debug at construction', () => {
        const sm = fakeStripManager();
        const settings = fakeSettings(true, 'not json');

        new WindowManager(sm.manager, settings);

        expect(debug).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

`npm test -- window-manager.test.ts -t "window rules"`
Expected: FAIL — `WindowManager` doesn't parse or match rules yet; `StripManager.applyRuleOverrides` reference in the fake is fine (it's just a `vi.fn()`), but nothing in `WindowManager` calls it.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/runtime/window-manager.ts`:

```typescript
// Global entry point for window lifecycle events: routes each tileable window to the
// strip for its single activity+desktop, leaves sticky/multi-assigned windows unmanaged,
// and moves a window between strips when its activity/desktop assignment changes.
// Per-window activity/desktop subscriptions live here because an unmanaged window belongs
// to no strip; strip ownership itself is tracked by StripManager.
//
// Also matches each newly added window against `settings.windowRules` (docs:
// 2026-09-06-window-rules-design), once, at add-time: a `float: true` match diverts the
// window straight to undocked instead of tiling it; a `width`/`align` match is applied to
// the column right after it's placed. `screen` is matched but never acted on — logged via
// `debug()` so the gap stays visible, since nothing in Drift moves windows across monitors.

import type { Settings } from '../config/settings';
import {
    matchRule,
    parseWindowRules,
    resolveWidth,
    type WindowRule,
    type WindowRuleOverrides,
} from '../core/window-rules';
import { debug } from '../debug';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    private readonly unsubscribeByWindow = new Map<string, () => void>();
    private readonly undocked = new Set<string>();
    private readonly windowRules: WindowRule[];

    constructor(
        private readonly stripManager: StripManager,
        private readonly settings: Settings,
    ) {
        const { rules, warnings } = parseWindowRules(settings.windowRules);
        this.windowRules = rules;
        warnings.forEach((warning) => debug(warning));
    }

    addWindow(win: WindowAdapter): void {
        if (!win.isTileable() || this.unsubscribeByWindow.has(win.id)) {
            return;
        }
        const disconnectActivities = win.onActivitiesChanged(() => this.reassign(win));
        const disconnectDesktops = win.onDesktopsChanged(() => this.reassign(win));
        this.unsubscribeByWindow.set(win.id, () => {
            disconnectActivities();
            disconnectDesktops();
        });

        const rule = matchRule(this.windowRules, win.resourceClass, win.caption);
        if (rule?.float === true) {
            this.undock(win);
            return;
        }
        this.place(win);
        if (rule !== null) {
            this.applyRuleOverrides(win, rule);
        }
    }

    removeWindow(win: WindowAdapter): void {
        const unsubscribe = this.unsubscribeByWindow.get(win.id);
        if (unsubscribe !== undefined) {
            unsubscribe();
            this.unsubscribeByWindow.delete(win.id);
        }
        this.undocked.delete(win.id);
        this.stripManager.remove(win);
    }

    /** Returns whether `win` was actually a Drift-managed window — used to gate the
     * focus-flash highlight to managed windows only (docs:
     * 2026-09-05-focus-flash-highlight-design). */
    activateWindow(win: WindowAdapter | null): boolean {
        if (win === null) {
            return false;
        }
        return this.stripManager.activate(win);
    }

    /** Toggles `win` between docked (managed by its strip) and floating/undocked (normal
     * KWin floating behavior, outside any strip) — docs: 2026-09-06-manual-undock-redock-design. */
    toggleFloating(win: WindowAdapter | null): void {
        if (win === null) {
            return;
        }
        if (this.undocked.has(win.id)) {
            this.undocked.delete(win.id);
            win.setKeepAbove(false);
            this.place(win);
            return;
        }
        if (this.stripManager.ownerOf(win.id) === null) {
            return;
        }
        this.stripManager.remove(win);
        this.undock(win);
    }

    private place(win: WindowAdapter): void {
        const assignment = win.singleAssignment();
        if (assignment !== null) {
            this.stripManager.addTo(assignment.activity, assignment.desktop, win);
        }
    }

    private reassign(win: WindowAdapter): void {
        if (this.undocked.has(win.id)) {
            return;
        }
        const currentKey = this.stripManager.ownerOf(win.id);
        const assignment = win.singleAssignment();
        const newKey = assignment === null ? null : this.stripManager.keyOf(assignment.activity, assignment.desktop);
        if (currentKey === newKey) {
            return;
        }
        this.stripManager.remove(win);
        if (assignment !== null) {
            this.stripManager.addTo(assignment.activity, assignment.desktop, win);
        }
    }

    /** Marks `win` as undocked and applies `undockKeepAbove` — shared by the manual
     * `toggleFloating` path and a matched `float: true` window rule. */
    private undock(win: WindowAdapter): void {
        this.undocked.add(win.id);
        if (this.settings.undockKeepAbove) {
            win.setKeepAbove(true);
        }
    }

    private applyRuleOverrides(win: WindowAdapter, rule: WindowRule): void {
        const overrides: WindowRuleOverrides = {};
        const width = resolveWidth(rule.width, win.screenWidth());
        if (width !== undefined) {
            overrides.width = width;
        }
        if (rule.align !== undefined) {
            overrides.align = rule.align;
        }
        if (overrides.width !== undefined || overrides.align !== undefined) {
            this.stripManager.applyRuleOverrides(win, overrides);
        }
        if (rule.screen !== undefined) {
            debug(
                `windowRules: rule matched with screen=${rule.screen}, but cross-monitor placement isn't implemented`,
            );
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

`npm test -- window-manager.test.ts`
Expected: PASS (full file — confirms the `undock()` extraction didn't change `toggleFloating`'s existing behavior)

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `windowRules`/`rule`/`overrides` naming consistent with `src/core/window-rules.ts` (Task 1)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Any convention violations fixed before moving to next task

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

Expected: all four PASS.

- [ ] **Step 2: Manual check**

`npm run package:install`, then in System Settings → Window Management → KWin Scripts → Drift's config icon:
- Confirm the "Window Rules" tab is present and editable.
- Enter a rule (e.g. `[{"class":"kcalc","float":true}]`), apply, disable+re-enable Drift (per the dialog's own restart notice).
- Open the matched app (`kcalc`) and confirm it opens floating instead of tiled.
- Open a non-matched app and confirm it still tiles normally (regression check).

- [ ] **Step 3: Record results**

Note PASS/FAIL for each of the four commands and the manual check in the task-tracking system being used to execute this plan (subagent-driven-development or executing-plans, per the plan header).
