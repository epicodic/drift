# Popup/Dialog Pinning to Parent Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a dialog/popup visually anchored to its tiled parent window whenever the parent's position changes for any Drift-internal reason (strip scroll, column resize, neighbor push, park/unpark).

**Architecture:** A new `TransientLinks` registry tracks the native KWin `transientFor` parent/child graph by window id. It's populated on every `windowAdded`/`windowRemoved` (independent of whether `WindowManager` tiles the window), and consulted from `onWindowGeometryChanged` whenever a *tiled* window's frame geometry changes: the position delta is replayed onto every floating transient descendant, recursively, skipping any descendant currently under interactive move/resize. Ported from Karousel's `ClientWrapper`/`ClientManager` mechanism (`_playground/karousel/src/lib/world/`). See `docs/agents/specs/2026-09-13-popup-pinning-design.md` for the full design and rationale.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Spec:** `docs/agents/specs/2026-09-13-popup-pinning-design.md` — read before implementing

---

## Task 1: KWin `transientFor` type + `WindowAdapter` accessors

**Files:**
- Modify: `drift/src/types/kwin.d.ts:54`
- Modify: `drift/src/kwin/window-adapter.ts:77-80`
- Modify: `drift/src/kwin/window-adapter.test.ts:7-42,106-112`
- Test: `drift/src/kwin/window-adapter.test.ts`

- [x] **Step 1: Write the failing tests**

Add `transientFor: null,` to the `createWindow()` fixture defaults (`window-adapter.test.ts:7-42`), right after the `transient: false,` line:

```ts
        transient: false,
        transientFor: null,
        fullScreen: false,
```

Add two new `describe` blocks right after the existing `describe('WindowAdapter.isFullScreen', ...)` block (after line 112):

```ts
describe('WindowAdapter.isTransient', () => {
    it('reflects the window transient property', () => {
        const window = createWindow({ transient: true });

        expect(new WindowAdapter(window).isTransient()).toBe(true);
    });

    it('is false for a normal window', () => {
        const window = createWindow({ transient: false });

        expect(new WindowAdapter(window).isTransient()).toBe(false);
    });
});

describe('WindowAdapter.transientFor', () => {
    it('returns null when the window has no transientFor', () => {
        const window = createWindow({ transientFor: null });

        expect(new WindowAdapter(window).transientFor()).toBeNull();
    });

    it('wraps the underlying transientFor window in a WindowAdapter', () => {
        const parent = createWindow({ internalId: 'parent-1' });
        const window = createWindow({ transientFor: parent });

        const result = new WindowAdapter(window).transientFor();

        expect(result).not.toBeNull();
        expect(result?.id).toBe('parent-1');
    });
});
```

- [x] **Step 2: Run tests to verify they fail**

`npm test -- window-adapter.test.ts`
Expected: FAIL — `transient` is not declared on `Window` yet (`transientFor: null` is a type error in the fixture), and `isTransient`/`transientFor` don't exist on `WindowAdapter`.

- [x] **Step 3: Add `transientFor` to the KWin type declaration**

In `drift/src/types/kwin.d.ts`, right after line 54 (`readonly transient: boolean;`):

```ts
    readonly transient: boolean;
    readonly transientFor: Window | null;
    readonly fullScreen: boolean;
```

- [x] **Step 4: Add the two accessors to `WindowAdapter`**

In `drift/src/kwin/window-adapter.ts`, right after `isFullScreen()` (lines 77-79):

```ts
    isFullScreen(): boolean {
        return this.window.fullScreen;
    }

    isTransient(): boolean {
        return this.window.transient;
    }

    transientFor(): WindowAdapter | null {
        return this.window.transientFor === null ? null : new WindowAdapter(this.window.transientFor);
    }
```

- [x] **Step 5: Run tests to verify they pass**

`npm test -- window-adapter.test.ts`
Expected: PASS

- [x] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules (`camelCase` methods, `PascalCase` types)
- [x] Language-specific guidelines followed (4-space indent, single quotes)
- [x] `npm test -- window-adapter.test.ts` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 2: `TransientLinks` registry

**Files:**
- Create: `drift/src/runtime/transient-links.ts`
- Test: `drift/src/runtime/transient-links.test.ts`

- [x] **Step 1: Write the failing tests**

Create `drift/src/runtime/transient-links.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import { TransientLinks } from './transient-links';

function fakeWindow(
    id: string,
    frame: Rect,
    transientForId: string | null,
    overrides: { interactiveMove?: boolean; interactiveResize?: boolean } = {},
): WindowAdapter {
    const win = {
        id,
        isTransient: () => transientForId !== null,
        transientFor: () => (transientForId === null ? null : ({ id: transientForId } as WindowAdapter)),
        frameGeometry: () => frame,
        setFrameGeometry: vi.fn((rect: Rect) => {
            frame.x = rect.x;
            frame.y = rect.y;
            frame.width = rect.width;
            frame.height = rect.height;
        }),
        isInteractiveMove: () => overrides.interactiveMove ?? false,
        isInteractiveResize: () => overrides.interactiveResize ?? false,
    };
    return win as unknown as WindowAdapter;
}

describe('TransientLinks', () => {
    it('does nothing for a window with no transientFor', () => {
        const links = new TransientLinks();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 100, height: 100 }, null);

        links.link(win);
        links.moveChildren('w1', 10, 10);
        // No error, nothing to assert on the window itself: link() is a no-op for non-transients.
    });

    it('moves a direct child by the parent-supplied delta', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        links.link(parent);
        links.link(child);

        links.moveChildren('parent', 30, -20);

        expect(child.setFrameGeometry).toHaveBeenCalledWith({ x: 130, y: 80, width: 200, height: 100 });
    });

    it('recurses into nested transients (a dialog of a dialog)', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        const grandchild = fakeWindow('grandchild', { x: 120, y: 120, width: 100, height: 50 }, 'child');
        links.link(parent);
        links.link(child);
        links.link(grandchild);

        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).toHaveBeenCalledWith({ x: 105, y: 105, width: 200, height: 100 });
        expect(grandchild.setFrameGeometry).toHaveBeenCalledWith({ x: 125, y: 125, width: 100, height: 50 });
    });

    it('skips a child under interactive move, but still recurses into its own children', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent', {
            interactiveMove: true,
        });
        const grandchild = fakeWindow('grandchild', { x: 120, y: 120, width: 100, height: 50 }, 'child');
        links.link(parent);
        links.link(child);
        links.link(grandchild);

        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).not.toHaveBeenCalled();
        expect(grandchild.setFrameGeometry).toHaveBeenCalledWith({ x: 125, y: 125, width: 100, height: 50 });
    });

    it('skips a child under interactive resize', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent', {
            interactiveResize: true,
        });
        links.link(parent);
        links.link(child);

        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('orphans a removed parent transient rather than reparenting its children', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        const grandchild = fakeWindow('grandchild', { x: 120, y: 120, width: 100, height: 50 }, 'child');
        links.link(parent);
        links.link(child);
        links.link(grandchild);

        links.unlink(child);
        links.moveChildren('parent', 5, 5);
        links.moveChildren('child', 5, 5);

        expect(grandchild.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('stops moving a child after it is unlinked', () => {
        const links = new TransientLinks();
        const parent = fakeWindow('parent', { x: 0, y: 0, width: 800, height: 600 }, null);
        const child = fakeWindow('child', { x: 100, y: 100, width: 200, height: 100 }, 'parent');
        links.link(parent);
        links.link(child);

        links.unlink(child);
        links.moveChildren('parent', 5, 5);

        expect(child.setFrameGeometry).not.toHaveBeenCalled();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

`npm test -- transient-links.test.ts`
Expected: FAIL — `./transient-links` doesn't exist yet.

- [x] **Step 3: Implement `TransientLinks`**

Create `drift/src/runtime/transient-links.ts`:

```ts
// Tracks the native KWin transientFor parent/child graph by window id (Drift constructs a
// fresh WindowAdapter per signal rather than keeping one persistent wrapper per window, unlike
// Karousel's ClientWrapper, which is why this is id-keyed rather than object-graph-keyed).
// Ported from Karousel's ClientWrapper/ClientManager (_playground/karousel/src/lib/world/) —
// see docs/agents/specs/2026-09-13-popup-pinning-design.md.

import type { WindowAdapter } from '../kwin/window-adapter';

export class TransientLinks {
    private readonly handles = new Map<string, WindowAdapter>();
    private readonly childrenOf = new Map<string, string[]>();
    private readonly parentOf = new Map<string, string>();

    /** Registers `win` as a transient child of its `transientFor` parent, if any. A no-op for
     * a non-transient window or one whose transientFor can't be resolved. Called for every
     * window on add, regardless of whether Drift tiles it. */
    link(win: WindowAdapter): void {
        if (!win.isTransient()) {
            return;
        }
        const parent = win.transientFor();
        if (parent === null) {
            return;
        }
        this.handles.set(win.id, win);
        this.handles.set(parent.id, parent);
        this.parentOf.set(win.id, parent.id);
        const siblings = this.childrenOf.get(parent.id) ?? [];
        siblings.push(win.id);
        this.childrenOf.set(parent.id, siblings);
    }

    /** Removes `win` from the graph. Its own children are orphaned (not reparented to its
     * parent), matching Karousel's ClientWrapper.destroy(). */
    unlink(win: WindowAdapter): void {
        const parentId = this.parentOf.get(win.id);
        if (parentId !== undefined) {
            const siblings = this.childrenOf.get(parentId);
            if (siblings !== undefined) {
                this.childrenOf.set(
                    parentId,
                    siblings.filter((id) => id !== win.id),
                );
            }
            this.parentOf.delete(win.id);
        }
        for (const childId of this.childrenOf.get(win.id) ?? []) {
            this.parentOf.delete(childId);
        }
        this.childrenOf.delete(win.id);
        this.handles.delete(win.id);
    }

    /** Shifts every descendant of `parentId` by `(dx, dy)`, recursively. A descendant under
     * interactive move/resize is skipped for this call (but its own descendants still move),
     * so Drift's follow-delta never fights a user actively dragging a popup themselves. */
    moveChildren(parentId: string, dx: number, dy: number): void {
        for (const childId of this.childrenOf.get(parentId) ?? []) {
            const child = this.handles.get(childId);
            if (child === undefined) {
                continue;
            }
            if (!child.isInteractiveMove() && !child.isInteractiveResize()) {
                const frame = child.frameGeometry();
                child.setFrameGeometry({ x: frame.x + dx, y: frame.y + dy, width: frame.width, height: frame.height });
            }
            this.moveChildren(childId, dx, dy);
        }
    }
}
```

- [x] **Step 4: Run tests to verify they pass**

`npm test -- transient-links.test.ts`
Expected: PASS

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules
- [x] Language-specific guidelines followed
- [x] `npm test -- transient-links.test.ts` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 3: Wire `moveTransients` into `onWindowGeometryChanged`

**Files:**
- Modify: `drift/src/runtime/window-events.ts:17-61`
- Modify: `drift/src/runtime/window-events.test.ts:25-44,144-151`
- Test: `drift/src/runtime/window-events.test.ts`

- [x] **Step 1: Write the failing tests**

In `window-events.test.ts`, add `moveTransients: vi.fn(),` to `fakeDeps()`'s returned object (anywhere in the object literal, e.g. right after `isEcho: () => false,`):

```ts
        isEcho: () => false,
        moveTransients: vi.fn(),
        resizeColumn: vi.fn(),
```

Add two new tests right after the `"ignores an echo of Drift's own geometry write"` test (after line 151, before `'ignores geometry changes for an unknown or hidden column'`):

```ts
    it('follows transient children by the position delta even for an otherwise-ignored pure move', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 50, y: 10, width: 800, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.moveTransients).toHaveBeenCalledWith('w1', 50, 10);
    });

    it('follows transient children even when the geometry change is an echo of its own write', () => {
        const deps = fakeDeps({ isEcho: () => true });
        const win = fakeWindow('w1', { x: 50, y: 10, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.moveTransients).toHaveBeenCalledWith('w1', 50, 10);
        expect(deps.resizeColumn).not.toHaveBeenCalled();
    });
```

- [x] **Step 2: Run test to verify it fails**

`npm test -- window-events.test.ts`
Expected: FAIL — `WindowEventDeps` has no `moveTransients` member yet, and `onWindowGeometryChanged` never calls it.

- [x] **Step 3: Add `moveTransients` to `WindowEventDeps` and call it**

In `drift/src/runtime/window-events.ts`, add to the `WindowEventDeps` interface, right after `isEcho`:

```ts
    isEcho(windowId: string, rect: Rect): boolean;
    /** Shifts every transient descendant (dialog/popup) of `windowId` by `(dx, dy)` — called
     * for every real geometry change of a tiled window, including an echo of Drift's own write
     * or a pure move that's otherwise a no-op for this function, since a popup still needs to
     * follow its parent in both of those cases (docs: 2026-09-13-popup-pinning-design). */
    moveTransients(windowId: string, dx: number, dy: number): void;
```

In `onWindowGeometryChanged`, insert the call right after the `rectsEqualRounded` early return and before the `isEcho` check:

```ts
    const newReal = win.frameGeometry();
    if (rectsEqualRounded(oldReal, newReal)) {
        return;
    }
    deps.moveTransients(win.id, Math.round(newReal.x - oldReal.x), Math.round(newReal.y - oldReal.y));
    if (deps.isEcho(win.id, newReal)) {
        return;
    }
```

- [x] **Step 4: Run tests to verify they pass**

`npm test -- window-events.test.ts`
Expected: PASS

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules
- [x] Language-specific guidelines followed
- [x] `npm test -- window-events.test.ts` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 4: Thread `TransientLinks` through `Strip` → `StripStack` → `StripManager`

This is pure constructor-injection plumbing (glue code). Every new parameter is added with a
default value so no existing call site in `strip.test.ts`, `strip-stack.test.ts`, or
`strip-manager.test.ts` needs to change — consistent with this codebase's existing convention of
leaving thin wiring untested directly (verified here by `npm run build` and Task 9's manual
testing), the same way `drag.ts`'s own wiring is documented as untested glue.

**Files:**
- Modify: `drift/src/runtime/strip.ts:95-116,965-970`
- Modify: `drift/src/runtime/strip-stack.ts:24,38-45,267-274`
- Modify: `drift/src/runtime/strip-manager.ts` (constructor + `StripStackFactory` + `stack()`)

- [x] **Step 1: `Strip` takes and uses a `TransientLinks`**

In `drift/src/runtime/strip.ts`, add the import (alongside the other `./`-relative imports near the top of the file):

```ts
import { TransientLinks } from './transient-links';
```

Change the constructor (lines 95-100) to add a defaulted 5th parameter:

```ts
    constructor(
        area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly transientLinks: TransientLinks = new TransientLinks(),
    ) {
```

In `eventDeps()` (around line 965-970), add the `moveTransients` entry:

```ts
    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            tileOf: (windowId) => this.registry.tileOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            moveTransients: (windowId, dx, dy) => this.transientLinks.moveChildren(windowId, dx, dy),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
```

- [x] **Step 2: `StripStack` threads it through to `Strip`**

In `drift/src/runtime/strip-stack.ts`, add the import:

```ts
import { TransientLinks } from './transient-links';
```

Change the `StripFactory` type (line 24) to accept it as a 5th parameter:

```ts
export type StripFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
) => Strip;
```

Change the constructor (lines 38-45) to add a defaulted `transientLinks` param after `createStrip`, and thread it through the default factory:

```ts
    constructor(
        private area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (area, settings, timer, workspaceAdapter, transientLinks) =>
            new Strip(area, settings, timer, workspaceAdapter, transientLinks),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
    ) {
```

Change `strip()` (lines 267-274) to pass it:

```ts
    private strip(index: number): Strip {
        let strip = this.strips.get(index);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.ticker.subscribe(), this.workspaceAdapter, this.transientLinks);
            this.strips.set(index, strip);
        }
        return strip;
    }
```

- [x] **Step 3: `StripManager` threads it through to `StripStack`**

In `drift/src/runtime/strip-manager.ts`, add the import:

```ts
import { TransientLinks } from './transient-links';
```

Change the `StripStackFactory` type to accept it as a 5th parameter:

```ts
export type StripStackFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
) => StripStack;
```

Change the constructor to add a defaulted `transientLinks` param after `createStripStack`, and thread it through the default factory:

```ts
    constructor(
        private area: Rect,
        private readonly settings: Settings,
        private readonly timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStripStack: StripStackFactory = (area, settings, timer, workspaceAdapter, transientLinks) =>
            new StripStack(area, settings, timer, workspaceAdapter, undefined, transientLinks),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
    ) {}
```

Change `stack()` to pass it:

```ts
    private stack(key: string): StripStack {
        let stack = this.stacks.get(key);
        if (stack === undefined) {
            stack = this.createStripStack(this.area, this.settings, this.timer, this.workspaceAdapter, this.transientLinks);
            this.stacks.set(key, stack);
        }
        return stack;
    }
```

Note the `undefined` passed for `StripStack`'s own `createStrip` parameter above — it's the
parameter *before* `transientLinks` in `StripStack`'s constructor (Task 4, Step 2), and passing
`undefined` explicitly triggers `StripStack`'s own default there while still supplying the
`transientLinks` argument that follows it.

- [x] **Step 4: Verify the build type-checks**

`npm run build`
Expected: no TypeScript errors. `strip.test.ts`, `strip-stack.test.ts`, and `strip-manager.test.ts` are unaffected (all existing calls to `new Strip(...)`, `new StripStack(...)`, `new StripManager(...)`, and every hand-written `StripFactory`/`StripStackFactory` test double keep compiling because every new parameter is optional).

- [x] **Step 5: Run the full JS/TS test suite**

`npm test`
Expected: PASS — no existing test needed to change for this task.

- [x] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules
- [x] Language-specific guidelines followed
- [x] `npm run build` and `npm test` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 5: `popupPinningEnabled` setting

**Files:**
- Modify: `drift/src/config/settings.ts:133`
- Modify: `drift/src/config/settings-definitions.ts:173`

- [x] **Step 1: Add the field to the `Settings` interface**

In `drift/src/config/settings.ts`, right after the `dragPanEnabled` field (line 133):

```ts
    dragPanEnabled: boolean;
    /** Whether a dialog/popup follows its tiled parent window's on-screen position (strip
     * scroll, column resize, park/unpark) instead of being left behind (docs:
     * 2026-09-13-popup-pinning-design). `false` fully restores pre-feature behavior: popups are
     * never touched by Drift. */
    popupPinningEnabled: boolean;
```

- [x] **Step 2: Add the definition entry**

In `drift/src/config/settings-definitions.ts`, right after the `dragPanFreeDwellMs` entry (line 176):

```ts
    { name: 'dragPanFreeDwellMs', type: 'UInt', default: 400 },
    { name: 'popupPinningEnabled', type: 'Bool', default: true },
```

- [x] **Step 3: Verify the build**

`npm run build`
Expected: no TypeScript errors — `DEFAULT_SETTINGS` and `loadSettings()` in `settings.ts` derive
from `SETTINGS_DEFINITIONS` automatically, so no other code in that file needs to change.

- [x] **Step 4: Run the full JS/TS test suite**

`npm test`
Expected: PASS

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules
- [x] Language-specific guidelines followed
- [x] `npm run build` and `npm test` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 6: KCM checkbox

**Files:**
- Modify: `drift/ui/config.ui:581-584`

- [x] **Step 1: Add a new groupbox with the checkbox**

In `drift/ui/config.ui`, `tab_behavior`'s outer `verticalLayout_behavior` closes at line 584
right after the drag-pan groupbox's `</item>` (line 583). Insert a new sibling `<item>`
containing its own small groupbox, right before that `</layout>` (line 584):

```xml
                                    </layout>
                                </widget>
                            </item>
                            <item>
                                <widget class="QGroupBox" name="groupBox_popups">
                                    <property name="title">
                                        <string>Popups</string>
                                    </property>
                                    <layout class="QFormLayout" name="formLayout_popups">
                                        <item row="0" column="1">
                                            <widget class="QCheckBox" name="kcfg_popupPinningEnabled">
                                                <property name="toolTip">
                                                    <string>A dialog or popup follows its tiled parent window's on-screen position instead of being left behind</string>
                                                </property>
                                                <property name="text">
                                                    <string>Keep popups pinned to their parent window</string>
                                                </property>
                                                <property name="checked">
                                                    <bool>true</bool>
                                                </property>
                                            </widget>
                                        </item>
                                    </layout>
                                </widget>
                            </item>
                        </layout>
                    </widget>
```

(This replaces the original three lines — `</layout>`, `</widget>`, `</item>`, `</layout>`,
`</widget>` sequence around 581-585 — with the block above, which re-closes the drag-pan
groupbox/item exactly as before and then adds the new groupbox/item before closing
`verticalLayout_behavior`/`tab_behavior`.)

- [x] **Step 2: Verify the build**

`make build`
Expected: builds successfully; no `qmllint`/UI validation errors.

- [x] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming/indentation matches the surrounding `config.ui` style (4-space indent preserved)
- [x] `make build` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 7: Wire `link`/`unlink` into `initWorkspaceSignals`

**Files:**
- Modify: `drift/src/runtime/workspace-signals.ts` (entire file)
- Modify: `drift/src/runtime/workspace-signals.test.ts` (entire file)
- Test: `drift/src/runtime/workspace-signals.test.ts`

- [x] **Step 1: Write the failing tests**

Replace the full contents of `drift/src/runtime/workspace-signals.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { TransientLinks } from './transient-links';
import type { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

function fakeWorkspaceAdapter() {
    const handlers: Record<string, (win?: WindowAdapter | null) => void> = {};
    const adapter = {
        onWindowAdded: (h: () => void) => (handlers.windowAdded = h),
        onWindowRemoved: (h: () => void) => (handlers.windowRemoved = h),
        onWindowActivated: (h: (win?: WindowAdapter | null) => void) => (handlers.windowActivated = h),
        onCurrentActivityChanged: (h: () => void) => (handlers.currentActivity = h),
        onCurrentDesktopChanged: (h: () => void) => (handlers.currentDesktop = h),
        onActivitiesChanged: (h: () => void) => (handlers.activities = h),
        onDesktopsChanged: (h: () => void) => (handlers.desktops = h),
        activities: () => ['a'],
        desktops: () => ['d1'],
    } as unknown as WorkspaceAdapter;
    return { adapter, handlers };
}

function fakeTransientLinks() {
    return { link: vi.fn(), unlink: vi.fn() } as unknown as TransientLinks;
}

describe('initWorkspaceSignals', () => {
    it('re-renders the active strip when the current activity changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.currentActivity();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('re-renders the active strip when the current desktop changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.currentDesktop();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('prunes strips with the valid activity/desktop sets when activities change', () => {
        const prune = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.activities();

        expect(prune).toHaveBeenCalledWith(new Set(['a']), new Set(['d1']));
    });

    it('forwards added windows to the window manager', () => {
        const addWindow = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.windowAdded();

        expect(addWindow).toHaveBeenCalledTimes(1);
    });

    it('forwards activated windows to the window manager', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
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

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter, onManagedWindowActivated);
        handlers.windowActivated(win);

        expect(onManagedWindowActivated).toHaveBeenCalledWith(win);
    });

    it('does not invoke onManagedWindowActivated when the activation was not managed', () => {
        const activateWindow = vi.fn(() => false);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const onManagedWindowActivated = vi.fn();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter, onManagedWindowActivated);
        handlers.windowActivated({} as WindowAdapter);

        expect(onManagedWindowActivated).not.toHaveBeenCalled();
    });

    it('does not throw for a null activated window or an omitted callback', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);

        expect(() => handlers.windowActivated(null)).not.toThrow();
        expect(activateWindow).toHaveBeenCalledWith(null);
    });

    it('links an added window when popup pinning is enabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const link = vi.fn();
        const transientLinks = { link, unlink: vi.fn() } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, true, adapter);
        handlers.windowAdded(win);

        expect(link).toHaveBeenCalledWith(win);
    });

    it('does not link an added window when popup pinning is disabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const link = vi.fn();
        const transientLinks = { link, unlink: vi.fn() } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, false, adapter);
        handlers.windowAdded(win);

        expect(link).not.toHaveBeenCalled();
    });

    it('unlinks a removed window when popup pinning is enabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), removeWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const unlink = vi.fn();
        const transientLinks = { link: vi.fn(), unlink } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, true, adapter);
        handlers.windowRemoved(win);

        expect(unlink).toHaveBeenCalledWith(win);
    });

    it('does not unlink a removed window when popup pinning is disabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), removeWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const unlink = vi.fn();
        const transientLinks = { link: vi.fn(), unlink } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, false, adapter);
        handlers.windowRemoved(win);

        expect(unlink).not.toHaveBeenCalled();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

`npm test -- workspace-signals.test.ts`
Expected: FAIL — `initWorkspaceSignals` doesn't accept `transientLinks`/`popupPinningEnabled` yet.

- [x] **Step 3: Implement**

Replace the full contents of `drift/src/runtime/workspace-signals.ts`:

```ts
// Centralizes workspace signal registration. Window lifecycle signals drive the
// WindowManager; current activity/desktop changes re-render the now-active strip; and
// activity/desktop list changes prune strips whose context no longer exists.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { TransientLinks } from './transient-links';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(
    windowManager: WindowManager,
    stripManager: StripManager,
    transientLinks: TransientLinks,
    popupPinningEnabled: boolean,
    workspaceAdapter: WorkspaceAdapter,
    onManagedWindowActivated?: (win: WindowAdapter) => void,
): void {
    workspaceAdapter.onWindowAdded((win) => {
        windowManager.addWindow(win);
        if (popupPinningEnabled) {
            transientLinks.link(win);
        }
    });
    workspaceAdapter.onWindowRemoved((win) => {
        windowManager.removeWindow(win);
        if (popupPinningEnabled) {
            transientLinks.unlink(win);
        }
    });
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

- [x] **Step 4: Run tests to verify they pass**

`npm test -- workspace-signals.test.ts`
Expected: PASS

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules
- [x] Language-specific guidelines followed
- [x] `npm test -- workspace-signals.test.ts` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 8: Wire it up in `Controller`

**Files:**
- Modify: `drift/src/runtime/controller.ts`

- [x] **Step 1: Add the import and field**

Add the import near the other `./`-relative runtime imports:

```ts
import { StripManager } from './strip-manager';
import { TransientLinks } from './transient-links';
import { WindowManager } from './window-manager';
```

Add a new private field alongside `stripManager`/`windowManager`:

```ts
    private readonly stripManager: StripManager;
    private readonly windowManager: WindowManager;
    private readonly transientLinks: TransientLinks;
```

- [x] **Step 2: Construct it and thread it into `StripManager`**

Change:

```ts
        this.stripManager = new StripManager(this.area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager, settings);
```

to:

```ts
        this.transientLinks = new TransientLinks();
        this.stripManager = new StripManager(
            this.area,
            settings,
            createQmlTimer(root),
            this.workspaceAdapter,
            undefined,
            this.transientLinks,
        );
        this.windowManager = new WindowManager(this.stripManager, settings);
```

(The `undefined` is `StripManager`'s own `createStripStack` factory parameter, which precedes
`transientLinks` — passing `undefined` there keeps `StripManager`'s default factory while still
supplying an explicit `transientLinks`, per Task 4 Step 3's note.)

- [x] **Step 3: Pass it (and the setting) to `initWorkspaceSignals`**

Change:

```ts
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter, (win) =>
            this.focusFlashOverlay.show(win),
        );
```

to:

```ts
        initWorkspaceSignals(
            this.windowManager,
            this.stripManager,
            this.transientLinks,
            this.settings.popupPinningEnabled,
            this.workspaceAdapter,
            (win) => this.focusFlashOverlay.show(win),
        );
```

- [x] **Step 4: Verify the build**

`npm run build`
Expected: no TypeScript errors.

- [x] **Step 5: Run the full JS/TS test suite**

`npm test`
Expected: PASS

- [x] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming conventions match project rules
- [x] Language-specific guidelines followed
- [x] `npm run build` and `npm test` passing
- [x] Any convention violations fixed before moving to next task

---

## Task 9: Full verification

**Files:** none (verification only)

- [x] **Step 1: Full lint**

`make lint`
Expected: PASS — JS/TS/QML checks including `qmllint`, no errors from `config.ui`'s new checkbox.

- [x] **Step 2: Full build**

`make build`
Expected: PASS — package assembled into `.build/drift`.

- [x] **Step 3: Full test suite**

`make test`
Expected: PASS — all JS/TS tests, including every test added in Tasks 1–3 and 7.

- [ ] **Step 4: Manual/live testing (requires a live KDE Plasma/KWin session — not performed by an agent; see note below)**

Per the spec's Testing section (no fixture exists for real transient windows in KWin scripting):

1. Enable Drift in KWin Scripts with the built package, restart KWin (or disable/re-enable the script).
2. Open a tiled app that spawns dialogs (e.g. a file manager's "Properties" dialog, or a text editor's "Find/Replace").
3. Open the dialog, then scroll the strip (focus another column) — confirm the dialog tracks its parent.
4. Resize a neighboring column so the parent window's column resizes — confirm the dialog still tracks.
5. Switch to another strip (row navigation) and back — confirm the dialog parks off-screen with its parent and reappears in sync.
6. Drag the dialog itself — confirm Drift's follow-logic doesn't fight the drag.
7. In Drift's KCM settings (Behavior tab → Popups), uncheck "Keep popups pinned to their parent window", restart KWin, and repeat step 3 — confirm the dialog is left behind exactly as it was before this feature (today's behavior).

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] Conventions file read: `docs/coding-conventions.md`
- [ ] `make lint`, `make build`, `make test` all passing
- [ ] Manual testing steps above completed and confirmed working
- [ ] Any issues found fixed before considering the plan complete
