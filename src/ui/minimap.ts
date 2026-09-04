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

export interface MinimapStrip {
    stripIndex: number;
    columns: MinimapColumn[];
}

/** A stack-level viewport: where the user is actually looking, in both dimensions — which
 * strip (`stripIndex`) plus the horizontal scroll/content extent within it. Only the active
 * strip ever has a real on-screen viewport, so a stack snapshot carries exactly one of these. */
export interface StripStackMinimapViewport {
    stripIndex: number;
    offset: number;
    width: number;
    contentLeft: number;
    contentWidth: number;
}

export interface StripStackMinimapSnapshot {
    strips: MinimapStrip[];
    viewport: StripStackMinimapViewport;
    gridHeight: number;
    /** Real-pixel vertical distance between adjacent strips' origins (`StripStack`'s own
     * `area.height`) — may exceed `gridHeight` (which excludes `settings.bottomMargin`),
     * leaving a real gap between strips in the rendered map, matching their on-screen look. */
    stripPitch: number;
}

/** Merges every strip currently in a `StripStack` into one aggregate snapshot. A strip's own
 * `Grid` always remembers its last-focused column even while inactive — that isn't real
 * (OS-level) focus, so every strip except `activeStripIndex` has `focused` forced to `false`
 * on its columns (docs: 2026-09-02-multi-strip-minimap-design). */
export function combineStripStackSnapshot(
    strips: { stripIndex: number; snapshot: MinimapSnapshot }[],
    activeStripIndex: number,
    stripPitch: number,
): StripStackMinimapSnapshot {
    const active = strips.find((strip) => strip.stripIndex === activeStripIndex);
    if (active === undefined) {
        throw new Error(`combineStripStackSnapshot: no strip at active index ${activeStripIndex}`);
    }
    return {
        strips: strips.map((strip) => ({
            stripIndex: strip.stripIndex,
            columns:
                strip.stripIndex === activeStripIndex
                    ? strip.snapshot.columns
                    : strip.snapshot.columns.map((column) =>
                          Object.assign({}, column, {
                              tiles: column.tiles.map((tile) => Object.assign({}, tile, { focused: false })),
                          }),
                      ),
        })),
        viewport: Object.assign({ stripIndex: activeStripIndex }, active.snapshot.viewport),
        gridHeight: active.snapshot.gridHeight,
        stripPitch,
    };
}
