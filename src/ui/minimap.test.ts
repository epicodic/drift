import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import type { WindowAdapter } from '../kwin/window-adapter';
import { ColumnRegistry } from '../runtime/column-registry';
import { SignalManager } from '../utils/signal-manager';
import { Viewport } from '../viewport/viewport';
import { buildMinimapSnapshot, combineStripStackSnapshot } from './minimap';
import type { MinimapColumn, MinimapViewport, MinimapSnapshot } from './minimap';

function fakeWindow(icon: QIcon | null, handle: Window | null = null): WindowAdapter {
    return { icon: () => icon, windowHandle: () => handle } as unknown as WindowAdapter;
}

describe('buildMinimapSnapshot', () => {
    it('reports each visible column position, width, focus, icon, and thumbnail handle', () => {
        const grid = new Grid(1000, 8);
        const first = grid.addColumn(400);
        const second = grid.addColumn(600);
        grid.setFocus(second.id);
        const registry = new ColumnRegistry();
        const icon = {} as QIcon;
        const handle = {} as Window;
        const secondTileId = second.tiles()[0].id;
        registry.set(second.id, secondTileId, fakeWindow(icon, handle), new SignalManager());
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, grid.virtualWidth());

        const snapshot = buildMinimapSnapshot(grid, viewport, registry);

        expect(snapshot.columns).toEqual([
            { id: first.id, x: 0, width: 400, focused: false, icon: null, thumbnail: null },
            { id: second.id, x: 408, width: 600, focused: true, icon, thumbnail: handle },
        ]);
    });

    it('omits hidden (minimized) columns', () => {
        const grid = new Grid(1000, 8);
        const visible = grid.addColumn(400);
        const hidden = grid.addColumn(300);
        grid.hideColumn(hidden.id);
        const viewport = new Viewport(1280);

        const snapshot = buildMinimapSnapshot(grid, viewport, new ColumnRegistry());

        expect(snapshot.columns).toEqual([
            { id: visible.id, x: 0, width: 400, focused: false, icon: null, thumbnail: null },
        ]);
    });

    it('reports the viewport offset, content bounds, and grid height', () => {
        const grid = new Grid(1000, 8);
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, 2000);

        const snapshot = buildMinimapSnapshot(grid, viewport, new ColumnRegistry());

        expect(snapshot.viewport).toEqual({ offset: 0, width: 1280, contentLeft: 0, contentWidth: 2000 });
        expect(snapshot.gridHeight).toBe(1000);
    });

    it("shows the focused tile's icon and thumbnail for a stacked column", () => {
        const grid = new Grid(1000, 8);
        const column = grid.addColumn(400);
        const topId = column.tiles()[0].id;
        const bottomId = column.addTile();
        const registry = new ColumnRegistry();
        const topIcon = {} as QIcon;
        const bottomIcon = {} as QIcon;
        const handle = {} as Window;
        registry.set(column.id, topId, fakeWindow(topIcon, null), new SignalManager());
        registry.set(column.id, bottomId, fakeWindow(bottomIcon, handle), new SignalManager());
        column.setFocusedTile(bottomId);
        const viewport = new Viewport(1280);
        viewport.setContentGeometry(0, grid.virtualWidth());

        const snapshot = buildMinimapSnapshot(grid, viewport, registry);

        expect(snapshot.columns).toHaveLength(1);
        expect(snapshot.columns[0].icon).toBe(bottomIcon);
        expect(snapshot.columns[0].thumbnail).toBe(handle);
    });
});

describe('combineStripStackSnapshot', () => {
    const viewportA = { offset: 0, width: 1280, contentLeft: 0, contentWidth: 2000 };

    function row(
        rowIndex: number,
        columns: MinimapColumn[],
        viewport: MinimapViewport = viewportA,
        gridHeight = 1000,
    ): { rowIndex: number; snapshot: MinimapSnapshot } {
        return { rowIndex, snapshot: { columns, viewport, gridHeight } };
    }

    it('merges every row, tagging each with its own rowIndex', () => {
        const rowMinus1 = row(-1, [{ id: 1, x: 0, width: 400, focused: false, icon: null, thumbnail: null }]);
        const row0 = row(0, [{ id: 2, x: 0, width: 600, focused: true, icon: null, thumbnail: null }]);

        const combined = combineStripStackSnapshot([rowMinus1, row0], 0, 1000);

        expect(combined.rows).toEqual([
            { rowIndex: -1, columns: rowMinus1.snapshot.columns },
            { rowIndex: 0, columns: row0.snapshot.columns },
        ]);
    });

    it('suppresses focused on every row except the active one', () => {
        const inactive = row(-1, [{ id: 1, x: 0, width: 400, focused: true, icon: null, thumbnail: null }]);
        const active = row(0, [{ id: 2, x: 0, width: 600, focused: true, icon: null, thumbnail: null }]);

        const combined = combineStripStackSnapshot([inactive, active], 0, 1000);

        expect(combined.rows[0].columns[0].focused).toBe(false);
        expect(combined.rows[1].columns[0].focused).toBe(true);
    });

    it('takes viewport and gridHeight from the active row, tagged with its rowIndex', () => {
        const inactive = row(-1, [], { offset: 999, width: 1, contentLeft: 999, contentWidth: 1 }, 1);
        const active = row(2, [], viewportA, 1000);

        const combined = combineStripStackSnapshot([inactive, active], 2, 1000);

        expect(combined.viewport).toEqual({ rowIndex: 2, ...viewportA });
        expect(combined.gridHeight).toBe(1000);
    });

    it('passes rowPitch through unchanged', () => {
        const combined = combineStripStackSnapshot([row(0, [])], 0, 1234);

        expect(combined.rowPitch).toBe(1234);
    });

    it('throws when no row matches the active index', () => {
        expect(() => combineStripStackSnapshot([row(0, [])], 5, 1000)).toThrow('5');
    });
});
