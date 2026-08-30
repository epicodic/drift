import { describe, expect, it } from 'vitest';
import { DEBUG_CONSOLE_WINDOW_TITLE } from './debug-console';
import { WindowAdapter } from './window-adapter';

function createWindow(overrides: Partial<Window> = {}): Window {
    return {
        frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
        internalId: 'window-1',
        caption: 'Window',
        normalWindow: true,
        skipTaskbar: false,
        onScreenDisplay: false,
        deleted: false,
        minSize: { width: 0, height: 0 },
        maxSize: { width: 1920, height: 1080 },
        move: false,
        resize: false,
        frameGeometryChanged: { connect: () => {}, disconnect: () => {} },
        interactiveMoveResizeStarted: { connect: () => {}, disconnect: () => {} },
        interactiveMoveResizeFinished: { connect: () => {}, disconnect: () => {} },
        ...overrides,
        transient: overrides.transient ?? false,
        fullScreen: overrides.fullScreen ?? false,
    };
}

describe('WindowAdapter.isTileable', () => {
    it('rejects transient windows', () => {
        const window = createWindow({ transient: true });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects fullscreen windows', () => {
        const window = createWindow({ fullScreen: true });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects on-screen-display windows', () => {
        const window = createWindow({ onScreenDisplay: true });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects the debug console window by title', () => {
        const window = createWindow({ caption: DEBUG_CONSOLE_WINDOW_TITLE });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });
});
