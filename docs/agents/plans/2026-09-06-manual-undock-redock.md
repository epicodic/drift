# Manual Undock/Redock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Meta+Space` shortcut that toggles the active window between docked (managed by its strip) and floating (normal KWin floating behavior, optionally kept above other windows), per `docs/agents/specs/2026-09-06-manual-undock-redock-design.md`.

**Architecture:** `WindowManager` gains a `Set<string>` of undocked window ids and a `toggleFloating()` method that reuses the existing `StripManager.remove()`/`addTo()` paths (the same ones already used for a real window close and for activity/desktop reassignment) — no new `Strip`/`Grid`/`ColumnRegistry` code. A new `keepAbove` field on the KWin `Window` type (mirroring the existing `skipTaskbar` field) is set/cleared as a side effect, gated by a new `undockKeepAbove` setting.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

### Task 1: `keepAbove` on `Window`/`WindowAdapter`

**Files:**
- Modify: `src/types/kwin.d.ts`
- Modify: `src/kwin/window-adapter.ts`
- Test: `src/kwin/window-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/kwin/window-adapter.test.ts`, right after the existing `describe('WindowAdapter.setSkipTaskbar', ...)` block:

```ts
describe('WindowAdapter.setKeepAbove', () => {
    it('writes keepAbove on the underlying window', () => {
        const window = createWindow({ keepAbove: false });
        const adapter = new WindowAdapter(window);

        adapter.setKeepAbove(true);

        expect(window.keepAbove).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- window-adapter`
Expected: FAIL — TypeScript error, `keepAbove` does not exist on type `Window` (in both the `createWindow` override argument and the `window.keepAbove` assertion).

- [ ] **Step 3: Write minimal implementation**

In `src/types/kwin.d.ts`, add `keepAbove` to the `Window` interface right next to the existing `skipTaskbar` field:

```ts
    skipTaskbar: boolean;
    keepAbove: boolean;
```

In `src/kwin/window-adapter.ts`, add a new method right after `setSkipTaskbar`:

```ts
    /** Sets whether the window stays above other (non-`keepAbove`) windows — used while a
     * window is undocked, so it stays visible above the still-tiled windows behind it
     * (docs: 2026-09-06-manual-undock-redock-design). */
    setKeepAbove(keepAbove: boolean): void {
        this.window.keepAbove = keepAbove;
    }
```

In `src/kwin/window-adapter.test.ts`, add `keepAbove: false` to the base object returned by `createWindow()` (next to the existing `skipTaskbar: false,` line), so every other test's `as Window` cast still type-checks:

```ts
        skipTaskbar: false,
        keepAbove: false,
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- window-adapter`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `undockKeepAbove` and `shortcutToggleFloating` settings

**Files:**
- Modify: `src/config/settings.ts`
- Test: `src/config/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/config/settings.test.ts`, inside the existing `describe('DEFAULT_SETTINGS', ...)` block (anywhere among the other `it(...)` cases):

```ts
    it('keeps undocked windows above others by default', () => {
        expect(DEFAULT_SETTINGS.undockKeepAbove).toBe(true);
    });

    it('uses Meta+Space to toggle floating', () => {
        expect(DEFAULT_SETTINGS.shortcutToggleFloating).toBe('Meta+Space');
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test -- settings`
Expected: FAIL — `DEFAULT_SETTINGS.undockKeepAbove` and `DEFAULT_SETTINGS.shortcutToggleFloating` are both `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/config/settings.ts`, add to the `Settings` interface, right after the existing `focusFlashDurationMs` field:

```ts
    /** Total duration of the focus-flash fade-in-then-fade-out, in milliseconds. */
    focusFlashDurationMs: number;
    /** Whether an undocked window is kept above still-docked windows (docs:
     * 2026-09-06-manual-undock-redock-design). */
    undockKeepAbove: boolean;
    /** Shortcut sequence for toggling the active window between docked and floating. */
    shortcutToggleFloating: string;
```

Add to `DEFAULT_SETTINGS`, right after `focusFlashDurationMs: 300,`:

```ts
    focusFlashDurationMs: 300,
    undockKeepAbove: true,
    shortcutToggleFloating: 'Meta+Space',
```

Add to `loadSettings`'s `Object.assign` call, right after the `focusFlashDurationMs: readNumberConfig(...)` line:

```ts
        focusFlashDurationMs: readNumberConfig('focusFlashDurationMs', DEFAULT_SETTINGS.focusFlashDurationMs),
        undockKeepAbove: readBooleanConfig('undockKeepAbove', DEFAULT_SETTINGS.undockKeepAbove),
        shortcutToggleFloating: readStringConfig('shortcutToggleFloating', DEFAULT_SETTINGS.shortcutToggleFloating),
```

- [ ] **Step 4: Run test to verify it passes**

`npm test -- settings`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: `WindowManager.toggleFloating`

**Files:**
- Modify: `src/runtime/window-manager.ts`
- Test: `src/runtime/window-manager.test.ts`

- [ ] **Step 1: Update the existing test fixtures first (no behavior change yet)**

`WindowManager`'s constructor is about to take a second `settings` parameter, and `fakeWin` needs a `setKeepAbove` spy. In `src/runtime/window-manager.test.ts`:

Add a minimal fake settings factory near the top, right after `fakeStripManager`'s closing brace:

```ts
function fakeSettings(undockKeepAbove = true): Settings {
    return { undockKeepAbove } as unknown as Settings;
}
```

Add the `Settings` import at the top of the file, alongside the existing imports:

```ts
import type { Settings } from '../config/settings';
```

In `fakeWin`'s returned object literal (the object assigned to `win`), add a `setKeepAbove` spy next to the existing `onActivitiesChanged`/`onDesktopsChanged` entries:

```ts
        setKeepAbove: vi.fn(),
```

In `FakeWin`'s interface declaration, add the matching field:

```ts
    setKeepAbove: ReturnType<typeof vi.fn>;
```

In `fakeWin`'s return statement (the object literal returned alongside `win`, `setAssignment`, etc.), expose it so tests can assert on it:

```ts
        setKeepAbove: win.setKeepAbove as ReturnType<typeof vi.fn>,
```

Update every existing `new WindowManager(sm.manager)` call site in this file to `new WindowManager(sm.manager, fakeSettings())` — there are 11 total: 3 inline (`new WindowManager(sm.manager).addWindow(win.win);` in `'routes a single-assignment window to its strip'`, `'leaves a sticky window unmanaged'`, `'ignores non-tileable windows'`) and 8 assigned to a `manager` const (the remaining 5 tests in `describe('WindowManager', ...)`, plus all 3 in `describe('WindowManager.activateWindow', ...)`).

- [ ] **Step 2: Run the full existing suite to verify it still passes**

`npm test -- window-manager`
Expected: PASS — this step only touched fixtures/call sites, no behavior changed yet.

- [ ] **Step 3: Write the failing tests for `toggleFloating`**

Add a new `describe` block at the end of `src/runtime/window-manager.test.ts`:

```ts
describe('WindowManager.toggleFloating', () => {
    it('does nothing for a null window', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());

        manager.toggleFloating(null);

        expect(sm.remove).not.toHaveBeenCalled();
        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('does nothing for a window Drift does not manage', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1');

        manager.toggleFloating(win.win);

        expect(sm.remove).not.toHaveBeenCalled();
        expect(win.setKeepAbove).not.toHaveBeenCalled();
    });

    it('undocks a docked window: removes it from its strip and sets keepAbove when undockKeepAbove is true', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings(true));
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);

        manager.toggleFloating(win.win);

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(win.setKeepAbove).toHaveBeenCalledWith(true);
    });

    it('undocks a docked window without setting keepAbove when undockKeepAbove is false', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings(false));
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);

        manager.toggleFloating(win.win);

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(win.setKeepAbove).not.toHaveBeenCalled();
    });

    it('redocks a floating window: re-adds it via its current assignment and clears keepAbove', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings(true));
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);
        manager.toggleFloating(win.win); // dock -> undock
        sm.remove.mockClear();
        sm.addTo.mockClear();
        win.setKeepAbove.mockClear();

        win.setAssignment({ activity: 'a', desktop: 'd2' }); // moved activity while floating
        manager.toggleFloating(win.win); // undock -> dock

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd2', win.win);
        expect(win.setKeepAbove).toHaveBeenCalledWith(false);
    });

    it('leaves a real window close cleaning up floating state (no stale redock)', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);
        manager.toggleFloating(win.win); // dock -> undock
        manager.removeWindow(win.win); // real close while floating
        sm.addTo.mockClear();

        manager.toggleFloating(win.win); // should be a no-op now, not a redock

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('does not re-dock a floating window when its activity/desktop changes on its own', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);
        manager.toggleFloating(win.win); // dock -> undock
        sm.remove.mockClear();
        sm.addTo.mockClear();

        win.setAssignment({ activity: 'a', desktop: 'd2' });
        win.fireDesktops();

        expect(sm.remove).not.toHaveBeenCalled();
        expect(sm.addTo).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 4: Run tests to verify they fail**

`npm test -- window-manager`
Expected: FAIL — `WindowManager` has no `toggleFloating` method yet.

- [ ] **Step 5: Write minimal implementation**

In `src/runtime/window-manager.ts`, add the `Settings` import and change the constructor:

```ts
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    private readonly unsubscribeByWindow = new Map<string, () => void>();
    private readonly undocked = new Set<string>();

    constructor(
        private readonly stripManager: StripManager,
        private readonly settings: Settings,
    ) {}
```

Update `removeWindow` to also clear the `undocked` entry:

```ts
    removeWindow(win: WindowAdapter): void {
        const unsubscribe = this.unsubscribeByWindow.get(win.id);
        if (unsubscribe !== undefined) {
            unsubscribe();
            this.unsubscribeByWindow.delete(win.id);
        }
        this.undocked.delete(win.id);
        this.stripManager.remove(win);
    }
```

Add the new public method, right after `activateWindow`:

```ts
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
        this.undocked.add(win.id);
        if (this.settings.undockKeepAbove) {
            win.setKeepAbove(true);
        }
    }
```

Add the reassign guard at the top of the existing private `reassign` method:

```ts
    private reassign(win: WindowAdapter): void {
        if (this.undocked.has(win.id)) {
            return;
        }
        const currentKey = this.stripManager.ownerOf(win.id);
```

- [ ] **Step 6: Run tests to verify they pass**

`npm test -- window-manager`
Expected: PASS

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Shortcut and `Controller` wiring

**Files:**
- Modify: `src/input/shortcuts.ts`
- Modify: `src/runtime/controller.ts`

No test file: `registerShortcuts`/`createShortcut` (`Qt.createQmlObject`) and `Controller` are both untestable KWin/QML glue — same as every other shortcut and as `focus-flash-overlay.ts`. There is no `shortcuts.test.ts` or `controller.test.ts` in this codebase today.

- [ ] **Step 1: Add the action to `ShortcutActions` and register the shortcut**

In `src/input/shortcuts.ts`, add to the `ShortcutActions` interface, right after `decreaseWindowHeight(): void;`:

```ts
    decreaseWindowHeight(): void;
    toggleFloating(): void;
```

In `registerShortcuts`, add a new `createShortcut` call at the end of the function body, right after the existing `DriftDecreaseWindowHeight` call:

```ts
    createShortcut(
        parent,
        'DriftToggleFloating',
        'Drift: Toggle Floating',
        settings.shortcutToggleFloating,
        actions.toggleFloating,
    );
}
```

- [ ] **Step 2: Wire `Controller`**

In `src/runtime/controller.ts`, change the `WindowManager` construction in the constructor:

```ts
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager, settings);
```

In `start()`, add a new entry to the `registerShortcuts` actions object, right after `decreaseWindowHeight: () => this.stripManager.activeStripStack().decreaseWindowHeight(),`:

```ts
            decreaseWindowHeight: () => this.stripManager.activeStripStack().decreaseWindowHeight(),
            toggleFloating: () => this.windowManager.toggleFloating(this.workspaceAdapter.activeWindow()),
        });
```

- [ ] **Step 3: Run the full test suite and typecheck**

`npm test`
Expected: PASS (no new tests in this task; this proves the constructor/interface change didn't break anything already covered)

`npm run typecheck`
Expected: no errors

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 5: KConfigXT entries and config UI

**Files:**
- Modify: `drift/contents/config/main.xml`
- Modify: `drift/contents/ui/config.ui`

No dedicated test: these two files aren't covered by `npm test`; `undockKeepAbove`/`shortcutToggleFloating` are already covered indirectly by `settings.test.ts`'s `loadSettings` round-trip (Task 2), matching how every other setting/shortcut entry is (un)covered today. `npm run lint` runs `qmllint` on QML files only, not `.xml`/`.ui` — this task is verified by reading the result and by `npm run build` succeeding.

- [ ] **Step 1: Add the `main.xml` entries**

In `drift/contents/config/main.xml`, add two entries right after the existing `shortcutIncreaseWindowHeight`/`shortcutDecreaseWindowHeight` pair (keep every other `shortcut*` entry's relative order and the `focusFlash*` block above it untouched — insert after whichever comes last in the file):

```xml
        <entry name="undockKeepAbove" type="Bool">
            <default>true</default>
        </entry>
        <entry name="shortcutToggleFloating" type="String">
            <default>Meta+Space</default>
        </entry>
```

- [ ] **Step 2: Add the `config.ui` checkbox**

In `drift/contents/ui/config.ui`, inside `tab_animation`'s `formLayout_animation`, add a new row (row 11, column 1) right after the existing `item row="10" column="1"` block (`kcfg_focusFlashDurationMs`):

```xml
                            <item row="11" column="1">
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
```

`shortcutToggleFloating` needs no `config.ui` widget — no shortcut has one today (the **Shortcuts** tab is a static label pointing at System Settings).

- [ ] **Step 3: Run the full build**

`npm run build`
Expected: succeeds (this is the step that actually exercises `main.xml`/`config.ui` — there's no narrower check for these two files)

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task

---

### Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

`npm test`
Expected: PASS, including every test added in Tasks 1–3

- [ ] **Step 2: Run lint**

`npm run lint`
Expected: PASS (fix any prettier/eslint/qmllint findings before continuing — see repo memory on formatting drift between tasks)

- [ ] **Step 3: Run the build**

`npm run build`
Expected: succeeds

- [ ] **Step 4: Update `docs/roadmap.md` and `docs/comparison-keybindings.md`**

In `docs/roadmap.md`, remove the now-implemented line:

```markdown
- **Undock/redock** — detaching a window from the strip to normal floating behavior (staying always-on-top) and re-docking it later.
```

In `docs/comparison-keybindings.md`, update the "Toggle floating" row's "Drift" column from `— (no float/undock yet, see roadmap)` to `Meta+Space`.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing
- [ ] Any convention violations fixed before moving to next task
