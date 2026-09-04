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
    it('reports each visible column position, width, and a single full-height tile carrying focus/icon/thumbnail', () => {
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
            {
                id: first.id,
                x: 0,
                width: 400,
                tiles: [{ y: 0, height: 1000, focused: false, icon: null, thumbnail: null }],
            },
            {
                id: second.id,
                x: 408,
                width: 600,
                tiles: [{ y: 0, height: 1000, focused: true, icon, thumbnail: handle }],
            },
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
            {
                id: visible.id,
                x: 0,
                width: 400,
                tiles: [{ y: 0, height: 1000, focused: false, icon: null, thumbnail: null }],
            },
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

    it('reports one tile per stacked window, each with its own position, icon, and thumbnail, focus only on the truly focused tile', () => {
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
        expect(snapshot.columns[0].tiles).toEqual([
            { y: 0, height: 500, focused: false, icon: topIcon, thumbnail: null },
            { y: 500, height: 500, focused: true, icon: bottomIcon, thumbnail: handle },
        ]);
    });
});

describe('combineStripStackSnapshot', () => {
    const viewportA = { offset: 0, width: 1280, contentLeft: 0, contentWidth: 2000 };

    function tile(focused: boolean): MinimapColumn['tiles'][number] {
        return { y: 0, height: 1000, focused, icon: null, thumbnail: null };
    }

    function strip(
        stripIndex: number,
        columns: MinimapColumn[],
        viewport: MinimapViewport = viewportA,
        gridHeight = 1000,
    ): { stripIndex: number; snapshot: MinimapSnapshot } {
        return { stripIndex, snapshot: { columns, viewport, gridHeight } };
    }

    it('merges every strip, tagging each with its own stripIndex', () => {
        const stripMinus1 = strip(-1, [{ id: 1, x: 0, width: 400, tiles: [tile(false)] }]);
        const strip0 = strip(0, [{ id: 2, x: 0, width: 600, tiles: [tile(true)] }]);

        const combined = combineStripStackSnapshot([stripMinus1, strip0], 0, 1000);

        expect(combined.strips).toEqual([
            { stripIndex: -1, columns: stripMinus1.snapshot.columns },
            { stripIndex: 0, columns: strip0.snapshot.columns },
        ]);
    });

    it('suppresses focused on every strip except the active one', () => {
        const inactive = strip(-1, [{ id: 1, x: 0, width: 400, tiles: [tile(true)] }]);
        const active = strip(0, [{ id: 2, x: 0, width: 600, tiles: [tile(true)] }]);

        const combined = combineStripStackSnapshot([inactive, active], 0, 1000);

        expect(combined.strips[0].columns[0].tiles[0].focused).toBe(false);
        expect(combined.strips[1].columns[0].tiles[0].focused).toBe(true);
    });

    it('suppresses focused on every tile in a stacked column on an inactive strip', () => {
        const inactive = strip(-1, [{ id: 1, x: 0, width: 400, tiles: [tile(false), tile(true)] }]);
        const active = strip(0, []);

        const combined = combineStripStackSnapshot([inactive, active], 0, 1000);

        expect(combined.strips[0].columns[0].tiles.map((t) => t.focused)).toEqual([false, false]);
    });

    it('takes viewport and gridHeight from the active strip, tagged with its stripIndex', () => {
        const inactive = strip(-1, [], { offset: 999, width: 1, contentLeft: 999, contentWidth: 1 }, 1);
        const active = strip(2, [], viewportA, 1000);

        const combined = combineStripStackSnapshot([inactive, active], 2, 1000);

        expect(combined.viewport).toEqual({ stripIndex: 2, ...viewportA });
        expect(combined.gridHeight).toBe(1000);
    });

    it('passes stripPitch through unchanged', () => {
        const combined = combineStripStackSnapshot([strip(0, [])], 0, 1234);

        expect(combined.stripPitch).toBe(1234);
    });

    it('throws when no strip matches the active index', () => {
        expect(() => combineStripStackSnapshot([strip(0, [])], 5, 1000)).toThrow('5');
    });
});
