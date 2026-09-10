// One scrollable tiling surface: owns its Grid (layout), Viewport (camera), Animator
// (scroll animation), GeometrySync (virtual->real writes), and ColumnRegistry (window
// bookkeeping). Absorbs the render(), revealFocused(), and per-window lifecycle logic
// that used to live in main.ts's init(). Only runtime/ and main.ts do this wiring.

import { Rect, shrinkRect } from '../core/coordinates';
import { formatDebugState } from '../core/debug-format';
import type { Column } from '../core/column';
import { Grid } from '../core/grid';
import type { ColumnAlign } from '../core/window-rules';
import type { Settings } from '../config/settings';
import { debug, setDebugState } from '../debug';
import { debugCamera, debugRows } from '../debug/snapshot';
import { registerDragReorder, type DragReorderDeps } from '../input/drag';
import { GeometrySync, toVirtualX } from '../kwin/geometry-sync';
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
import { AxisMotion } from '../viewport/axis-motion';
import { EdgeDwell } from '../viewport/edge-dwell';
import { ANIMATION_TICK_MS, SharedTicker } from '../viewport/shared-ticker';
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
export type StripDragHooks = Pick<DragReorderDeps, 'onDragStarted' | 'onDragTick' | 'onDragFinished'>;

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
    // Always the margin-inset content rect (see `marginedArea`), never the raw work area —
    // every coordinate consumer below is built from this, not from the constructor's `area` param.
    private area: Rect;
    private readonly grid: Grid;
    private readonly viewport: Viewport;
    private readonly geometrySync: GeometrySync;
    private readonly animator: Animator;
    // All four channels are keyed by WINDOW id, never column id: a tile id is only stable
    // within one column, and window keying is what lets a single window be seeded
    // independently for a drag release or a keyboard move without disturbing the siblings
    // sharing its column (docs: 2026-09-08-window-motion-primitive-design).
    private readonly tileXMotion = new AxisMotion<string>();
    private readonly tileYMotion = new AxisMotion<string>();
    private readonly tileWidthMotion = new AxisMotion<string>();
    private readonly tileHeightMotion = new AxisMotion<string>();
    private readonly ticker: SharedTicker;
    private readonly motionTimer: Timer;
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
        area: Rect,
        private readonly settings: Settings,
        timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
    ) {
        this.area = this.marginedArea(area);
        this.grid = new Grid(Math.max(1, this.area.height), settings.horizontalGap, settings.verticalGap);
        this.viewport = new Viewport(Math.max(1, this.area.width));
        this.geometrySync = new GeometrySync(this.area);
        this.ticker = new SharedTicker(timer, ANIMATION_TICK_MS);
        this.animator = new Animator(
            this.ticker.subscribe(),
            () => Date.now(),
            ANIMATION_TICK_MS,
            (offset) => {
                this.viewport.setOffset(offset);
                this.render();
            },
        );
        this.motionTimer = this.ticker.subscribe();
    }

    /** Re-derives grid height, viewport width, and the virtual->real coordinate origin from a
     * changed work area (a panel/dock resizing, or the initial KWin startup race with panel
     * strut registration — see `WorkspaceAdapter.workingArea`), then re-renders every window
     * at the new geometry instantly — this is a correction, not a user-facing layout change,
     * so it shouldn't ease into place over `animationDurationMs` like a normal resize. */
    updateArea(area: Rect): void {
        this.area = this.marginedArea(area);
        this.grid.setHeight(Math.max(1, this.area.height));
        this.viewport.setViewportWidth(Math.max(1, this.area.width));
        this.geometrySync.setArea(this.area);
        this.render(undefined, true);
    }

    /** Insets `area` by the four configured margins — the single place every coordinate
     * consumer (Grid, Viewport, GeometrySync, and by extension drag math and
     * marginedScreenBounds, which all read `this.area`) gets its origin from, so they
     * agree on where the grid actually starts. */
    private marginedArea(area: Rect): Rect {
        return shrinkRect(area, {
            top: this.settings.topMargin,
            bottom: this.settings.bottomMargin,
            left: this.settings.leftMargin,
            right: this.settings.rightMargin,
        });
    }

    /** `verticalOffsetY` is sticky, not defaulted: passing a value both applies it immediately
     * and remembers it as `this.verticalOffsetY` for every later call that omits the argument
     * (internal call sites — addWindow, detachColumn, the horizontal Animator's own tick, drag-
     * reorder, window-events handlers — all omit it). Omitting it does NOT mean "use 0"; it means
     * "keep whatever this strip was last explicitly told to use." Only `StripStack`'s transition
     * code (`applyVerticalOffset`, `snapRestingStrips`, and its `switchToStrip` priming call) ever
     * passes an explicit value — that's what keeps a parked, off-screen strip parked instead of
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
                const targetRect = previewRects?.get(tile.id) ?? column.tileRect(tile.id, columnRect);
                let x: number;
                let y: number;
                let width: number;
                let height: number;
                if (instant) {
                    this.tileXMotion.snapTo(win.id, columnRect.x);
                    this.tileYMotion.snapTo(win.id, targetRect.y);
                    this.tileWidthMotion.snapTo(win.id, targetRect.width);
                    this.tileHeightMotion.snapTo(win.id, targetRect.height);
                    x = columnRect.x;
                    y = targetRect.y;
                    width = targetRect.width;
                    height = targetRect.height;
                } else {
                    const now = Date.now();
                    const duration = this.settings.animationDurationMs;
                    x = this.tileXMotion.update(win.id, columnRect.x, now, duration);
                    y = this.tileYMotion.update(win.id, targetRect.y, now, duration);
                    width = this.tileWidthMotion.update(win.id, targetRect.width, now, duration);
                    height = this.tileHeightMotion.update(win.id, targetRect.height, now, duration);
                }
                this.geometrySync.apply(
                    win,
                    Object.assign({}, targetRect, { x, y, width, height }),
                    this.viewport.offset(),
                    this.verticalOffsetY,
                );
            }
        }
        if (
            this.tileXMotion.isAnimating() ||
            this.tileYMotion.isAnimating() ||
            this.tileWidthMotion.isAnimating() ||
            this.tileHeightMotion.isAnimating()
        ) {
            // Preserve excludeWindowId and stackPreview: a live drag-reorder must keep skipping
            // the dragged window's own geometry across continuation ticks, not just the first,
            // and a live stack-hover preview must not flicker back to committed rects for one
            // frame while a column-position animation is still in flight. verticalOffsetY is
            // intentionally still omitted here — it's sticky via `this.verticalOffsetY` (see
            // render()'s own doc comment), so omitting it is safe.
            this.motionTimer.start(ANIMATION_TICK_MS, () =>
                this.render(excludeWindowId, false, undefined, stackPreview),
            );
        } else {
            this.motionTimer.stop();
        }
        setDebugState(
            formatDebugState(debugRows(this.grid, this.registry), debugCamera(this.viewport), this.grid.debugState()),
        );
    }

    /** Seeds `windowId`'s motion channels to start from `rect`, in virtual strip coordinates
     * (area-relative y). The next `render()` eases from there into whatever the layout
     * resolves for that window; omitted fields leave that channel resting where it already
     * was, which is how a caller animates only some dimensions (docs:
     * 2026-09-08-window-motion-primitive-design). */
    seedMotionFrom(windowId: string, rect: Partial<Rect>): void {
        if (rect.x !== undefined) {
            this.tileXMotion.snapTo(windowId, rect.x);
        }
        if (rect.y !== undefined) {
            this.tileYMotion.snapTo(windowId, rect.y);
        }
        if (rect.width !== undefined) {
            this.tileWidthMotion.snapTo(windowId, rect.width);
        }
        if (rect.height !== undefined) {
            this.tileHeightMotion.snapTo(windowId, rect.height);
        }
    }

    /** `seedMotionFrom` seeded from the window's own current on-screen geometry — "wherever
     * it is right now, drift it to where the layout says it belongs." */
    seedMotionFromCurrentGeometry(win: WindowAdapter): void {
        const real = win.frameGeometry();
        this.seedMotionFrom(win.id, {
            x: toVirtualX(real.x, this.area, this.viewport.offset()),
            y: real.y - this.area.y,
            width: real.width,
            height: real.height,
        });
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
            this.viewport.offsetToRevealOnScreen(rect.x, rect.width, this.marginedScreenBounds()),
            this.settings.animationDurationMs,
        );
    }

    /** Physical screens in strip-relative coordinates, sorted left-to-right, clipped to the
     * margin-inset visible area at the strip's outer edges. A monitor's raw geometry extends
     * into the left/right margin (or past the strip's own content width) at the strip's two
     * ends — without clipping, `offsetToRevealOnScreen` and align-cycle would treat that
     * margin-reserved space as available and slide content into it. Interior monitor
     * boundaries (the bezel between two adjacent screens) are left untouched: margins only
     * apply at the strip's absolute edges, not between screens. Read fresh on every call
     * rather than cached, consistent with `isFullScreenGeometry`'s live reads. */
    private marginedScreenBounds(): ScreenBounds[] {
        const screens = this.workspaceAdapter
            .screens()
            .map((screen) => ({ left: screen.geometry.x - this.area.x, width: screen.geometry.width }))
            .sort((a, b) => a.left - b.left);
        const viewportWidth = this.viewport.viewportWidth();
        return screens.map((screen, index) => {
            const left = index === 0 ? Math.max(screen.left, 0) : screen.left;
            const right =
                index === screens.length - 1
                    ? Math.min(screen.left + screen.width, viewportWidth)
                    : screen.left + screen.width;
            return { left, width: right - left };
        });
    }

    private tileKey(columnId: number, tileId: number): string {
        return `${columnId}:${tileId}`;
    }

    /** Drops all four motion channels for `windowId`, so its next appearance snaps instead
     * of animating from a stale pre-hide value. */
    private forgetMotion(windowId: string): void {
        this.tileXMotion.forget(windowId);
        this.tileYMotion.forget(windowId);
        this.tileWidthMotion.forget(windowId);
        this.tileHeightMotion.forget(windowId);
    }

    /** `forgetMotion` for every window currently registered in `columnId`. Call it before
     * removing or hiding the column, while it is still resolvable. */
    private forgetColumnMotion(columnId: number): void {
        const column = this.grid.column(columnId);
        if (column === null) {
            return;
        }
        for (const tile of column.tiles()) {
            const win = this.registry.get(columnId, tile.id);
            if (win) {
                this.forgetMotion(win.id);
            }
        }
    }

    minimapSnapshot(): MinimapSnapshot {
        return buildMinimapSnapshot(this.grid, this.viewport, this.registry, this.animator.targetOffset());
    }

    addWindow(win: WindowAdapter, initiallyDragging = false, stripDragHooks?: StripDragHooks): void {
        const width = Math.round(win.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        this.wireTile(win, column, column.focusedTileId, initiallyDragging, stripDragHooks);
        this.render(initiallyDragging ? win.id : undefined);
        // A mid-drag add skips revealFocused(): Grid.addColumn always focuses the new column,
        // and if this strip's content already overflows the viewport, revealFocused() would kick
        // off a real Animator pan whose tick callback calls render() with NO excludeWindowId —
        // fighting the live KWin interactive move on the x-axis. registerDragReorder's own
        // interactiveMoveResizeFinished handler (src/input/drag.ts) calls revealFocused() too,
        // but only there, after dragging is fully done — never mid-drag, for the same reason.
        if (!initiallyDragging) {
            this.revealFocused();
        }
    }

    /** Adds `windows` as tiles of a single new stacked column, in order — the counterpart to
     * `addWindow` for re-adding an already-stacked column elsewhere (e.g. a cross-strip move),
     * so the stack survives intact instead of splitting into separate columns. No-op for an
     * empty array. */
    addWindowStack(windows: WindowAdapter[], initiallyDragging = false, stripDragHooks?: StripDragHooks): void {
        const [first, ...rest] = windows;
        if (first === undefined) {
            return;
        }
        const width = Math.round(first.frameGeometry().width) || this.settings.defaultColumnWidth;
        const column = this.grid.addColumn(width);
        this.wireTile(first, column, column.focusedTileId, initiallyDragging, stripDragHooks);
        for (const win of rest) {
            const tileId = column.addTile();
            this.wireTile(win, column, tileId, initiallyDragging, stripDragHooks);
        }
        this.render(initiallyDragging ? first.id : undefined);
        // See addWindow's comment above — same rationale for skipping revealFocused() mid-drag.
        if (!initiallyDragging) {
            this.revealFocused();
        }
    }

    /** Registers `win` as `tileId` within `column`: registry bookkeeping, minimize/fullscreen
     * state, and the geometry/minimize/fullscreen/drag-reorder signal wiring every tile needs
     * regardless of whether it landed via `addWindow` or `addWindowStack`. */
    private wireTile(
        win: WindowAdapter,
        column: Column,
        tileId: number,
        initiallyDragging: boolean,
        stripDragHooks?: StripDragHooks,
    ): void {
        const signals = new SignalManager();
        this.registry.set(column.id, tileId, win, signals);
        if (win.isMinimized()) {
            this.grid.hideColumn(column.id);
        }
        if (win.isFullScreen()) {
            this.fullScreenTiles.add(this.tileKey(column.id, tileId));
        }
        signals.add(win.onFrameGeometryChanged((oldReal) => onWindowGeometryChanged(win, oldReal, this.eventDeps())));
        signals.add(win.onMinimizedChanged(() => onMinimizedChanged(win, this.eventDeps())));
        signals.add(win.onFullScreenChanged(() => onFullScreenChanged(win, this.eventDeps())));
        // A live border-drag resize excludes this window from render()'s tile loop (see
        // onWindowGeometryChanged's isInteractiveResize branch), so its motion channels never
        // track the resize while it's in progress. Once the drag ends, snap them to the window's
        // real final geometry — otherwise the next unrelated render() (e.g. switching focus and
        // revealing another window) sees a stale pre-resize target and visibly snaps the width
        // back before re-animating it forward (docs: reported width-restore-on-switch bug).
        signals.add(win.onInteractiveMoveResizeFinished(() => this.seedMotionFromCurrentGeometry(win)));
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
                        reorderThresholdFraction: this.settings.reorderThresholdFraction,
                        stackOverlapFraction: this.settings.stackOverlapFraction,
                        dragPanEnabled: this.settings.dragPanEnabled,
                        dragPanVerticalTolerancePx: this.settings.dragPanVerticalTolerancePx,
                        createStackDwell: (onFire: (key: string) => void) =>
                            new EdgeDwell<string>(
                                this.ticker.subscribe(),
                                () => Date.now(),
                                ANIMATION_TICK_MS,
                                this.settings.columnDragDwellMs,
                                onFire,
                            ),
                        seedMotionFrom: (windowId: string, rect: Partial<Rect>) => this.seedMotionFrom(windowId, rect),
                        commitTileIntoStack: (
                            fromColumnId: number,
                            fromTileId: number,
                            toColumnId: number,
                            slot: number,
                        ) => this.commitTileIntoStack(fromColumnId, fromTileId, toColumnId, slot),
                        revealFocused: () => this.revealFocused(),
                    },
                    stripDragHooks,
                ),
                initiallyDragging,
            ),
        );
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
            this.forgetMotion(win.id);
            this.fullScreenTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.minimizedTiles.delete(this.tileKey(location.columnId, location.tileId));
            this.render();
            this.revealFocused();
            return;
        }
        this.detachColumn(location.columnId, [win]);
    }

    /** Detaches the whole focused column — every tile's window, as a unit — from this
     * strip, returning them so a caller (StripStack's cross-strip move) can re-add them
     * elsewhere via `addWindowStack`, which keeps a stacked column's tiles together as one
     * column in the target strip. Empty array if there's nothing to detach. */
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

    /** Detaches just the focused tile's window, leaving the rest of a stacked column's tiles
     * in place — the single-window counterpart to `detachFocusedColumn`, used to peel a
     * window off the edge of a stack and hand it to a caller (e.g. moving it to an adjacent
     * strip) without disturbing its former stack-mates. Detaches the whole column, same as
     * `detachFocusedColumn`, when it only had that one tile. Null if there's no focused column. */
    detachFocusedTile(): WindowAdapter | null {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return null;
        }
        const win = this.registry.get(focused.id, focused.focusedTileId);
        if (win === undefined) {
            return null;
        }
        this.removeWindow(win);
        return win;
    }

    /** Shared teardown for `removeWindow` (single-tile column case) and
     * `detachFocusedColumn`: forgets every one of `windows`' geometry-sync/motion/
     * fullscreen/minimize state, removes the column from the grid, and re-renders. */
    private detachColumn(columnId: number, windows: WindowAdapter[]): void {
        this.registry.deleteColumn(columnId);
        for (const win of windows) {
            this.geometrySync.forget(win.id);
            this.forgetMotion(win.id);
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
        this.grid.removeColumn(columnId);
        this.render();
        this.revealFocused();
    }

    /** True when this strip has no windows — used by strip-pruning (docs:
     * 2026-09-01-row-navigation-design). */
    isEmpty(): boolean {
        return this.registry.isEmpty();
    }

    /** Toggles `skipTaskbar` on every window currently in this strip — used while paging strips,
     * so an inactive strip's windows don't clutter the taskbar (docs:
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

    focusFirst(): void {
        this.activateColumn(this.grid.focusFirst());
    }

    focusLast(): void {
        this.activateColumn(this.grid.focusLast());
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
        this.render();
        this.revealFocused();
    }

    /** Moves the focused column directly to index 0 within the strip — the "jump" form of
     * `moveWindowLeft`, which moves one slot at a time. No-op with no focused column or
     * already at the start. */
    moveWindowToStart(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const currentIndex = this.grid.indexOf(focused.id);
        if (currentIndex <= 0) {
            return;
        }
        this.grid.moveColumn(focused.id, 0);
        this.render();
        this.revealFocused();
    }

    /** Moves the focused column directly to the last index — see `moveWindowToStart`. */
    moveWindowToEnd(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const lastIndex = this.grid.columns().length - 1;
        const currentIndex = this.grid.indexOf(focused.id);
        if (currentIndex >= lastIndex) {
            return;
        }
        this.grid.moveColumn(focused.id, lastIndex);
        this.render();
        this.revealFocused();
    }

    /** Grows the focused column's width by `columnWidthStep`, without changing focus —
     * the keyboard equivalent of dragging the column's right edge. No-op with no focused
     * column. */
    increaseColumnWidth(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        this.grid.resizeColumn(focused.id, focused.width + this.settings.columnWidthStep);
        this.render();
        this.revealFocused();
    }

    /** Shrinks the focused column's width by `columnWidthStep`, clamped at
     * `columnWidthStep` itself so it never reaches zero — see
     * `increaseColumnWidth`. */
    decreaseColumnWidth(): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        const target = Math.max(this.settings.columnWidthStep, focused.width - this.settings.columnWidthStep);
        this.grid.resizeColumn(focused.id, target);
        this.render();
        this.revealFocused();
    }

    /** Moves the focused tile up within the focused column's stack, swapping position with
     * its neighbor. No-op if there's no focused column, it's not a stack, or the tile is
     * already at the top. Returns whether it actually moved — callers (e.g. the keyboard
     * Meta+Ctrl+Up shortcut) use `false` as the signal to fall back to expelling the tile
     * to the strip above instead. */
    moveTileUp(): boolean {
        return this.moveTile((column) => column.moveFocusedTileUp());
    }

    /** Moves the focused tile down within the focused column's stack, swapping position with
     * its neighbor. No-op if there's no focused column, it's not a stack, or the tile is
     * already at the bottom. Returns whether it actually moved — see `moveTileUp`. */
    moveTileDown(): boolean {
        return this.moveTile((column) => column.moveFocusedTileDown());
    }

    /** Grows the focused tile's height by `windowHeightStep`, taking the space from a
     * neighbor in the same stack — the keyboard equivalent of drag-resizing a tile
     * boundary. No-op on a single-tile column or with no focused column. Returns whether
     * it actually grew. */
    increaseWindowHeight(): boolean {
        return this.moveTile((column) => column.growFocusedTile(this.settings.windowHeightStep));
    }

    /** Shrinks the focused tile's height by `windowHeightStep` — see `increaseWindowHeight`. */
    decreaseWindowHeight(): boolean {
        return this.moveTile((column) => column.shrinkFocusedTile(this.settings.windowHeightStep));
    }

    private moveTile(move: (column: Column) => boolean): boolean {
        const column = this.grid.focusedColumn();
        if (column === null) {
            return false;
        }
        if (!move(column)) {
            return false;
        }
        this.render();
        this.revealFocused();
        return true;
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
     * stack (docs: 2026-09-03-vertical-tiling-design). Deliberately does not forget the
     * absorbed window's tile y/height motion: its old position is exactly the intended
     * starting point for the stack-entry animation, not a stale value to discard (docs:
     * 2026-09-07-stack-and-release-motion-design). */
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
     * bookkeeping changes at all (docs: 2026-09-03-drag-to-stack-design). Also deliberately
     * does not forget the moved window's tile y/height motion — see `absorbRight`. */
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void {
        const toTileId = this.grid.moveTileIntoColumn(fromColumnId, fromTileId, toColumnId, slot);
        this.registry.moveWindow(fromColumnId, fromTileId, toColumnId, toTileId);
        this.fullScreenTiles.delete(this.tileKey(fromColumnId, fromTileId));
        this.minimizedTiles.delete(this.tileKey(fromColumnId, fromTileId));
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

    /** Sets the focused column's width directly — used once, right after a window is
     * created, to apply a window rule's `width` (docs: 2026-09-06-window-rules-design).
     * A no-op if nothing is focused (shouldn't happen on the caller's actual call path,
     * since `Grid.addColumn` always focuses the column it just created). */
    setFocusedColumnWidth(width: number): void {
        const focused = this.grid.focusedColumn();
        if (focused === null) {
            return;
        }
        focused.setWidth(width);
        // Rest the width channel at the new value so the rule applies instantly: a window
        // rule is part of the window's first appearance, which never animates.
        for (const tile of focused.tiles()) {
            const win = this.registry.get(focused.id, tile.id);
            if (win) {
                this.seedMotionFrom(win.id, { width });
            }
        }
        this.render();
    }

    /** Jumps the focused column directly to `align`'s edge/center, without cycling through
     * phases the way `cycleAlignLeft`/`cycleAlignRight` do — used once, right after a window
     * is created, to apply a window rule's `align` (docs: 2026-09-06-window-rules-design).
     * Deliberately duplicates cycleAlign's screen-resolution logic instead of factoring it
     * out: cycleAlign's own multi-monitor wraparound behavior is separately tuned and
     * tested, and this method doesn't need it. */
    alignFocusedColumn(align: ColumnAlign): void {
        const focused = this.grid.focusedColumn();
        if (focused === null || focused.hidden) {
            return;
        }
        const rect = this.grid.columnRect(focused.id);
        const screens = this.marginedScreenBounds();
        const offset = this.viewport.offset();
        const screenIndex = currentScreenIndex(rect.x, rect.width, offset, screens);
        const screen = screenIndex === null ? { left: 0, width: this.viewport.viewportWidth() } : screens[screenIndex];
        const offsets = alignOffsets(rect.x, rect.width, screen);
        const target = align === 'left' ? offsets.left : align === 'right' ? offsets.right : offsets.center;
        this.animator.animate(offset, target, this.settings.animationDurationMs);
    }

    private animateViewportTo(target: number): void {
        this.animator.animate(this.viewport.offset(), target, this.settings.animationDurationMs);
    }

    private shiftViewport(delta: number): void {
        this.animateViewportTo(this.viewport.offset() + delta);
    }

    /** Pans the camera without touching focus — unlike focusLeft/Right and cycleAlign,
     * which both move or reposition the focused column itself. */
    shiftViewportLeft(): void {
        this.shiftViewport(this.settings.viewportShiftStep);
    }

    shiftViewportRight(): void {
        this.shiftViewport(-this.settings.viewportShiftStep);
    }

    /** Pans directly to the strip's leftmost content edge, without changing focus —
     * the "jump" form of `shiftViewportLeft`, which pans by a fixed step. */
    shiftViewportToStart(): void {
        this.animateViewportTo(this.viewport.contentLeft());
    }

    /** Pans directly to the strip's rightmost content edge — see `shiftViewportToStart`.
     * Falls back to `contentLeft()` when the content is narrower than the viewport (there
     * is no further edge to reveal), the same floor `Viewport`'s own private `maxOffset()`
     * uses internally. */
    shiftViewportToEnd(): void {
        const start = this.viewport.contentLeft();
        const end = start + this.viewport.contentWidth() - this.viewport.viewportWidth();
        this.animateViewportTo(Math.max(start, end));
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
        const screens = this.marginedScreenBounds();
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
            resizeTile: (columnId, tileId, height, edge) =>
                this.grid.column(columnId)?.resizeTile(tileId, height, edge) ?? false,
            hideColumn: (columnId) => {
                this.forgetColumnMotion(columnId);
                this.grid.hideColumn(columnId);
            },
            showColumn: (columnId) => this.grid.showColumn(columnId),
            hideTile: (columnId, tileId) => {
                const column = this.grid.column(columnId);
                if (column !== null && column.tileCount() > 1) {
                    this.minimizedTiles.add(this.tileKey(columnId, tileId));
                    const win = this.registry.get(columnId, tileId);
                    if (win) {
                        this.forgetMotion(win.id);
                    }
                    return;
                }
                this.forgetColumnMotion(columnId);
                this.grid.hideColumn(columnId);
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
                    const win = this.registry.get(columnId, tileId);
                    if (win) {
                        this.forgetMotion(win.id);
                    }
                } else {
                    this.fullScreenTiles.delete(key);
                }
            },
            render: (excludeWindowId, instant) => this.render(excludeWindowId, instant),
            revealFocused: () => this.revealFocused(),
            isFullScreenGeometry: (win) => this.workspaceAdapter.isFullScreenGeometry(win),
            seedMotionFromCurrentGeometry: (win) => this.seedMotionFromCurrentGeometry(win),
        };
    }
}
