import { describe, expect, it } from 'vitest';
import { Grid } from '../core/grid';
import type { WindowAdapter } from '../kwin/window-adapter';
import { ColumnRegistry } from '../runtime/column-registry';
import { SignalManager } from '../utils/signal-manager';
import { Viewport } from '../viewport/viewport';
import { buildMinimapSnapshot } from './minimap';

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
        registry.set(second.id, fakeWindow(icon, handle), new SignalManager());
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
});
