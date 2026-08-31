// One scrollable tiling surface: owns its Grid (layout), Viewport (camera), Animator
// (scroll animation), GeometrySync (virtual->real writes), and ColumnRegistry (window
// bookkeeping). Absorbs the render(), revealFocused(), and per-window lifecycle logic
// that used to live in main.ts's init(). Only runtime/ and main.ts do this wiring.

import type { Rect } from '../core/coordinates';
import { formatDebugState } from '../core/debug-format';
import type { Column } from '../core/column';
import { Grid } from '../core/grid';
import type { Settings } from '../config/settings';
import { debug, setDebugState } from '../debug';
import { debugCamera, debugRows } from '../debug/snapshot';
import { registerDragReorder } from '../input/drag';
import { GeometrySync } from '../kwin/geometry-sync';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { alignOffsets, nextAlignStep, type AlignDirection, type AlignOffsets } from '../viewport/align-cycle';
import { Animator, type Timer } from '../viewport/animator';
import { ColumnMotion } from '../viewport/column-motion';
import { SharedTicker } from '../viewport/shared-ticker';
import { Viewport } from '../viewport/viewport';
import { ColumnRegistry } from './column-registry';
import {
    onFullScreenChanged,
    onMinimizedChanged,
    onWindowGeometryChanged,
    type WindowEventDeps,
} from './window-events';
import { SignalManager } from '../utils/signal-manager';

export class Strip {
    private readonly grid: Grid;
    private readonly viewport: Viewport;
    private readonly geometrySync: GeometrySync;
    private readonly animator: Animator;
    private readonly columnMotion = new ColumnMotion();
    private readonly columnMotionTimer: Timer;
    private readonly registry = new ColumnRegistry();
    // Tracks fullscreen state per column, updated only by the window's fullScreenChanged
    // signal (never by re-reading the live property from an unrelated render() call — KWin's
    // own docs warn the property is only reliably observed via its notify signal).
    private readonly fullScreenColumns = new Set<number>();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
    ) {
        this.grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
        this.viewport = new Viewport(area.width);
        this.geometrySync = new GeometrySync(area);
        const ticker = new SharedTicker(timer, settings.animationTickMs);
        this.animator = new Animator(
            ticker.subscribe(),
            () => Date.now(),
            settings.animationTickMs,
            (offset) => {
                this.viewport.setOffset(offset);
                this.render();
            },
        );
        this.columnMotionTimer = ticker.subscribe();
    }

    render(excludeWindowId?: string, instant = false): void {
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            if (column.hidden) {
                continue;
            }
            const win = this.registry.get(column.id);
            if (!win || win.id === excludeWindowId || this.fullScreenColumns.has(column.id)) {
                continue;
            }
            const rect = this.grid.columnRect(column.id);
            let x: number;
            if (instant) {
                this.columnMotion.snapTo(column.id, rect.x);
                x = rect.x;
            } else {
                x = this.columnMotion.update(column.id, rect.x, Date.now(), this.settings.animationDurationMs);
            }
            this.geometrySync.apply(win, Object.assign({}, rect, { x }), this.viewport.offset());
        }
        if (this.columnMotion.isAnimating()) {
            this.columnMotionTimer.start(this.settings.animationTickMs, () => this.render());
        } else {
            this.columnMotionTimer.stop();
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
        if (win.isFullScreen()) {
            this.fullScreenColumns.add(column.id);
        }
        signals.add(win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal, this.eventDeps())));
        signals.add(win.onMinimizedChanged(() => onMinimizedChanged(win, this.eventDeps())));
        signals.add(win.onFullScreenChanged(() => onFullScreenChanged(win, this.eventDeps())));
        signals.add(
            registerDragReorder(win, column.id, {
                grid: this.grid,
                viewport: this.viewport,
                workspaceAdapter: this.workspaceAdapter,
                area: this.area,
                // Drag-reorder settle stays fully instant, matching pre-animation behavior.
                render: () => this.render(undefined, true),
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
        this.fullScreenColumns.delete(columnId);
        this.columnMotion.forget(columnId);
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
        this.activateColumn(this.grid.focusLeft());
    }

    focusRight(): void {
        this.activateColumn(this.grid.focusRight());
    }

    /** Focus-stepping only moves Drift's own notion of the focused column (`Grid`) —
     * this is what also makes KWin actually hand keyboard focus to that column's window. */
    private activateColumn(column: Column | null): void {
        if (column !== null) {
            this.registry.get(column.id)?.activate();
        }
        this.revealFocused();
    }

    cycleAlignLeft(): void {
        this.cycleAlign('left');
    }

    cycleAlignRight(): void {
        this.cycleAlign('right');
    }

    /** Pans the camera without touching focus — unlike focusLeft/Right and cycleAlign,
     * the focused column never changes. Deliberately unclamped: the user can keep
     * panning past either end of the content. */
    shiftViewportLeft(): void {
        this.shiftViewport(-this.settings.viewportShiftStep);
    }

    shiftViewportRight(): void {
        this.shiftViewport(this.settings.viewportShiftStep);
    }

    private shiftViewport(delta: number): void {
        const target = this.viewport.offset() + delta;
        this.animator.animate(this.viewport.offset(), target, this.settings.animationDurationMs);
    }

    private cycleAlign(direction: AlignDirection): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            debug(`cycleAlign(${direction}): no focused column (focused=${focused === null ? 'null' : 'hidden'})`);
            return;
        }
        const offsets = this.columnAlignOffsets(focused.id);
        const step = nextAlignStep(direction, this.viewport.offset(), offsets);
        debug(
            `cycleAlign(${direction}): offset=${this.viewport.offset()} offsets=${JSON.stringify(offsets)} ` +
                `step=${JSON.stringify(step)}`,
        );
        this.animator.animate(this.viewport.offset(), step.targetOffset, this.settings.animationDurationMs);
    }

    /** Unclamped on purpose — align-cycle must be able to place a column flush against
     * either viewport edge even when the whole strip already fits within it. */
    private columnAlignOffsets(columnId: number): AlignOffsets {
        const rect = this.grid.columnRect(columnId);
        return alignOffsets(rect.x, rect.width, this.viewport.viewportWidth());
    }

    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
            hideColumn: (columnId) => {
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
            showColumn: (columnId) => this.grid.showColumn(columnId),
            setFullScreen: (columnId, fullScreen) => {
                if (fullScreen) {
                    this.fullScreenColumns.add(columnId);
                    this.columnMotion.forget(columnId);
                } else {
                    this.fullScreenColumns.delete(columnId);
                }
            },
            render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
            revealFocused: () => this.revealFocused(),
            isFullScreenGeometry: (win) => this.workspaceAdapter.isFullScreenGeometry(win),
        };
    }
}
