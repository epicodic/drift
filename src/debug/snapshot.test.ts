import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import type { WindowAdapter } from '../kwin/window-adapter';
import { ColumnRegistry } from '../runtime/column-registry';
import { SignalManager } from '../utils/signal-manager';
import { Viewport } from '../viewport/viewport';
import { debugCamera, debugRows } from './snapshot';

describe('debugRows', () => {
    it('reports "(none)" for a column with no registered window', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(400);
        const registry = new ColumnRegistry();

        const rows = debugRows(grid, registry);

        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('(none)');
        expect(rows[0].columnId).toBe(column.id);
        expect(rows[0].hidden).toBe(false);
        expect(rows[0].real).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });

    it('reports a hidden column with a zero-height virtual rect', () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(400);
        grid.hideColumn(column.id);

        const rows = debugRows(grid, new ColumnRegistry());

        expect(rows[0].hidden).toBe(true);
        expect(rows[0].virtual).toEqual({ x: 0, y: 0, width: 400, height: 0 });
    });

    it("shows the focused tile's window for a stacked column", () => {
        const grid = new Grid(1000, 0);
        const registry = new ColumnRegistry();
        const column = grid.addColumn(300);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        registry.set(
            column.id,
            topId,
            {
                id: 'top',
                caption: 'Top',
                frameGeometry: () => ({ x: 0, y: 0, width: 300, height: 500 }),
            } as unknown as WindowAdapter,
            new SignalManager(),
        );
        registry.set(
            column.id,
            bottomId,
            {
                id: 'bottom',
                caption: 'Bottom',
                frameGeometry: () => ({ x: 0, y: 500, width: 300, height: 500 }),
            } as unknown as WindowAdapter,
            new SignalManager(),
        );
        column.setFocusedTile(bottomId);

        const [row] = debugRows(grid, registry);

        expect(row.id).toBe('bottom');
    });
});

describe('debugCamera', () => {
    it('reports the viewport offset and content bounds', () => {
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, 2000);

        const camera = debugCamera(viewport);

        expect(camera.viewportWidth).toBe(1280);
        expect(camera.contentLeft).toBe(0);
        expect(camera.contentWidth).toBe(2000);
        expect(typeof camera.offset).toBe('number');
    });
});
