import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import { onMinimizedChanged, onWindowGeometryChanged, type WindowEventDeps } from './window-events';

function fakeWindow(
    id: string,
    frame: Rect,
    overrides: { interactiveResize?: boolean; minimized?: boolean } = {},
): WindowAdapter {
    return {
        id,
        frameGeometry: () => frame,
        isInteractiveResize: () => overrides.interactiveResize ?? false,
        isMinimized: () => overrides.minimized ?? false,
    } as unknown as WindowAdapter;
}

function fakeDeps(overrides: Partial<WindowEventDeps> = {}): WindowEventDeps {
    return {
        columnOf: () => 1,
        isHidden: () => false,
        isEcho: () => false,
        resizeColumn: vi.fn(),
        hideColumn: vi.fn(),
        showColumn: vi.fn(),
        render: vi.fn(),
        ...overrides,
    };
}

describe('onWindowGeometryChanged', () => {
    it('resizes the column on a width change and re-renders', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.resizeColumn).toHaveBeenCalledWith(1, 900, 'right');
        expect(deps.render).toHaveBeenCalledWith(undefined);
    });

    it('excludes the resized window from render during an interactive resize', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 }, { interactiveResize: true });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.render).toHaveBeenCalledWith('w1');
    });

    it('ignores a pure move (no width change)', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 50, y: 0, width: 800, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.resizeColumn).not.toHaveBeenCalled();
        expect(deps.render).not.toHaveBeenCalled();
    });

    it("ignores an echo of Drift's own geometry write", () => {
        const deps = fakeDeps({ isEcho: () => true });
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, deps);

        expect(deps.resizeColumn).not.toHaveBeenCalled();
    });

    it('ignores geometry changes for an unknown or hidden column', () => {
        const win = fakeWindow('w1', { x: 0, y: 0, width: 900, height: 600 });

        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, fakeDeps({ columnOf: () => null }));
        onWindowGeometryChanged(win, { x: 0, y: 0, width: 800, height: 600 }, fakeDeps({ isHidden: () => true }));
    });
});

describe('onMinimizedChanged', () => {
    it('hides the column when the window is minimized', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 800, height: 600 }, { minimized: true });

        onMinimizedChanged(win, deps);

        expect(deps.hideColumn).toHaveBeenCalledWith(1);
        expect(deps.render).toHaveBeenCalledTimes(1);
    });

    it('shows the column when the window is restored', () => {
        const deps = fakeDeps();
        const win = fakeWindow('w1', { x: 0, y: 0, width: 800, height: 600 }, { minimized: false });

        onMinimizedChanged(win, deps);

        expect(deps.showColumn).toHaveBeenCalledWith(1);
    });
});
