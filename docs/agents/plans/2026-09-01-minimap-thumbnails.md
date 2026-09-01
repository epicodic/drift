# Minimap Live Window-Content Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live, true-aspect-ratio preview of each column's window content inside the existing minimap overlay, gated by a `minimapShowThumbnails` setting (default on), per [`docs/agents/specs/2026-09-01-minimap-thumbnails-design.md`](../specs/2026-09-01-minimap-thumbnails-design.md).

**Architecture:** `Grid` exposes its constant strip height. `WindowAdapter` exposes the raw KWin `Window` handle. `buildMinimapSnapshot` threads both through `MinimapSnapshot`/`MinimapColumn`. `minimap-overlay.ts`'s QML gains a `KWinComponents.WindowThumbnail` per column (from `import org.kde.kwin 3.0`), sized to the true window aspect ratio and clipped to the panel's fixed height rather than stretched, with the window icon moving to a small corner badge whenever thumbnails are shown. `Controller` reads the new setting once and passes it through at construction.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## Task 1: `Grid.screenHeight()`

**Files:**
- Modify: `src/core/grid.ts`
- Modify: `src/core/grid.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/core/grid.test.ts`, add a new `describe` block anywhere after the `'Grid — empty state'` block (it uses the file's existing `HEIGHT`/`GAP` constants at the top):

```ts
describe('Grid — screenHeight', () => {
    it('reports the constant height passed to the constructor', () => {
        const grid = new Grid(HEIGHT, GAP);

        expect(grid.screenHeight()).toBe(HEIGHT);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `Grid.screenHeight` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/core/grid.ts`, add a method right after `columns()` (line 30-32):

```ts
    columns(): readonly Column[] {
        return this.ordered.slice();
    }

    /** The strip's constant screen height — every column's rect uses this same value
     * (see `columnRect`), so a consumer needing the real aspect ratio without an
     * existing column (the minimap's live thumbnails) can read it directly
     * (docs: 2026-09-01-minimap-thumbnails-design). */
    screenHeight(): number {
        return this.height;
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

## Task 2: `WindowAdapter.windowHandle()`

**Files:**
- Modify: `src/kwin/window-adapter.ts`
- Modify: `src/kwin/window-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/kwin/window-adapter.test.ts`, add a new `describe` block after the existing `'WindowAdapter.icon'` block:

```ts
describe('WindowAdapter.windowHandle', () => {
    it('returns the underlying window', () => {
        const window = createWindow();

        expect(new WindowAdapter(window).windowHandle()).toBe(window);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `WindowAdapter.windowHandle` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

In `src/kwin/window-adapter.ts`, add a method right after `icon()` (line 20-22):

```ts
    icon(): QIcon {
        return this.window.icon;
    }

    /** The underlying KWin window, for binding directly to QML's
     * `WindowThumbnail.client` (docs: 2026-09-01-minimap-thumbnails-design). The only
     * place `this.window` itself — rather than a value derived from it — leaves
     * `WindowAdapter`. */
    windowHandle(): Window {
        return this.window;
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

## Task 3: Thread `thumbnail` and `gridHeight` through `MinimapSnapshot`

**Files:**
- Modify: `src/ui/minimap.ts`
- Modify: `src/ui/minimap.test.ts`

Depends on Tasks 1 and 2 (`Grid.screenHeight()`, `WindowAdapter.windowHandle()`).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/ui/minimap.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import type { WindowAdapter } from '../kwin/window-adapter';
import { ColumnRegistry } from '../runtime/column-registry';
import { SignalManager } from '../utils/signal-manager';
import { Viewport } from '../viewport/viewport';
import { buildMinimapSnapshot } from './minimap';

function fakeWindow(icon: QIcon | null, handle: Window | null = null): WindowAdapter {
    return { icon: () => icon, windowHandle: () => handle } as unknown as WindowAdapter;
}

describe('buildMinimapSnapshot', () => {
    it('reports each visible column position, width, focus, icon, and thumbnail handle', () => {
        const grid = new Grid(1000, 8);
        const first = grid.addColumn(400);
        const second = grid.addColumn(600);
        grid.setFocus(second.id);
        const registry = new ColumnRegistry();
        const icon = {} as QIcon;
        const handle = {} as Window;
        registry.set(second.id, fakeWindow(icon, handle), new SignalManager());
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, grid.virtualWidth());

        const snapshot = buildMinimapSnapshot(grid, viewport, registry);

        expect(snapshot.columns).toEqual([
            { id: first.id, x: 0, width: 400, focused: false, icon: null, thumbnail: null },
            { id: second.id, x: 408, width: 600, focused: true, icon, thumbnail: handle },
        ]);
    });

    it('omits hidden (minimized) columns', () => {
        const grid = new Grid(1000, 8);
        const visible = grid.addColumn(400);
        const hidden = grid.addColumn(300);
        grid.hideColumn(hidden.id);
        const viewport = new Viewport(1280);

        const snapshot = buildMinimapSnapshot(grid, viewport, new ColumnRegistry());

        expect(snapshot.columns).toEqual([
            { id: visible.id, x: 0, width: 400, focused: false, icon: null, thumbnail: null },
        ]);
    });

    it('reports the viewport offset, content bounds, and grid height', () => {
        const grid = new Grid(1000, 8);
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, 2000);

        const snapshot = buildMinimapSnapshot(grid, viewport, new ColumnRegistry());

        expect(snapshot.viewport).toEqual({ offset: 0, width: 1280, contentLeft: 0, contentWidth: 2000 });
        expect(snapshot.gridHeight).toBe(1000);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `MinimapColumn` has no `thumbnail` field and `MinimapSnapshot` has no `gridHeight` field yet; `fakeWindow`'s `windowHandle` is unused by the current implementation.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/ui/minimap.ts` with:

```ts
// Builds a snapshot of one strip's layout + camera for the minimap overlay
// (docs: 2026-09-01-minimap-design, 2026-09-01-minimap-thumbnails-design). Pure and
// KWin-free, mirrors debug/snapshot.ts.

import type { Grid } from '../core/grid';
import type { ColumnRegistry } from '../runtime/column-registry';
import type { Viewport } from '../viewport/viewport';

export interface MinimapColumn {
    id: number;
    x: number;
    width: number;
    focused: boolean;
    icon: QIcon | null;
    thumbnail: Window | null;
}

export interface MinimapViewport {
    offset: number;
    width: number;
    contentLeft: number;
    contentWidth: number;
}

export interface MinimapSnapshot {
    columns: MinimapColumn[];
    viewport: MinimapViewport;
    gridHeight: number;
}

export function buildMinimapSnapshot(grid: Grid, viewport: Viewport, registry: ColumnRegistry): MinimapSnapshot {
    const focusedId = grid.focusedColumn()?.id ?? null;
    const columns = grid
        .columns()
        .filter((column) => !column.hidden)
        .map((column) => {
            const rect = grid.columnRect(column.id);
            const window = registry.get(column.id);
            return {
                id: column.id,
                x: rect.x,
                width: rect.width,
                focused: column.id === focusedId,
                icon: window?.icon() ?? null,
                thumbnail: window?.windowHandle() ?? null,
            };
        });
    return {
        columns,
        viewport: {
            offset: viewport.offset(),
            width: viewport.viewportWidth(),
            contentLeft: viewport.contentLeft(),
            contentWidth: viewport.contentWidth(),
        },
        gridHeight: grid.screenHeight(),
    };
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

## Task 4: `minimapShowThumbnails` setting

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/config/settings.test.ts`
- Modify: `drift/contents/config/main.xml`
- Modify: `drift/contents/ui/config.ui`

- [ ] **Step 1: Write the failing test**

In `src/config/settings.test.ts`, add a new `it` inside the existing `describe('DEFAULT_SETTINGS', ...)` block:

```ts
    it('auto-hides the minimap after 1200ms by default', () => {
        expect(DEFAULT_SETTINGS.minimapAutoHideMs).toBe(1200);
    });

    it('shows minimap thumbnails by default', () => {
        expect(DEFAULT_SETTINGS.minimapShowThumbnails).toBe(true);
    });
});
```

(Only the new `it` block is new — it replaces the existing closing `});` of the `describe` block.)

- [ ] **Step 2: Run test to verify it fails**

`npm test`
Expected: FAIL — `minimapShowThumbnails` does not exist on `DEFAULT_SETTINGS`.

- [ ] **Step 3: Write minimal implementation**

In `src/config/settings.ts`, add the field to the `Settings` interface (after `minimapAutoHideMs`, line 32-33):

```ts
    /** How long the minimap overlay stays visible after the last focus-step press, in milliseconds. */
    minimapAutoHideMs: number;
    /** Whether the minimap's column boxes show a live preview of each window's content
     * (docs: 2026-09-01-minimap-thumbnails-design). Off falls back to icon-only, as before. */
    minimapShowThumbnails: boolean;
}
```

Add the default (after `minimapAutoHideMs: 1200,`, line 49-50):

```ts
    minimapAutoHideMs: 1200,
    minimapShowThumbnails: true,
};
```

Add it to `loadSettings()` (after the existing `minimapAutoHideMs` read, line 61):

```ts
        minimapAutoHideMs: readNumberConfig('minimapAutoHideMs', DEFAULT_SETTINGS.minimapAutoHideMs),
        minimapShowThumbnails: readBooleanConfig('minimapShowThumbnails', DEFAULT_SETTINGS.minimapShowThumbnails),
```

Add a new reader function after `readStringConfig` (end of file):

```ts
// Same rationale as readNumberConfig: never let a bad config value take down init().
function readBooleanConfig(key: string, defaultValue: boolean): boolean {
    try {
        const value = KWin.readConfig(key, defaultValue);
        return typeof value === 'boolean' ? value : defaultValue;
    } catch (error) {
        void error;
        return defaultValue;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

`npm test`
Expected: PASS

- [ ] **Step 5: Wire the KConfigXT entry**

In `drift/contents/config/main.xml`, add a new entry after `minimapAutoHideMs` (line 20-22):

```xml
        <entry name="minimapAutoHideMs" type="UInt">
            <default>1200</default>
        </entry>
        <entry name="minimapShowThumbnails" type="Bool">
            <default>true</default>
        </entry>
```

- [ ] **Step 6: Add the settings-dialog control**

In `drift/contents/ui/config.ui`, inside `tab_animation`'s `formLayout_animation`, add a new row after the existing `minimapAutoHideMs` row (i.e. right before the layout's closing `</layout>` tag that follows the `kcfg_minimapAutoHideMs` item, line 182-183):

```xml
                            <item row="2" column="1">
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
                            <item row="3" column="1">
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
```

(Only the new `<item row="3" column="1">...</item>` block is new.)

- [ ] **Step 7: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck`, `npm test`, and `npm run lint` pass
- [ ] `npm run build` succeeds (validates `config.ui`/`main.xml` are well-formed via the packaging step)
- [ ] Any convention violations fixed before moving to next task

---

## Task 5: Render `WindowThumbnail` in the overlay QML

**Files:**
- Modify: `src/types/kwin.d.ts`
- Modify: `src/kwin/minimap-overlay.ts`

Depends on Task 3 (`MinimapSnapshot.gridHeight`/`MinimapColumn.thumbnail`) and Task 4 (`minimapShowThumbnails`).
`minimap-overlay.ts` is untestable without a live compositor, like `debug-console.ts` (docs §8) — no unit test step. Verified manually in Task 7.

- [ ] **Step 1: Extend the dialog's ambient QML type**

In `src/types/kwin.d.ts`, update `QmlMinimapDialog` (currently lines 163-169):

```ts
/** The dynamically-created minimap overlay dialog. `columns`/`viewportBox` are plain
 * data (see `PanelColumn`/`PanelViewportBox` in `kwin/minimap-overlay.ts`), typed
 * loosely here since this file has no app-specific types (docs: 2026-09-01-minimap-design,
 * 2026-09-01-minimap-thumbnails-design). */
interface QmlMinimapDialog extends QmlObject {
    columns: unknown[];
    viewportBox: unknown;
    thumbnailHeight: number;
    showThumbnails: boolean;
    x: number;
    y: number;
    visible: boolean;
}
```

- [ ] **Step 2: Rewrite the overlay module**

Replace the entire contents of `src/kwin/minimap-overlay.ts` with:

```ts
// A centered OSD overlay showing the current strip's columns and viewport extent,
// shown on Meta+Tab/Meta+Shift+Tab (docs: 2026-09-01-minimap-design,
// 2026-09-01-minimap-thumbnails-design). Built via `Qt.createQmlObject`, the same
// pattern as `debug-console.ts`.

import type { Rect } from '../core/coordinates';
import type { MinimapSnapshot } from '../ui/minimap';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const MINIMAP_OVERLAY_WINDOW_TITLE = 'Drift Minimap';

const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 90;
const PANEL_MARGIN = 20;
const DIALOG_WIDTH = PANEL_WIDTH + PANEL_MARGIN * 2;
const DIALOG_HEIGHT = PANEL_HEIGHT + PANEL_MARGIN * 2;

const MINIMAP_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
import org.kde.kwin 3.0 as KWinComponents
PlasmaCore.Dialog {
    id: dialog
    property var columns: []
    property var viewportBox: ({ x: 0, width: 0 })
    property real thumbnailHeight: 0
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
        implicitWidth: ${DIALOG_WIDTH}
        implicitHeight: ${DIALOG_HEIGHT}
        Item {
            anchors.fill: parent
            anchors.margins: ${PANEL_MARGIN}
            Repeater {
                model: dialog.columns
                delegate: Rectangle {
                    x: modelData.x
                    width: Math.max(modelData.width, 2)
                    height: ${PANEL_HEIGHT}
                    radius: 4
                    color: modelData.focused ? "#3daee9" : "#5c5c5c"
                    border.color: "#ffffff"
                    border.width: modelData.focused ? 2 : 0
                    clip: true
                    KWinComponents.WindowThumbnail {
                        client: modelData.thumbnail
                        visible: dialog.showThumbnails && modelData.thumbnail !== null
                        width: parent.width
                        height: dialog.thumbnailHeight
                        anchors.verticalCenter: parent.verticalCenter
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
                }
            }
            Rectangle {
                x: dialog.viewportBox.x
                y: -6
                width: Math.max(dialog.viewportBox.width, 2)
                height: ${PANEL_HEIGHT + 12}
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

interface PanelViewportBox {
    x: number;
    width: number;
}

export interface MinimapOverlay {
    show(snapshot: MinimapSnapshot, screen: Rect): void;
}

export function createMinimapOverlay(
    parent: QmlObject,
    autoHideMs: number,
    showThumbnails: boolean,
): MinimapOverlay {
    const dialog = Qt.createQmlObject(MINIMAP_QML, parent) as QmlMinimapDialog;
    dialog.showThumbnails = showThumbnails;
    const hideTimer = createQmlTimer(parent);

    return {
        show(snapshot: MinimapSnapshot, screen: Rect): void {
            const { scale } = panelScale(snapshot);
            dialog.columns = toPanelColumns(snapshot);
            dialog.viewportBox = toPanelViewportBox(snapshot);
            dialog.thumbnailHeight = scale * snapshot.gridHeight;
            dialog.x = Math.round(screen.x + (screen.width - DIALOG_WIDTH) / 2);
            dialog.y = Math.round(screen.y + (screen.height - DIALOG_HEIGHT) / 2);
            dialog.visible = true;
            hideTimer.start(autoHideMs, () => {
                hideTimer.stop();
                dialog.visible = false;
            });
        },
    };
}

function panelScale(snapshot: MinimapSnapshot): { left: number; scale: number } {
    const { viewport } = snapshot;
    const left = Math.min(viewport.contentLeft, viewport.offset);
    const right = Math.max(viewport.contentLeft + viewport.contentWidth, viewport.offset + viewport.width);
    return { left, scale: PANEL_WIDTH / Math.max(right - left, 1) };
}

function toPanelColumns(snapshot: MinimapSnapshot): PanelColumn[] {
    const { left, scale } = panelScale(snapshot);
    return snapshot.columns.map((column) => ({
        x: (column.x - left) * scale,
        width: column.width * scale,
        focused: column.focused,
        icon: column.icon,
        thumbnail: column.thumbnail,
    }));
}

function toPanelViewportBox(snapshot: MinimapSnapshot): PanelViewportBox {
    const { left, scale } = panelScale(snapshot);
    return {
        x: (snapshot.viewport.offset - left) * scale,
        width: snapshot.viewport.width * scale,
    };
}
```

- [ ] **Step 3: Verify nothing broke**

`npm run typecheck && npm test`
Expected: PASS (no behavior change to existing tests — this file has none of its own)

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck` and `npm test` pass
- [ ] `npm run lint` passes (runs `qmllint` on `drift/contents/ui/main.qml`; the QML template string in `minimap-overlay.ts` itself is not linted by that command, so double-check it by eye against `docs/coding-conventions.md`'s QML section)
- [ ] Any convention violations fixed before moving to next task

---

## Task 6: Wire `minimapShowThumbnails` into `Controller`

**Files:**
- Modify: `src/runtime/controller.ts`

Depends on Task 4 (`Settings.minimapShowThumbnails`) and Task 5 (`createMinimapOverlay`'s new parameter).
`Controller` has no test file (untestable KWin/QML wiring, same as its existing `debugConsole` construction) — verified by typecheck/build plus the manual test in Task 7.

- [ ] **Step 1: Pass the setting through**

In `src/runtime/controller.ts`, change the `minimapOverlay` construction (line 37):

```ts
        this.minimapOverlay = createMinimapOverlay(root, settings.minimapAutoHideMs, settings.minimapShowThumbnails);
```

- [ ] **Step 2: Verify nothing broke**

`npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass
- [ ] Any convention violations fixed before moving to next task

---

## Task 7: Manual verification in a live KWin session

None of the QML rendering in Task 5 can be exercised by `npm test` (per `docs/development.md`, `kwin/` is untestable without a live compositor). This task is the real verification of the feature and must be done by a human or an agent with terminal access to a running Plasma 6 session — it cannot be completed by static analysis alone.

**Files:** none (verification only).

- [ ] **Step 1: Build and install**

```
npm run package:install
```

Expected: builds cleanly and installs/upgrades the KWin script.

- [ ] **Step 2: Restart KWin and confirm the script is enabled**

Restart KWin (e.g. log out/in, or `kwin_wayland --replace &` in an X11/nested test session) and confirm "Drift" is enabled under System Settings → Window Management → KWin Scripts.

- [ ] **Step 3: Confirm live thumbnails render**

Open at least 3 real application windows so they're tiled into columns. Press `Meta+Tab` / `Meta+Shift+Tab` repeatedly and confirm:
- Each column's box shows a live, updating preview of that window's actual content (not just a flat color/icon).
- The preview updates in near-real-time if the window's content changes while the overlay is visible (e.g. a video playing, a cursor blinking).

If `KWinComponents.WindowThumbnail` does not render (blank/black boxes, or a KWin script error in `journalctl --user -f -u plasma-kwin_wayland` — enable `QT_LOGGING_RULES=kwin_*.debug=true;js.debug=true` first per `docs/development.md`), the fallback is: in `src/kwin/minimap-overlay.ts`, remove the `KWinComponents.WindowThumbnail` item and the `import org.kde.kwin 3.0 as KWinComponents` line, and make the centered `Kirigami.Icon` unconditional again (`visible: modelData.icon !== null && parent.width > 12`, dropping `!dialog.showThumbnails &&`), removing the corner-badge `Kirigami.Icon` entirely — this reverts to the pre-Task-5 icon-only appearance. Record which outcome occurred.

- [ ] **Step 4: Confirm no distortion**

Resize one tiled window to be very narrow and another to be very wide (drag its column edge). Press `Meta+Tab` to refresh the minimap and confirm each preview shows a proportionally-correct, undistorted center-crop of the window's content — not stretched or squished vertically or horizontally.

- [ ] **Step 5: Confirm the icon badge**

With thumbnails showing, confirm each column also shows that window's icon as a small badge in the bottom-right corner (not centered).

- [ ] **Step 6: Confirm the opt-out setting**

Open the Drift KCM (System Settings → Window Management → KWin Scripts → Drift's configure button), uncheck "Show live window content in the minimap", apply, then disable and re-enable Drift under KWin Scripts (per the config form's restart notice). Press `Meta+Tab` again and confirm the minimap reverts to the original centered-icon-only appearance, with no live preview and no corner badge.

Re-enable the setting afterward so the feature is left in its default state.

- [ ] **Step 7: Confirm minimized columns are still omitted**

Minimize one of the open windows, press `Meta+Tab` again, and confirm the minimized window's column (and its thumbnail) does not appear on the minimap at all.

- [ ] **Step 8: Confirm the minimap window itself is never tiled or captured**

Confirm the overlay never appears as a tiled column, and that its own box (if somehow visible to itself) doesn't recursively show a thumbnail of the minimap — this should already hold since `WindowAdapter.isTileable()` excludes it and the overlay is `outputOnly: true`.

- [ ] **Step 9: Record the outcome**

Note the result of steps 3–8 (pass/fail per bullet) back to the user, including whether the `WindowThumbnail` fallback from Step 3 was needed.

---

## Self-Review Notes

- **Spec coverage:** every section of the addendum spec maps to a task — feasibility/QML type (Task 5), privacy/opt-out setting (Task 4, wired in Task 6), true-aspect sizing math (Task 5's `thumbnailHeight` computation, sourced from Task 1's `Grid.screenHeight()`), icon badge fallback (Task 5's dual `Kirigami.Icon` items), `WindowAdapter`/`ColumnRegistry` plumbing (Tasks 2–3), testing scope and the "verify the binding first" caution (Task 7 Steps 3's explicit fallback).
- **Placeholder scan:** no TBD/placeholder steps remain; the one open risk (`WindowThumbnail` rendering) has a concrete, fully-specified fallback in Task 7 Step 3, not left vague.
- **Type consistency:** `MinimapSnapshot.gridHeight`/`MinimapColumn.thumbnail` (Task 3) are the same names read by `minimap-overlay.ts`'s `show()`/`toPanelColumns()` (Task 5); `WindowAdapter.windowHandle()` (Task 2) is the exact method name `buildMinimapSnapshot` calls (Task 3); `createMinimapOverlay(parent, autoHideMs, showThumbnails)`'s signature (Task 5) matches its call site in `Controller` (Task 6) argument-for-argument.
