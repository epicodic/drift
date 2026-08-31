import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };
const INSTANT_SETTINGS = { ...DEFAULT_SETTINGS, animationDurationMs: 0 };

function fakeTimer(): Timer {
    return { start: () => {}, stop: () => {} };
}

function fakeWorkspaceAdapter(): WorkspaceAdapter {
    return { cursorX: () => 0 } as unknown as WorkspaceAdapter;
}

interface FakeWindow {
    adapter: WindowAdapter;
    setFrameGeometry: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    disconnects: {
        frameGeometry: ReturnType<typeof vi.fn>;
        minimized: ReturnType<typeof vi.fn>;
        fullScreen: ReturnType<typeof vi.fn>;
        moveStarted: ReturnType<typeof vi.fn>;
        moveFinished: ReturnType<typeof vi.fn>;
    };
    setIsFullScreen(value: boolean): void;
    triggerFullScreenChanged(): void;
}

function fakeWindow(
    id: string,
    options: { width?: number; minimized?: boolean; fullScreen?: boolean } = {},
): FakeWindow {
    const disconnects = {
        frameGeometry: vi.fn(),
        minimized: vi.fn(),
        fullScreen: vi.fn(),
        moveStarted: vi.fn(),
        moveFinished: vi.fn(),
    };
    const setFrameGeometry = vi.fn();
    const activate = vi.fn();
    let isFullScreen = options.fullScreen ?? false;
    let fullScreenHandler: (() => void) | undefined;
    const adapter = {
        id,
        caption: id,
        frameGeometry: () => ({ x: 0, y: 0, width: options.width ?? 800, height: 1000 }),
        setFrameGeometry,
        activate,
        isMinimized: () => options.minimized ?? false,
        isFullScreen: () => isFullScreen,
        isInteractiveResize: () => false,
        isInteractiveMove: () => false,
        onFrameGeometryChanged: () => disconnects.frameGeometry,
        onMinimizedChanged: () => disconnects.minimized,
        onFullScreenChanged: (handler: () => void) => {
            fullScreenHandler = handler;
            return disconnects.fullScreen;
        },
        onInteractiveMoveResizeStarted: () => disconnects.moveStarted,
        onInteractiveMoveResizeFinished: () => disconnects.moveFinished,
    } as unknown as WindowAdapter;
    return {
        adapter,
        setFrameGeometry,
        activate,
        disconnects,
        setIsFullScreen: (value) => {
            isFullScreen = value;
        },
        triggerFullScreenChanged: () => fullScreenHandler?.(),
    };
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
        expect(win.disconnects.fullScreen).toHaveBeenCalledTimes(1);
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

    it('activates the window of the column focus moves to', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter); // col2 is now focused

        strip.focusLeft();

        expect(win1.activate).toHaveBeenCalledTimes(1);

        strip.focusRight();

        expect(win2.activate).toHaveBeenCalledTimes(1);
    });

    it('never writes geometry to a fullscreen window on render', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { fullScreen: true });
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('stops writing geometry once fullScreenChanged reports the window entered fullscreen, even via an unrelated render()', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setIsFullScreen(true);
        win.triggerFullScreenChanged();
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('resumes writing geometry once fullScreenChanged reports the window left fullscreen', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setIsFullScreen(true);
        win.triggerFullScreenChanged();
        win.setIsFullScreen(false);
        win.triggerFullScreenChanged();
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).toHaveBeenCalled();
    });

    it('keeps skipping a fullscreen column even if a later read of the live property would say otherwise', () => {
        // Regresssion guard: fullscreen tracking must be driven by the dedicated fullScreenChanged
        // signal, not by re-reading window.fullScreen from an unrelated render() call — KWin's own
        // docs warn the property can only reliably be observed via its notify signal.
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setIsFullScreen(true);
        win.triggerFullScreenChanged();
        win.setIsFullScreen(false); // live property drifts without a matching signal
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    describe('cycleAlignLeft / cycleAlignRight', () => {
        it('cycles a single oversized column through left/center/right and stops at both edges', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win = fakeWindow('w1', { width: 1600 });
            strip.addWindow(win.adapter); // offset 0 — already left-aligned, no reveal needed

            strip.cycleAlignRight(); // right cycle's start phase: advances to centered
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -160 }));

            strip.cycleAlignRight();
            // right-aligned
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -320 }));

            strip.cycleAlignRight(); // already right-aligned (right cycle's own edge): no-op
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -320 }));

            strip.cycleAlignLeft(); // left cycle's start phase: advances to centered
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -160 }));

            strip.cycleAlignLeft();
            // left-aligned
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));

            strip.cycleAlignLeft(); // already left-aligned (left cycle's own edge): no-op
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
        });

        it('cycles a narrow column through left/center/right even when the whole strip fits in the viewport', () => {
            // AREA is 1280 wide; this column (400) is far narrower — nothing here ever needs
            // scrolling to stay revealed, but align-cycle must still be able to place it at
            // the viewport's left edge, center, and right edge.
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win = fakeWindow('w1', { width: 400 });
            strip.addWindow(win.adapter); // offset 0 — already left-aligned

            strip.cycleAlignRight();
            // centered: (1280 - 400) / 2 = 440
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 440 }));

            strip.cycleAlignRight();
            // right-aligned: 1280 - 400 = 880
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 880 }));

            strip.cycleAlignLeft();
            // back to centered
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 440 }));

            strip.cycleAlignLeft();
            // back to left-aligned
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
        });

        it('does nothing when the focused column is hidden (minimized)', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win = fakeWindow('w1', { minimized: true });
            strip.addWindow(win.adapter);
            win.setFrameGeometry.mockClear();

            strip.cycleAlignRight();
            strip.cycleAlignLeft();

            expect(win.setFrameGeometry).not.toHaveBeenCalled();
        });
    });

    describe('shiftViewportLeft / shiftViewportRight', () => {
        const SHIFT_SETTINGS = { ...INSTANT_SETTINGS, viewportShiftStep: 100 };

        function twoColumnStrip(): { strip: Strip; win1: FakeWindow; win2: FakeWindow } {
            const strip = new Strip(AREA, SHIFT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            const win2 = fakeWindow('w2');
            strip.addWindow(win1.adapter);
            strip.addWindow(win2.adapter); // col2 focused; revealFocused already scrolled right
            strip.focusLeft(); // back to col1, offset 0
            win1.setFrameGeometry.mockClear();
            win2.setFrameGeometry.mockClear();
            win1.activate.mockClear();
            win2.activate.mockClear();
            return { strip, win1, win2 };
        }

        it('pans the camera right by the configured step', () => {
            const { strip, win1 } = twoColumnStrip();

            strip.shiftViewportRight();

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -100 }));
        });

        it('pans the camera left by the configured step', () => {
            const { strip, win1, win2 } = twoColumnStrip();
            strip.shiftViewportRight();
            win1.setFrameGeometry.mockClear();
            win2.setFrameGeometry.mockClear();

            strip.shiftViewportLeft();

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
        });

        it('keeps panning right past the content right edge (contentWidth 1608, viewport 1280 -> maxOffset 328)', () => {
            const { strip, win2 } = twoColumnStrip();

            for (let i = 0; i < 10; i++) {
                strip.shiftViewportRight();
            }

            // offset reaches 1000, well past maxOffset (328): real x = 808 - 1000
            expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 808 - 1000 }));
        });

        it('keeps panning left past the content left edge (offset goes negative)', () => {
            const { strip, win1 } = twoColumnStrip();

            strip.shiftViewportLeft(); // offset 0 -> -100

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 100 }));
        });

        it('does not change which column is focused', () => {
            const { strip, win1, win2 } = twoColumnStrip();

            strip.shiftViewportRight();
            strip.shiftViewportLeft();

            expect(win1.activate).not.toHaveBeenCalled();
            expect(win2.activate).not.toHaveBeenCalled();
        });
    });
});
