// Turns a window's interactive-move lifecycle into a live column reorder or a live
// drag-to-stack, deciding per tick between the two via a priority check (docs:
// 2026-09-04-drag-reorder-stack-priority-design): reorder — the dragged window's own
// edge crossing a neighbor's center (`Grid.insertionIndexForEdges`) — is checked
// first and, when it fires, commits `Grid.moveColumn` immediately, live, exactly as
// it did before drag-to-stack existed. Only when reorder does NOT fire this tick is
// stack considered: whichever column the real mouse pointer (not the dragged
// window's geometry) currently sits over, gated by a dwell timer so a drag merely
// passing through on its way to a reorder swap never flashes a stack preview. Stack
// stays preview-only until release, unlike reorder — the two triggers use different
// measurements and different timing, so they never contest the same tick. Hovering
// the dragged tile's own column (same-column reorder-within-stack) is unaffected by
// any of this and keeps working exactly as before, with no dwell.

import { Column } from '../core/column';
import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { debug } from '../debug';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { StackPreview } from '../runtime/strip';
import { EdgeDwell } from '../viewport/edge-dwell';
import { Viewport } from '../viewport/viewport';
import { resolveStackSlot, StackHover } from './drag-hover';

/** Minimal view of `ColumnRegistry` this module needs — resolving the dragged
 * window's CURRENT column/tile fresh on every tick, rather than closing over a
 * fixed id captured once at connection time. That fixed-id approach was the
 * pre-existing bug: a window that became a stacked tile via `absorbRight` kept a
 * stale connection pointing at its original, since-removed column id, so dragging
 * an already-stacked tile's title bar never worked correctly
 * (docs: 2026-09-03-drag-to-stack-design). */
export interface DragRegistryView {
    tileOf(windowId: string): { columnId: number; tileId: number } | null;
    moveWindow(fromColumnId: number, fromTileId: number, toColumnId: number, toTileId: number): void;
}

export interface DragReorderDeps {
    grid: Grid;
    registry: DragRegistryView;
    viewport: Viewport;
    area: Rect;
    render(excludeWindowId?: string, instant?: boolean, verticalOffsetY?: undefined, stackPreview?: StackPreview): void;
    /** Real mouse pointer position, in real (screen) coordinates — used for stack-zone
     * hover, not the dragged window's own geometry: a window is typically grabbed away
     * from its center (e.g. near the titlebar), so relying on the window's edge either
     * overshoots or never crosses at all (docs: 2026-09-04-drag-reorder-stack-priority-design). */
    cursorPos(): { x: number; y: number };
    /** Builds a dwell timer armed on a neighbor column id, firing `onFire` once hovered
     * past `columnDragDwellMs` — one instance per drag-reorder connection, reused across
     * every drag that window does. */
    createStackDwell(onFire: (columnId: number) => void): EdgeDwell<number>;
    snapColumn(columnId: number): void;
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void;
    /** Row-crossing hooks (docs: 2026-09-02-cross-row-drag-design) — StripStack supplies
     * these to watch the pointer's vertical position on every drag tick without a second,
     * independent signal connection on the same window. All optional; omitted when not
     * row-aware (e.g. a Strip used outside a StripStack). */
    onDragStarted?(win: WindowAdapter): void;
    onDragTick?(win: WindowAdapter): void;
    onDragFinished?(): void;
    /** Called once, after the dragged column has settled into its final grid slot on
     * release — scrolls it back into view if a reorder near the strip's edge pushed that
     * slot (partially) outside the viewport. Never called mid-drag: doing so would fight
     * the live KWin interactive move (same rationale as skipping reveal on a mid-drag add,
     * see `Strip.addWindow`). */
    revealFocused(): void;
}

/** `win`'s own current left/right edges, in virtual x — what reorder measures against
 * a neighbor's center (docs: 2026-09-04-drag-reorder-stack-priority-design). */
function windowEdgesVirtualX(win: WindowAdapter, area: Rect, viewportOffsetX: number): { left: number; right: number } {
    const rect = win.frameGeometry();
    return {
        left: toVirtualX(rect.x, area, viewportOffsetX),
        right: toVirtualX(rect.x + rect.width, area, viewportOffsetX),
    };
}

/** Fetches `columnId`'s `Column`, throwing a descriptive error instead of silently
 * dereferencing null if the registry and grid have desynced — the exact failure mode
 * `DragRegistryView.tileOf`-based location resolution is meant to prevent, but this
 * file is glue code with no direct test coverage, so a clear error here matters more
 * than in tested core code. */
function requireColumn(grid: Grid, columnId: number): Column {
    const column = grid.column(columnId);
    if (column === null) {
        throw new Error(`Unknown column id: ${columnId}`);
    }
    return column;
}

/** Wires `win`'s move lifecycle to reorder or stack live, and to settle it on
 * release. `initiallyDragging` seeds the local dragging state for a connection
 * created mid-drag — e.g. when a cross-row move reparents the window into a new
 * row's Strip while the user is still holding the drag (docs:
 * 2026-09-02-cross-row-drag-design): the new connection never sees
 * `interactiveMoveResizeStarted`, since it already fired once on the connection this
 * one replaces. Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, deps: DragReorderDeps, initiallyDragging = false): () => void {
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which neighbor column id the stack dwell has actually FIRED for — null while
     * merely hovering, before the dwell elapses. Only a fired target shows a preview. */
    let armedStackTarget: number | null = null;

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        debug(`drag started: win=${win.id} isInteractiveMove=${dragging}`);
        if (dragging) {
            deps.onDragStarted?.(win);
        }
    });

    /** Current column/tile the dragged window is registered under. Null only if the
     * window has already been removed from the registry mid-drag (e.g. it closed). */
    const currentLocation = (): { columnId: number; tileId: number } | null => deps.registry.tileOf(win.id);

    /** Expels a stack tile into its own standalone column the first time a drag
     * carries it into a reorder swap — reorder operates on standalone columns, which
     * a stack tile is not. Placement doesn't need to be exact here: subsequent ticks
     * converge it over the next tick or two, the same way a mid-drag row-reparent
     * already tolerates a short convergence window (docs: 2026-09-03-drag-to-stack-design). */
    const expelToStandaloneColumn = (columnId: number, tileId: number): number => {
        const column = requireColumn(deps.grid, columnId);
        column.removeTile(tileId);
        const newColumn = deps.grid.addColumn(win.frameGeometry().width);
        deps.registry.moveWindow(columnId, tileId, newColumn.id, newColumn.tiles()[0].id);
        return newColumn.id;
    };

    /** Resolves the standalone column id a reorder swap should operate on for
     * `location` — the tile's own column if it's already standalone (single-tile), or a
     * freshly expelled one otherwise. */
    const resolveReorderColumn = (location: { columnId: number; tileId: number }): number => {
        const homeColumn = requireColumn(deps.grid, location.columnId);
        return homeColumn.tileCount() === 1
            ? location.columnId
            : expelToStandaloneColumn(location.columnId, location.tileId);
    };

    /** Renders a live stack-entry preview for `slot` within `hoverColumnId`, and remembers
     * it as `lastStackHover` for the eventual release commit. Shared by same-column hover
     * (no dwell) and cross-column hover (dwell-gated, see `stackDwell` below) — both
     * resolve a slot the same way, via `resolveStackSlot`. */
    const renderStackPreview = (
        location: { columnId: number; tileId: number },
        hoverColumnId: number,
        slot: number,
    ): void => {
        lastStackHover = { columnId: hoverColumnId, slot };
        const sameColumn = hoverColumnId === location.columnId;
        if (sameColumn) {
            // Same-column reorder commits via Column.moveTile, which never redistributes
            // height — so the dragged tile's own current height is already what it will
            // actually end up at. Using anything else here would fight what's about to happen.
            deps.render(win.id, false, undefined, {
                enteringColumnId: hoverColumnId,
                enteringIndex: slot,
                enteringGapHeight: win.frameGeometry().height,
                enteringExcludeTileId: location.tileId,
            });
            return;
        }
        // Cross-column: the eventual commit (Column.insertTileAt) evenly redistributes the
        // target column's total height across its existing tiles PLUS the incoming one — so
        // approximate that here instead of using the dragged window's own current height
        // (which, for a standalone column's tile, is the ENTIRE column height and would
        // reserve a wildly oversized gap in the target stack for the whole hover;
        // docs: 2026-09-03-drag-to-stack-design).
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const targetColumn = requireColumn(deps.grid, hoverColumnId);
        const targetTiles = targetColumn.tiles();
        const targetTotalHeight = targetTiles.reduce((sum, tile) => sum + tile.height, 0);
        const gapHeight = targetTotalHeight / (targetTiles.length + 1);
        const stackPreview: StackPreview = {
            enteringColumnId: hoverColumnId,
            enteringIndex: slot,
            enteringGapHeight: gapHeight,
        };
        if (homeColumn.tileCount() > 1) {
            stackPreview.leavingColumnId = location.columnId;
            stackPreview.leavingTileId = location.tileId;
        }
        deps.render(win.id, false, undefined, stackPreview);
    };

    // Fires once the pointer has held over a neighbor column past columnDragDwellMs.
    // Recomputes fresh against the pointer's CURRENT position rather than whatever it was
    // when the dwell armed — the dwell's own timer tick is independent of frameGeometryChanged,
    // so a few more pixels of drag may have happened since.
    const stackDwell = deps.createStackDwell((columnId) => {
        armedStackTarget = columnId;
        const location = currentLocation();
        if (location === null) {
            return;
        }
        const pointer = deps.cursorPos();
        const pointerY = pointer.y - deps.area.y;
        const slot = resolveStackSlot(deps.grid, columnId, location.columnId, location.tileId, pointerY);
        if (slot === null) {
            return;
        }
        renderStackPreview(location, columnId, slot);
    });

    const tickInner = (): void => {
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const pointer = deps.cursorPos();
        const pointerVirtualX = toVirtualX(pointer.x, deps.area, deps.viewport.offset());
        const pointerY = pointer.y - deps.area.y;
        const pointerColumnId = deps.grid.columnAtVirtualX(pointerVirtualX);

        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)}) ` +
                `pointer=(${pointerVirtualX.toFixed(0)},${pointerY.toFixed(0)}) pointerCol=${pointerColumnId}`,
        );

        if (pointerColumnId === null) {
            stackDwell.update(null);
            armedStackTarget = null;
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }

        if (pointerColumnId === location.columnId) {
            // Home territory: same-column tile reorder, unaffected by dwell.
            stackDwell.update(null);
            armedStackTarget = null;
            const slot = resolveStackSlot(deps.grid, location.columnId, location.columnId, location.tileId, pointerY);
            if (slot === null) {
                lastStackHover = null;
                deps.render(win.id, false);
                return;
            }
            renderStackPreview(location, location.columnId, slot);
            return;
        }

        // Cross-column: reorder is checked first, live — restored original behavior.
        const homeIndex = deps.grid.indexOf(location.columnId);
        const reorderIndex = deps.grid.insertionIndexForEdges(location.columnId, winEdges.left, winEdges.right);
        if (reorderIndex !== homeIndex) {
            debug(`drag tick: reorder triggered col${location.columnId} idx${homeIndex}->${reorderIndex}`);
            stackDwell.update(null);
            armedStackTarget = null;
            lastStackHover = null;
            const columnId = resolveReorderColumn(location);
            // Recompute fresh: expulsion may have appended a new column, shifting indices.
            const finalIndex = deps.grid.insertionIndexForEdges(columnId, winEdges.left, winEdges.right);
            deps.grid.moveColumn(columnId, finalIndex);
            deps.render(win.id, false);
            return;
        }

        // Reorder didn't fire: pointer sits over a neighbor -> stack dwell territory.
        if (armedStackTarget !== null && armedStackTarget !== pointerColumnId) {
            armedStackTarget = null; // left the previously-armed neighbor; re-arm fresh below
        }
        stackDwell.update(pointerColumnId);
        if (armedStackTarget !== pointerColumnId) {
            // Not armed for this neighbor yet — dwell still counting, no preview.
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }
        const slot = resolveStackSlot(deps.grid, pointerColumnId, location.columnId, location.tileId, pointerY);
        if (slot === null) {
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }
        renderStackPreview(location, pointerColumnId, slot);
    };

    // TEMPORARY DEBUG INSTRUMENTATION: writes to the OSD debug console (Meta+Shift+D)
    // to diagnose reports of drag behavior mismatching expectations. Remove once no
    // further live-testing rounds are needed.
    const tick = (): void => {
        try {
            tickInner();
        } catch (error) {
            debug(`drag tick ERROR: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`);
        }
    };

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        deps.onDragTick?.(win);
    });

    const finishedInner = (): void => {
        if (!dragging) {
            debug('drag finished: ignored, dragging flag already false');
            return;
        }
        dragging = false;
        stackDwell.stop();
        armedStackTarget = null;
        const location = currentLocation();
        debug(
            `drag finished: win=${win.id} loc=${location ? `col${location.columnId}/tile${location.tileId}` : 'null'}`,
        );
        if (location === null) {
            deps.onDragFinished?.();
            return;
        }
        if (lastStackHover === null) {
            // Reorder already committed live, tick by tick — nothing left to apply here
            // except settling the dragged column's own animation at its final real slot.
            deps.snapColumn(location.columnId);
        } else if (lastStackHover.columnId === location.columnId) {
            requireColumn(deps.grid, location.columnId).moveTile(location.tileId, lastStackHover.slot);
        } else {
            deps.commitTileIntoStack(location.columnId, location.tileId, lastStackHover.columnId, lastStackHover.slot);
        }
        lastStackHover = null;
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    };

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        try {
            finishedInner();
        } catch (error) {
            debug(
                `drag finished ERROR: ${error instanceof Error ? `${error.message}\n${error.stack}` : String(error)}`,
            );
            dragging = false;
            stackDwell.stop();
            armedStackTarget = null;
            lastStackHover = null;
            deps.onDragFinished?.();
        }
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
        stackDwell.stop();
    };
}
