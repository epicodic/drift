// Turns a window's interactive-move lifecycle into a live column reorder or a live
// drag-to-stack (docs: 2026-09-07-drag-reorder-stack-refinement-design). Reorder —
// the dragged window's own edge penetrating a neighbor past `reorderThresholdFraction`
// of its width (`Grid.insertionIndexForEdges`) — is checked first and, when it fires,
// commits `Grid.moveColumn` immediately, live. Only when reorder does NOT fire this
// tick is stacking considered: candidates are gathered purely from the dragged tile's
// own geometry — its column's siblings plus both immediate neighbor columns' tiles —
// and resolved by `resolveStackTarget`'s overlap-gate + top-edge-band, dwell-gated by
// `EdgeDwell` exactly like reorder's neighbor used to be, now applied uniformly to
// same-column and cross-column hovers alike. Stack stays preview-only until release,
// unlike reorder.

import { Column } from '../core/column';
import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { debug } from '../debug';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { StackPreview } from '../runtime/strip';
import { EdgeDwell } from '../viewport/edge-dwell';
import { Viewport } from '../viewport/viewport';
import { resolveStackTarget, stackTargetIndex, StackCandidate, StackTarget } from './drag-hover';

/** The dragged tile's resolved stack landing spot, ready to commit on release —
 * `columnId`/`slot` identify the target column and tile-list index. */
interface StackHover {
    columnId: number;
    slot: number;
}

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
    /** Fraction of a neighbor's width a reorder swap must penetrate before it fires
     * (`settings.reorderThresholdFraction`) — see `Grid.insertionIndexForEdges`. */
    reorderThresholdFraction: number;
    /** Minimum horizontal overlap a candidate tile needs before it's considered for
     * stacking (`settings.stackOverlapFraction`) — see `resolveStackTarget`. */
    stackOverlapFraction: number;
    render(excludeWindowId?: string, instant?: boolean, verticalOffsetY?: undefined, stackPreview?: StackPreview): void;
    /** Builds a dwell timer armed on a resolved stack target's compound key
     * (`` `${columnId}:${tileId}:${direction}` ``), firing `onFire` once hovered past
     * `columnDragDwellMs` — one instance per drag-reorder connection, reused across
     * every drag that window does. Applied uniformly to same-column and cross-column
     * stack hovers alike (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    createStackDwell(onFire: (key: string) => void): EdgeDwell<string>;
    /** Seeds the dragged column's x (and the window's own y/height) motion at its
     * actual drop position on a reorder settle, so it eases into its final slot instead
     * of snapping (docs: 2026-09-07-stack-and-release-motion-design). */
    seedReorderRelease(windowId: string, columnId: number, virtualX: number, virtualY: number, height: number): void;
    /** Same idea for a stack drop: seeds the dropped tile's y/height at its actual drop
     * position (column x is intentionally left alone for a cross-column drop — docs:
     * 2026-09-07-stack-and-release-motion-design). */
    seedStackRelease(windowId: string, virtualY: number, height: number): void;
    commitTileIntoStack(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): void;
    /** Strip-crossing hooks (docs: 2026-09-02-cross-row-drag-design) — StripStack supplies
     * these to watch the pointer's vertical position on every drag tick without a second,
     * independent signal connection on the same window. All optional; omitted when not
     * strip-aware (e.g. a Strip used outside a StripStack). */
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

/** `win`'s own current rect, in virtual x / area-relative y — the same coordinate
 * space `Grid.columnRect`/`Column.tileRect` already produce, so it can be compared
 * directly against a candidate tile's rect (docs:
 * 2026-09-07-drag-reorder-stack-refinement-design). */
function windowRectVirtual(win: WindowAdapter, area: Rect, viewportOffsetX: number): Rect {
    const rect = win.frameGeometry();
    return {
        x: toVirtualX(rect.x, area, viewportOffsetX),
        y: rect.y - area.y,
        width: rect.width,
        height: rect.height,
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
 * created mid-drag — e.g. when a cross-strip move reparents the window into a new
 * strip while the user is still holding the drag (docs:
 * 2026-09-02-cross-row-drag-design): the new connection never sees
 * `interactiveMoveResizeStarted`, since it already fired once on the connection this
 * one replaces. Returns a disconnect function. */
export function registerDragReorder(win: WindowAdapter, deps: DragReorderDeps, initiallyDragging = false): () => void {
    let dragging = initiallyDragging;
    let lastStackHover: StackHover | null = null;
    /** Which stack target's compound key (`` `${columnId}:${tileId}:${direction}` ``) the
     * dwell has actually FIRED for — null while merely hovering, before the dwell elapses.
     * Only a fired key shows a preview. */
    let armedStackKey: string | null = null;

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
     * converge it over the next tick or two, the same way a mid-drag strip-reparent
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

    /** Renders a live stack-entry preview for `target`, and remembers the resulting
     * `{columnId, slot}` as `lastStackHover` for the eventual release commit. Shared by
     * same-column and cross-column hover alike — both resolve a target the same way, via
     * `resolveStackTarget`. */
    const renderStackPreview = (location: { columnId: number; tileId: number }, target: StackTarget): void => {
        const targetColumn = requireColumn(deps.grid, target.columnId);
        const sameColumn = target.columnId === location.columnId;
        const targetTiles = sameColumn
            ? targetColumn.tiles().filter((tile) => tile.id !== location.tileId)
            : targetColumn.tiles();
        const slot = stackTargetIndex(target, targetTiles);
        lastStackHover = { columnId: target.columnId, slot };
        if (sameColumn) {
            // Same-column reorder commits via Column.moveTile, which never redistributes
            // height — so the dragged tile's own current height is already what it will
            // actually end up at. Using anything else here would fight what's about to happen.
            deps.render(win.id, false, undefined, {
                enteringColumnId: target.columnId,
                enteringIndex: slot,
                enteringGapHeight: win.frameGeometry().height,
                enteringExcludeTileId: location.tileId,
            });
            return;
        }
        // Cross-column: the eventual commit (Column.insertTileAt) evenly redistributes the
        // target column's total height across its existing tiles PLUS the incoming one — so
        // approximate that here instead of using the dragged window's own current height
        // (docs: 2026-09-03-drag-to-stack-design).
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const targetTotalHeight = targetTiles.reduce((sum, tile) => sum + tile.height, 0);
        const gapHeight = targetTotalHeight / (targetTiles.length + 1);
        const stackPreview: StackPreview = {
            enteringColumnId: target.columnId,
            enteringIndex: slot,
            enteringGapHeight: gapHeight,
        };
        if (homeColumn.tileCount() > 1) {
            stackPreview.leavingColumnId = location.columnId;
            stackPreview.leavingTileId = location.tileId;
        }
        deps.render(win.id, false, undefined, stackPreview);
    };

    /** Gathers this tick's stack candidates from the dragged window's own geometry alone —
     * its home column's siblings (if it's currently in a multi-tile column) plus both
     * immediate neighbor columns' tiles — and resolves a target from them. No pointer
     * position involved at all (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    const resolveCurrentTarget = (location: { columnId: number; tileId: number }): StackTarget | null => {
        const draggedRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const candidates: StackCandidate[] = [];
        if (homeColumn.tileCount() > 1) {
            const homeRect = deps.grid.columnRect(location.columnId);
            for (const tile of homeColumn.tiles()) {
                if (tile.id === location.tileId) {
                    continue;
                }
                candidates.push({
                    columnId: location.columnId,
                    tileId: tile.id,
                    rect: homeColumn.tileRect(tile.id, homeRect),
                });
            }
        }
        for (const neighborId of deps.grid.visibleNeighborColumnIds(location.columnId)) {
            const neighborColumn = requireColumn(deps.grid, neighborId);
            const neighborRect = deps.grid.columnRect(neighborId);
            for (const tile of neighborColumn.tiles()) {
                candidates.push({
                    columnId: neighborId,
                    tileId: tile.id,
                    rect: neighborColumn.tileRect(tile.id, neighborRect),
                });
            }
        }
        return resolveStackTarget(draggedRect, candidates, deps.stackOverlapFraction);
    };

    // Fires once the resolved stack target has held steady past columnDragDwellMs.
    // Recomputes fresh against the window's CURRENT geometry rather than whatever it was
    // when the dwell armed — the dwell's own timer tick is independent of
    // frameGeometryChanged, so a few more pixels of drag may have happened since.
    const stackDwell = deps.createStackDwell((key) => {
        const location = currentLocation();
        if (location === null) {
            return;
        }
        const target = resolveCurrentTarget(location);
        if (target === null) {
            return;
        }
        const currentKey = `${target.columnId}:${target.tileId}:${target.direction}`;
        if (currentKey !== key) {
            return; // moved on before the dwell fired; the next regular tick will reconcile
        }
        armedStackKey = key;
        renderStackPreview(location, target);
    });

    const tickInner = (): void => {
        const location = currentLocation();
        if (location === null) {
            debug('drag tick: currentLocation() is null (window not in registry)');
            return;
        }

        const winEdges = windowEdgesVirtualX(win, deps.area, deps.viewport.offset());
        const homeColumn = requireColumn(deps.grid, location.columnId);
        const homeIndex = deps.grid.indexOf(location.columnId);

        const raw = win.frameGeometry();
        debug(
            `drag tick: win=${win.id} loc=col${location.columnId}/tile${location.tileId} ` +
                `winEdges=(${winEdges.left.toFixed(0)},${winEdges.right.toFixed(0)}) ` +
                `raw=(${raw.x.toFixed(0)},${raw.y.toFixed(0)},${raw.width.toFixed(0)},${raw.height.toFixed(0)}) ` +
                `viewportOffset=${deps.viewport.offset().toFixed(0)}`,
        );

        // Reorder: checked first, live — the dragged column's own edge penetrating a
        // neighbor past reorderThresholdFraction of its width.
        const reorderIndex = deps.grid.insertionIndexForEdges(
            location.columnId,
            winEdges.left,
            winEdges.right,
            deps.reorderThresholdFraction,
        );
        if (reorderIndex !== homeIndex) {
            debug(`drag tick: reorder triggered col${location.columnId} idx${homeIndex}->${reorderIndex}`);
            stackDwell.update(null);
            armedStackKey = null;
            lastStackHover = null;
            const columnId = resolveReorderColumn(location);
            // Recompute fresh: expulsion may have appended a new column, shifting indices.
            const finalIndex = deps.grid.insertionIndexForEdges(
                columnId,
                winEdges.left,
                winEdges.right,
                deps.reorderThresholdFraction,
            );
            deps.grid.moveColumn(columnId, finalIndex);
            deps.render(win.id, false);
            return;
        }

        // Reorder didn't fire: edge-expel a multi-tile column's own tile past the grid's
        // outer boundary, on a side with no neighbor to reorder against at all.
        if (homeColumn.tileCount() > 1) {
            const expelDirection = deps.grid.expelDirectionForEdges(location.columnId, winEdges.left, winEdges.right);
            if (expelDirection !== null) {
                debug(`drag tick: edge-expel triggered col${location.columnId} dir=${expelDirection}`);
                stackDwell.update(null);
                armedStackKey = null;
                lastStackHover = null;
                const newColumnId = expelToStandaloneColumn(location.columnId, location.tileId);
                const homeIndexAfterExpel = deps.grid.indexOf(location.columnId);
                deps.grid.moveColumn(
                    newColumnId,
                    expelDirection === 'left' ? homeIndexAfterExpel : homeIndexAfterExpel + 1,
                );
                deps.render(win.id, false);
                return;
            }
        }

        // Stack: same mechanism whether the winning candidate is a sibling in the dragged
        // tile's own column or a tile in an immediate neighbor.
        const target = resolveCurrentTarget(location);
        if (target === null) {
            stackDwell.update(null);
            armedStackKey = null;
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }
        const key = `${target.columnId}:${target.tileId}:${target.direction}`;
        stackDwell.update(key);
        if (armedStackKey !== key) {
            // Not armed for this target yet — dwell still counting, no preview.
            lastStackHover = null;
            deps.render(win.id, false);
            return;
        }
        renderStackPreview(location, target);
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
        armedStackKey = null;
        const location = currentLocation();
        debug(
            `drag finished: win=${win.id} loc=${location ? `col${location.columnId}/tile${location.tileId}` : 'null'}`,
        );
        if (location === null) {
            deps.onDragFinished?.();
            return;
        }
        // The window's own actual position/size right at release — the animation's intended
        // starting point, converted to the same virtual-x/area-relative-y coordinate space
        // Grid/Column already produce (docs: 2026-09-07-stack-and-release-motion-design).
        const dropRect = windowRectVirtual(win, deps.area, deps.viewport.offset());
        if (lastStackHover === null) {
            const homeColumn = requireColumn(deps.grid, location.columnId);
            if (homeColumn.tileCount() === 1) {
                // A genuine reorder settled live — this is a standalone column, safe to seed
                // its shared x from this tile's own drop position.
                deps.seedReorderRelease(win.id, location.columnId, dropRect.x, dropRect.y, dropRect.height);
            } else {
                // Nothing committed (no reorder fired, no stack target ever armed) — the tile
                // is just settling back into its own multi-tile stack. Only seed y/height:
                // column x is shared across every tile in the column, and seeding it from this
                // one tile's own live drop position would corrupt its siblings' x for one frame
                // (docs: 2026-09-07-stack-and-release-motion-design).
                deps.seedStackRelease(win.id, dropRect.y, dropRect.height);
            }
        } else {
            deps.seedStackRelease(win.id, dropRect.y, dropRect.height);
            if (lastStackHover.columnId === location.columnId) {
                requireColumn(deps.grid, location.columnId).moveTile(location.tileId, lastStackHover.slot);
            } else {
                deps.commitTileIntoStack(
                    location.columnId,
                    location.tileId,
                    lastStackHover.columnId,
                    lastStackHover.slot,
                );
            }
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
            armedStackKey = null;
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
