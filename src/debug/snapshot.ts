// Builds the debug-console snapshot structures from a strip's live state. Extracted
// verbatim from the debugRows()/debugCamera() closures that used to sit inside main.ts's
// init(), keeping presentation out of the orchestration layer.

import type { CameraDebugState, WindowDebugRow } from '../core/debug-format';
import type { Grid } from '../core/grid';
import type { ColumnRegistry } from '../runtime/column-registry';
import type { Viewport } from '../viewport/viewport';

export function debugRows(grid: Grid, registry: ColumnRegistry): WindowDebugRow[] {
    return grid.columns().map((column) => {
        const win = registry.get(column.id);
        return {
            id: win?.id ?? '(none)',
            title: win?.caption ?? '',
            columnId: column.id,
            hidden: column.hidden,
            virtual: column.hidden ? { x: 0, y: 0, width: column.width, height: 0 } : grid.columnRect(column.id),
            real: win?.frameGeometry() ?? { x: 0, y: 0, width: 0, height: 0 },
        };
    });
}

export function debugCamera(viewport: Viewport): CameraDebugState {
    return {
        offset: viewport.offset(),
        viewportWidth: viewport.viewportWidth(),
        contentLeft: viewport.contentLeft(),
        contentWidth: viewport.contentWidth(),
    };
}
