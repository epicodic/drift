// Drift entry point. `init` is the single exported boot function the QML host calls
// (docs §6.2), receiving the QML root as the parent for runtime QML objects (the
// animation `Timer` and shortcut handlers). Everything below is integration wiring
// over the tested pure modules (core/, viewport/) and the KWin adapters (docs §8).

import { loadSettings } from './config/settings';
import { rectsEqualRounded, resizedEdge, Rect } from './core/coordinates';
import { Grid } from './core/grid';
import { registerShortcuts } from './input/shortcuts';
import { GeometrySync } from './kwin/geometry-sync';
import { createQmlTimer } from './kwin/qml-timer';
import { WindowAdapter } from './kwin/window-adapter';
import { WorkspaceAdapter } from './kwin/workspace-adapter';
import { Animator } from './viewport/animator';
import { Viewport } from './viewport/viewport';

export function init(root: QmlObject): void {
    const settings = loadSettings();
    const workspaceAdapter = new WorkspaceAdapter();
    const area = workspaceAdapter.combinedGeometry();

    const grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
    const viewport = new Viewport(area.width);
    const geometrySync = new GeometrySync(area);
    const windowsByColumn = new Map<number, WindowAdapter>();
    const disconnectByColumn = new Map<number, () => void>();

    const animator = new Animator(
        createQmlTimer(root),
        () => Date.now(),
        settings.animationTickMs,
        (offset) => {
            viewport.scrollTo(offset);
            render();
        },
    );

    function render(excludeWindowId?: string): void {
        viewport.setContentGeometry(grid.contentLeft(), grid.virtualWidth());
        for (const column of grid.columns()) {
            const win = windowsByColumn.get(column.id);
            if (win && win.id !== excludeWindowId) {
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

    function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect): void {
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        const newReal = win.frameGeometry();
        if (rectsEqualRounded(oldReal, newReal)) {
            return;
        }
        if (geometrySync.isEcho(win.id, newReal)) {
            return;
        }
        if (Math.round(newReal.width) === Math.round(oldReal.width)) {
            return; // width-only step: ignore pure moves and height-only changes
        }
        grid.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
        render(win.isInteractiveResize() ? win.id : undefined);
    }

    workspaceAdapter.onWindowAdded((win) => {
        if (!win.isTileable()) {
            return;
        }
        const width = Math.round(win.frameGeometry().width) || settings.defaultColumnWidth;
        const column = grid.addColumn(width);
        windowsByColumn.set(column.id, win);
        disconnectByColumn.set(
            column.id,
            win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal)),
        );
        render();
        revealFocused();
    });

    workspaceAdapter.onWindowRemoved((win) => {
        const columnId = columnOf(win.id);
        if (columnId === null) {
            return;
        }
        const disconnect = disconnectByColumn.get(columnId);
        if (disconnect) {
            disconnect();
        }
        disconnectByColumn.delete(columnId);
        geometrySync.forget(win.id);
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
