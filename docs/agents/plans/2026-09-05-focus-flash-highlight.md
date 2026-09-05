# Focus Flash Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flash a blurred border around a window's real screen position whenever Drift detects and handles a focus change of a managed window, per [`docs/agents/specs/2026-09-05-focus-flash-highlight-design.md`](../specs/2026-09-05-focus-flash-highlight-design.md).

**Architecture:** A pure `ui/focus-flash.ts` computes a fade-in/fade-out opacity envelope from elapsed time. A `kwin/focus-flash-overlay.ts` `PlasmaCore.Dialog` (built exactly like `kwin/minimap-overlay.ts`) tracks a window's live `frameGeometry()` on a timer and applies that envelope. `StripManager.activate()`/`WindowManager.activateWindow()` start reporting (via a `boolean` return) whether an activation was actually a managed window, and `initWorkspaceSignals()` uses that to fire the overlay only for managed windows, on any activation source (click, Alt-Tab, taskbar, or a Drift shortcut).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## Task 1: Pure flash-opacity envelope

**Files:**
- Create: `src/ui/focus-flash.ts`
- Create: `src/ui/focus-flash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ui/focus-flash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flashOpacity } from './focus-flash';

describe('flashOpacity', () => {
    it('starts at 0 at the very beginning of the flash', () => {
        expect(flashOpacity(0, 300)).toBe(0);
    });

    it('reaches full opacity exactly at the midpoint', () => {
        expect(flashOpacity(150, 300)).toBe(1);
    });

    it('ramps up linearly during the first half', () => {
        expect(flashOpacity(75, 300)).toBeCloseTo(0.5);
    });

    it('ramps down linearly during the second half', () => {
        expect(flashOpacity(225, 300)).toBeCloseTo(0.5);
    });

    it('reaches 0 exactly at the end of the flash', () => {
        expect(flashOpacity(300, 300)).toBe(0);
    });

    it('stays at 0 past the end of the flash', () => {
        expect(flashOpacity(500, 300)).toBe(0);
    });

    it('returns 0 for a non-positive duration', () => {
        expect(flashOpacity(0, 0)).toBe(0);
        expect(flashOpacity(10, -50)).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `./focus-flash` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/ui/focus-flash.ts`:

```ts
// Pure fade-in/fade-out opacity envelope for the focus-flash highlight (docs:
// 2026-09-05-focus-flash-highlight-design). KWin-free and fully unit-tested; the
// KWin-touching glue that samples this against a real clock lives in
// `kwin/focus-flash-overlay.ts`.

/** Triangular envelope: ramps 0 -> 1 over the first half of `durationMs`, then 1 -> 0 over
 * the second half. Returns 0 once `elapsedMs >= durationMs`, and 0 for a non-positive duration. */
export function flashOpacity(elapsedMs: number, durationMs: number): number {
    if (durationMs <= 0 || elapsedMs >= durationMs) {
        return 0;
    }
    const half = durationMs / 2;
    if (elapsedMs <= half) {
        return elapsedMs / half;
    }
    return 1 - (elapsedMs - half) / half;
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: `StripManager.activate()` reports whether the window was managed

**Files:**
- Modify: `src/runtime/strip-manager.ts`
- Modify: `src/runtime/strip-manager.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/runtime/strip-manager.test.ts`, replace the existing `'routes activation to the owning strip stack'` test and add a new one right after it:

```ts
    it('routes activation to the owning strip stack and reports it as managed', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        const result = manager.activate(w1);

        expect(created[0].activateWindow).toHaveBeenCalledWith(w1);
        expect(result).toBe(true);
    });

    it('reports an unmanaged window activation as not managed', () => {
        const { manager, created } = makeManager();

        const result = manager.activate(fakeWin('ghost'));

        expect(created).toHaveLength(0);
        expect(result).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `manager.activate(...)` currently returns `undefined`, not `true`/`false`.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/strip-manager.ts`, change `activate()` (currently right after `remove()`):

```ts
    /** Routes activation to the strip stack that owns `win`, if any. Returns whether `win`
     * was actually managed by Drift — used to gate the focus-flash highlight to managed
     * windows only (docs: 2026-09-05-focus-flash-highlight-design). */
    activate(win: WindowAdapter): boolean {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return false;
        }
        this.stacks.get(key)?.activateWindow(win);
        return true;
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: `WindowManager.activateWindow()` reports whether the window was managed

**Files:**
- Modify: `src/runtime/window-manager.ts`
- Modify: `src/runtime/window-manager.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/runtime/window-manager.test.ts`, add a new `describe` block after the existing `describe('WindowManager', ...)` block:

```ts
describe('WindowManager.activateWindow', () => {
    it('returns true when the strip manager reports the window as managed', () => {
        const sm = fakeStripManager();
        sm.activate.mockReturnValue(true);
        const manager = new WindowManager(sm.manager);
        const win = fakeWin('w1');

        expect(manager.activateWindow(win.win)).toBe(true);
        expect(sm.activate).toHaveBeenCalledWith(win.win);
    });

    it('returns false when the strip manager reports the window as unmanaged', () => {
        const sm = fakeStripManager();
        sm.activate.mockReturnValue(false);
        const manager = new WindowManager(sm.manager);
        const win = fakeWin('w1');

        expect(manager.activateWindow(win.win)).toBe(false);
    });

    it('returns false for a null window without calling the strip manager', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager);

        expect(manager.activateWindow(null)).toBe(false);
        expect(sm.activate).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `activateWindow` currently returns `undefined`, not `true`/`false`.

- [ ] **Step 3: Write minimal implementation**

In `src/runtime/window-manager.ts`, change `activateWindow()`:

```ts
    /** Returns whether `win` was actually a Drift-managed window — used to gate the
     * focus-flash highlight to managed windows only (docs:
     * 2026-09-05-focus-flash-highlight-design). */
    activateWindow(win: WindowAdapter | null): boolean {
        if (win === null) {
            return false;
        }
        return this.stripManager.activate(win);
    }
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: `initWorkspaceSignals` gains an `onManagedWindowActivated` callback

**Files:**
- Modify: `src/runtime/workspace-signals.ts`
- Modify: `src/runtime/workspace-signals.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/runtime/workspace-signals.test.ts`, change the `fakeWorkspaceAdapter` helper's `handlers` typing so `windowActivated` can be invoked with a window argument, and add new tests. Replace the whole file's contents with:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

function fakeWorkspaceAdapter() {
    const handlers: Record<string, (win?: WindowAdapter | null) => void> = {};
    const adapter = {
        onWindowAdded: (h: () => void) => (handlers.windowAdded = h),
        onWindowRemoved: (h: () => void) => (handlers.windowRemoved = h),
        onWindowActivated: (h: (win: WindowAdapter | null) => void) => (handlers.windowActivated = h),
        onCurrentActivityChanged: (h: () => void) => (handlers.currentActivity = h),
        onCurrentDesktopChanged: (h: () => void) => (handlers.currentDesktop = h),
        onActivitiesChanged: (h: () => void) => (handlers.activities = h),
        onDesktopsChanged: (h: () => void) => (handlers.desktops = h),
        activities: () => ['a'],
        desktops: () => ['d1'],
    } as unknown as WorkspaceAdapter;
    return { adapter, handlers };
}

describe('initWorkspaceSignals', () => {
    it('re-renders the active strip when the current activity changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.currentActivity();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('re-renders the active strip when the current desktop changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.currentDesktop();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('prunes strips with the valid activity/desktop sets when activities change', () => {
        const prune = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.activities();

        expect(prune).toHaveBeenCalledWith(new Set(['a']), new Set(['d1']));
    });

    it('forwards added windows to the window manager', () => {
        const addWindow = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.windowAdded();

        expect(addWindow).toHaveBeenCalledTimes(1);
    });

    it('forwards activated windows to the window manager', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.windowActivated(win);

        expect(activateWindow).toHaveBeenCalledWith(win);
    });

    it('invokes onManagedWindowActivated when the activation was managed', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const onManagedWindowActivated = vi.fn();
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, adapter, onManagedWindowActivated);
        handlers.windowActivated(win);

        expect(onManagedWindowActivated).toHaveBeenCalledWith(win);
    });

    it('does not invoke onManagedWindowActivated when the activation was not managed', () => {
        const activateWindow = vi.fn(() => false);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const onManagedWindowActivated = vi.fn();

        initWorkspaceSignals(windowManager, stripManager, adapter, onManagedWindowActivated);
        handlers.windowActivated({} as WindowAdapter);

        expect(onManagedWindowActivated).not.toHaveBeenCalled();
    });

    it('does not throw for a null activated window or an omitted callback', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);

        expect(() => handlers.windowActivated(null)).not.toThrow();
        expect(activateWindow).toHaveBeenCalledWith(null);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `windowManager.activateWindow` is currently called with no expectations wired for a callback; the two new `onManagedWindowActivated` tests fail because `initWorkspaceSignals` doesn't accept a fourth argument yet, and never calls it.

- [ ] **Step 3: Write minimal implementation**

Replace `src/runtime/workspace-signals.ts` in full:

```ts
// Centralizes workspace signal registration. Window lifecycle signals drive the
// WindowManager; current activity/desktop changes re-render the now-active strip; and
// activity/desktop list changes prune strips whose context no longer exists.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(
    windowManager: WindowManager,
    stripManager: StripManager,
    workspaceAdapter: WorkspaceAdapter,
    onManagedWindowActivated?: (win: WindowAdapter) => void,
): void {
    workspaceAdapter.onWindowAdded((win) => windowManager.addWindow(win));
    workspaceAdapter.onWindowRemoved((win) => windowManager.removeWindow(win));
    workspaceAdapter.onWindowActivated((win) => {
        const managed = windowManager.activateWindow(win);
        if (win !== null && managed && onManagedWindowActivated) {
            onManagedWindowActivated(win);
        }
    });
    workspaceAdapter.onCurrentActivityChanged(() => stripManager.renderActive());
    workspaceAdapter.onCurrentDesktopChanged(() => stripManager.renderActive());
    workspaceAdapter.onActivitiesChanged(() => pruneStrips(stripManager, workspaceAdapter));
    workspaceAdapter.onDesktopsChanged(() => pruneStrips(stripManager, workspaceAdapter));
}

function pruneStrips(stripManager: StripManager, workspaceAdapter: WorkspaceAdapter): void {
    stripManager.prune(new Set(workspaceAdapter.activities()), new Set(workspaceAdapter.desktops()));
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: `kwin/focus-flash-overlay.ts` QML overlay + tiling exclusion

**Files:**
- Modify: `src/types/kwin.d.ts`
- Create: `src/kwin/focus-flash-overlay.ts`
- Modify: `src/kwin/window-adapter.ts`
- Modify: `src/kwin/window-adapter.test.ts`

`focus-flash-overlay.ts` itself is untestable without a live compositor, like `minimap-overlay.ts` (no unit tests for the QML-touching parts). The tiling-exclusion change it requires in `WindowAdapter.isTileable()` **is** tested, following the existing `MINIMAP_OVERLAY_WINDOW_TITLE` precedent, so this task still starts with a failing test.

- [ ] **Step 1: Write the failing test**

In `src/kwin/window-adapter.test.ts`, add an import next to the existing overlay-title ones, and a new test in the `describe('WindowAdapter.isTileable', ...)` block, right after `'rejects the minimap overlay window by title'`:

```ts
import { describe, expect, it } from 'vitest';
import { DEBUG_CONSOLE_WINDOW_TITLE } from './debug-console';
import { FOCUS_FLASH_OVERLAY_WINDOW_TITLE } from './focus-flash-overlay';
import { MINIMAP_OVERLAY_WINDOW_TITLE } from './minimap-overlay';
import { WindowAdapter } from './window-adapter';
```

```ts
    it('rejects the minimap overlay window by title', () => {
        const window = createWindow({ caption: MINIMAP_OVERLAY_WINDOW_TITLE });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects the focus flash overlay window by title', () => {
        const window = createWindow({ caption: FOCUS_FLASH_OVERLAY_WINDOW_TITLE });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `./focus-flash-overlay` does not exist yet.

- [ ] **Step 3: Add the ambient QML type**

In `src/types/kwin.d.ts`, add this next to `QmlMinimapDialog`:

```ts
/** The dynamically-created focus-flash overlay dialog: a blurred border rectangle flashed
 * around a window's live frame geometry (docs: 2026-09-05-focus-flash-highlight-design). */
interface QmlFocusFlashDialog extends QmlObject {
    borderWidth: number;
    blurRadius: number;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    visible: boolean;
}
```

- [ ] **Step 4: Create the overlay module**

Create `src/kwin/focus-flash-overlay.ts`:

```ts
// A blurred border rectangle flashed around a window whenever Drift detects and handles
// a focus change of a managed window (docs: 2026-09-05-focus-flash-highlight-design).
// Built via `Qt.createQmlObject`, the same pattern as `minimap-overlay.ts`.

import { flashOpacity } from '../ui/focus-flash';
import { createQmlTimer } from './qml-timer';
import type { WindowAdapter } from './window-adapter';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const FOCUS_FLASH_OVERLAY_WINDOW_TITLE = 'Drift Focus Flash';

const FOCUS_FLASH_QML = `import QtQuick 6.0
import QtQuick.Effects
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
PlasmaCore.Dialog {
    id: dialog
    property real borderWidth: 4
    property real blurRadius: 24
    title: "${FOCUS_FLASH_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Item {
        implicitWidth: dialog.width
        implicitHeight: dialog.height
        Item {
            id: borderSource
            anchors.fill: parent
            anchors.margins: dialog.blurRadius
            visible: false
            Rectangle {
                anchors.fill: parent
                color: "transparent"
                border.color: Kirigami.Theme.highlightColor
                border.width: dialog.borderWidth
            }
        }
        MultiEffect {
            anchors.fill: borderSource
            source: borderSource
            blurEnabled: true
            blur: 1.0
            blurMax: dialog.blurRadius
        }
        Rectangle {
            anchors.fill: borderSource
            color: "transparent"
            border.color: Kirigami.Theme.highlightColor
            border.width: dialog.borderWidth
        }
    }
}`;

export interface FocusFlashOverlay {
    show(win: WindowAdapter): void;
}

/** `tickMs` reuses the viewport's own animation clock interval (`settings.animationTickMs`)
 * so the flash tracks a simultaneous reveal-pan animation smoothly. `enabled` is fixed at
 * construction time, same as every other setting here — Drift settings all take effect on
 * restart, not live. */
export function createFocusFlashOverlay(
    parent: QmlObject,
    tickMs: number,
    borderWidth: number,
    blurRadius: number,
    durationMs: number,
    enabled: boolean,
): FocusFlashOverlay {
    const dialog = Qt.createQmlObject(FOCUS_FLASH_QML, parent) as QmlFocusFlashDialog;
    dialog.borderWidth = borderWidth;
    dialog.blurRadius = blurRadius;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    return {
        show(win: WindowAdapter): void {
            if (!enabled) {
                return;
            }
            startedAt = Date.now();
            dialog.visible = true;
            timer.start(tickMs, () => {
                const elapsed = Date.now() - startedAt;
                try {
                    const frame = win.frameGeometry();
                    dialog.x = Math.round(frame.x - blurRadius);
                    dialog.y = Math.round(frame.y - blurRadius);
                    dialog.width = Math.round(frame.width + blurRadius * 2);
                    dialog.height = Math.round(frame.height + blurRadius * 2);
                    dialog.opacity = flashOpacity(elapsed, durationMs);
                } catch (error) {
                    // The window can be closed mid-flash — never let that take down the timer.
                    void error;
                    timer.stop();
                    dialog.visible = false;
                    return;
                }
                if (elapsed >= durationMs) {
                    timer.stop();
                    dialog.visible = false;
                }
            });
        },
    };
}
```

- [ ] **Step 5: Exclude the overlay window from tiling**

In `src/kwin/window-adapter.ts`, add the import and extend `isTileable()`:

```ts
import { Rect } from '../core/coordinates';
import { DEBUG_CONSOLE_WINDOW_TITLE } from './debug-console';
import { FOCUS_FLASH_OVERLAY_WINDOW_TITLE } from './focus-flash-overlay';
import { MINIMAP_OVERLAY_WINDOW_TITLE } from './minimap-overlay';

export class WindowAdapter {
    constructor(private readonly window: Window) {}

    get id(): string {
        return this.window.internalId;
    }

    get caption(): string {
        return this.window.caption;
    }

    icon(): QIcon {
        return this.window.icon;
    }

    /** A normal, non-transient, non-fullscreen window that Drift should tile. */
    isTileable(): boolean {
        return (
            this.window.normalWindow &&
            !this.window.transient &&
            !this.window.modal &&
            this.window.managed &&
            this.window.pid > -1 &&
            this.window.resizeable &&
            !this.window.fullScreen &&
            !this.window.skipTaskbar &&
            !this.window.onScreenDisplay &&
            !this.window.deleted &&
            this.window.caption !== DEBUG_CONSOLE_WINDOW_TITLE &&
            this.window.caption !== MINIMAP_OVERLAY_WINDOW_TITLE &&
            this.window.caption !== FOCUS_FLASH_OVERLAY_WINDOW_TITLE
        );
    }
```

(Only the new `FOCUS_FLASH_OVERLAY_WINDOW_TITLE` import and the new `this.window.caption !== FOCUS_FLASH_OVERLAY_WINDOW_TITLE` condition are additions — `constructor` through `icon()` and the rest of `isTileable()` already exist exactly as shown.)

- [ ] **Step 6: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 6: Settings — `src/config/settings.ts`

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/config/settings.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/config/settings.test.ts`, add new tests inside the existing `describe('DEFAULT_SETTINGS', ...)` block:

```ts
    it('enables the focus flash by default', () => {
        expect(DEFAULT_SETTINGS.focusFlashEnabled).toBe(true);
    });

    it('defaults the focus flash border width to 4px and blur radius to 24px', () => {
        expect(DEFAULT_SETTINGS.focusFlashBorderWidth).toBe(4);
        expect(DEFAULT_SETTINGS.focusFlashBlurRadius).toBe(24);
    });

    it('defaults the focus flash duration to 300ms', () => {
        expect(DEFAULT_SETTINGS.focusFlashDurationMs).toBe(300);
    });
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `DEFAULT_SETTINGS.focusFlashEnabled`/`focusFlashBorderWidth`/`focusFlashBlurRadius`/`focusFlashDurationMs` don't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/config/settings.ts`, add four fields to the `Settings` interface, right after the existing `minimapShowThumbnails` field:

```ts
    /** Whether the minimap's column boxes show a live preview of each window's content
     * (docs: 2026-09-01-minimap-thumbnails-design). Off falls back to icon-only, as before. */
    minimapShowThumbnails: boolean;
    /** Whether the focus-flash highlight is shown at all (docs:
     * 2026-09-05-focus-flash-highlight-design). */
    focusFlashEnabled: boolean;
    /** Width of the focus-flash highlight's border, in pixels. */
    focusFlashBorderWidth: number;
    /** Blur radius of the focus-flash highlight, in pixels. */
    focusFlashBlurRadius: number;
    /** Total duration of the focus-flash fade-in-then-fade-out, in milliseconds. */
    focusFlashDurationMs: number;
}
```

(The `minimapShowThumbnails` field and its doc comment already exist unchanged — only the four `focusFlash*` fields after it are additions.)

Add the matching defaults to `DEFAULT_SETTINGS`, right after `minimapShowThumbnails: true,`:

```ts
    minimapShowThumbnails: true,
    focusFlashEnabled: true,
    focusFlashBorderWidth: 4,
    focusFlashBlurRadius: 24,
    focusFlashDurationMs: 300,
};
```

Add the matching reads to `loadSettings()`'s `Object.assign(...)` call, right after `minimapShowThumbnails: readBooleanConfig(...)`:

```ts
        minimapShowThumbnails: readBooleanConfig('minimapShowThumbnails', DEFAULT_SETTINGS.minimapShowThumbnails),
        focusFlashEnabled: readBooleanConfig('focusFlashEnabled', DEFAULT_SETTINGS.focusFlashEnabled),
        focusFlashBorderWidth: readNumberConfig('focusFlashBorderWidth', DEFAULT_SETTINGS.focusFlashBorderWidth),
        focusFlashBlurRadius: readNumberConfig('focusFlashBlurRadius', DEFAULT_SETTINGS.focusFlashBlurRadius),
        focusFlashDurationMs: readNumberConfig('focusFlashDurationMs', DEFAULT_SETTINGS.focusFlashDurationMs),
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 7: Config schema and KCM UI

**Files:**
- Modify: `drift/contents/config/main.xml`
- Modify: `drift/contents/ui/config.ui`

Neither file is covered by `npm test`; both are validated with `xmllint --noout`, following the exact precedent set in [`docs/agents/plans/2026-08-31-settings-dialog.md`](2026-08-31-settings-dialog.md).

- [ ] **Step 1: Add the four KConfigXT entries**

In `drift/contents/config/main.xml`, add four new `<entry>` elements right after the existing `minimapShowThumbnails` entry:

```xml
        <entry name="minimapShowThumbnails" type="Bool">
            <default>true</default>
        </entry>
        <entry name="focusFlashEnabled" type="Bool">
            <default>true</default>
        </entry>
        <entry name="focusFlashBorderWidth" type="UInt">
            <default>4</default>
        </entry>
        <entry name="focusFlashBlurRadius" type="UInt">
            <default>24</default>
        </entry>
        <entry name="focusFlashDurationMs" type="UInt">
            <default>300</default>
        </entry>
```

- [ ] **Step 2: Validate the schema**

```
xmllint --noout drift/contents/config/main.xml
```

Expected: no output, exit code 0.

- [ ] **Step 3: Add the KCM widgets**

In `drift/contents/ui/config.ui`, add four new rows to `formLayout_animation` (the **Animation** tab), right after the existing `row="6"` (`kcfg_columnDragDwellMs`) items and before the closing `</layout>` of that tab:

```xml
                            <item row="6" column="1">
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
                            <item row="7" column="1">
                                <widget class="QCheckBox" name="kcfg_focusFlashEnabled">
                                    <property name="toolTip">
                                        <string>Flash a blurred border around a window whenever Drift handles its focus change</string>
                                    </property>
                                    <property name="text">
                                        <string>Flash the focused window's border</string>
                                    </property>
                                    <property name="checked">
                                        <bool>true</bool>
                                    </property>
                                </widget>
                            </item>
                            <item row="8" column="0">
                                <widget class="QLabel" name="label_focusFlashBorderWidth">
                                    <property name="text">
                                        <string>Focus flash border width:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="8" column="1">
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
                            <item row="9" column="0">
                                <widget class="QLabel" name="label_focusFlashBlurRadius">
                                    <property name="text">
                                        <string>Focus flash blur radius:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="9" column="1">
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
                            <item row="10" column="0">
                                <widget class="QLabel" name="label_focusFlashDurationMs">
                                    <property name="text">
                                        <string>Focus flash duration:</string>
                                    </property>
                                </widget>
                            </item>
                            <item row="10" column="1">
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
                        </layout>
                    </widget>
```

(Only the four new `item row="7"`–`row="10"` blocks are additions — the `row="6"` block and the closing `</layout></widget>` already exist exactly as shown, and anchor where the new rows are inserted.)

- [ ] **Step 4: Validate the UI file**

```
xmllint --noout drift/contents/ui/config.ui
```

Expected: no output, exit code 0.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (every `kcfg_<name>` widget name matches its `main.xml` entry name from Step 1)
- [ ] Language-specific guidelines are followed
- [ ] Task-level verification commands from the plan executed and passing (`xmllint --noout` above, both files)
- [ ] Any convention violations fixed before moving to next task

---

## Task 8: Wire the overlay into `Controller`

**Files:**
- Modify: `src/runtime/controller.ts`

`Controller` has no test file (untestable KWin/QML wiring, same as its existing `debugConsole`/`minimapOverlay` construction), so this task is verified by typecheck/build plus the manual test in Task 9, not a unit test.

- [ ] **Step 1: Add the import and field**

```ts
import type { Settings } from '../config/settings';
import { createDebugConsole, type DebugConsole } from '../kwin/debug-console';
import { createFocusFlashOverlay, type FocusFlashOverlay } from '../kwin/focus-flash-overlay';
import { createMinimapOverlay, type MinimapOverlay } from '../kwin/minimap-overlay';
import { createQmlTimer } from '../kwin/qml-timer';
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { registerShortcuts } from '../input/shortcuts';
import type { StripStack } from './strip-stack';
import { StripManager } from './strip-manager';
import { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';
```

```ts
export class Controller {
    private readonly workspaceAdapter = new WorkspaceAdapter();
    private readonly stripManager: StripManager;
    private readonly windowManager: WindowManager;
    private readonly debugConsole: DebugConsole;
    private readonly minimapOverlay: MinimapOverlay;
    private readonly focusFlashOverlay: FocusFlashOverlay;

    constructor(
        private readonly root: QmlObject,
        private readonly settings: Settings,
        private readonly scriptUiDirUrl: string,
    ) {
        const area = this.workspaceAdapter.combinedGeometry();
        // Create the debug console before the animation timer, matching the original init() order.
        this.debugConsole = createDebugConsole(root);
        this.minimapOverlay = createMinimapOverlay(root, settings.minimapAutoHideMs, settings.minimapShowThumbnails);
        this.focusFlashOverlay = createFocusFlashOverlay(
            root,
            settings.animationTickMs,
            settings.focusFlashBorderWidth,
            settings.focusFlashBlurRadius,
            settings.focusFlashDurationMs,
            settings.focusFlashEnabled,
        );
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager);
    }
```

- [ ] **Step 2: Pass the callback to `initWorkspaceSignals`**

```ts
    start(): void {
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter, (win) =>
            this.focusFlashOverlay.show(win),
        );
        registerShortcuts(this.root, this.settings, {
```

(Only the `initWorkspaceSignals(...)` call itself changes — everything from `registerShortcuts(...)` onward in `start()` is unchanged.)

- [ ] **Step 3: Verify nothing broke**

`npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 9: Manual verification in a live KWin session

None of the QML rendering in Task 5/8 can be exercised by `npm test` (per `docs/development.md`, `kwin/` is untestable without a live compositor). This task is the real verification of the feature and must be done by a human or an agent with terminal access to a running Plasma 6 session — it cannot be completed by static analysis alone.

**Files:** none (verification only).

- [ ] **Step 1: Build and install**

```
make install
```

Expected: builds cleanly and installs/upgrades the KWin script.

- [ ] **Step 2: Restart KWin and enable the script**

```
make restart-kwin
make enable
```

Confirm "Drift" is enabled under System Settings → Window Management → KWin Scripts if `make enable` doesn't confirm it directly.

- [ ] **Step 3: Verify the flash triggers on every activation source**

Open at least 2 real windows so they're tiled into columns. Confirm a blurred border briefly flashes around the newly-focused window's real on-screen position for each of:
- A Drift shortcut (`Meta+Left`/`Meta+Right`).
- A mouse click on the other window.
- Alt-Tab (KWin's own window switcher).
- Clicking the other window's taskbar entry.

- [ ] **Step 4: Verify the flash shape and timing**

Confirm the border fades in, peaks, then fades out smoothly (no hard cut, no hold at full brightness), finishing in roughly `focusFlashDurationMs` (default 300ms).

- [ ] **Step 5: Verify it tracks a reveal-pan**

Arrange enough columns that a `Meta+Right` past the last visible column triggers a reveal-pan. Confirm the flash's border visibly follows the window as it slides into view, rather than staying at its pre-pan position.

- [ ] **Step 6: Verify unmanaged windows never flash**

Open a window Drift leaves unmanaged (e.g. one assigned to all activities, if activities are in use, or a dialog), focus it, and confirm no flash appears.

- [ ] **Step 7: Verify the overlay window itself is never tiled**

Confirm the focus-flash overlay never appears as a tiled column itself (it should stay a floating, click-through OSD, per Task 5's `isTileable()` exclusion).

- [ ] **Step 8: Verify the enable/disable and numeric settings**

Open the Drift KCM (System Settings → Window Management → KWin Scripts → Drift → configure), and on the **Animation** tab:
- Uncheck "Flash the focused window's border", restart KWin, and confirm no flash occurs on any focus change.
- Re-enable it, set a much larger border width and blur radius (e.g. 12px / 50px) and a longer duration (e.g. 1000ms), restart KWin, and confirm the flash visibly reflects the new values.

- [ ] **Step 9: Record the outcome**

Note the result of Steps 3–8 (pass/fail per bullet) back to the user.

---

## Self-Review Notes

- **Spec coverage:** trigger scope (any managed-window activation) — Tasks 2–4, 8; pure fade-in/fade-out envelope — Task 1; live position tracking during a reveal-pan — Task 5, verified in Task 9 Step 5; restart-abandons-previous-flash behavior — Task 5 (`startedAt`/`timer.start` reset on every `show()` call); fixed system-theme color — Task 5 (`Kirigami.Theme.highlightColor`); four `focusFlash*` settings, enable/disable gating — Tasks 6–8, verified in Task 9 Step 8; excluding the overlay from tiling — Task 5.
- **Placeholder scan:** no TBD/placeholder steps remain; every code block is complete and copy-pasteable.
- **Type consistency:** `flashOpacity(elapsedMs, durationMs)` (Task 1) is the exact signature called in `kwin/focus-flash-overlay.ts` (Task 5); `StripManager.activate(win): boolean` (Task 2) is what `WindowManager.activateWindow(win): boolean` (Task 3) calls and returns directly; `initWorkspaceSignals(..., onManagedWindowActivated?: (win: WindowAdapter) => void)` (Task 4) matches the arrow function passed in `Controller.start()` (Task 8); `FocusFlashOverlay.show(win: WindowAdapter): void` (Task 5) is the exact shape `Controller` calls (Task 8); `createFocusFlashOverlay`'s 6 positional parameters (Task 5) match the 6 arguments passed at its call site (Task 8) in the same order.
