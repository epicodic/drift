// One scrollable tiling surface: owns its Grid (layout), Viewport (camera), Animator
// (scroll animation), GeometrySync (virtual->real writes), and ColumnRegistry (window
// bookkeeping). Absorbs the render(), revealFocused(), and per-window lifecycle logic
// that used to live in main.ts's init(). Only runtime/ and main.ts do this wiring.

import type { Rect } from '../core/coordinates';
import { formatDebugState } from '../core/debug-format';
import { Grid } from '../core/grid';
import type { Settings } from '../config/settings';
import { setDebugState } from '../debug';
import { debugCamera, debugRows } from '../debug/snapshot';
import { registerDragReorder } from '../input/drag';
import { GeometrySync } from '../kwin/geometry-sync';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { Animator, type Timer } from '../viewport/animator';
import { Viewport } from '../viewport/viewport';
import { ColumnRegistry } from './column-registry';
import { onMinimizedChanged, onWindowGeometryChanged, type WindowEventDeps } from './window-events';
import { SignalManager } from '../utils/signal-manager';

export class Strip {
    private readonly grid: Grid;
    private readonly viewport: Viewport;
    private readonly geometrySync: GeometrySync;
    private readonly animator: Animator;
    private readonly registry = new ColumnRegistry();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
    ) {
        this.grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
        this.viewport = new Viewport(area.width);
        this.geometrySync = new GeometrySync(area);
        this.animator = new Animator(
            timer,
            () => Date.now(),
            settings.animationTickMs,
            (offset) => {
                this.viewport.scrollTo(offset);
                this.render();
            },
        );
    }

    render(excludeWindowId?: string): void {
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            if (column.hidden) {
                continue;
            }
            const win = this.registry.get(column.id);
            if (win && win.id !== excludeWindowId) {
                this.geometrySync.apply(win, this.grid.columnRect(column.id), this.viewport.offset());
            }
        }
        setDebugState(
            formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()),
        );
    }

    revealFocused(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        this.animator.animate(
            this.viewport.offset(),
            this.viewport.offsetToReveal(rect.x, rect.width),
            this.settings.animationDurationMs,
        );
    }

    addWindow(win: WindowAdapter): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        const signals = new SignalManager();
        this.registry.set(column.id, win, signals);
        if (win.isMinimized()) {
            this.grid.hideColumn(column.id);
        }
        signals.add(win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal, this.eventDeps())));
        signals.add(win.onMinimizedChanged(() => onMinimizedChanged(win, this.eventDeps())));
        signals.add(
            registerDragReorder(win, column.id, {
                grid: this.grid,
                viewport: this.viewport,
                workspaceAdapter: this.workspaceAdapter,
                area: this.area,
                render: () => this.render(),
            }),
        );
        this.render();
        this.revealFocused();
    }

    removeWindow(win: WindowAdapter): void {
        const columnId = this.registry.columnOf(win.id);
        if (columnId === null) {
            return;
        }
        this.registry.delete(columnId);
        this.geometrySync.forget(win.id);
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }

    activateWindow(win: WindowAdapter): void {
        const columnId = this.registry.columnOf(win.id);
        if (columnId === null) {
            return;
        }
        this.grid.setFocus(columnId);
        this.revealFocused();
    }

    focusLeft(): void {
        this.grid.focusLeft();
        this.revealFocused();
    }

    focusRight(): void {
        this.grid.focusRight();
        this.revealFocused();
    }

    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
            hideColumn: (columnId) => this.grid.hideColumn(columnId),
            showColumn: (columnId) => this.grid.showColumn(columnId),
            render: (excludeWindowId) => this.render(excludeWindowId),
            revealFocused: () => this.revealFocused(),
        };
    }
}
