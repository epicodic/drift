// Builds a snapshot of one strip's layout + camera for the minimap overlay
// (docs: 2026-09-01-minimap-design). Pure and KWin-free, mirrors debug/snapshot.ts.

import type { Grid } from '../core/grid';
import type { ColumnRegistry } from '../runtime/column-registry';
import type { Viewport } from '../viewport/viewport';

export interface MinimapColumn {
    id: number;
    x: number;
    width: number;
    focused: boolean;
    icon: QIcon | null;
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
}

export function buildMinimapSnapshot(grid: Grid, viewport: Viewport, registry: ColumnRegistry): MinimapSnapshot {
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
                focused: column.id === focusedId,
                icon: registry.get(column.id)?.icon() ?? null,
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
    };
}
