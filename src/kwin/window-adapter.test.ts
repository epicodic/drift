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
        minimized: false,
        activities: ['activity-1'],
        desktops: [{ id: 'desktop-1', name: 'Desktop 1' }],
        frameGeometryChanged: { connect: () => {}, disconnect: () => {} },
        minimizedChanged: { connect: () => {}, disconnect: () => {} },
        activitiesChanged: { connect: () => {}, disconnect: () => {} },
        desktopsChanged: { connect: () => {}, disconnect: () => {} },
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

describe('WindowAdapter.singleAssignment', () => {
    it('returns the activity and desktop for a window on exactly one of each', () => {
        const window = createWindow({
            activities: ['a1'],
            desktops: [{ id: 'd1', name: 'Desktop 1' }],
        });

        expect(new WindowAdapter(window).singleAssignment()).toEqual({ activity: 'a1', desktop: 'd1' });
    });

    it('returns null for a window on no activity', () => {
        const window = createWindow({ activities: [], desktops: [{ id: 'd1', name: 'Desktop 1' }] });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });

    it('returns null for a window on multiple activities', () => {
        const window = createWindow({
            activities: ['a1', 'a2'],
            desktops: [{ id: 'd1', name: 'Desktop 1' }],
        });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });

    it('returns null for a window on no desktop', () => {
        const window = createWindow({ activities: ['a1'], desktops: [] });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });

    it('returns null for a window on multiple desktops', () => {
        const window = createWindow({
            activities: ['a1'],
            desktops: [
                { id: 'd1', name: 'Desktop 1' },
                { id: 'd2', name: 'Desktop 2' },
            ],
        });

        expect(new WindowAdapter(window).singleAssignment()).toBeNull();
    });
});
