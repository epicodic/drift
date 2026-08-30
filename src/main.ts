// Drift entry point. `init` is the single exported boot function the QML host calls
// (docs §6.2), receiving the QML root as the parent for runtime QML objects (the
// animation `Timer` and shortcut handlers). Everything below is integration wiring
// over the tested pure modules (core/, viewport/) and the KWin adapters (docs §8).

import { loadSettings } from './config/settings';
import { rectsEqualRounded, resizedEdge, Rect } from './core/coordinates';
import { formatDebugState, WindowDebugRow } from './core/debug-format';
import { Grid } from './core/grid';
import { setDebugState } from './debug';
import { registerDragReorder } from './input/drag';
import { registerShortcuts } from './input/shortcuts';
import { createDebugConsole } from './kwin/debug-console';
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
    const debugConsole = createDebugConsole(root);
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
        setDebugState(formatDebugState(debugRows(), debugCamera(), grid.debugState()));
    }

    function debugRows(): WindowDebugRow[] {
        return grid.columns().map((column) => {
            const win = windowsByColumn.get(column.id);
            return {
                id: win?.id ?? '(none)',
                title: win?.caption ?? '',
                columnId: column.id,
                virtual: grid.columnRect(column.id),
                real: win?.frameGeometry() ?? { x: 0, y: 0, width: 0, height: 0 },
            };
        });
    }

    function debugCamera() {
        return {
            offset: viewport.offset(),
            viewportWidth: viewport.viewportWidth(),
            contentLeft: viewport.contentLeft(),
            contentWidth: viewport.contentWidth(),
        };
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
        const disconnectGeometry = win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal));
        const disconnectDrag = registerDragReorder(win, column.id, {
            grid,
            viewport,
            workspaceAdapter,
            area,
            render,
        });
        disconnectByColumn.set(column.id, () => {
            disconnectGeometry();
            disconnectDrag();
        });
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
        toggleDebugConsole: () => {
            debugConsole.toggle();
        },
    });

    console.log('Drift: initialized');
}
