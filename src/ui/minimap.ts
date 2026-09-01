// Builds a snapshot of one strip's layout + camera for the minimap overlay
// (docs: 2026-09-01-minimap-design, 2026-09-01-minimap-thumbnails-design). Pure and
// KWin-free, mirrors debug/snapshot.ts.

import type { Grid } from '../core/grid';
import type { ColumnRegistry } from '../runtime/column-registry';
import type { Viewport } from '../viewport/viewport';

export interface MinimapColumn {
    id: number;
    x: number;
    width: number;
    focused: boolean;
    icon: QIcon | null;
    thumbnail: Window | null;
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

export function buildMinimapSnapshot(grid: Grid, viewport: Viewport, registry: ColumnRegistry): MinimapSnapshot {
    const focusedId = grid.focusedColumn()?.id ?? null;
    const columns = grid
        .columns()
        .filter((column) => !column.hidden)
        .map((column) => {
            const rect = grid.columnRect(column.id);
            const window = registry.get(column.id);
            return {
                id: column.id,
                x: rect.x,
                width: rect.width,
                focused: column.id === focusedId,
                icon: window?.icon() ?? null,
                thumbnail: window?.windowHandle() ?? null,
            };
        });
    return {
        columns,
        viewport: {
            offset: viewport.offset(),
            width: viewport.viewportWidth(),
            contentLeft: viewport.contentLeft(),
            contentWidth: viewport.contentWidth(),
        },
        gridHeight: grid.screenHeight(),
    };
}
