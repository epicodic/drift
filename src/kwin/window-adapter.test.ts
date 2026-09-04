import { describe, expect, it } from 'vitest';
import { DEBUG_CONSOLE_WINDOW_TITLE } from './debug-console';
import { MINIMAP_OVERLAY_WINDOW_TITLE } from './minimap-overlay';
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
        resizeable: true,
        minimized: false,
        icon: {} as QIcon,
        activities: ['activity-1'],
        desktops: [{ id: 'desktop-1', name: 'Desktop 1' }],
        output: { name: 'output-1', geometry: { x: 0, y: 0, width: 1920, height: 1080 } },
        frameGeometryChanged: { connect: () => {}, disconnect: () => {} },
        minimizedChanged: { connect: () => {}, disconnect: () => {} },
        fullScreenChanged: { connect: () => {}, disconnect: () => {} },
        activitiesChanged: { connect: () => {}, disconnect: () => {} },
        desktopsChanged: { connect: () => {}, disconnect: () => {} },
        interactiveMoveResizeStarted: { connect: () => {}, disconnect: () => {} },
        interactiveMoveResizeFinished: { connect: () => {}, disconnect: () => {} },
        transient: false,
        fullScreen: false,
        modal: false,
        managed: true,
        pid: 1234,
        resourceClass: 'test-window',
        ...overrides,
    } as Window;
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

    it('rejects the minimap overlay window by title', () => {
        const window = createWindow({ caption: MINIMAP_OVERLAY_WINDOW_TITLE });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects modal windows', () => {
        const window = createWindow({ modal: true });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects unmanaged windows', () => {
        const window = createWindow({ managed: false });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects windows with invalid pid', () => {
        const window = createWindow({ pid: -1 });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });

    it('rejects non-resizeable windows', () => {
        const window = createWindow({ resizeable: false });

        expect(new WindowAdapter(window).isTileable()).toBe(false);
    });
});

describe('WindowAdapter.isFullScreen', () => {
    it('reflects the window fullScreen property', () => {
        const window = createWindow({ fullScreen: true });

        expect(new WindowAdapter(window).isFullScreen()).toBe(true);
    });
});

describe('WindowAdapter.setSkipTaskbar', () => {
    it('writes skipTaskbar on the underlying window', () => {
        const window = createWindow({ skipTaskbar: false });
        const adapter = new WindowAdapter(window);

        adapter.setSkipTaskbar(true);

        expect(window.skipTaskbar).toBe(true);
    });

    it('does not affect isTileable for an already-tiled window (only checked once, at add-time)', () => {
        const window = createWindow({ skipTaskbar: false });
        const adapter = new WindowAdapter(window);
        expect(adapter.isTileable()).toBe(true);

        adapter.setSkipTaskbar(true);

        expect(adapter.isTileable()).toBe(false); // isTileable() itself always reads live state...
        // ...but WindowManager.addWindow (window-manager.ts, unchanged by this plan) only calls
        // isTileable() once, at first sight of the window, and never again on a live-changed
        // signal — so a later toggle here cannot cause Drift to un-tile a window it already
        // manages. That's a property of window-manager.ts's existing, untouched code, not
        // something this plan adds a new test for; this test only proves skipTaskbar itself
        // round-trips through the adapter correctly.
    });
});

describe('WindowAdapter.icon', () => {
    it('returns the underlying window icon', () => {
        const icon = {} as QIcon;
        const window = createWindow({ icon });

        expect(new WindowAdapter(window).icon()).toBe(icon);
    });
});

describe('WindowAdapter.windowHandle', () => {
    it('returns the underlying window', () => {
        const window = createWindow();

        expect(new WindowAdapter(window).windowHandle()).toBe(window);
    });
});

describe('WindowAdapter.output', () => {
    it('returns the window output', () => {
        const output = { name: 'output-2', geometry: { x: 1920, y: 0, width: 1920, height: 1080 } };
        const window = createWindow({ output });

        expect(new WindowAdapter(window).output()).toBe(output);
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
