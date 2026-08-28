// Drift entry point. `init` is the single exported boot function the QML host calls
// (docs §6.2), receiving the QML root as the parent for runtime QML objects (the
// animation `Timer` and shortcut handlers). Everything below is integration wiring
// over the tested pure modules (core/, viewport/) and the KWin adapters (docs §8).

import { DEFAULT_SETTINGS } from './config/settings';
import { Grid } from './core/grid';
import { registerShortcuts } from './input/shortcuts';
import { GeometrySync } from './kwin/geometry-sync';
import { createQmlTimer } from './kwin/qml-timer';
import { WindowAdapter } from './kwin/window-adapter';
import { WorkspaceAdapter } from './kwin/workspace-adapter';
import { Animator } from './viewport/animator';
import { Viewport } from './viewport/viewport';

export function init(root: QmlObject): void {
    const settings = DEFAULT_SETTINGS;
    const workspaceAdapter = new WorkspaceAdapter();
    const area = workspaceAdapter.combinedGeometry();

    const grid = new Grid(area.height, settings.columnGap);
    const viewport = new Viewport(area.width);
    const geometrySync = new GeometrySync(area);
    const windowsByColumn = new Map<number, WindowAdapter>();

    const animator = new Animator(
        createQmlTimer(root),
        () => Date.now(),
        settings.animationTickMs,
        (offset) => {
            viewport.scrollTo(offset);
            render();
        },
    );

    function render(): void {
        viewport.setContentWidth(grid.virtualWidth());
        for (const column of grid.columns()) {
            const win = windowsByColumn.get(column.id);
            if (win) {
                geometrySync.apply(win, grid.columnRect(column.id), viewport.offset());
            }
        }
    }

    function revealFocused(): void {
        const focused = grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const rect = grid.columnRect(focused.id);
        animator.animate(viewport.offset(), viewport.offsetToReveal(rect.x, rect.width), settings.animationDurationMs);
    }

    function columnOf(windowId: string): number | null {
        for (const [columnId, win] of windowsByColumn) {
            if (win.id === windowId) {
                return columnId;
            }
        }
        return null;
    }

    workspaceAdapter.onWindowAdded((win) => {
        if (!win.isTileable()) {
            return;
        }
        const column = grid.addColumn(settings.defaultColumnWidth);
        windowsByColumn.set(column.id, win);
        render();
        revealFocused();
    });

    workspaceAdapter.onWindowRemoved((win) => {
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        windowsByColumn.delete(columnId);
        grid.removeColumn(columnId);
        render();
        revealFocused();
    });

    workspaceAdapter.onWindowActivated((win) => {
        if (win === null) {
            return;
        }
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        grid.setFocus(columnId);
        revealFocused();
    });

    registerShortcuts(root, {
        focusLeft: () => {
            grid.focusLeft();
            revealFocused();
        },
        focusRight: () => {
            grid.focusRight();
            revealFocused();
        },
    });

    console.log('Drift: initialized');
}
