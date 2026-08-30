# Activities Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partition Drift's tiling layout by `(activity, virtualDesktop)` so windows on different Plasma activities and virtual desktops never affect each other's positions.

**Architecture:** `StripManager` becomes a lazily-populated `Map` of one `Strip` (hence one `Grid`/`Viewport`) per `(activity, desktop)` key, tracking which strip owns each window. `WindowManager` routes each window to the strip for its single activity+desktop, leaves sticky/multi-assigned windows unmanaged, and moves windows between strips when their assignment changes. Workspace switch signals re-render the now-active strip. Grids always span all screens (screen is not part of the key).

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-08-30-activities-support-design.md`

---

## File Structure

- `src/types/kwin.d.ts` — add `KwinDesktop`, window/workspace activity & desktop fields and signals (ambient declarations).
- `src/kwin/window-adapter.ts` — expose `activities()`, `desktops()`, `singleAssignment()`, and the two new signal wrappers.
- `src/kwin/window-adapter.test.ts` — extend the `Window` fake; add the `singleAssignment()` truth-table tests.
- `src/kwin/workspace-adapter.ts` — expose `currentActivity()`, `currentDesktop()`, `activities()`, `desktops()`, and the switch/list signal wrappers.
- `src/runtime/strip-manager.ts` — rewrite into a keyed map with ownership tracking, lazy creation, and pruning.
- `src/runtime/strip-manager.test.ts` — new unit tests for keying, routing, ownership, and pruning.
- `src/runtime/window-manager.ts` — router: single-assignment routing, unmanaged sticky windows, reassignment, subscription bookkeeping.
- `src/runtime/window-manager.test.ts` — new unit tests for routing and reassignment.
- `src/runtime/workspace-signals.ts` — wire the new switch/list signals to `StripManager`.
- `src/runtime/workspace-signals.test.ts` — new unit test for the wiring.
- `src/runtime/controller.ts` — pass `stripManager` into `initWorkspaceSignals`.

`Strip`, `Grid`, `Viewport`, `ColumnRegistry`, `GeometrySync`, and `Animator` are unchanged.

---

## Task 1: KWin activity/desktop types + WindowAdapter accessors

**Files:**
- Modify: `src/types/kwin.d.ts`
- Modify: `src/kwin/window-adapter.ts`
- Test: `src/kwin/window-adapter.test.ts`

- [ ] **Step 1: Add the ambient type declarations**

In `src/types/kwin.d.ts`, add a `KwinDesktop` interface (place it just after the `Output` interface):

```typescript
/** A KWin virtual desktop. `Workspace.desktops` and `Window.desktops` expose these. */
interface KwinDesktop {
    readonly id: string;
    readonly name: string;
}
```

Add these members to the `Window` interface (alongside the existing `readonly minimized` / signal members):

```typescript
    readonly activities: string[];
    readonly desktops: KwinDesktop[];
    readonly activitiesChanged: Signal<() => void>;
    readonly desktopsChanged: Signal<() => void>;
```

Add these members to the `WorkspaceApi` interface (alongside the existing `windowActivated` signal):

```typescript
    readonly currentActivity: string;
    currentDesktop: KwinDesktop;
    readonly activities: string[];
    readonly desktops: KwinDesktop[];
    readonly currentActivityChanged: Signal<() => void>;
    readonly currentDesktopChanged: Signal<() => void>;
    readonly activitiesChanged: Signal<() => void>;
    readonly desktopsChanged: Signal<() => void>;
```

- [ ] **Step 2: Extend the test `Window` fake and write the failing tests**

In `src/kwin/window-adapter.test.ts`, add these properties to the object returned by `createWindow` (before the `...overrides` spread so overrides win):

```typescript
        minimized: false,
        activities: ['activity-1'],
        desktops: [{ id: 'desktop-1', name: 'Desktop 1' }],
        activitiesChanged: { connect: () => {}, disconnect: () => {} },
        desktopsChanged: { connect: () => {}, disconnect: () => {} },
        frameGeometryChanged: { connect: () => {}, disconnect: () => {} },
```

Append this test suite to the same file:

```typescript
describe('WindowAdapter.singleAssignment', () => {
    it('returns the activity and desktop for a window on exactly one of each', () => {
        const window = createWindow({
            activities: ['a1'],
            desktops: [{ id: 'd1', name: 'Desktop 1' }],
        });

        expect(new WindowAdapter(window).singleAssignment()).toEqual({ activity: 'a1', desktop: 'd1' });
    });

    it('returns null for a window on no activity', () => {
        const window = createWindow({ activities: [], desktops: [{ id: 'd1', name: 'Desktop 1' }] });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });

    it('returns null for a window on multiple activities', () => {
        const window = createWindow({
            activities: ['a1', 'a2'],
            desktops: [{ id: 'd1', name: 'Desktop 1' }],
        });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });

    it('returns null for a window on no desktop', () => {
        const window = createWindow({ activities: ['a1'], desktops: [] });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });

    it('returns null for a window on multiple desktops', () => {
        const window = createWindow({
            activities: ['a1'],
            desktops: [
                { id: 'd1', name: 'Desktop 1' },
                { id: 'd2', name: 'Desktop 2' },
            ],
        });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

`npm test`
Expected: FAIL — `singleAssignment` is not a function on `WindowAdapter`.

- [ ] **Step 4: Implement the WindowAdapter accessors**

In `src/kwin/window-adapter.ts`, add these methods (place them after `isMinimized()`):

```typescript
    activities(): string[] {
        return this.window.activities;
    }

    desktops(): KwinDesktop[] {
        return this.window.desktops;
    }

    /** The window's single activity+desktop, or null unless it is on exactly one of each. */
    singleAssignment(): { activity: string; desktop: string } | null {
        const activities = this.window.activities;
        const desktops = this.window.desktops;
        if (activities.length !== 1 || desktops.length !== 1) {
            return null;
        }
        return { activity: activities[0], desktop: desktops[0].id };
    }

    onActivitiesChanged(handler: () => void): () => void {
        this.window.activitiesChanged.connect(handler);
        return () => this.window.activitiesChanged.disconnect(handler);
    }

    onDesktopsChanged(handler: () => void): () => void {
        this.window.desktopsChanged.connect(handler);
        return () => this.window.desktopsChanged.disconnect(handler);
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

`npm test`
Expected: PASS — all `singleAssignment` cases and the existing `isTileable` suite pass.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols (`KwinDesktop` PascalCase type; `singleAssignment`/`activities`/`desktops` camelCase methods)
- [ ] Language-specific guidelines are followed (4-space indent, 120-col limit, KWin access stays in the adapter)
- [ ] Task-level verification commands executed and passing (`npm test`, `npm run lint`)
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: WorkspaceAdapter activity/desktop accessors and signals

**Files:**
- Modify: `src/kwin/workspace-adapter.ts`

This adapter touches the live `Workspace` global and has no unit test today (documented as untestable without a compositor). Verify via typecheck/build.

- [ ] **Step 1: Add the accessors and signal wrappers**

In `src/kwin/workspace-adapter.ts`, add these methods to `WorkspaceAdapter` (place after `cursorX()`):

```typescript
    currentActivity(): string {
        return Workspace.currentActivity;
    }

    /** The id of the current virtual desktop. */
    currentDesktop(): string {
        return Workspace.currentDesktop.id;
    }

    activities(): string[] {
        return Workspace.activities;
    }

    /** The ids of all virtual desktops. */
    desktops(): string[] {
        return Workspace.desktops.map((desktop) => desktop.id);
    }

    onCurrentActivityChanged(handler: () => void): void {
        Workspace.currentActivityChanged.connect(handler);
    }

    onCurrentDesktopChanged(handler: () => void): void {
        Workspace.currentDesktopChanged.connect(handler);
    }

    onActivitiesChanged(handler: () => void): void {
        Workspace.activitiesChanged.connect(handler);
    }

    onDesktopsChanged(handler: () => void): void {
        Workspace.desktopsChanged.connect(handler);
    }
```

- [ ] **Step 2: Verify the build typechecks**

`npm run build`
Expected: PASS — no type errors; the new `Workspace` members resolve against Task 1's declarations.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (camelCase accessors and `on*` handlers)
- [ ] Language-specific guidelines are followed (all `Workspace` access confined to this adapter)
- [ ] Task-level verification commands executed and passing (`npm run build`, `npm run lint`)
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: StripManager keyed map with ownership and pruning

**Files:**
- Modify: `src/runtime/strip-manager.ts`
- Test: `src/runtime/strip-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/strip-manager.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import type { Strip } from './strip';
import { StripManager, type StripFactory } from './strip-manager';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}

function fakeWorkspaceAdapter(activity: string, desktop: string): WorkspaceAdapter {
    return {
        currentActivity: () => activity,
        currentDesktop: () => desktop,
    } as unknown as WorkspaceAdapter;
}

interface FakeStrip {
    strip: Strip;
    addWindow: ReturnType<typeof vi.fn>;
    removeWindow: ReturnType<typeof vi.fn>;
    activateWindow: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
}

function fakeStrip(): FakeStrip {
    const addWindow = vi.fn();
    const removeWindow = vi.fn();
    const activateWindow = vi.fn();
    const render = vi.fn();
    const strip = { addWindow, removeWindow, activateWindow, render } as unknown as Strip;
    return { strip, addWindow, removeWindow, activateWindow, render };
}

function recordingFactory(): { factory: StripFactory; created: FakeStrip[] } {
    const created: FakeStrip[] = [];
    const factory: StripFactory = () => {
        const fake = fakeStrip();
        created.push(fake);
        return fake.strip;
    };
    return { factory, created };
}

function fakeWin(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

function makeManager(activity = 'a', desktop = 'd1') {
    const { factory, created } = recordingFactory();
    const manager = new StripManager(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(activity, desktop), factory);
    return { manager, created };
}

describe('StripManager', () => {
    it('routes windows for different (activity, desktop) to separate strips', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        const w2 = fakeWin('w2');

        manager.addTo('a', 'd1', w1);
        manager.addTo('a', 'd2', w2);

        expect(created).toHaveLength(2);
        expect(created[0].addWindow).toHaveBeenCalledWith(w1);
        expect(created[1].addWindow).toHaveBeenCalledWith(w2);
    });

    it('reuses the same strip for the same key', () => {
        const { manager, created } = makeManager();

        manager.addTo('a', 'd1', fakeWin('w1'));
        manager.addTo('a', 'd1', fakeWin('w2'));

        expect(created).toHaveLength(1);
        expect(created[0].addWindow).toHaveBeenCalledTimes(2);
    });

    it('activeStrip follows the workspace current activity and desktop', () => {
        const { manager } = makeManager('a', 'd1');

        const active = manager.activeStrip();

        expect(manager.stripFor('a', 'd1')).toBe(active);
    });

    it('records ownership and routes removal to the owning strip', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        expect(manager.ownerOf('w1')).toBe('a|d1');

        manager.remove(w1);

        expect(created[0].removeWindow).toHaveBeenCalledWith(w1);
        expect(manager.ownerOf('w1')).toBeNull();
    });

    it('ignores removal of an unmanaged window', () => {
        const { manager, created } = makeManager();

        expect(() => manager.remove(fakeWin('ghost'))).not.toThrow();
        expect(created).toHaveLength(0);
    });

    it('routes activation to the owning strip', () => {
        const { manager, created } = makeManager();
        const w1 = fakeWin('w1');
        manager.addTo('a', 'd1', w1);

        manager.activate(w1);

        expect(created[0].activateWindow).toHaveBeenCalledWith(w1);
    });

    it('prunes strips whose activity or desktop disappeared and clears their ownership', () => {
        const { manager, created } = makeManager();
        manager.addTo('a', 'd1', fakeWin('w1'));
        manager.addTo('b', 'd1', fakeWin('w2'));
        const countBefore = created.length;

        manager.prune(new Set(['a']), new Set(['d1']));

        expect(manager.ownerOf('w1')).toBe('a|d1');
        expect(manager.ownerOf('w2')).toBeNull();

        manager.stripFor('b', 'd1');
        expect(created.length).toBe(countBefore + 1);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test`
Expected: FAIL — `StripFactory` export and `addTo`/`ownerOf`/`prune`/`stripFor`/`activate` do not exist yet.

- [ ] **Step 3: Rewrite StripManager**

Replace the entire contents of `src/runtime/strip-manager.ts` with:

```typescript
// Owns one Strip per (activity, virtualDesktop) pair and tracks which strip owns each
// window. Grids always span all screens, so screen is not part of the key. activeStrip()
// follows the workspace's current activity/desktop; strips are created lazily and pruned
// when their activity or desktop disappears.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

export type StripFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
) => Strip;

export class StripManager {
    private readonly strips = new Map<string, Strip>();
    private readonly ownerByWindow = new Map<string, string>();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        private readonly timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (area, settings, timer, workspaceAdapter) =>
            new Strip(area, settings, timer, workspaceAdapter),
    ) {}

    keyOf(activity: string, desktop: string): string {
        return `${activity}|${desktop}`;
    }

    stripFor(activity: string, desktop: string): Strip {
        return this.strip(this.keyOf(activity, desktop));
    }

    activeStrip(): Strip {
        return this.stripFor(this.workspaceAdapter.currentActivity(), this.workspaceAdapter.currentDesktop());
    }

    ownerOf(windowId: string): string | null {
        return this.ownerByWindow.get(windowId) ?? null;
    }

    addTo(activity: string, desktop: string, win: WindowAdapter): void {
        const key = this.keyOf(activity, desktop);
        this.strip(key).addWindow(win);
        this.ownerByWindow.set(win.id, key);
    }

    remove(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.strips.get(key)?.removeWindow(win);
        this.ownerByWindow.delete(win.id);
    }

    activate(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.strips.get(key)?.activateWindow(win);
    }

    renderActive(): void {
        this.activeStrip().render();
    }

    prune(validActivities: ReadonlySet<string>, validDesktops: ReadonlySet<string>): void {
        for (const key of [...this.strips.keys()]) {
            const [activity, desktop] = key.split('|');
            if (validActivities.has(activity) && validDesktops.has(desktop)) {
                continue;
            }
            this.strips.delete(key);
            for (const [windowId, owner] of [...this.ownerByWindow]) {
                if (owner === key) {
                    this.ownerByWindow.delete(windowId);
                }
            }
        }
    }

    private strip(key: string): Strip {
        let strip = this.strips.get(key);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.timer, this.workspaceAdapter);
            this.strips.set(key, strip);
        }
        return strip;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test`
Expected: PASS — the new `StripManager` suite is green and existing suites still pass.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (`StripFactory` PascalCase type; camelCase methods; `ownerByWindow` field)
- [ ] Language-specific guidelines are followed (4-space indent, 120-col limit, no KWin access)
- [ ] Task-level verification commands executed and passing (`npm test`, `npm run lint`)
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: WindowManager routing and reassignment

**Files:**
- Modify: `src/runtime/window-manager.ts`
- Test: `src/runtime/window-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/runtime/window-manager.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';
import { WindowManager } from './window-manager';

function fakeStripManager() {
    const owners = new Map<string, string>();
    const addTo = vi.fn((activity: string, desktop: string, win: WindowAdapter) =>
        owners.set(win.id, `${activity}|${desktop}`),
    );
    const remove = vi.fn((win: WindowAdapter) => owners.delete(win.id));
    const activate = vi.fn();
    const ownerOf = vi.fn((id: string) => owners.get(id) ?? null);
    const keyOf = (activity: string, desktop: string) => `${activity}|${desktop}`;
    const manager = { addTo, remove, activate, ownerOf, keyOf } as unknown as StripManager;
    return { manager, addTo, remove, activate, ownerOf };
}

interface FakeWin {
    win: WindowAdapter;
    setAssignment: (assignment: { activity: string; desktop: string } | null) => void;
    fireActivities: () => void;
    fireDesktops: () => void;
    disconnectActivities: ReturnType<typeof vi.fn>;
    disconnectDesktops: ReturnType<typeof vi.fn>;
}

function fakeWin(
    id: string,
    options: { tileable?: boolean; assignment?: { activity: string; desktop: string } | null } = {},
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
        onActivitiesChanged: (handler: () => void) => {
            activitiesHandler = handler;
            return disconnectActivities;
        },
        onDesktopsChanged: (handler: () => void) => {
            desktopsHandler = handler;
            return disconnectDesktops;
        },
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
    };
}

describe('WindowManager', () => {
    it('routes a single-assignment window to its strip', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });

        new WindowManager(sm.manager).addWindow(win.win);

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
    });

    it('leaves a sticky window unmanaged', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: null });

        new WindowManager(sm.manager).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('ignores non-tileable windows', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { tileable: false });

        new WindowManager(sm.manager).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('moves a managed window when its desktop changes', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        win.setAssignment({ activity: 'a', desktop: 'd2' });
        win.fireDesktops();

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(sm.addTo).toHaveBeenLastCalledWith('a', 'd2', win.win);
    });

    it('does nothing when the reassignment key is unchanged', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);
        sm.remove.mockClear();

        win.fireDesktops();

        expect(sm.remove).not.toHaveBeenCalled();
    });

    it('removes a managed window that becomes sticky', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        win.setAssignment(null);
        win.fireActivities();

        expect(sm.remove).toHaveBeenCalledWith(win.win);
    });

    it('adds an unmanaged window that becomes single-assignment', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: null });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        win.setAssignment({ activity: 'a', desktop: 'd1' });
        win.fireDesktops();

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
    });

    it('unsubscribes and removes on removeWindow', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        manager.removeWindow(win.win);

        expect(win.disconnectActivities).toHaveBeenCalledTimes(1);
        expect(win.disconnectDesktops).toHaveBeenCalledTimes(1);
        expect(sm.remove).toHaveBeenCalledWith(win.win);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

`npm test`
Expected: FAIL — `WindowManager` still calls `activeStrip()` and has no reassignment/subscription behavior.

- [ ] **Step 3: Rewrite WindowManager**

Replace the entire contents of `src/runtime/window-manager.ts` with:

```typescript
// Global entry point for window lifecycle events: routes each tileable window to the
// strip for its single activity+desktop, leaves sticky/multi-assigned windows unmanaged,
// and moves a window between strips when its activity/desktop assignment changes.
// Per-window activity/desktop subscriptions live here because an unmanaged window belongs
// to no strip; strip ownership itself is tracked by StripManager.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    private readonly unsubscribeByWindow = new Map<string, () => void>();

    constructor(private readonly stripManager: StripManager) {}

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
        this.place(win);
    }

    removeWindow(win: WindowAdapter): void {
        const unsubscribe = this.unsubscribeByWindow.get(win.id);
        if (unsubscribe !== undefined) {
            unsubscribe();
            this.unsubscribeByWindow.delete(win.id);
        }
        this.stripManager.remove(win);
    }

    activateWindow(win: WindowAdapter | null): void {
        if (win === null) {
            return;
        }
        this.stripManager.activate(win);
    }

    private place(win: WindowAdapter): void {
        const assignment = win.singleAssignment();
        if (assignment !== null) {
            this.stripManager.addTo(assignment.activity, assignment.desktop, win);
        }
    }

    private reassign(win: WindowAdapter): void {
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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

`npm test`
Expected: PASS — the new `WindowManager` suite is green and existing suites still pass.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (camelCase methods and `unsubscribeByWindow` field)
- [ ] Language-specific guidelines are followed (4-space indent, 120-col limit, no KWin access)
- [ ] Task-level verification commands executed and passing (`npm test`, `npm run lint`)
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: Wire workspace switch/list signals and update the Controller

**Files:**
- Modify: `src/runtime/workspace-signals.ts`
- Modify: `src/runtime/controller.ts`
- Test: `src/runtime/workspace-signals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/runtime/workspace-signals.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

function fakeWorkspaceAdapter() {
    const handlers: Record<string, () => void> = {};
    const adapter = {
        onWindowAdded: (h: () => void) => (handlers.windowAdded = h),
        onWindowRemoved: (h: () => void) => (handlers.windowRemoved = h),
        onWindowActivated: (h: () => void) => (handlers.windowActivated = h),
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

`npm test`
Expected: FAIL — `initWorkspaceSignals` currently takes two arguments and does not wire the switch/list signals.

- [ ] **Step 3: Rewrite workspace-signals**

Replace the entire contents of `src/runtime/workspace-signals.ts` with:

```typescript
// Centralizes workspace signal registration. Window lifecycle signals drive the
// WindowManager; current activity/desktop changes re-render the now-active strip; and
// activity/desktop list changes prune strips whose context no longer exists.

import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(
    windowManager: WindowManager,
    stripManager: StripManager,
    workspaceAdapter: WorkspaceAdapter,
): void {
    workspaceAdapter.onWindowAdded((win) => windowManager.addWindow(win));
    workspaceAdapter.onWindowRemoved((win) => windowManager.removeWindow(win));
    workspaceAdapter.onWindowActivated((win) => windowManager.activateWindow(win));
    workspaceAdapter.onCurrentActivityChanged(() => stripManager.renderActive());
    workspaceAdapter.onCurrentDesktopChanged(() => stripManager.renderActive());
    workspaceAdapter.onActivitiesChanged(() => pruneStrips(stripManager, workspaceAdapter));
    workspaceAdapter.onDesktopsChanged(() => pruneStrips(stripManager, workspaceAdapter));
}

function pruneStrips(stripManager: StripManager, workspaceAdapter: WorkspaceAdapter): void {
    stripManager.prune(new Set(workspaceAdapter.activities()), new Set(workspaceAdapter.desktops()));
}
```

- [ ] **Step 4: Update the Controller call site**

In `src/runtime/controller.ts`, change the `initWorkspaceSignals` call in `start()` to pass the strip manager:

```typescript
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter);
```

- [ ] **Step 5: Run the test to verify it passes**

`npm test`
Expected: PASS — the `initWorkspaceSignals` suite is green and existing suites still pass.

- [ ] **Step 6: Full build and lint**

`npm run build && npm run lint`
Expected: PASS — no type errors and no lint failures across TypeScript/QML.

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules (camelCase `pruneStrips` helper)
- [ ] Language-specific guidelines are followed (4-space indent, 120-col limit, no KWin access outside adapters)
- [ ] Task-level verification commands executed and passing (`npm test`, `npm run build`, `npm run lint`)
- [ ] Any convention violations fixed before moving to next task

---

## Final Verification

- [ ] `npm test` — all suites pass
- [ ] `npm run build` — typechecks and bundles
- [ ] `npm run lint` — JavaScript/TypeScript/QML checks pass
