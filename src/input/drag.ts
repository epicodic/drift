// Turns a window's interactive-move lifecycle into a live column reorder or a live
// drag-to-stack, deciding per tick between the two via `resolveStackHover` and
// `resolveReorderTarget` (docs: 2026-09-03-drag-to-stack-design). Both are derived
// from the SAME measurement — the dragged tile's own center's local fraction within
// whichever column currently contains it — so the reorder zone (outer quarter) and
// stack zone (middle half) are mutually exclusive and exhaustive by construction.
// Both modes are ALSO render-only until release, with exactly one real model
// mutation on `interactiveMoveResizeFinished` (matching whichever hover state is
// current at that instant): the target (and, for a cross-column drag out of an
// existing stack, the source) column's tiles preview-reflow to open/close a gap for
// stacking, or the affected columns preview-slide to their would-be positions for
// reordering, via `ReorderPreview`/`Grid.previewOffsetsWithColumnAt`. Reorder used
// to commit `Grid.moveColumn` live, every tick, off the dragged window's own EDGE
// crossing a neighbor's CENTER — that live commit is what made stacking
// geometrically unreachable in practice: the moment a swap landed, it relabeled the
// neighbor's entire spatial territory as belonging to the dragged column, so the
// cursor could never again be observed hovering a DIFFERENT column's true middle
// 50% during one continuous drag (proven empirically, not just by inspection — see
// the design doc's bugfix note). Deferring the commit to release, exactly like
// stacking already did, removes that capture entirely: `Grid.ordered` never changes
// mid-drag, so `resolveStackHover`/`resolveReorderTarget`'s column lookups stay
// stable and reachable throughout. The window's own real geometry is never touched
// while dragging in either mode — it keeps following the cursor untouched
// throughout.

import { Column } from '../core/column';
import { Rect } from '../core/coordinates';
import { Grid } from '../core/grid';
import { toVirtualX } from '../kwin/geometry-sync';
import { WindowAdapter } from '../kwin/window-adapter';
import { ReorderPreview, StackPreview } from '../runtime/strip';
import { Viewport } from '../viewport/viewport';
import { resolveReorderTarget, resolveStackHover, StackHover } from './drag-hover';

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
    render(
        excludeWindowId?: string,
        instant?: boolean,
        verticalOffsetY?: undefined,
        stackPreview?: StackPreview,
        reorderPreview?: ReorderPreview,
    ): void;
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

/** Virtual x of `win`'s own center, and its real y-center relative to `area` — the
 * anchor stack-hover resolution uses, since a column/tile's own middle-zone/slot
 * detection is naturally center-based rather than edge-based
 * (docs: 2026-09-03-drag-to-stack-design). */
function windowCenter(win: WindowAdapter, area: Rect, viewportOffsetX: number): { virtualX: number; y: number } {
    const rect = win.frameGeometry();
    return {
        virtualX: toVirtualX(rect.x + rect.width / 2, area, viewportOffsetX),
        y: rect.y + rect.height / 2 - area.y,
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

    const disconnectStarted = win.onInteractiveMoveResizeStarted(() => {
        dragging = win.isInteractiveMove();
        if (dragging) {
            deps.onDragStarted?.(win);
        }
    });

    /** Current column/tile the dragged window is registered under. Null only if the
     * window has already been removed from the registry mid-drag (e.g. it closed). */
    const currentLocation = (): { columnId: number; tileId: number } | null => deps.registry.tileOf(win.id);

    /** Expels a stack tile into its own standalone column the first time a drag
     * carries it from a stack zone into a reorder zone — `resolveReorderCommit`
     * requires the dragged window to already own a real, standalone Grid column,
     * which a stack tile does not. Placement doesn't need to be exact here:
     * subsequent ticks converge it over the next tick or two, the same way a
     * mid-drag row-reparent already tolerates a short convergence window
     * (docs: 2026-09-03-drag-to-stack-design). */
    const expelToStandaloneColumn = (columnId: number, tileId: number): number => {
        const column = requireColumn(deps.grid, columnId);
        column.removeTile(tileId);
        const newColumn = deps.grid.addColumn(win.frameGeometry().width);
        deps.registry.moveWindow(columnId, tileId, newColumn.id, newColumn.tiles()[0].id);
        return newColumn.id;
    };

    /** Resolves the standalone column id a reorder swap should operate on for
     * `location` — the tile's own column if it's already standalone (single-tile), or a
     * freshly expelled one otherwise. Shared by `tick()`'s reorder-zone branch and the
     * release handler's reorder-zone branch, since both need the same resolution before
     * calling `resolveReorderCommit`. */
    const resolveReorderColumn = (location: { columnId: number; tileId: number }): number => {
        const homeColumn = requireColumn(deps.grid, location.columnId);
        return homeColumn.tileCount() === 1
            ? location.columnId
            : expelToStandaloneColumn(location.columnId, location.tileId);
    };

    /** Resolves what a reorder commit WOULD do for `location` at `virtualXCenter`,
     * without doing it: expelling a currently-stacked tile to standalone is still
     * resolved eagerly (see `resolveReorderColumn`) — it's a one-time, idempotent
     * transition that doesn't repeatedly contest the same territory the way a swap
     * does — but the actual `Grid.moveColumn` swap is left to the caller, which
     * decides whether to preview it (`tick`) or commit it for real
     * (`interactiveMoveResizeFinished`). Returns null when the center is still
     * within its own column: nothing to reorder into yet. */
    const resolveReorderCommit = (
        location: { columnId: number; tileId: number },
        virtualXCenter: number,
    ): { columnId: number; targetIndex: number } | null => {
        const reorderTargetId = resolveReorderTarget(deps.grid, location.columnId, virtualXCenter);
        if (reorderTargetId === null) {
            return null;
        }
        const columnId = resolveReorderColumn(location);
        return { columnId, targetIndex: deps.grid.indexOf(reorderTargetId) };
    };

    const tick = (): void => {
        const location = currentLocation();
        if (location === null) {
            return;
        }
        const center = windowCenter(win, deps.area, deps.viewport.offset());
        const hover = resolveStackHover(deps.grid, location.columnId, location.tileId, center.virtualX, center.y);

        if (hover === null) {
            // Reorder zone: preview only, nothing committed until release — mirrors stack
            // mode exactly, and is what keeps a live swap from "capturing" a neighbor's
            // territory and making its stack zone unreachable (see the module doc comment).
            lastStackHover = null;
            const commit = resolveReorderCommit(location, center.virtualX);
            if (commit === null) {
                deps.render(win.id, false); // clear any stale preview from a moment ago
                return;
            }
            deps.render(win.id, false, undefined, undefined, commit);
            return;
        }

        // Stack zone: preview only, nothing committed until release.
        lastStackHover = hover;
        const sameColumn = hover.columnId === location.columnId;
        if (sameColumn) {
            // Same-column reorder commits via Column.moveTile, which never redistributes
            // height — so the dragged tile's own current height is already what it will
            // actually end up at. Using anything else here would fight what's about to happen.
            deps.render(win.id, false, undefined, {
                enteringColumnId: hover.columnId,
                enteringIndex: hover.slot,
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
        const targetColumn = requireColumn(deps.grid, hover.columnId);
        const targetTiles = targetColumn.tiles();
        const targetTotalHeight = targetTiles.reduce((sum, tile) => sum + tile.height, 0);
        const gapHeight = targetTotalHeight / (targetTiles.length + 1);
        const stackPreview: StackPreview = {
            enteringColumnId: hover.columnId,
            enteringIndex: hover.slot,
            enteringGapHeight: gapHeight,
        };
        if (homeColumn.tileCount() > 1) {
            stackPreview.leavingColumnId = location.columnId;
            stackPreview.leavingTileId = location.tileId;
        }
        deps.render(win.id, false, undefined, stackPreview);
    };

    const disconnectGeometryChanged = win.onFrameGeometryChanged(() => {
        if (!dragging) {
            return;
        }
        tick();
        deps.onDragTick?.(win);
    });

    const disconnectFinished = win.onInteractiveMoveResizeFinished(() => {
        if (!dragging) {
            return;
        }
        dragging = false;
        const location = currentLocation();
        if (location === null) {
            deps.onDragFinished?.();
            return;
        }
        if (lastStackHover === null) {
            // The one real reorder mutation, if any: recomputed fresh against the window's
            // final geometry rather than trusting a cached mid-drag value (nothing in the
            // real Grid has moved yet — see `resolveReorderCommit` — so this is exactly the
            // same decision `tick()` would make one more time, now actually applied).
            const center = windowCenter(win, deps.area, deps.viewport.offset());
            const commit = resolveReorderCommit(location, center.virtualX);
            const columnId = commit === null ? location.columnId : commit.columnId;
            if (commit !== null) {
                deps.grid.moveColumn(commit.columnId, commit.targetIndex);
            }
            deps.snapColumn(columnId);
        } else if (lastStackHover.columnId === location.columnId) {
            requireColumn(deps.grid, location.columnId).moveTile(location.tileId, lastStackHover.slot);
        } else {
            deps.commitTileIntoStack(location.columnId, location.tileId, lastStackHover.columnId, lastStackHover.slot);
        }
        lastStackHover = null;
        deps.render();
        deps.revealFocused();
        deps.onDragFinished?.();
    });

    return () => {
        disconnectStarted();
        disconnectGeometryChanged();
        disconnectFinished();
    };
}
