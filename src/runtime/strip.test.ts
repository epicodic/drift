import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}

function fakeWorkspaceAdapter(): WorkspaceAdapter {
    return { cursorX: () => 0 } as unknown as WorkspaceAdapter;
}

interface FakeWindow {
    adapter: WindowAdapter;
    setFrameGeometry: ReturnType<typeof vi.fn>;
    disconnects: {
        frameGeometry: ReturnType<typeof vi.fn>;
        minimized: ReturnType<typeof vi.fn>;
        moveStarted: ReturnType<typeof vi.fn>;
        moveFinished: ReturnType<typeof vi.fn>;
    };
}

function fakeWindow(id: string, options: { width?: number; minimized?: boolean } = {}): FakeWindow {
    const disconnects = {
        frameGeometry: vi.fn(),
        minimized: vi.fn(),
        moveStarted: vi.fn(),
        moveFinished: vi.fn(),
    };
    const setFrameGeometry = vi.fn();
    const adapter = {
        id,
        caption: id,
        frameGeometry: () => ({ x: 0, y: 0, width: options.width ?? 800, height: 1000 }),
        setFrameGeometry,
        isMinimized: () => options.minimized ?? false,
        isInteractiveResize: () => false,
        isInteractiveMove: () => false,
        onFrameGeometryChanged: () => disconnects.frameGeometry,
        onMinimizedChanged: () => disconnects.minimized,
        onInteractiveMoveResizeStarted: () => disconnects.moveStarted,
        onInteractiveMoveResizeFinished: () => disconnects.moveFinished,
    } as unknown as WindowAdapter;
    return { adapter, setFrameGeometry, disconnects };
}

describe('Strip', () => {
    it('adds an already-minimized window without throwing and keeps it hidden', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { minimized: true });

        expect(() => strip.addWindow(win.adapter)).not.toThrow();
        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('applies real geometry to a newly added window', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');

        strip.addWindow(win.adapter);

        expect(win.setFrameGeometry).toHaveBeenCalled();
    });

    it('tears down every window signal when the window is removed', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);

        strip.removeWindow(win.adapter);

        expect(win.disconnects.frameGeometry).toHaveBeenCalledTimes(1);
        expect(win.disconnects.minimized).toHaveBeenCalledTimes(1);
        expect(win.disconnects.moveStarted).toHaveBeenCalledTimes(1);
        expect(win.disconnects.moveFinished).toHaveBeenCalledTimes(1);
    });

    it('ignores removal of a window it never registered', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const ghost = fakeWindow('ghost');

        expect(() => strip.removeWindow(ghost.adapter)).not.toThrow();
        expect(ghost.disconnects.frameGeometry).not.toHaveBeenCalled();
    });

    it('stops writing geometry to a window after it is removed', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        strip.removeWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('activates a known window and focus stepping do not throw', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);

        expect(() => strip.activateWindow(win.adapter)).not.toThrow();
        expect(() => strip.focusLeft()).not.toThrow();
        expect(() => strip.focusRight()).not.toThrow();
    });
});
