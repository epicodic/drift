# Settings Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate hand-maintained duplication of settings/shortcut defaults across `settings.ts`, `main.xml`, and `setup-shortcuts.sh`; fix two settings-audit gaps (`animationTickMs` dead wiring, missing `focusFlashOpacity`); reorganize the config dialog.

**Architecture:** A new `SETTINGS_DEFINITIONS` array in `src/config/settings-definitions.ts` becomes the single source of truth (`{ name, type, default, shortcut? }` per entry). Two pure builder modules (`kcfg-xml.ts`, `shortcut-bindings.ts`) turn it into `main.xml` and a shortcut-bindings data file respectively; two thin generator entry points get bundled by Rollup and run via `node`, redirecting their output into the two generated (gitignored) files as part of `npm run build`. `settings.ts`'s `loadSettings()`/`DEFAULT_SETTINGS` become generic loops over the array instead of one hand-written line per field.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-06-settings-consolidation-design.md` — read before implementing

---

## File Structure

New files:
- `src/config/settings-definitions.ts` — the single source of truth: `SettingsDefinition` type and `SETTINGS_DEFINITIONS` array (49 entries: 19 plain settings + 30 shortcuts).
- `src/config/kcfg-xml.ts` — pure `buildKcfgXml(defs)` function, builds `main.xml`'s content.
- `src/config/kcfg-xml.test.ts` — unit tests for the above.
- `src/config/generate-main-xml.ts` — thin entry point: imports the above two, `console.log`s the result. Bundled by Rollup, run via `node`, output redirected to `drift/contents/config/main.xml`.
- `src/config/shortcut-bindings.ts` — pure `driftActionNameFor(key)` and `buildShortcutBindingsScript(defs)` functions, builds the `DRIFT_BINDINGS='...'` data block.
- `src/config/shortcut-bindings.test.ts` — unit tests for the above.
- `src/config/generate-shortcut-bindings.ts` — thin entry point, same pattern, output redirected to `drift/contents/bin/shortcut-bindings.generated.sh`.

Modified files:
- `src/config/settings.ts` — `Settings` interface gains `focusFlashOpacity`, loses `animationTickMs`; `DEFAULT_SETTINGS`/`loadSettings()` become generic loops over `SETTINGS_DEFINITIONS`.
- `src/config/settings.test.ts` — one new test for `focusFlashOpacity`.
- `src/viewport/shared-ticker.ts` — gains `export const ANIMATION_TICK_MS = 16`.
- `src/runtime/strip.ts`, `src/runtime/strip-stack.ts`, `src/runtime/controller.ts` — `settings.animationTickMs` → `ANIMATION_TICK_MS` import.
- `src/kwin/focus-flash-overlay.ts` — new `peakOpacity` parameter, replaces hardcoded `* 0.5`.
- `rollup.config.mjs` — exports an array of three build configs instead of one.
- `package.json` — `build` script wired to also run the two generators.
- `.gitignore` — adds `.build/`, `drift/contents/config/main.xml`, `drift/contents/bin/shortcut-bindings.generated.sh`.
- `drift/contents/config/main.xml` — untracked from git (`git rm --cached`), becomes build output.
- `drift/contents/bin/setup-shortcuts.sh` — the hand-written `DRIFT_BINDINGS` table and its padding-collapse step are replaced by sourcing the generated file; header comments updated.
- `drift/contents/ui/config.ui` — reorganized into 5 tabs with bordered groups; gains widgets for `columnWidthStep`, `windowHeightStep`, `focusFlashOpacity` (previously missing controls); gains a bottom login notice and a Shortcuts-tab script-path note.

Deleted files:
- `src/config/shortcuts-consistency.test.ts` — superseded by generation making divergence structurally impossible, plus the new `kcfg-xml.test.ts`/`shortcut-bindings.test.ts`.

---

### Task 1: Add `focusFlashOpacity` setting

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `drift/contents/config/main.xml`
- Test: `src/config/settings.test.ts`

This uses today's hand-maintained mechanism (the generator doesn't exist until Task 5) — it'll be transcribed into `SETTINGS_DEFINITIONS` as-is once that lands. The `config.ui` widget for it is added later, in Task 9's dialog reorganization, to avoid a throwaway edit.

- [ ] **Step 1: Write the failing test**

In `src/config/settings.test.ts`, add (near the other focus-flash tests, after the `focusFlashDurationMs` one):

```typescript
    it('defaults the focus flash peak opacity to 0.5', () => {
        expect(DEFAULT_SETTINGS.focusFlashOpacity).toBe(0.5);
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Property 'focusFlashOpacity' does not exist on type 'Settings'` (or a runtime `undefined` mismatch, depending on when TS catches it).

- [ ] **Step 3: Add the field to the `Settings` interface**

In `src/config/settings.ts`, find:

```typescript
    /** Total duration of the focus-flash fade-in-then-fade-out, in milliseconds. */
    focusFlashDurationMs: number;
    /** Whether an undocked window is kept above still-docked windows (docs:
```

Replace with:

```typescript
    /** Total duration of the focus-flash fade-in-then-fade-out, in milliseconds. */
    focusFlashDurationMs: number;
    /** Peak opacity of the focus-flash highlight at the midpoint of its fade-in-then-fade-out
     * (docs: 2026-09-05-focus-flash-highlight-design.md). */
    focusFlashOpacity: number;
    /** Whether an undocked window is kept above still-docked windows (docs:
```

- [ ] **Step 4: Add the default value**

Find:

```typescript
    focusFlashBorderWidth: 4,
    focusFlashBlurRadius: 24,
    focusFlashDurationMs: 300,
    undockKeepAbove: true,
```

Replace with:

```typescript
    focusFlashBorderWidth: 4,
    focusFlashBlurRadius: 24,
    focusFlashDurationMs: 300,
    focusFlashOpacity: 0.5,
    undockKeepAbove: true,
```

- [ ] **Step 5: Read it from config in `loadSettings()`**

Find:

```typescript
        focusFlashBorderWidth: readNumberConfig('focusFlashBorderWidth', DEFAULT_SETTINGS.focusFlashBorderWidth),
        focusFlashBlurRadius: readNumberConfig('focusFlashBlurRadius', DEFAULT_SETTINGS.focusFlashBlurRadius),
        focusFlashDurationMs: readNumberConfig('focusFlashDurationMs', DEFAULT_SETTINGS.focusFlashDurationMs),
        undockKeepAbove: readBooleanConfig('undockKeepAbove', DEFAULT_SETTINGS.undockKeepAbove),
```

Replace with:

```typescript
        focusFlashBorderWidth: readNumberConfig('focusFlashBorderWidth', DEFAULT_SETTINGS.focusFlashBorderWidth),
        focusFlashBlurRadius: readNumberConfig('focusFlashBlurRadius', DEFAULT_SETTINGS.focusFlashBlurRadius),
        focusFlashDurationMs: readNumberConfig('focusFlashDurationMs', DEFAULT_SETTINGS.focusFlashDurationMs),
        focusFlashOpacity: readNumberConfig('focusFlashOpacity', DEFAULT_SETTINGS.focusFlashOpacity),
        undockKeepAbove: readBooleanConfig('undockKeepAbove', DEFAULT_SETTINGS.undockKeepAbove),
```

- [ ] **Step 6: Add the `main.xml` entry**

In `drift/contents/config/main.xml`, find:

```xml
        <entry name="focusFlashDurationMs" type="UInt">
            <default>300</default>
        </entry>
        <entry name="shortcutFocusLeft" type="String">
```

Replace with:

```xml
        <entry name="focusFlashDurationMs" type="UInt">
            <default>300</default>
        </entry>
        <entry name="focusFlashOpacity" type="Double">
            <default>0.5</default>
        </entry>
        <entry name="shortcutFocusLeft" type="String">
```

- [ ] **Step 7: Wire it through `focus-flash-overlay.ts` and `controller.ts`**

In `src/kwin/focus-flash-overlay.ts`, change the function signature and its use — find:

```typescript
export function createFocusFlashOverlay(
    parent: QmlObject,
    tickMs: number,
    borderWidth: number,
    blurRadius: number,
    durationMs: number,
    enabled: boolean,
): FocusFlashOverlay {
```

Replace with:

```typescript
export function createFocusFlashOverlay(
    parent: QmlObject,
    tickMs: number,
    borderWidth: number,
    blurRadius: number,
    durationMs: number,
    peakOpacity: number,
    enabled: boolean,
): FocusFlashOverlay {
```

Then find:

```typescript
                    dialog.opacity = flashOpacity(elapsed, durationMs) * 0.5;
```

Replace with:

```typescript
                    dialog.opacity = flashOpacity(elapsed, durationMs) * peakOpacity;
```

In `src/runtime/controller.ts`, find:

```typescript
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            settings.animationTickMs,
            settings.focusFlashBorderWidth,
            settings.focusFlashBlurRadius,
            settings.focusFlashDurationMs,
            settings.focusFlashEnabled,
        );
```

Replace with:

```typescript
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            settings.animationTickMs,
            settings.focusFlashBorderWidth,
            settings.focusFlashBlurRadius,
            settings.focusFlashDurationMs,
            settings.focusFlashOpacity,
            settings.focusFlashEnabled,
        );
```

(`settings.animationTickMs` here is replaced with `ANIMATION_TICK_MS` in Task 2 — leave it as-is for now so this task's diff stays focused on `focusFlashOpacity` alone.)

- [ ] **Step 8: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 9: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Naming: `focusFlashOpacity` is `camelCase`, matches sibling settings
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Demote `animationTickMs` to an internal constant

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/viewport/shared-ticker.ts`
- Modify: `src/runtime/strip.ts`, `src/runtime/strip-stack.ts`, `src/runtime/controller.ts`
- Modify: `src/kwin/focus-flash-overlay.ts` (doc comment only)

No test is written for this one — it's a pure refactor (moving a constant, not changing behavior); `npm run typecheck` and the existing test suite are the verification.

- [ ] **Step 1: Add the constant**

In `src/viewport/shared-ticker.ts`, find:

```typescript
import type { Timer } from './animator';

export class SharedTicker {
```

Replace with:

```typescript
import type { Timer } from './animator';

/** Internal render-tick rate driving every `SharedTicker`/`Animator`/`EdgeDwell` in the
 * codebase — an implementation detail (~60fps), not user-tunable behavior, so it lives here
 * as a constant rather than in `Settings` (docs/agents/specs/2026-09-06-settings-consolidation-design.md). */
export const ANIMATION_TICK_MS = 16;

export class SharedTicker {
```

- [ ] **Step 2: Remove the setting from `settings.ts`**

Find:

```typescript
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Timer tick interval driving the animation, in milliseconds (~60fps). */
    animationTickMs: number;
    /** Space reserved at the bottom of the screen (e.g. for a panel), in pixels. */
    bottomMargin: number;
```

Replace with:

```typescript
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Space reserved at the bottom of the screen (e.g. for a panel), in pixels. */
    bottomMargin: number;
```

Find:

```typescript
    animationDurationMs: 200,
    animationTickMs: 16,
    bottomMargin: 0,
```

Replace with:

```typescript
    animationDurationMs: 200,
    bottomMargin: 0,
```

(`animationTickMs` was never read via `readConfig()` — nothing to remove from `loadSettings()`, and it was never in `main.xml` or `config.ui`.)

- [ ] **Step 3: Update call sites in `strip.ts`**

Find:

```typescript
import { SharedTicker } from '../viewport/shared-ticker';
```

Replace with:

```typescript
import { ANIMATION_TICK_MS, SharedTicker } from '../viewport/shared-ticker';
```

Find:

```typescript
        this.ticker = new SharedTicker(timer, settings.animationTickMs);
        this.animator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            settings.animationTickMs,
```

Replace with:

```typescript
        this.ticker = new SharedTicker(timer, ANIMATION_TICK_MS);
        this.animator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            ANIMATION_TICK_MS,
```

Find:

```typescript
            this.columnMotionTimer.start(this.settings.animationTickMs, () =>
```

Replace with:

```typescript
            this.columnMotionTimer.start(ANIMATION_TICK_MS, () =>
```

Find:

```typescript
                            new EdgeDwell<number>(
                                this.ticker.subscribe(),
                                () => Date.now(),
                                this.settings.animationTickMs,
                                this.settings.columnDragDwellMs,
```

Replace with:

```typescript
                            new EdgeDwell<number>(
                                this.ticker.subscribe(),
                                () => Date.now(),
                                ANIMATION_TICK_MS,
                                this.settings.columnDragDwellMs,
```

- [ ] **Step 4: Update call sites in `strip-stack.ts`**

Find:

```typescript
import { SharedTicker } from '../viewport/shared-ticker';
```

Replace with:

```typescript
import { ANIMATION_TICK_MS, SharedTicker } from '../viewport/shared-ticker';
```

Find:

```typescript
        this.ticker = new SharedTicker(timer, settings.animationTickMs);
        this.verticalAnimator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            settings.animationTickMs,
```

Replace with:

```typescript
        this.ticker = new SharedTicker(timer, ANIMATION_TICK_MS);
        this.verticalAnimator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            ANIMATION_TICK_MS,
```

Find:

```typescript
        this.edgeDwell = new EdgeDwell<EdgeDirection>(
            this.ticker.subscribe(),
            () => Date.now(),
            this.settings.animationTickMs,
            this.settings.stripDragDwellMs,
```

Replace with:

```typescript
        this.edgeDwell = new EdgeDwell<EdgeDirection>(
            this.ticker.subscribe(),
            () => Date.now(),
            ANIMATION_TICK_MS,
            this.settings.stripDragDwellMs,
```

- [ ] **Step 5: Update the call site in `controller.ts`**

Find:

```typescript
import { createFocusFlashOverlay, type FocusFlashOverlay } from '../kwin/focus-flash-overlay';
```

Replace with:

```typescript
import { createFocusFlashOverlay, type FocusFlashOverlay } from '../kwin/focus-flash-overlay';
import { ANIMATION_TICK_MS } from '../viewport/shared-ticker';
```

Find:

```typescript
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            settings.animationTickMs,
```

Replace with:

```typescript
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            ANIMATION_TICK_MS,
```

- [ ] **Step 6: Update the doc comment in `focus-flash-overlay.ts`**

Find:

```typescript
/** `tickMs` reuses the viewport's own animation clock interval (`settings.animationTickMs`)
 * so the flash tracks a simultaneous reveal-pan animation smoothly. `enabled` is fixed at
 * construction time, same as every other setting here — Drift settings all take effect on
 * restart, not live. */
```

Replace with:

```typescript
/** `tickMs` reuses the viewport's own animation clock interval (`ANIMATION_TICK_MS`) so the
 * flash tracks a simultaneous reveal-pan animation smoothly. `enabled` is fixed at
 * construction time, same as every other setting here — Drift settings all take effect on
 * restart, not live. */
```

- [ ] **Step 7: Verify**

`npm run typecheck && npm test`
Expected: both PASS (no behavior change — `ANIMATION_TICK_MS` is still `16`, same value `settings.animationTickMs` always resolved to).

- [ ] **Step 8: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `ANIMATION_TICK_MS` is `UPPER_SNAKE_CASE`, matching module-level constant convention
- [ ] `npm run typecheck` passes (confirms no remaining `settings.animationTickMs` references)
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Create `settings-definitions.ts` — the single source of truth

**Files:**
- Create: `src/config/settings-definitions.ts`
- Test: `src/config/settings-definitions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/settings-definitions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFINITIONS } from './settings-definitions';

describe('SETTINGS_DEFINITIONS', () => {
    it('has exactly one entry per known setting, with no duplicate names', () => {
        const names = SETTINGS_DEFINITIONS.map((def) => def.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.length).toBe(49);
    });

    it("each entry's default value type matches its declared kcfg type", () => {
        for (const def of SETTINGS_DEFINITIONS) {
            const actual = typeof def.default;
            if (def.type === 'Bool') {
                expect(actual, def.name).toBe('boolean');
            } else if (def.type === 'String') {
                expect(actual, def.name).toBe('string');
            } else {
                // UInt or Double
                expect(actual, def.name).toBe('number');
            }
        }
    });

    it('only shortcut* entries carry shortcut metadata, and vice versa', () => {
        for (const def of SETTINGS_DEFINITIONS) {
            if (def.name.startsWith('shortcut')) {
                expect(def.shortcut, def.name).toBeDefined();
            } else {
                expect(def.shortcut, def.name).toBeUndefined();
            }
        }
    });

    it('only 4 entries declare an altDefault (the width/height step shortcuts)', () => {
        const withAlt = SETTINGS_DEFINITIONS.filter((def) => def.shortcut?.altDefault !== undefined);
        expect(withAlt.map((def) => def.name).sort()).toEqual([
            'shortcutDecreaseColumnWidth',
            'shortcutDecreaseWindowHeight',
            'shortcutIncreaseColumnWidth',
            'shortcutIncreaseWindowHeight',
        ]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Cannot find module './settings-definitions'`

- [ ] **Step 3: Write the implementation**

Create `src/config/settings-definitions.ts`:

```typescript
// The single source of truth for every setting's kcfg schema entry and runtime default —
// generated build output (drift/contents/config/main.xml via generate-main-xml.ts,
// drift/contents/bin/shortcut-bindings.generated.sh via generate-shortcut-bindings.ts) and
// src/config/settings.ts's DEFAULT_SETTINGS/loadSettings() are all derived from this array
// instead of duplicating it by hand (docs/agents/specs/2026-09-06-settings-consolidation-design.md).

import { DEFAULT_WINDOW_RULES } from '../core/default-window-rules';
import type { Settings } from './settings';

/** KConfigXT entry types Drift's settings use. */
export type KcfgType = 'UInt' | 'Bool' | 'String' | 'Double';

/** Metadata for a `shortcut*` setting, feeding the setup-shortcuts.sh generator — absent on
 * every non-shortcut entry. */
export interface ShortcutMetadata {
    /** kglobalaccel action text, without the "Drift: " prefix (the generator adds it). */
    label: string;
    /** Optional second key sequence for the same action (e.g. a numpad alternate). Has no
     * counterpart in Drift's own QML `ShortcutHandler` (src/input/shortcuts.ts) — only
     * reaches kglobalaccel through the generated shortcut-bindings file. */
    altDefault?: string;
}

/** One setting's complete definition. */
export interface SettingsDefinition<K extends keyof Settings = keyof Settings> {
    name: K;
    type: KcfgType;
    default: Settings[K];
    shortcut?: ShortcutMetadata;
}

export const SETTINGS_DEFINITIONS: SettingsDefinition[] = [
    { name: 'columnGap', type: 'UInt', default: 8 },
    { name: 'defaultColumnWidth', type: 'UInt', default: 800 },
    { name: 'animationDurationMs', type: 'UInt', default: 200 },
    { name: 'bottomMargin', type: 'UInt', default: 0 },
    { name: 'shortcutFocusLeft', type: 'String', default: 'Meta+Left', shortcut: { label: 'Focus Column Left' } },
    { name: 'shortcutFocusRight', type: 'String', default: 'Meta+Right', shortcut: { label: 'Focus Column Right' } },
    {
        name: 'shortcutToggleDebugConsole',
        type: 'String',
        default: 'Meta+Shift+D',
        shortcut: { label: 'Toggle Debug Console' },
    },
    {
        name: 'shortcutCycleAlignLeft',
        type: 'String',
        default: 'Meta+Shift+Left',
        shortcut: { label: 'Cycle Column Align Left' },
    },
    {
        name: 'shortcutCycleAlignRight',
        type: 'String',
        default: 'Meta+Shift+Right',
        shortcut: { label: 'Cycle Column Align Right' },
    },
    {
        name: 'shortcutViewportShiftLeft',
        type: 'String',
        default: 'Meta+Alt+Left',
        shortcut: { label: 'Shift Viewport Left' },
    },
    {
        name: 'shortcutViewportShiftRight',
        type: 'String',
        default: 'Meta+Alt+Right',
        shortcut: { label: 'Shift Viewport Right' },
    },
    { name: 'shortcutNavigateUp', type: 'String', default: 'Meta+Up', shortcut: { label: 'Navigate Up' } },
    { name: 'shortcutNavigateDown', type: 'String', default: 'Meta+Down', shortcut: { label: 'Navigate Down' } },
    {
        name: 'shortcutMoveWindowToStripAbove',
        type: 'String',
        default: 'Meta+Ctrl+Up',
        shortcut: { label: 'Move Window To Strip Above' },
    },
    {
        name: 'shortcutMoveWindowToStripBelow',
        type: 'String',
        default: 'Meta+Ctrl+Down',
        shortcut: { label: 'Move Window To Strip Below' },
    },
    { name: 'shortcutAbsorbRight', type: 'String', default: 'Meta+I', shortcut: { label: 'Absorb Column Right' } },
    { name: 'shortcutExpel', type: 'String', default: 'Meta+O', shortcut: { label: 'Expel Focused Tile' } },
    {
        name: 'shortcutMoveWindowLeft',
        type: 'String',
        default: 'Meta+Ctrl+Left',
        shortcut: { label: 'Move Window Left' },
    },
    {
        name: 'shortcutMoveWindowRight',
        type: 'String',
        default: 'Meta+Ctrl+Right',
        shortcut: { label: 'Move Window Right' },
    },
    { name: 'shortcutStripUp', type: 'String', default: 'Meta+Page_Up', shortcut: { label: 'Strip Up' } },
    { name: 'shortcutStripDown', type: 'String', default: 'Meta+Page_Down', shortcut: { label: 'Strip Down' } },
    {
        name: 'shortcutMoveColumnToStripAbove',
        type: 'String',
        default: 'Meta+Ctrl+Page_Up',
        shortcut: { label: 'Move Column To Strip Above' },
    },
    {
        name: 'shortcutMoveColumnToStripBelow',
        type: 'String',
        default: 'Meta+Ctrl+Page_Down',
        shortcut: { label: 'Move Column To Strip Below' },
    },
    { name: 'shortcutFocusFirst', type: 'String', default: 'Meta+Home', shortcut: { label: 'Focus First Column' } },
    { name: 'shortcutFocusLast', type: 'String', default: 'Meta+End', shortcut: { label: 'Focus Last Column' } },
    {
        name: 'shortcutMoveWindowToStart',
        type: 'String',
        default: 'Meta+Ctrl+Home',
        shortcut: { label: 'Move Window To Start' },
    },
    {
        name: 'shortcutMoveWindowToEnd',
        type: 'String',
        default: 'Meta+Ctrl+End',
        shortcut: { label: 'Move Window To End' },
    },
    {
        name: 'shortcutViewportShiftToStart',
        type: 'String',
        default: 'Meta+Alt+Home',
        shortcut: { label: 'Shift Viewport To Start' },
    },
    {
        name: 'shortcutViewportShiftToEnd',
        type: 'String',
        default: 'Meta+Alt+End',
        shortcut: { label: 'Shift Viewport To End' },
    },
    {
        name: 'shortcutIncreaseColumnWidth',
        type: 'String',
        default: 'Meta+Plus',
        shortcut: { label: 'Increase Column Width', altDefault: 'Meta+Num+Plus' },
    },
    {
        name: 'shortcutDecreaseColumnWidth',
        type: 'String',
        default: 'Meta+Minus',
        shortcut: { label: 'Decrease Column Width', altDefault: 'Meta+Num+Minus' },
    },
    {
        name: 'shortcutIncreaseWindowHeight',
        type: 'String',
        default: 'Meta+Shift+Plus',
        shortcut: { label: 'Increase Window Height', altDefault: 'Meta+Shift+Num+Plus' },
    },
    {
        name: 'shortcutDecreaseWindowHeight',
        type: 'String',
        default: 'Meta+Shift+Minus',
        shortcut: { label: 'Decrease Window Height', altDefault: 'Meta+Shift+Num+Minus' },
    },
    { name: 'viewportShiftStep', type: 'UInt', default: 400 },
    { name: 'columnWidthStep', type: 'UInt', default: 80 },
    { name: 'windowHeightStep', type: 'UInt', default: 80 },
    { name: 'stripDragDwellMs', type: 'UInt', default: 400 },
    { name: 'stripDragEdgeBorderPx', type: 'UInt', default: 2 },
    { name: 'columnDragDwellMs', type: 'UInt', default: 400 },
    { name: 'minimapAutoHideMs', type: 'UInt', default: 1200 },
    { name: 'minimapShowThumbnails', type: 'Bool', default: true },
    { name: 'focusFlashEnabled', type: 'Bool', default: true },
    { name: 'focusFlashBorderWidth', type: 'UInt', default: 4 },
    { name: 'focusFlashBlurRadius', type: 'UInt', default: 24 },
    { name: 'focusFlashDurationMs', type: 'UInt', default: 300 },
    { name: 'focusFlashOpacity', type: 'Double', default: 0.5 },
    { name: 'undockKeepAbove', type: 'Bool', default: true },
    { name: 'shortcutToggleFloating', type: 'String', default: 'Meta+Space', shortcut: { label: 'Toggle Floating' } },
    { name: 'windowRules', type: 'String', default: DEFAULT_WINDOW_RULES },
];
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] File is kebab-case (`settings-definitions.ts`), types are `PascalCase`, exported array is a plain module-level export (not `UPPER_SNAKE_CASE` — it's a data table, not a scalar constant; matches `DEFAULT_WINDOW_RULES`'s own precedent... note: `DEFAULT_WINDOW_RULES` *is* `UPPER_SNAKE_CASE` despite being a table — for consistency, keep `SETTINGS_DEFINITIONS` `UPPER_SNAKE_CASE` too, as already named above)
- [ ] `npm run typecheck` passes (confirms every `default` value's type matches its `Settings[K]` field type — this is where a mismatch like `{ name: 'columnGap', default: 'eight' }` would be caught at compile time)
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Create `kcfg-xml.ts` — pure `main.xml` builder

**Files:**
- Create: `src/config/kcfg-xml.ts`
- Test: `src/config/kcfg-xml.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/kcfg-xml.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildKcfgXml } from './kcfg-xml';
import type { SettingsDefinition } from './settings-definitions';

describe('buildKcfgXml', () => {
    it('renders a UInt entry with its default', () => {
        const xml = buildKcfgXml([{ name: 'columnGap', type: 'UInt', default: 8 }] as SettingsDefinition[]);
        expect(xml).toContain('<entry name="columnGap" type="UInt">');
        expect(xml).toContain('<default>8</default>');
    });

    it('renders a Bool entry with its default', () => {
        const xml = buildKcfgXml([
            { name: 'undockKeepAbove', type: 'Bool', default: true },
        ] as SettingsDefinition[]);
        expect(xml).toContain('<entry name="undockKeepAbove" type="Bool">');
        expect(xml).toContain('<default>true</default>');
    });

    it('renders a Double entry with its default', () => {
        const xml = buildKcfgXml([
            { name: 'focusFlashOpacity', type: 'Double', default: 0.5 },
        ] as SettingsDefinition[]);
        expect(xml).toContain('<entry name="focusFlashOpacity" type="Double">');
        expect(xml).toContain('<default>0.5</default>');
    });

    it('escapes &, <, and > in a String default', () => {
        const xml = buildKcfgXml([
            { name: 'windowRules', type: 'String', default: 'a & b <c> d' },
        ] as SettingsDefinition[]);
        expect(xml).toContain('<default>a &amp; b &lt;c&gt; d</default>');
    });

    it('wraps entries in the kcfg document structure with a kwinrc kcfgfile', () => {
        const xml = buildKcfgXml([{ name: 'columnGap', type: 'UInt', default: 8 }] as SettingsDefinition[]);
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain('<kcfgfile name="kwinrc" />');
        expect(xml.trim().startsWith('<?xml')).toBe(true);
        expect(xml.trim().endsWith('</kcfg>')).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Cannot find module './kcfg-xml'`

- [ ] **Step 3: Write the implementation**

Create `src/config/kcfg-xml.ts`:

```typescript
// Builds drift/contents/config/main.xml's content from SETTINGS_DEFINITIONS. Pure and
// side-effect-free so it's directly unit-testable; generate-main-xml.ts is the thin
// script wrapper that actually prints this to stdout for the build.

import type { SettingsDefinition } from './settings-definitions';

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildKcfgXml(definitions: SettingsDefinition[]): string {
    const entries = definitions
        .map((def) => {
            const defaultText = typeof def.default === 'string' ? escapeXml(def.default) : String(def.default);
            return `        <entry name="${def.name}" type="${def.type}">\n            <default>${defaultText}</default>\n        </entry>`;
        })
        .join('\n');
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<kcfg xmlns="http://www.kde.org/standards/kcfg/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.kde.org/standards/kcfg/1.0 http://www.kde.org/standards/kcfg/1.0/kcfg.xsd">\n' +
        '    <kcfgfile name="kwinrc" />\n' +
        '    <group name="">\n' +
        entries +
        '\n    </group>\n' +
        '</kcfg>\n'
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Sanity-check against the real data**

Run this ad hoc (not a permanent test — just confirms the real `SETTINGS_DEFINITIONS` round-trips sensibly before wiring up the build):

```
npx vitest run src/config/kcfg-xml.test.ts
```

Expected: PASS (already covered by Step 4; this step is a checkpoint before moving on, not new work).

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `escapeXml` is a private (non-exported) `camelCase` function
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: Wire up `main.xml` generation and retire the hand-maintained copy

**Files:**
- Create: `src/config/generate-main-xml.ts`
- Modify: `rollup.config.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Delete from git tracking: `drift/contents/config/main.xml` (kept on disk as build output)

- [ ] **Step 1: Create the generator entry point**

Create `src/config/generate-main-xml.ts`:

```typescript
import { buildKcfgXml } from './kcfg-xml';
import { SETTINGS_DEFINITIONS } from './settings-definitions';

console.log(buildKcfgXml(SETTINGS_DEFINITIONS));
```

- [ ] **Step 2: Add a second (and later, third) Rollup build target**

In `rollup.config.mjs`, find:

```javascript
import typescript from '@rollup/plugin-typescript';

// The QML host (contents/ui/main.qml) imports this bundle and calls
// `Drift.init(root, scriptUiDirUrl)` (docs §6.2). Rollup wraps the src/ module tree in
// an IIFE assigned to `DriftBundle`; the footer re-exposes `init` as a top-level
// function declaration, which is the form QML reliably exposes to `import "..." as
// Drift` (matches the working Karousel build). The footer's own parameter list must be
// kept in sync with `main.ts`'s `init` signature — extra call-site arguments are
// silently dropped otherwise (confirmed live: this shim previously only declared
// `root`, silently discarding `scriptUiDirUrl`).
export default {
    input: 'src/main.ts',
    output: {
        file: 'drift/contents/code/main.js',
        format: 'iife',
        name: 'DriftBundle',
        footer: 'function init(root, scriptUiDirUrl) { return DriftBundle.init(root, scriptUiDirUrl); }',
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            noEmitOnError: true,
        }),
    ],
};
```

Replace with:

```javascript
import typescript from '@rollup/plugin-typescript';

// A fresh plugin instance per build target — @rollup/plugin-typescript keeps internal
// program state that must not be shared across the multiple inputs built from this one
// config file.
function typescriptPlugin() {
    return typescript({
        tsconfig: './tsconfig.json',
        noEmitOnError: true,
    });
}

// The QML host (contents/ui/main.qml) imports this bundle and calls
// `Drift.init(root, scriptUiDirUrl)` (docs §6.2). Rollup wraps the src/ module tree in
// an IIFE assigned to `DriftBundle`; the footer re-exposes `init` as a top-level
// function declaration, which is the form QML reliably exposes to `import "..." as
// Drift` (matches the working Karousel build). The footer's own parameter list must be
// kept in sync with `main.ts`'s `init` signature — extra call-site arguments are
// silently dropped otherwise (confirmed live: this shim previously only declared
// `root`, silently discarding `scriptUiDirUrl`).
const mainBundle = {
    input: 'src/main.ts',
    output: {
        file: 'drift/contents/code/main.js',
        format: 'iife',
        name: 'DriftBundle',
        footer: 'function init(root, scriptUiDirUrl) { return DriftBundle.init(root, scriptUiDirUrl); }',
    },
    plugins: [typescriptPlugin()],
};

// Prints drift/contents/config/main.xml's content to stdout when run with `node`; `npm run
// generate:config` redirects it into the file (docs/agents/specs/2026-09-06-settings-consolidation-design.md).
const generateMainXmlBundle = {
    input: 'src/config/generate-main-xml.ts',
    output: {
        file: '.build/generate-main-xml.cjs',
        format: 'cjs',
    },
    plugins: [typescriptPlugin()],
};

export default [mainBundle, generateMainXmlBundle];
```

- [ ] **Step 3: Wire the npm scripts**

In `package.json`, find:

```json
        "build": "rollup -c && npm run build:shaders",
        "build:shaders": "scripts/compile-shaders.sh",
```

Replace with:

```json
        "build": "rollup -c && npm run generate:config && npm run build:shaders",
        "generate:config": "node .build/generate-main-xml.cjs > drift/contents/config/main.xml",
        "build:shaders": "scripts/compile-shaders.sh",
```

- [ ] **Step 4: Gitignore the generated file and the transient bundle dir**

In `.gitignore`, find:

```
drift/contents/code/main.js
drift/contents/shaders/*.qsb
```

Replace with:

```
drift/contents/code/main.js
drift/contents/shaders/*.qsb
drift/contents/config/main.xml
.build/
```

- [ ] **Step 5: Untrack the hand-maintained file and regenerate it**

```
git rm --cached drift/contents/config/main.xml
npm run build
```

Expected: `git rm --cached` reports the file removed from the index (it stays on disk); `npm run build` regenerates `drift/contents/config/main.xml` as build output, and its content should be byte-for-byte equivalent to the hand-maintained version from Task 1 (same 49... well, 46 non-shortcut-adjacent entries covered by `main.xml` today plus the 30 shortcuts — verify with `git diff drift/contents/config/main.xml` before the `rm --cached` takes effect, or `diff <(git show HEAD:drift/contents/config/main.xml) drift/contents/config/main.xml` after regenerating, to confirm no unintended content drift).

- [ ] **Step 6: Verify**

`npm run build && npm run typecheck && npm test`
Expected: all PASS; `drift/contents/config/main.xml` exists on disk (as untracked build output) with 49 `<entry>` elements.

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run build` succeeds end to end
- [ ] `git status` shows `drift/contents/config/main.xml` as untracked (not staged, not ignored-but-tracked)
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 6: Rewrite `settings.ts`'s `DEFAULT_SETTINGS`/`loadSettings()` as generic loops

**Files:**
- Modify: `src/config/settings.ts`

- [ ] **Step 1: Replace the file header comment**

Find:

```typescript
// Hardcoded spike defaults (docs §7.2), overridable via the package's config/main.xml
// (KConfigXT, read through `KWin.readConfig`) — the same mechanism Karousel uses.

import { DEFAULT_WINDOW_RULES } from '../core/default-window-rules';
```

Replace with:

```typescript
// Settings and their defaults are defined once in settings-definitions.ts (single source of
// truth — docs/agents/specs/2026-09-06-settings-consolidation-design.md); this file derives
// DEFAULT_SETTINGS from it and reads the live values through `KWin.readConfig`, backed by
// the generated drift/contents/config/main.xml (KConfigXT schema).

import { SETTINGS_DEFINITIONS } from './settings-definitions';
```

(`DEFAULT_WINDOW_RULES` is no longer imported directly here — `settings-definitions.ts` owns that import now.)

- [ ] **Step 2: Replace `DEFAULT_SETTINGS`**

Find the line:

```typescript
export const DEFAULT_SETTINGS: Settings = {
```

...through its matching closing brace and semicolon (the large literal object ending in `};` right before the `loadSettings` JSDoc comment). Replace the entire `export const DEFAULT_SETTINGS: Settings = { ... };` block with:

```typescript
function buildDefaultSettings(): Settings {
    // Object spread/Object.fromEntries are unsupported (spread confirmed; fromEntries
    // unconfirmed) by KWin's declarativescript JS engine — build the object with a plain
    // loop and bracket assignment instead, both already used elsewhere in this codebase.
    const settings: Record<string, unknown> = {};
    for (const definition of SETTINGS_DEFINITIONS) {
        settings[definition.name] = definition.default;
    }
    return settings as Settings;
}

export const DEFAULT_SETTINGS: Settings = buildDefaultSettings();
```

- [ ] **Step 3: Replace `loadSettings()`**

Find the `loadSettings` function (from its JSDoc comment `/** Reads user-configurable settings...` through the closing `});` of the `Object.assign(...)` call and its own closing `}`). Replace the whole function body with:

```typescript
/** Reads user-configurable settings from kwinrc (docs §5). Untestable glue (docs §8). */
export function loadSettings(): Settings {
    const settings: Record<string, unknown> = {};
    for (const definition of SETTINGS_DEFINITIONS) {
        switch (definition.type) {
            case 'UInt':
            case 'Double':
                settings[definition.name] = readNumberConfig(definition.name, definition.default as number);
                break;
            case 'String':
                settings[definition.name] = readStringConfig(definition.name, definition.default as string);
                break;
            case 'Bool':
                settings[definition.name] = readBooleanConfig(definition.name, definition.default as boolean);
                break;
        }
    }
    return settings as Settings;
}
```

Leave the three helper functions below it (`readNumberConfig`, `readStringConfig`, `readBooleanConfig`) untouched — they're still used, just called generically now instead of once per field.

- [ ] **Step 4: Verify**

`npm run typecheck && npm test`
Expected: both PASS. `settings.test.ts` needs no changes — it only asserts on `DEFAULT_SETTINGS` values, which are unchanged (just derived differently now).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `buildDefaultSettings` is a private (non-exported) `camelCase` function
- [ ] `npm run typecheck` passes (confirms no leftover per-field `readXConfig` calls, no unused imports)
- [ ] `npm test` passes — spot-check the diff shows `settings.ts` shrank substantially (the ~100-line hand-written `loadSettings()` body is now ~15 lines)
- [ ] Any convention violations fixed before moving to next task

---

### Task 7: Create `shortcut-bindings.ts` — pure shortcut data builder

**Files:**
- Create: `src/config/shortcut-bindings.ts`
- Test: `src/config/shortcut-bindings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/shortcut-bindings.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildShortcutBindingsScript, driftActionNameFor } from './shortcut-bindings';
import type { SettingsDefinition } from './settings-definitions';

describe('driftActionNameFor', () => {
    it('strips the "shortcut" prefix and prepends "Drift"', () => {
        expect(driftActionNameFor('shortcutFocusLeft')).toBe('DriftFocusLeft');
        expect(driftActionNameFor('shortcutToggleFloating')).toBe('DriftToggleFloating');
    });
});

describe('buildShortcutBindingsScript', () => {
    it('emits a 3-column row for a shortcut with no altDefault', () => {
        const script = buildShortcutBindingsScript([
            {
                name: 'shortcutFocusLeft',
                type: 'String',
                default: 'Meta+Left',
                shortcut: { label: 'Focus Column Left' },
            },
        ] as SettingsDefinition[]);
        expect(script).toContain('DriftFocusLeft|Drift: Focus Column Left|Meta+Left');
    });

    it('emits a 4-column row for a shortcut with an altDefault', () => {
        const script = buildShortcutBindingsScript([
            {
                name: 'shortcutIncreaseColumnWidth',
                type: 'String',
                default: 'Meta+Plus',
                shortcut: { label: 'Increase Column Width', altDefault: 'Meta+Num+Plus' },
            },
        ] as SettingsDefinition[]);
        expect(script).toContain('DriftIncreaseColumnWidth|Drift: Increase Column Width|Meta+Plus|Meta+Num+Plus');
    });

    it('skips non-shortcut definitions', () => {
        const script = buildShortcutBindingsScript([
            { name: 'columnGap', type: 'UInt', default: 8 },
        ] as SettingsDefinition[]);
        expect(script).not.toContain('columnGap');
    });

    it('wraps the rows in a DRIFT_BINDINGS shell assignment', () => {
        const script = buildShortcutBindingsScript([
            { name: 'shortcutExpel', type: 'String', default: 'Meta+O', shortcut: { label: 'Expel Focused Tile' } },
        ] as SettingsDefinition[]);
        expect(script).toContain("DRIFT_BINDINGS='");
        expect(script.trim().endsWith("'")).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Cannot find module './shortcut-bindings'`

- [ ] **Step 3: Write the implementation**

Create `src/config/shortcut-bindings.ts`:

```typescript
// Builds the DRIFT_BINDINGS data block that setup-shortcuts.sh sources, from
// SETTINGS_DEFINITIONS. Pure and side-effect-free so it's directly unit-testable;
// generate-shortcut-bindings.ts is the thin script wrapper that prints this to stdout
// for the build.

import type { SettingsDefinition } from './settings-definitions';

/** "shortcutFocusLeft" -> "DriftFocusLeft" — the naming convention linking a settings key
 * to its kglobalaccel action name. */
export function driftActionNameFor(settingsKey: string): string {
    return `Drift${settingsKey.replace(/^shortcut/, '')}`;
}

export function buildShortcutBindingsScript(definitions: SettingsDefinition[]): string {
    const rows = definitions
        .filter((def) => def.shortcut !== undefined)
        .map((def) => {
            const actionName = driftActionNameFor(def.name);
            const actionText = `Drift: ${def.shortcut!.label}`;
            const sequence = def.default as string;
            const altSequence = def.shortcut!.altDefault;
            return altSequence
                ? `${actionName}|${actionText}|${sequence}|${altSequence}`
                : `${actionName}|${actionText}|${sequence}`;
        })
        .join('\n');
    return (
        '# Generated by generate-shortcut-bindings.ts from src/config/settings-definitions.ts — do not edit by hand.\n' +
        '# Sourced by setup-shortcuts.sh. Columns: action_name|action_text|sequence|alt_sequence (alt optional).\n' +
        "DRIFT_BINDINGS='\n" +
        rows +
        "\n'\n"
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `driftActionNameFor` and `buildShortcutBindingsScript` are exported `camelCase` functions
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 8: Wire up shortcut-bindings generation and update `setup-shortcuts.sh`

**Files:**
- Create: `src/config/generate-shortcut-bindings.ts`
- Modify: `rollup.config.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `drift/contents/bin/setup-shortcuts.sh`
- Delete: `src/config/shortcuts-consistency.test.ts`

- [ ] **Step 1: Create the generator entry point**

Create `src/config/generate-shortcut-bindings.ts`:

```typescript
import { buildShortcutBindingsScript } from './shortcut-bindings';
import { SETTINGS_DEFINITIONS } from './settings-definitions';

console.log(buildShortcutBindingsScript(SETTINGS_DEFINITIONS));
```

- [ ] **Step 2: Add the third Rollup build target**

In `rollup.config.mjs`, find:

```javascript
export default [mainBundle, generateMainXmlBundle];
```

Replace with:

```javascript
// Prints the DRIFT_BINDINGS data block to stdout when run with `node`; `npm run
// generate:config` redirects it into drift/contents/bin/shortcut-bindings.generated.sh,
// which setup-shortcuts.sh sources.
const generateShortcutBindingsBundle = {
    input: 'src/config/generate-shortcut-bindings.ts',
    output: {
        file: '.build/generate-shortcut-bindings.cjs',
        format: 'cjs',
    },
    plugins: [typescriptPlugin()],
};

export default [mainBundle, generateMainXmlBundle, generateShortcutBindingsBundle];
```

- [ ] **Step 3: Wire the npm script**

In `package.json`, find:

```json
        "generate:config": "node .build/generate-main-xml.cjs > drift/contents/config/main.xml",
```

Replace with:

```json
        "generate:config": "node .build/generate-main-xml.cjs > drift/contents/config/main.xml && node .build/generate-shortcut-bindings.cjs > drift/contents/bin/shortcut-bindings.generated.sh",
```

- [ ] **Step 4: Gitignore the generated file**

In `.gitignore`, find:

```
drift/contents/config/main.xml
.build/
```

Replace with:

```
drift/contents/config/main.xml
drift/contents/bin/shortcut-bindings.generated.sh
.build/
```

- [ ] **Step 5: Update `setup-shortcuts.sh`'s header comment**

In `drift/contents/bin/setup-shortcuts.sh`, find:

```sh
# - Table-driven: DRIFT_BINDINGS below is the single source of truth, one line per
#   action: `drift_action_name | drift_action_text | sequence | alt_sequence`.
#   To add or rebind a shortcut, edit a line here — nothing else needs to change
#   unless the sequence uses a key/modifier not already known to key_code()/
#   modifier_bit() in setup-shortcuts-lib.sh. Fields are padded with spaces for
#   readability and collapsed back to a plain "|" join right after the heredoc.
# - alt_sequence is optional (omit the field and its leading "|" if unused) and
```

Replace with:

```sh
# - Table-driven: DRIFT_BINDINGS is generated from src/config/settings-definitions.ts
#   (the single source of truth) by generate-shortcut-bindings.ts, and sourced from
#   drift/contents/bin/shortcut-bindings.generated.sh below — see
#   docs/agents/specs/2026-09-06-settings-consolidation-design.md. To add or rebind a
#   shortcut, edit settings-definitions.ts and run `npm run build`; nothing else needs
#   to change unless the sequence uses a key/modifier not already known to key_code()/
#   modifier_bit() in setup-shortcuts-lib.sh.
# - alt_sequence is optional and
```

Find:

```sh
# - Default sequences are intentionally duplicated from src/config/settings.ts
#   (DEFAULT_SETTINGS); unavoidable since this script runs standalone, outside the
#   KWin script process, before Drift has a chance to self-register anything.
```

Delete this block entirely (no longer true — defaults now flow from `settings-definitions.ts` through the generated file, not by hand).

- [ ] **Step 6: Replace the inline `DRIFT_BINDINGS` table with a `source`**

Find:

```sh
# Action Name               | Text                              | Sequence          | Alt Sequence
DRIFT_BINDINGS='
DriftFocusLeft              | Drift: Focus Column Left          | Meta+Left
DriftFocusRight             | Drift: Focus Column Right         | Meta+Right
DriftToggleDebugConsole     | Drift: Toggle Debug Console       | Meta+Shift+D
DriftCycleAlignLeft         | Drift: Cycle Column Align Left    | Meta+Shift+Left
DriftCycleAlignRight        | Drift: Cycle Column Align Right   | Meta+Shift+Right
DriftViewportShiftLeft      | Drift: Shift Viewport Left        | Meta+Alt+Left
DriftViewportShiftRight     | Drift: Shift Viewport Right       | Meta+Alt+Right
DriftNavigateUp             | Drift: Navigate Up                | Meta+Up
DriftNavigateDown           | Drift: Navigate Down              | Meta+Down
DriftMoveWindowToStripAbove | Drift: Move Window To Strip Above | Meta+Ctrl+Up
DriftMoveWindowToStripBelow | Drift: Move Window To Strip Below | Meta+Ctrl+Down
DriftAbsorbRight            | Drift: Absorb Column Right        | Meta+I
DriftExpel                  | Drift: Expel Focused Tile         | Meta+O
DriftMoveWindowLeft         | Drift: Move Window Left           | Meta+Ctrl+Left
DriftMoveWindowRight        | Drift: Move Window Right          | Meta+Ctrl+Right
DriftStripUp                | Drift: Strip Up                   | Meta+Page_Up
DriftStripDown              | Drift: Strip Down                 | Meta+Page_Down
DriftMoveColumnToStripAbove | Drift: Move Column To Strip Above | Meta+Ctrl+Page_Up
DriftMoveColumnToStripBelow | Drift: Move Column To Strip Below | Meta+Ctrl+Page_Down
DriftFocusFirst             | Drift: Focus First Column         | Meta+Home
DriftFocusLast              | Drift: Focus Last Column          | Meta+End
DriftMoveWindowToStart      | Drift: Move Window To Start       | Meta+Ctrl+Home
DriftMoveWindowToEnd        | Drift: Move Window To End         | Meta+Ctrl+End
DriftViewportShiftToStart   | Drift: Shift Viewport To Start    | Meta+Alt+Home
DriftViewportShiftToEnd     | Drift: Shift Viewport To End      | Meta+Alt+End
DriftIncreaseColumnWidth    | Drift: Increase Column Width      | Meta+Plus        | Meta+Num+Plus
DriftDecreaseColumnWidth    | Drift: Decrease Column Width      | Meta+Minus       | Meta+Num+Minus
DriftIncreaseWindowHeight   | Drift: Increase Window Height     | Meta+Shift+Plus  | Meta+Shift+Num+Plus
DriftDecreaseWindowHeight   | Drift: Decrease Window Height     | Meta+Shift+Minus | Meta+Shift+Num+Minus
DriftToggleFloating         | Drift: Toggle Floating            | Meta+Space
'
# The padding above is purely cosmetic; collapse " | " back to "|" so every
# downstream awk/read consumer keeps seeing the original compact field format.
DRIFT_BINDINGS="$(printf '%s\n' "$DRIFT_BINDINGS" | sed -E 's/[[:space:]]*\|[[:space:]]*/|/g; s/[[:space:]]+$//')"
```

Replace with:

```sh
# shellcheck source=./shortcut-bindings.generated.sh
. "${SCRIPT_DIR}/shortcut-bindings.generated.sh"
```

- [ ] **Step 7: Regenerate and verify**

```
git rm --cached drift/contents/config/main.xml 2>/dev/null; true  # no-op if Task 5 already did this
npm run build
```

Expected: `drift/contents/bin/shortcut-bindings.generated.sh` now exists on disk (untracked), containing `DRIFT_BINDINGS='...'` with the same 30 rows as before, now unpadded (`driftActionNameFor` and the generator produce plain `|`-joined fields directly — no separate collapse step needed, since there's no padding to begin with).

Sanity-check the shell script still parses correctly:

```
sh -n drift/contents/bin/setup-shortcuts.sh
```

Expected: no output (syntax OK). Do not actually run `setup-shortcuts.sh` in this step — it mutates live kglobalaccel state and needs a real KWin session; that's covered by the manual smoke check in Task 10.

- [ ] **Step 8: Delete the superseded consistency test**

```
rm src/config/shortcuts-consistency.test.ts
```

- [ ] **Step 9: Verify**

`npm test`
Expected: PASS (the deleted test's job — catching drift between `main.xml`, `settings.ts`, and `setup-shortcuts.sh` — is now structurally impossible, and is additionally covered by `kcfg-xml.test.ts` and `shortcut-bindings.test.ts`).

- [ ] **Step 10: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `npm run build` succeeds end to end
- [ ] `sh -n drift/contents/bin/setup-shortcuts.sh` reports no syntax errors
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 9: Reorganize the config dialog

**Files:**
- Modify: `drift/contents/ui/config.ui`

This is a full-file replacement — the tab restructuring touches too much of the file for a targeted diff to stay readable. Read the current file first if picking this task up cold, to confirm no unrelated hand-edits have landed since this plan was written.

- [ ] **Step 1: Replace `drift/contents/ui/config.ui`**

Write the complete file:

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
                <widget class="QLabel" name="label_restartNotice">
                    <property name="text">
                        <string>Changes take effect after restarting KWin, or disabling and re-enabling Drift under KWin Scripts.</string>
                    </property>
                    <property name="wordWrap">
                        <bool>true</bool>
                    </property>
                </widget>
            </item>
            <item>
                <widget class="QTabWidget" name="tabWidget">
                    <property name="currentIndex">
                        <number>0</number>
                    </property>
                    <widget class="QWidget" name="tab_layout">
                        <attribute name="title">
                            <string>Layout</string>
                        </attribute>
                        <layout class="QVBoxLayout" name="verticalLayout_layout">
                            <item>
                                <widget class="QGroupBox" name="groupBox_layout">
                                    <property name="title">
                                        <string>Layout</string>
                                    </property>
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
                                        <item row="3" column="1">
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
                                </widget>
                            </item>
                            <item>
                                <spacer name="verticalSpacer_layout">
                                    <property name="orientation">
                                        <enum>Qt::Orientation::Vertical</enum>
                                    </property>
                                </spacer>
                            </item>
                        </layout>
                    </widget>
                    <widget class="QWidget" name="tab_behavior">
                        <attribute name="title">
                            <string>Behavior</string>
                        </attribute>
                        <layout class="QVBoxLayout" name="verticalLayout_behavior">
                            <item>
                                <widget class="QGroupBox" name="groupBox_scrolling">
                                    <property name="title">
                                        <string>Scrolling</string>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_scrolling">
                                        <item row="0" column="0">
                                            <widget class="QLabel" name="label_viewportShiftStep">
                                                <property name="text">
                                                    <string>Viewport shift step:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="0" column="1">
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
                                        <item row="1" column="0">
                                            <widget class="QLabel" name="label_animationDurationMs">
                                                <property name="text">
                                                    <string>Animation duration:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="1">
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
                                    </layout>
                                </widget>
                            </item>
                            <item>
                                <widget class="QGroupBox" name="groupBox_resizing">
                                    <property name="title">
                                        <string>Resizing</string>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_resizing">
                                        <item row="0" column="0">
                                            <widget class="QLabel" name="label_columnWidthStep">
                                                <property name="text">
                                                    <string>Column width step:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="0" column="1">
                                            <widget class="QSpinBox" name="kcfg_columnWidthStep">
                                                <property name="toolTip">
                                                    <string>Distance a column's width changes per increase/decrease-width shortcut press</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>1</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>80</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="0">
                                            <widget class="QLabel" name="label_windowHeightStep">
                                                <property name="text">
                                                    <string>Window height step:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="1">
                                            <widget class="QSpinBox" name="kcfg_windowHeightStep">
                                                <property name="toolTip">
                                                    <string>Distance a stacked tile's height changes per increase/decrease-height shortcut press (stacked columns only)</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>1</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>999</number>
                                                </property>
                                                <property name="value">
                                                    <number>80</number>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
                                </widget>
                            </item>
                            <item>
                                <widget class="QGroupBox" name="groupBox_dragging">
                                    <property name="title">
                                        <string>Dragging</string>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_dragging">
                                        <item row="0" column="0">
                                            <widget class="QLabel" name="label_stripDragDwellMs">
                                                <property name="text">
                                                    <string>Strip-drag dwell:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="0" column="1">
                                            <widget class="QSpinBox" name="kcfg_stripDragDwellMs">
                                                <property name="toolTip">
                                                    <string>How long a dragged window must stay past the screen's top/bottom edge before it moves to the strip above/below</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> ms</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>5000</number>
                                                </property>
                                                <property name="value">
                                                    <number>400</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="0">
                                            <widget class="QLabel" name="label_stripDragEdgeBorderPx">
                                                <property name="text">
                                                    <string>Strip-drag edge border:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="1">
                                            <widget class="QSpinBox" name="kcfg_stripDragEdgeBorderPx">
                                                <property name="toolTip">
                                                    <string>How close to the screen's top/bottom edge the pointer must be for a cross-strip drag to arm</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>100</number>
                                                </property>
                                                <property name="value">
                                                    <number>2</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="2" column="0">
                                            <widget class="QLabel" name="label_columnDragDwellMs">
                                                <property name="text">
                                                    <string>Column-stack drag dwell:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="2" column="1">
                                            <widget class="QSpinBox" name="kcfg_columnDragDwellMs">
                                                <property name="toolTip">
                                                    <string>How long the pointer must hover a neighbor column before a cross-column drag previews stacking into it</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> ms</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>5000</number>
                                                </property>
                                                <property name="value">
                                                    <number>400</number>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
                                </widget>
                            </item>
                        </layout>
                    </widget>
                    <widget class="QWidget" name="tab_visualFeedback">
                        <attribute name="title">
                            <string>Visual Feedback</string>
                        </attribute>
                        <layout class="QVBoxLayout" name="verticalLayout_visualFeedback">
                            <item>
                                <widget class="QGroupBox" name="groupBox_minimap">
                                    <property name="title">
                                        <string>Minimap</string>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_minimap">
                                        <item row="0" column="1">
                                            <widget class="QCheckBox" name="kcfg_minimapShowThumbnails">
                                                <property name="toolTip">
                                                    <string>Show a live preview of each window's content instead of just its icon</string>
                                                </property>
                                                <property name="text">
                                                    <string>Show live window content in the minimap</string>
                                                </property>
                                                <property name="checked">
                                                    <bool>true</bool>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="0">
                                            <widget class="QLabel" name="label_minimapAutoHideMs">
                                                <property name="text">
                                                    <string>Auto-hide delay:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="1">
                                            <widget class="QSpinBox" name="kcfg_minimapAutoHideMs">
                                                <property name="toolTip">
                                                    <string>How long the minimap overlay stays visible after the last focus-step press</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> ms</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>10000</number>
                                                </property>
                                                <property name="value">
                                                    <number>1200</number>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
                                </widget>
                            </item>
                            <item>
                                <widget class="QGroupBox" name="kcfg_focusFlashEnabled">
                                    <property name="title">
                                        <string>Flash the focused window's border</string>
                                    </property>
                                    <property name="toolTip">
                                        <string>Flash a blurred border around a window whenever Drift handles its focus change</string>
                                    </property>
                                    <property name="checkable">
                                        <bool>true</bool>
                                    </property>
                                    <property name="checked">
                                        <bool>true</bool>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_focusFlash">
                                        <item row="0" column="0">
                                            <widget class="QLabel" name="label_focusFlashBorderWidth">
                                                <property name="text">
                                                    <string>Border width:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="0" column="1">
                                            <widget class="QSpinBox" name="kcfg_focusFlashBorderWidth">
                                                <property name="toolTip">
                                                    <string>Width of the focus-flash highlight's border</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>1</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>50</number>
                                                </property>
                                                <property name="value">
                                                    <number>4</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="0">
                                            <widget class="QLabel" name="label_focusFlashBlurRadius">
                                                <property name="text">
                                                    <string>Blur radius:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="1" column="1">
                                            <widget class="QSpinBox" name="kcfg_focusFlashBlurRadius">
                                                <property name="toolTip">
                                                    <string>Blur radius of the focus-flash highlight</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> px</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>100</number>
                                                </property>
                                                <property name="value">
                                                    <number>24</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="2" column="0">
                                            <widget class="QLabel" name="label_focusFlashDurationMs">
                                                <property name="text">
                                                    <string>Duration:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="2" column="1">
                                            <widget class="QSpinBox" name="kcfg_focusFlashDurationMs">
                                                <property name="toolTip">
                                                    <string>Total duration of the focus-flash fade-in-then-fade-out</string>
                                                </property>
                                                <property name="suffix">
                                                    <string> ms</string>
                                                </property>
                                                <property name="minimum">
                                                    <number>0</number>
                                                </property>
                                                <property name="maximum">
                                                    <number>5000</number>
                                                </property>
                                                <property name="value">
                                                    <number>300</number>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="3" column="0">
                                            <widget class="QLabel" name="label_focusFlashOpacity">
                                                <property name="text">
                                                    <string>Peak opacity:</string>
                                                </property>
                                            </widget>
                                        </item>
                                        <item row="3" column="1">
                                            <widget class="QDoubleSpinBox" name="kcfg_focusFlashOpacity">
                                                <property name="toolTip">
                                                    <string>Peak opacity of the focus-flash highlight at the midpoint of its fade</string>
                                                </property>
                                                <property name="decimals">
                                                    <number>2</number>
                                                </property>
                                                <property name="minimum">
                                                    <double>0.0</double>
                                                </property>
                                                <property name="maximum">
                                                    <double>1.0</double>
                                                </property>
                                                <property name="singleStep">
                                                    <double>0.05</double>
                                                </property>
                                                <property name="value">
                                                    <double>0.50</double>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
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
                            <item>
                                <widget class="QLabel" name="label_setupShortcutsScript">
                                    <property name="text">
                                        <string>To (re-)apply Drift's default shortcuts in one step, run:
~/.local/share/kwin/scripts/drift/contents/bin/setup-shortcuts.sh</string>
                                    </property>
                                    <property name="wordWrap">
                                        <bool>true</bool>
                                    </property>
                                    <property name="alignment">
                                        <set>Qt::AlignmentFlag::AlignCenter</set>
                                    </property>
                                    <property name="textInteractionFlags">
                                        <set>Qt::TextInteractionFlag::TextSelectableByMouse</set>
                                    </property>
                                </widget>
                            </item>
                        </layout>
                    </widget>
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
                </widget>
            </item>
            <item>
                <widget class="QLabel" name="label_loginNotice">
                    <property name="text">
                        <string>Some settings — including keyboard shortcuts registered via kglobalaccel — take full effect only after your next login.</string>
                    </property>
                    <property name="wordWrap">
                        <bool>true</bool>
                    </property>
                </widget>
            </item>
        </layout>
    </widget>
    <resources/>
</ui>
```

- [ ] **Step 2: Validate with `qmllint`-adjacent tooling**

`.ui` files aren't QML, so `qmllint` doesn't apply. Instead, sanity-check the XML is well-formed:

```
python3 -c "import xml.dom.minidom as m; m.parse('drift/contents/ui/config.ui')" && echo "well-formed"
```

Expected: `well-formed`

- [ ] **Step 3: Run the full lint/build/test suite**

`npm run lint && npm run build && npm test`
Expected: all PASS (note `qmllint` in the `lint` script only checks `main.qml`, not `config.ui` — this step's real coverage of `config.ui` is Step 2 plus the manual check in Task 10).

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] Every `kcfg_<name>` widget name matches a real `SETTINGS_DEFINITIONS` entry name exactly (spot check: `kcfg_columnWidthStep`, `kcfg_windowHeightStep`, `kcfg_focusFlashOpacity`, `kcfg_focusFlashEnabled` — all present in Task 3's array)
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] Any convention violations fixed before moving to next task

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full clean build**

```
rm -rf .build drift/contents/code/main.js drift/contents/config/main.xml drift/contents/bin/shortcut-bindings.generated.sh
npm run build
```

Expected: succeeds; all three files listed above are regenerated.

- [ ] **Step 2: Full test suite**

`npm test`
Expected: all PASS, including `settings.test.ts`, `settings-definitions.test.ts`, `kcfg-xml.test.ts`, `shortcut-bindings.test.ts`; `shortcuts-consistency.test.ts` no longer exists.

- [ ] **Step 3: Full lint**

`npm run lint`
Expected: PASS (ESLint, Prettier, `qmllint` on `main.qml`).

- [ ] **Step 4: Typecheck**

`npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual smoke check (requires a real KDE Plasma 6 session)**

```
npm run package:install
```

Then:
1. Open System Settings → Window Management → KWin Scripts, confirm Drift is enabled, and open its configuration dialog. Confirm all 5 tabs render, the Focus Flash groupbox's checkbox grays out its child spinboxes when unchecked, and the bottom login-notice label and the Shortcuts-tab script-path label both appear with the expected text.
2. Run `~/.local/share/kwin/scripts/drift/contents/bin/setup-shortcuts.sh` from a terminal (copy-pasting the path shown in the Shortcuts tab) and confirm it completes without error and reports each binding applied.
3. Restart KWin (or disable/re-enable Drift) and confirm tiling still works — this exercises `loadSettings()`'s new generic loop against the generated `main.xml` end to end.

- [ ] **Step 6: Report results**

Summarize pass/fail for each of Steps 1-5 back to the user before considering this plan complete.
