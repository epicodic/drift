// Builds a snapshot of one strip's layout + camera for the minimap overlay
// (docs: 2026-09-01-minimap-design, 2026-09-01-minimap-thumbnails-design). Pure and
// KWin-free, mirrors debug/snapshot.ts.

import type { Grid } from '../core/grid';
import type { ColumnRegistry } from '../runtime/column-registry';
import type { Viewport } from '../viewport/viewport';

/** One window in a column's vertical tile stack (docs: 2026-09-03-vertical-tiling-design). A
 * plain single-window column has exactly one, filling the column's full height. */
export interface MinimapTile {
    y: number;
    height: number;
    focused: boolean;
    icon: QIcon | null;
    thumbnail: Window | null;
}

export interface MinimapColumn {
    id: number;
    x: number;
    width: number;
    tiles: MinimapTile[];
}

export interface MinimapViewport {
    offset: number;
    width: number;
    contentLeft: number;
    contentWidth: number;
}

export interface MinimapSnapshot {
    columns: MinimapColumn[];
    viewport: MinimapViewport;
    gridHeight: number;
}

export function buildMinimapSnapshot(
    grid: Grid,
    viewport: Viewport,
    registry: ColumnRegistry,
    offset: number = viewport.offset(),
): MinimapSnapshot {
    const focusedId = grid.focusedColumn()?.id ?? null;
    const columns = grid
        .columns()
        .filter((column) => !column.hidden)
        .map((column) => {
            const rect = grid.columnRect(column.id);
            return {
                id: column.id,
                x: rect.x,
                width: rect.width,
                tiles: column.tiles().map((tile) => {
                    const tileRect = column.tileRect(tile.id, rect);
                    const window = registry.get(column.id, tile.id);
                    return {
                        y: tileRect.y,
                        height: tileRect.height,
                        focused: column.id === focusedId && tile.id === column.focusedTileId,
                        icon: window?.icon() ?? null,
                        thumbnail: window?.windowHandle() ?? null,
                    };
                }),
            };
        });
    return {
        columns,
        viewport: {
            offset,
            width: viewport.viewportWidth(),
            contentLeft: viewport.contentLeft(),
            contentWidth: viewport.contentWidth(),
        },
        gridHeight: grid.screenHeight(),
    };
}

export interface MinimapRow {
    rowIndex: number;
    columns: MinimapColumn[];
}

/** A stack-level viewport: where the user is actually looking, in both dimensions — which
 * row (`rowIndex`) plus the horizontal scroll/content extent within it. Only the active row
 * ever has a real on-screen viewport, so a stack snapshot carries exactly one of these. */
export interface StripStackMinimapViewport {
    rowIndex: number;
    offset: number;
    width: number;
    contentLeft: number;
    contentWidth: number;
}

export interface StripStackMinimapSnapshot {
    rows: MinimapRow[];
    viewport: StripStackMinimapViewport;
    gridHeight: number;
    /** Real-pixel vertical distance between adjacent rows' origins (`StripStack`'s own
     * `area.height`) — may exceed `gridHeight` (which excludes `settings.bottomMargin`),
     * leaving a real gap between rows in the rendered map, matching their on-screen look. */
    rowPitch: number;
}

/** Merges every row currently in a `StripStack` into one aggregate snapshot. A row's own
 * `Grid` always remembers its last-focused column even while inactive — that isn't real
 * (OS-level) focus, so every row except `activeRowIndex` has `focused` forced to `false`
 * on its columns (docs: 2026-09-02-multi-strip-minimap-design). */
export function combineStripStackSnapshot(
    rows: { rowIndex: number; snapshot: MinimapSnapshot }[],
    activeRowIndex: number,
    rowPitch: number,
): StripStackMinimapSnapshot {
    const active = rows.find((row) => row.rowIndex === activeRowIndex);
    if (active === undefined) {
        throw new Error(`combineStripStackSnapshot: no row at active index ${activeRowIndex}`);
    }
    return {
        rows: rows.map((row) => ({
            rowIndex: row.rowIndex,
            columns:
                row.rowIndex === activeRowIndex
                    ? row.snapshot.columns
                    : row.snapshot.columns.map((column) =>
                          Object.assign({}, column, {
                              tiles: column.tiles.map((tile) => Object.assign({}, tile, { focused: false })),
                          }),
                      ),
        })),
        viewport: Object.assign({ rowIndex: activeRowIndex }, active.snapshot.viewport),
        gridHeight: active.snapshot.gridHeight,
        rowPitch,
    };
}
