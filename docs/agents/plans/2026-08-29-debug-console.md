# Debug Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an on-screen (top-left OSD) debug console that any module can append lines to via a `debug(...args)` function, toggled with `Meta+Shift+D`.

**Architecture:** A pure, unit-tested ring-buffer module (`src/debug.ts`) exposes `debug()`/`setDebugSink()` with no KWin dependency. A KWin-glue module (`src/kwin/debug-console.ts`, untested, same pattern as `qml-timer.ts`/`shortcuts.ts`) creates a `Rectangle`+`Text` QML overlay via `Qt.createQmlObject` and wires it as the sink. `main.ts` creates the console once during `init()` and wires a new shortcut action to toggle it.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

**Design spec:** `docs/agents/specs/2026-08-29-debug-console-design.md` — read before implementing

---

### Task 1: `src/debug.ts` — pure ring-buffer + sink

**Files:**
- Create: `src/debug.ts`
- Test: `src/debug.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
// src/debug.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { debug, setDebugSink } from './debug';

describe('debug', () => {
    beforeEach(() => {
        setDebugSink(null);
    });

    it('does nothing observable when no sink is attached', () => {
        expect(() => debug('hello')).not.toThrow();
    });

    it('sends a single string arg as-is to the sink', () => {
        const received: string[] = [];
        debug('before sink attached');
        setDebugSink((text) => received.push(text));
        expect(received).toEqual(['before sink attached']);
    });

    it('replays the current buffer immediately when a sink attaches', () => {
        const received: string[] = [];
        debug('first');
        debug('second');
        setDebugSink((text) => received.push(text));
        expect(received).toEqual(['first\nsecond']);
    });

    it('joins multiple args with a space', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        debug('value:', 42);
        expect(received[received.length - 1]).toBe('value: 42');
    });

    it('JSON.stringifies non-string args', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        debug({ a: 1 });
        expect(received[received.length - 1]).toBe('{"a":1}');
    });

    it('appends each call as a new line', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        debug('line 1');
        debug('line 2');
        expect(received[received.length - 1]).toBe('line 1\nline 2');
    });

    it('drops the oldest line once more than 50 lines are buffered', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        for (let i = 1; i <= 51; i++) {
            debug('line ' + i);
        }
        const lastText = received[received.length - 1];
        const lines = lastText.split('\n');
        expect(lines.length).toBe(50);
        expect(lines[0]).toBe('line 2');
        expect(lines[lines.length - 1]).toBe('line 51');
    });

    it('setDebugSink(null) detaches the sink', () => {
        const received: string[] = [];
        setDebugSink((text) => received.push(text));
        setDebugSink(null);
        debug('should not be received');
        expect(received).toEqual([]);
    });
});
```

- [x] **Step 2: Run tests to verify they fail**

`npm test`
Expected: FAIL — `src/debug.ts` does not exist yet.

- [x] **Step 3: Write the implementation**

```ts
// src/debug.ts
// A console.log-like debug channel: any module can call `debug(...)` without
// knowing where the output ends up. `setDebugSink` wires it to a renderer
// (e.g. the OSD overlay in kwin/debug-console.ts) — see docs §(debug console).

export type DebugSink = (text: string) => void;

const MAX_LINES = 50;

let sink: DebugSink | null = null;
const lines: string[] = [];

export function setDebugSink(newSink: DebugSink | null): void {
    sink = newSink;
    if (sink !== null) {
        sink(lines.join('\n'));
    }
}

export function debug(...args: unknown[]): void {
    lines.push(formatArgs(args));
    if (lines.length > MAX_LINES) {
        lines.shift();
    }
    if (sink !== null) {
        sink(lines.join('\n'));
    }
}

function formatArgs(args: unknown[]): string {
    return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}
```

- [x] **Step 4: Run tests to verify they pass**

`npm test`
Expected: PASS (all `src/debug.test.ts` cases green, plus the existing suite unaffected).

- [x] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Naming: `camelCase` functions (`debug`, `setDebugSink`, `formatArgs`), `PascalCase` type (`DebugSink`), `UPPER_SNAKE_CASE` constant (`MAX_LINES`) — matches project rules
- [x] No KWin dependency introduced in this file (pure module, per design spec)
- [x] `npm run typecheck` passes
- [x] `npm test` passes (run directly, not piped through `tail`/`head`)
- [x] Any convention violations fixed before moving to next task

---

### Task 2: `types/kwin.d.ts` — `QmlDebugOverlay` type

**Files:**
- Modify: `src/types/kwin.d.ts` (add new interface near `QmlTimer`/`QmlShortcutHandler`)

- [x] **Step 1: Add the interface**

Add this directly after the existing `QmlShortcutHandler` interface (do not remove or reorder existing interfaces):

```ts
/** The dynamically-created debug console overlay (`Rectangle` root, docs §debug console). */
interface QmlDebugOverlay extends QmlObject {
    lines: string;
    visible: boolean;
}
```

- [x] **Step 2: Verify**

`npm run typecheck`
Expected: PASS — this is a pure ambient type addition, nothing references it yet.

- [x] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Interface named `PascalCase`, properties `camelCase` — matches project rules
- [x] Placed alongside the other `Qml*` interfaces, consistent with existing file organization
- [x] `npm run typecheck` passes
- [x] Any convention violations fixed before moving to next task

---

### Task 3: `src/kwin/debug-console.ts` — QML overlay glue

**Files:**
- Create: `src/kwin/debug-console.ts`

(No test file — untested glue, matching `src/kwin/qml-timer.ts` and `src/input/shortcuts.ts`, both of which have no test files, per the design spec.)

- [x] **Step 1: Write the implementation**

```ts
// src/kwin/debug-console.ts
// A top-left OSD overlay showing the accumulated `debug()` log (src/debug.ts).
// Built via `Qt.createQmlObject`, the same pattern as `qml-timer.ts`/`shortcuts.ts` —
// declarativescript has no static QML in this file tree for dynamically-parented
// runtime objects (docs §6.2).

import { setDebugSink } from '../debug';

const CONSOLE_QML = `import QtQuick 6.0
Rectangle {
    id: root
    property string lines: ""
    z: 1000
    anchors.left: parent.left
    anchors.leftMargin: 20
    anchors.top: parent.top
    anchors.topMargin: 20
    radius: 5
    color: Qt.rgba(0, 0, 0, 0.7)
    visible: false
    width: label.paintedWidth + 30
    height: label.paintedHeight + 30
    Text {
        id: label
        anchors.centerIn: parent
        text: root.lines
        color: "#ffffff"
        font.family: "monospace"
        font.pixelSize: 13
    }
}`;

export interface DebugConsole {
    toggle(): void;
}

export function createDebugConsole(parent: QmlObject): DebugConsole {
    const overlay = Qt.createQmlObject(CONSOLE_QML, parent) as QmlDebugOverlay;
    setDebugSink((text) => {
        overlay.lines = text;
    });
    return {
        toggle(): void {
            overlay.visible = !overlay.visible;
        },
    };
}
```

- [x] **Step 2: Verify**

`npm run typecheck` and `npm run lint`
Expected: PASS. (`Qt.createQmlObject` return type is `QmlObject`; the `as QmlDebugOverlay` cast matches the existing cast style in `qml-timer.ts`/`shortcuts.ts`.)

- [x] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] Lowercase kebab-case filename (`debug-console.ts`), `camelCase` function/variable names, `PascalCase` interface — matches project rules
- [x] KWin API access confined to `kwin/` adapter module — matches project rules
- [x] `npm run typecheck` passes
- [x] `npm run lint` passes
- [x] Any convention violations fixed before moving to next task

---

### Task 4: Wire the toggle shortcut and console creation

**Files:**
- Modify: `src/input/shortcuts.ts`
- Modify: `src/main.ts`

- [x] **Step 1: Extend `ShortcutActions` and register the new shortcut**

In `src/input/shortcuts.ts`, change:

```ts
export interface ShortcutActions {
    focusLeft(): void;
    focusRight(): void;
}

export function registerShortcuts(parent: QmlObject, actions: ShortcutActions): void {
    createShortcut(parent, 'DriftFocusLeft', 'Drift: Focus Column Left', 'Meta+A', actions.focusLeft);
    createShortcut(parent, 'DriftFocusRight', 'Drift: Focus Column Right', 'Meta+D', actions.focusRight);
}
```

to:

```ts
export interface ShortcutActions {
    focusLeft(): void;
    focusRight(): void;
    toggleDebugConsole(): void;
}

export function registerShortcuts(parent: QmlObject, actions: ShortcutActions): void {
    createShortcut(parent, 'DriftFocusLeft', 'Drift: Focus Column Left', 'Meta+A', actions.focusLeft);
    createShortcut(parent, 'DriftFocusRight', 'Drift: Focus Column Right', 'Meta+D', actions.focusRight);
    createShortcut(
        parent,
        'DriftToggleDebugConsole',
        'Drift: Toggle Debug Console',
        'Meta+Shift+D',
        actions.toggleDebugConsole,
    );
}
```

Leave `createShortcut` itself unchanged.

- [x] **Step 2: Wire it up in `main.ts`**

In `src/main.ts`, add the import next to the other adapter imports:

```ts
import { createDebugConsole } from './kwin/debug-console';
```

Create the console early in `init()` (right after `geometrySync` is constructed, before `windowsByColumn`/`disconnectByColumn` — exact placement doesn't matter functionally, but keep it near the other one-time setup calls):

```ts
    const geometrySync = new GeometrySync(area);
    const debugConsole = createDebugConsole(root);
    const windowsByColumn = new Map<number, WindowAdapter>();
```

Update the `registerShortcuts` call to add the new action:

```ts
    registerShortcuts(root, {
        focusLeft: () => {
            grid.focusLeft();
            revealFocused();
        },
        focusRight: () => {
            grid.focusRight();
            revealFocused();
        },
        toggleDebugConsole: () => {
            debugConsole.toggle();
        },
    });
```

- [x] **Step 3: Verify**

`npm run typecheck`, `npm test`, `npm run lint`, `npm run build`
Expected: all PASS. No existing test should reference `ShortcutActions` directly (it's only glue), so the interface extension should not break any test file — confirm with `npm test` output.

- [x] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] Conventions file read: `docs/coding-conventions.md`
- [x] `camelCase` for the new method/action (`toggleDebugConsole`) — matches project rules
- [x] No KWin API access added outside `kwin/`/`input/` adapter modules — matches project rules
- [x] `npm run typecheck` passes
- [x] `npm test` passes
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [x] Any convention violations fixed before moving to next task

---

### Task 5: Full-suite verification and package install

**Files:** none (verification only)

- [x] **Step 1: Run the full quality gate**

```
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: all four PASS, with no output truncated (do not pipe through `tail`/`head` — read full output).

- [x] **Step 2: Confirm no stray formatting drift**

`git status --short` and `git diff --stat`
Expected: only the files listed in Tasks 1–4 are modified (per repo memory, a background process has occasionally reformatted an unrelated `{}` into `{ }` in whichever file was most recently touched — catch and revert any such stray change here).

- [x] **Step 3: Reinstall the package for live testing**

`npm run package:install`
Expected: succeeds (installs or upgrades the KWin script package).

- [x] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [x] All four quality-gate commands re-confirmed passing in this task's own terminal output (not reused from an earlier task)
- [x] `git status --short` shows only expected files
- [x] Manual live verification noted as pending a login-cycle (per repo memory on declarativescript reload constraints) — not blocking commit, but flag to the user
