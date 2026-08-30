// Formats a live snapshot of tiling internals for the OSD debug console (docs §8).
// Pure and KWin-free — takes plain data so it's testable without a compositor.

import { Rect } from './coordinates';
import { GridDebugState } from './grid';

export interface WindowDebugRow {
    id: string;
    title: string;
    columnId: number;
    hidden: boolean;
    virtual: Rect;
    real: Rect;
}

export interface CameraDebugState {
    offset: number;
    viewportWidth: number;
    contentLeft: number;
    contentWidth: number;
}

export function formatDebugState(
    rows: readonly WindowDebugRow[],
    camera: CameraDebugState,
    grid?: GridDebugState,
): string {
    const gridLine = grid ? [formatGridLine(grid)] : [];
    const cameraLine =
        `camera: offset=${camera.offset} viewport=${camera.viewportWidth} ` +
        `content=[${camera.contentLeft}..${camera.contentLeft + camera.contentWidth}]`;
    const windowLines = rows.map(
        (row) =>
            `col ${row.columnId} (win ${row.id} "${row.title}")${row.hidden ? ' [minimized]' : ''}: ` +
            `virtual=${formatRect(row.virtual)} real=${formatRect(row.real)}`,
    );
    return gridLine.concat([cameraLine], windowLines).join('\n');
}

function formatGridLine(grid: GridDebugState): string {
    const columns = grid.columns
        .map((column) => `${column.id}:${column.width}${column.hidden ? '(hidden)' : ''}`)
        .join(',');
    return `grid: focused=${grid.focusedColumnId} nextId=${grid.nextId} originX=${grid.originX} columns=[${columns}]`;
}

function formatRect(rect: Rect): string {
    return `{x:${rect.x},y:${rect.y},w:${rect.width},h:${rect.height}}`;
}
