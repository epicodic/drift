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
import { registerDragReorder, type DragReorderDeps } from '../input/drag';
import { GeometrySync } from '../kwin/geometry-sync';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { buildMinimapSnapshot, type MinimapSnapshot } from '../ui/minimap';
import {
    adjacentScreenIndex,
    alignOffsets,
    currentScreenIndex,
    nextAlignStep,
    type AlignDirection,
    type ScreenBounds,
} from '../viewport/align-cycle';
import { Animator, type Timer } from '../viewport/animator';
import { ColumnMotion } from '../viewport/column-motion';
import { EdgeDwell } from '../viewport/edge-dwell';
import { SharedTicker } from '../viewport/shared-ticker';
import { Viewport } from '../viewport/viewport';
import { ColumnRegistry, type TileLocation } from './column-registry';
import {
    onFullScreenChanged,
    onMinimizedChanged,
    onWindowGeometryChanged,
    type WindowEventDeps,
} from './window-events';
import { SignalManager } from '../utils/signal-manager';

/** The subset of `DragReorderDeps` a caller can supply per-window without knowing about
 * `Grid`/`Viewport`/rendering internals — used by `StripStack` to watch a dragged window's
 * vertical position (docs: 2026-09-02-cross-row-drag-design). */
export type RowDragHooks = Pick<DragReorderDeps, 'onDragStarted' | 'onDragTick' | 'onDragFinished'>;

/** Optional live-drag stack preview passed to `render()`: which tile rects to compute
 * from a hypothetical layout instead of the committed one. `enteringColumnId`/
 * `enteringIndex`/`enteringGapHeight` describe the column opening a gap for the dragged
 * tile; `leavingColumnId`/`leavingTileId` (only set for a cross-column drag whose source
 * is itself a multi-tile stack) describe the column closing the gap the dragged tile is
 * leaving. Exported for `src/input/drag.ts` to reference when wiring real drag signals
 * (docs: 2026-09-03-drag-to-stack-design). */
export interface StackPreview {
    enteringColumnId: number;
    enteringIndex: number;
    enteringGapHeight: number;
    enteringExcludeTileId?: number;
    leavingColumnId?: number;
    leavingTileId?: number;
}

export class Strip {
    private readonly grid: Grid;
    private readonly viewport: Viewport;
    private readonly geometrySync: GeometrySync;
    private readonly animator: Animator;
    private readonly columnMotion = new ColumnMotion();
    private readonly ticker: SharedTicker;
    private readonly columnMotionTimer: Timer;
    private readonly registry = new ColumnRegistry();
    // Tracks fullscreen/minimized state per TILE (not per column, since a stacked column
    // can have one tile fullscreen/minimized while its siblings stay visible underneath),
    // keyed by `${columnId}:${tileId}`. Fullscreen state is updated only by the window's
    // fullScreenChanged signal (never by re-reading the live property from an unrelated
    // render() call — KWin's own docs warn the property is only reliably observed via its
    // notify signal). Minimized state mirrors this for the same "don't corrupt siblings"
    // reason — a 1-tile column keeps using Grid's column-level hideColumn/showColumn
    // instead, unchanged (docs: 2026-09-03-vertical-tiling-design).
    private readonly fullScreenTiles = new Set<string>();
    private readonly minimizedTiles = new Set<string>();
    // The vertical offset every render() call applies until told otherwise — see render()'s own
    // doc comment for why this is "sticky" rather than reset on every call.
    private verticalOffsetY = 0;

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
    ) {
        this.grid = new Grid(Math.max(1, area.height - settings.bottomMargin), settings.columnGap);
        this.viewport = new Viewport(area.width);
        this.geometrySync = new GeometrySync(area);
        this.ticker = new SharedTicker(timer, settings.animationTickMs);
        this.animator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            settings.animationTickMs,
            (offset) => {
                this.viewport.setOffset(offset);
                this.render();
            },
        );
        this.columnMotionTimer = this.ticker.subscribe();
    }

    /** `verticalOffsetY` is sticky, not defaulted: passing a value both applies it immediately
     * and remembers it as `this.verticalOffsetY` for every later call that omits the argument
     * (internal call sites — addWindow, detachColumn, the horizontal Animator's own tick, drag-
     * reorder, window-events handlers — all omit it). Omitting it does NOT mean "use 0"; it means
     * "keep whatever this row was last explicitly told to use." Only `StripStack`'s transition
     * code (`applyVerticalOffset`, `snapRestingRows`, and its `switchToRow` priming call) ever
     * passes an explicit value — that's what keeps a parked, off-screen row parked instead of
     * snapping back to y=0 on the next unrelated internal render() (docs:
     * 2026-09-01-row-navigation-design).
     *
     * `stackPreview` (see `StackPreview`): optional live-drag stack preview. The dragged
     * tile's own window keeps being excluded from geometry sync via `excludeWindowId`,
     * unchanged (docs: 2026-09-03-drag-to-stack-design). */
    render(excludeWindowId?: string, instant = false, verticalOffsetY?: number, stackPreview?: StackPreview): void {
        if (verticalOffsetY !== undefined) {
            this.verticalOffsetY = verticalOffsetY;
        }
        this.viewport.setContentGeometry(this.grid.contentLeft(), this.grid.virtualWidth());
        for (const column of this.grid.columns()) {
            const columnRect = this.grid.columnRect(column.id);
            if (column.hidden) {
                for (const tile of column.tiles()) {
                    const win = this.registry.get(column.id, tile.id);
                    if (
                        !win ||
                        win.id === excludeWindowId ||
                        this.fullScreenTiles.has(this.tileKey(column.id, tile.id))
                    ) {
                        continue;
                    }
                    // No position animation for a minimized window — nothing on screen to smooth,
                    // and this keeps its real x tracking the viewport pan instead of freezing it
                    // (a taskbar sorted by real x would otherwise see it drift out of order).
                    this.geometrySync.apply(
                        win,
                        column.tileRect(tile.id, columnRect),
                        this.viewport.offset(),
                        this.verticalOffsetY,
                    );
                }
                continue;
            }
            // Mirrors the pre-Task-7 per-column early-continue exactly (generalized across a
            // stack's tiles): only skip columnMotion tracking entirely when EVERY tile is
            // excluded — a lone fullscreen tile must not silently re-establish (and then
            // mid-animate) the column's tracked x while nothing is actually being drawn for
            // it, or exiting fullscreen would animate from a stale position instead of
            // snapping straight to wherever the column moved to in the meantime.
            const allTilesExcluded = column.tiles().every((tile) => {
                const tileWin = this.registry.get(column.id, tile.id);
                const key = this.tileKey(column.id, tile.id);
                return !tileWin || tileWin.id === excludeWindowId || this.fullScreenTiles.has(key);
            });
            if (allTilesExcluded) {
                continue;
            }
            const targetX = columnRect.x;
            let x: number;
            if (instant) {
                this.columnMotion.snapTo(column.id, targetX);
                x = targetX;
            } else {
                x = this.columnMotion.update(column.id, targetX, Date.now(), this.settings.animationDurationMs);
            }
            const previewRects =
                stackPreview && column.id === stackPreview.enteringColumnId
                    ? column.previewRectsWithGapAt(
                        stackPreview.enteringIndex,
                        stackPreview.enteringGapHeight,
                        columnRect,
                        stackPreview.enteringExcludeTileId,
                    )
                    : stackPreview && column.id === stackPreview.leavingColumnId
                        ? column.previewRectsWithoutTile(stackPreview.leavingTileId!, columnRect)
                        : null;
            for (const tile of column.tiles()) {
                const key = this.tileKey(column.id, tile.id);
                if (this.fullScreenTiles.has(key) || this.minimizedTiles.has(key)) {
                    continue;
                }
                const win = this.registry.get(column.id, tile.id);
                if (!win || win.id === excludeWindowId) {
                    continue;
                }
                const rect = previewRects?.get(tile.id) ?? column.tileRect(tile.id, columnRect);
                this.geometrySync.apply(
                    win,
                    Object.assign({}, rect, { x }),
                    this.viewport.offset(),
                    this.verticalOffsetY,
                );
            }
        }
        if (this.columnMotion.isAnimating()) {
            // Preserve excludeWindowId and stackPreview: a live drag-reorder must keep skipping
            // the dragged window's own geometry across continuation ticks, not just the first,
            // and a live stack-hover preview must not flicker back to committed rects for one
            // frame while a column-position animation is still in flight. verticalOffsetY is
            // intentionally still omitted here — it's sticky via `this.verticalOffsetY` (see
            // render()'s own doc comment), so omitting it is safe.
            this.columnMotionTimer.start(this.settings.animationTickMs, () =>
                this.render(excludeWindowId, false, undefined, stackPreview),
            );
        } else {
            this.columnMotionTimer.stop();
        }
        setDebugState(
            formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()),
        );
    }

    /** Forces `columnId`'s position animation to rest at its current logical x with no
     * easing — used to settle the dragged column instantly on drag-reorder release
     * while its neighbors keep animating (docs: 2026-08-31-drag-reorder-live-preview). */
    snapColumn(columnId: number): void {
        this.columnMotion.snapTo(columnId, this.grid.columnRect(columnId).x);
    }

    /** Which (column, tile) a window is currently registered under — used by drag
     * wiring to resolve the dragged window's live location on every tick instead of
     * a fixed id captured once (docs: 2026-09-03-drag-to-stack-design). */
    locationOf(windowId: string): TileLocation | null {
        return this.registry.tileOf(windowId);
    }

    revealFocused(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        this.animator.animate(
            this.viewport.offset(),
            this.viewport.offsetToRevealOnScreen(rect.x, rect.width, this.screenBounds()),
            this.settings.animationDurationMs,
        );
    }

    /** Physical screens in strip-relative coordinates, sorted left-to-right. Read fresh on
     * every call rather than cached, consistent with `isFullScreenGeometry`'s live reads. */
    private screenBounds(): ScreenBounds[] {
        return this.workspaceAdapter
            .screens()
            .map((screen) => ({ left: screen.geometry.x - this.area.x, width: screen.geometry.width }))
            .sort((a, b) => a.left - b.left);
    }

    private tileKey(columnId: number, tileId: number): string {
        return `${columnId}:${tileId}`;
    }

    minimapSnapshot(): MinimapSnapshot {
        return buildMinimapSnapshot(this.grid, this.viewport, this.registry, this.animator.targetOffset());
    }

    addWindow(win: WindowAdapter, initiallyDragging = false, rowDragHooks?: RowDragHooks): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        const signals = new SignalManager();
        this.registry.set(column.id, column.focusedTileId, win, signals);
        if (win.isMinimized()) {
            this.grid.hideColumn(column.id);
        }
        if (win.isFullScreen()) {
            this.fullScreenTiles.add(this.tileKey(column.id, column.focusedTileId));
        }
        signals.add(win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal, this.eventDeps())));
        signals.add(win.onMinimizedChanged(() => onMinimizedChanged(win, this.eventDeps())));
        signals.add(win.onFullScreenChanged(() => onFullScreenChanged(win, this.eventDeps())));
        signals.add(
            registerDragReorder(
                win,
                Object.assign(
                    {
                        grid: this.grid,
                        registry: this.registry,
                        viewport: this.viewport,
                        area: this.area,
                        render: (
                            excludeWindowId?: string,
                            instant?: boolean,
                            verticalOffsetY?: undefined,
                            stackPreview?: StackPreview,
                        ) => this.render(excludeWindowId, instant, verticalOffsetY, stackPreview),
                        cursorPos: () => this.workspaceAdapter.cursorPos(),
                        createStackDwell: (onFire: (columnId: number) => void) =>
                            new EdgeDwell<number>(
                                this.ticker.subscribe(),
                                () => Date.now(),
                                this.settings.animationTickMs,
                                this.settings.columnDragDwellMs,
                                onFire,
                            ),
                        snapColumn: (id: number) => this.snapColumn(id),
                        commitTileIntoStack: (
                            fromColumnId: number,
                            fromTileId: number,
                            toColumnId: number,
                            slot: number,
                        ) => this.commitTileIntoStack(fromColumnId, fromTileId, toColumnId, slot),
                        revealFocused: () => this.revealFocused(),
                    },
                    rowDragHooks,
                ),
                initiallyDragging,
            ),
        );
        this.render(initiallyDragging ? win.id : undefined);
        // A mid-drag add skips revealFocused(): Grid.addColumn always focuses the new column,
        // and if this row's content already overflows the viewport, revealFocused() would kick
        // off a real Animator pan whose tick callback calls render() with NO excludeWindowId —
        // fighting the live KWin interactive move on the x-axis. registerDragReorder's own
        // interactiveMoveResizeFinished handler (src/input/drag.ts) calls revealFocused() too,
        // but only there, after dragging is fully done — never mid-drag, for the same reason.
        if (!initiallyDragging) {
            this.revealFocused();
        }
    }

    removeWindow(win: WindowAdapter): void {
        const location = this.registry.tileOf(win.id);
        if (location === null) {
            return;
        }
        const column = this.grid.column(location.columnId);
        if (column !== null && column.tileCount() > 1) {
            this.registry.deleteTile(location.columnId, location.tileId);
            column.removeTile(location.tileId);
            this.geometrySync.forget(win.id);
            this.fullScreenTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.minimizedTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.render();
            this.revealFocused();
            return;
        }
        this.detachColumn(location.columnId, [win]);
    }

    /** Detaches the whole focused column — every tile's window, as a unit — from this
     * strip, returning them so a caller (StripStack's cross-row move) can re-add them
     * elsewhere. A stacked column's tiles are NOT preserved as a stack in the target
     * row this pass — each is re-added via addWindow as its own column there (docs:
     * 2026-09-03-vertical-tiling-design, Out of Scope). Empty array if there's nothing
     * to detach. */
    detachFocusedColumn(): WindowAdapter[] {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return [];
        }
        const windows = this.registry.windowsInColumn(focused.id);
        if (windows.length === 0) {
            return [];
        }
        this.detachColumn(focused.id, windows);
        return windows;
    }

    /** Shared teardown for `removeWindow` (single-tile column case) and
     * `detachFocusedColumn`: forgets every one of `windows`' geometry-sync/motion/
     * fullscreen/minimize state, removes the column from the grid, and re-renders. */
    private detachColumn(columnId: number, windows: WindowAdapter[]): void {
        this.registry.deleteColumn(columnId);
        for (const win of windows) {
            this.geometrySync.forget(win.id);
        }
        this.fullScreenTiles.forEach((key) => {
            if (key.startsWith(`${columnId}:`)) {
                this.fullScreenTiles.delete(key);
            }
        });
        this.minimizedTiles.forEach((key) => {
            if (key.startsWith(`${columnId}:`)) {
                this.minimizedTiles.delete(key);
            }
        });
        this.columnMotion.forget(columnId);
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }

    /** True when this row has no windows — used by row-pruning (docs:
     * 2026-09-01-row-navigation-design). */
    isEmpty(): boolean {
        return this.registry.isEmpty();
    }

    /** Toggles `skipTaskbar` on every window currently in this row — used while paging rows,
     * so an inactive row's windows don't clutter the taskbar (docs:
     * 2026-09-01-row-navigation-design). */
    setSkipTaskbar(skipTaskbar: boolean): void {
        for (const win of this.registry.windows()) {
            win.setSkipTaskbar(skipTaskbar);
        }
    }

    activateWindow(win: WindowAdapter): void {
        const location = this.registry.tileOf(win.id);
        if (location === null) {
            return;
        }
        this.grid.setFocus(location.columnId);
        this.grid.column(location.columnId)?.setFocusedTile(location.tileId);
        this.revealFocused();
    }

    focusLeft(): void {
        this.activateColumn(this.grid.focusLeft());
    }

    focusRight(): void {
        this.activateColumn(this.grid.focusRight());
    }

    moveWindowLeft(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const currentIndex = this.grid.indexOf(focused.id);
        if (currentIndex <= 0) {
            return;
        }
        this.grid.moveColumn(focused.id, currentIndex - 1);
        this.snapColumn(focused.id);
        this.render();
        this.revealFocused();
    }

    moveWindowRight(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const currentIndex = this.grid.indexOf(focused.id);
        if (currentIndex >= this.grid.columns().length - 1) {
            return;
        }
        this.grid.moveColumn(focused.id, currentIndex + 1);
        this.snapColumn(focused.id);
        this.render();
        this.revealFocused();
    }

    /** Moves tile focus up within the focused column's stack and activates the newly
     * focused tile's window. No-op if there's no focused column or it's not a stack.
     * Returns whether focus actually moved. */
    focusUp(): boolean {
        return this.moveTileFocus((column) => column.focusUp());
    }

    /** Moves tile focus down within the focused column's stack. Returns whether focus
     * actually moved. */
    focusDown(): boolean {
        return this.moveTileFocus((column) => column.focusDown());
    }

    private moveTileFocus(move: (column: Column) => boolean): boolean {
        const column = this.grid.focusedColumn();
        if (column === null) {
            return false;
        }
        const moved = move(column);
        if (moved) {
            this.registry.get(column.id, column.focusedTileId)?.activate();
        }
        this.revealFocused();
        return moved;
    }

    /** Absorb: pull the column to the right of the focused one into its stack, as a
     * new tile at the bottom. No-op if there's no right neighbor or it's already a
     * stack (docs: 2026-09-03-vertical-tiling-design). */
    absorbRight(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const result = this.grid.absorbColumnRight(focused.id);
        if (result === null) {
            return;
        }
        this.registry.moveWindow(result.fromColumnId, result.fromTileId, focused.id, result.toTileId);
        this.fullScreenTiles.delete(this.tileKey(result.fromColumnId, result.fromTileId));
        this.minimizedTiles.delete(this.tileKey(result.fromColumnId, result.fromTileId));
        this.columnMotion.forget(result.fromColumnId);
        this.render();
        this.revealFocused();
    }

    /** Expel: remove the focused tile from the focused column's stack and give it its
     * own new column to the right. No-op on a single-tile column. */
    expel(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const result = this.grid.expelFocusedTile(focused.id, this.settings.defaultColumnWidth);
        if (result === null) {
            return;
        }
        this.registry.moveWindow(focused.id, result.fromTileId, result.toColumnId, result.toTileId);
        this.render();
        this.revealFocused();
    }

    /** Moves `fromTileId` out of `fromColumnId` and into `toColumnId` at `slot` —
     * the general, drag-driven form of `absorbRight`, for any source/target pair.
     * `fromColumnId` must differ from `toColumnId`; same-column reordering goes
     * through `Column.moveTile` directly (see drag.ts), which needs no registry or
     * bookkeeping changes at all (docs: 2026-09-03-drag-to-stack-design). */
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void {
        const toTileId = this.grid.moveTileIntoColumn(fromColumnId, fromTileId, toColumnId, slot);
        this.registry.moveWindow(fromColumnId, fromTileId, toColumnId, toTileId);
        this.fullScreenTiles.delete(this.tileKey(fromColumnId, fromTileId));
        this.minimizedTiles.delete(this.tileKey(fromColumnId, fromTileId));
        this.columnMotion.forget(fromColumnId);
    }

    /** Focus-stepping only moves Drift's own notion of the focused column (`Grid`) —
     * this is what also makes KWin actually hand keyboard focus to that column's window. */
    private activateColumn(column: Column | null): void {
        if (column !== null) {
            this.registry.get(column.id, column.focusedTileId)?.activate();
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
        this.shiftViewport(this.settings.viewportShiftStep);
    }

    shiftViewportRight(): void {
        this.shiftViewport(-this.settings.viewportShiftStep);
    }

    private shiftViewport(delta: number): void {
        const target = this.viewport.offset() + delta;
        this.animator.animate(this.viewport.offset(), target, this.settings.animationDurationMs);
    }

    /** Cycles the focused column through left/center/right of whichever physical screen
     * it's currently on (falling back to the combined desktop when it fits no single
     * screen). A further press at that screen's own edge crosses to the neighboring
     * screen's entering edge, wrapping around at either end (docs:
     * 2026-09-01-multimonitor-align-cycle-design). */
    private cycleAlign(direction: AlignDirection): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            debug(`cycleAlign(${direction}): no focused column (focused=${focused === null ? 'null' : 'hidden'})`);
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        const screens = this.screenBounds();
        const offset = this.viewport.offset();

        const screenIndex = currentScreenIndex(rect.x, rect.width, offset, screens);
        const screen = screenIndex === null ? { left: 0, width: this.viewport.viewportWidth() } : screens[screenIndex];
        const offsets = alignOffsets(rect.x, rect.width, screen);
        const step = nextAlignStep(direction, offset, offsets);
        debug(
            `cycleAlign(${direction}): offset=${offset} screenIndex=${screenIndex} offsets=${JSON.stringify(offsets)} ` +
            `step=${JSON.stringify(step)}`,
        );

        if (screenIndex !== null && Math.round(step.targetOffset) === Math.round(offset)) {
            const targetIndex = adjacentScreenIndex(direction, screenIndex, rect.width, screens);
            if (targetIndex === null) {
                return; // no-op: no fitting neighbor in this direction
            }
            const targetOffsets = alignOffsets(rect.x, rect.width, screens[targetIndex]);
            const targetOffset = direction === 'left' ? targetOffsets.right : targetOffsets.left;
            this.animator.animate(offset, targetOffset, this.settings.animationDurationMs);
            return;
        }
        this.animator.animate(offset, step.targetOffset, this.settings.animationDurationMs);
    }

    private eventDeps(): WindowEventDeps {
        return {
            columnOf: (windowId) => this.registry.columnOf(windowId),
            tileOf: (windowId) => this.registry.tileOf(windowId),
            isHidden: (columnId) => this.grid.isHidden(columnId),
            isEcho: (windowId, rect) => this.geometrySync.isEcho(windowId, rect),
            resizeColumn: (columnId, width, edge) => this.grid.resizeColumn(columnId, width, edge),
            resizeTile: (columnId, tileId, height, edge) => {
                this.grid.column(columnId)?.resizeTile(tileId, height, edge);
            },
            hideColumn: (columnId) => {
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
            showColumn: (columnId) => this.grid.showColumn(columnId),
            hideTile: (columnId, tileId) => {
                const column = this.grid.column(columnId);
                if (column !== null && column.tileCount() > 1) {
                    this.minimizedTiles.add(this.tileKey(columnId, tileId));
                    return;
                }
                this.grid.hideColumn(columnId);
                this.columnMotion.forget(columnId);
            },
            showTile: (columnId, tileId) => {
                const column = this.grid.column(columnId);
                if (column !== null && column.tileCount() > 1) {
                    this.minimizedTiles.delete(this.tileKey(columnId, tileId));
                    return;
                }
                this.grid.showColumn(columnId);
            },
            setFullScreen: (columnId, tileId, fullScreen) => {
                const key = this.tileKey(columnId, tileId);
                if (fullScreen) {
                    this.fullScreenTiles.add(key);
                    this.columnMotion.forget(columnId);
                } else {
                    this.fullScreenTiles.delete(key);
                }
            },
            render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
            revealFocused: () => this.revealFocused(),
            isFullScreenGeometry: (win) => this.workspaceAdapter.isFullScreenGeometry(win),
        };
    }
}
