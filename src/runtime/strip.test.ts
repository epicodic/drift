import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { ScreenInfo, WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };
const WIDE_AREA: Rect = { x: 0, y: 0, width: 5000, height: 1000 };
const FAKE_OUTPUT: Output = { name: 'output-1', geometry: { x: 0, y: 0, width: 1920, height: 1080 } };
const MULTI_MONITOR_AREA: Rect = { x: 0, y: 0, width: 2000, height: 1000 };
const INSTANT_SETTINGS = { ...DEFAULT_SETTINGS, animationDurationMs: 0 };

class ManualTimer implements Timer {
    private onTick: (() => void) | null = null;

    start(_intervalMs: number, onTick: () => void): void {
        this.onTick = onTick;
    }

    stop(): void {
        this.onTick = null;
    }

    fire(): void {
        this.onTick?.();
    }
}

function fakeTimer(): ManualTimer {
    return new ManualTimer();
}

function fakeWorkspaceAdapter(screens: ScreenInfo[] = []): WorkspaceAdapter {
    return { screens: () => screens } as unknown as WorkspaceAdapter;
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
        icon: () => null,
        windowHandle: () => null,
        output: () => FAKE_OUTPUT,
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

        // Two independent onFrameGeometryChanged subscribers: window-events.ts's resize/fullscreen
        // handling, and drag.ts's live drag-reorder preview.
        expect(win.disconnects.frameGeometry).toHaveBeenCalledTimes(2);
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

    it('reports a minimap snapshot with the focused column flagged', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);

        const snapshot = strip.minimapSnapshot();

        expect(snapshot.columns).toHaveLength(1);
        expect(snapshot.columns[0].focused).toBe(true);
    });

    it('reports the reveal animation target offset immediately, not the stale pre-move offset', () => {
        const strip = new Strip(AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter); // col1 @ x=0, width 800 — fits, no scroll
        strip.addWindow(win2.adapter); // col2 @ x=808, width 800 — revealFocused animates offset 0 -> 328

        const snapshot = strip.minimapSnapshot();

        expect(snapshot.viewport.offset).toBe(328);
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

    describe('cycleAlignLeft / cycleAlignRight — multi-monitor', () => {
        const screens: ScreenInfo[] = [
            { name: 'L', geometry: { x: 0, y: 0, width: 1000, height: 1000 } },
            { name: 'R', geometry: { x: 1000, y: 0, width: 1000, height: 1000 } },
        ];

        it('cycles within the current screen, then crosses to the neighbor and wraps around', () => {
            const strip = new Strip(MULTI_MONITOR_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(screens));
            const win = fakeWindow('w1', { width: 400 });
            strip.addWindow(win.adapter); // offset 0 — already left-aligned on the left screen

            strip.cycleAlignRight(); // centered on the left screen
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 300 }));

            strip.cycleAlignRight(); // right-aligned on the left screen (its own edge)
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 600 }));

            strip.cycleAlignRight(); // crosses onto the right screen, at its left edge
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1000 }));

            strip.cycleAlignRight(); // centered on the right screen
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1300 }));

            strip.cycleAlignRight(); // right-aligned on the right screen (its own edge)
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1600 }));

            strip.cycleAlignRight(); // wraps around to the left screen's left edge
            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
        });

        it('wraps leftward off the first screen onto the last screen, at its right edge', () => {
            const strip = new Strip(MULTI_MONITOR_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(screens));
            const win = fakeWindow('w1', { width: 400 });
            strip.addWindow(win.adapter); // offset 0 — already at the left screen's own left edge

            strip.cycleAlignLeft(); // already at its own edge: wraps to the right screen's right edge

            expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1600 }));
        });

        it('does not cross onto a neighboring screen the column is too wide to fit on', () => {
            const area: Rect = { x: 0, y: 0, width: 1300, height: 1000 };
            const narrowNeighbor: ScreenInfo[] = [
                { name: 'L', geometry: { x: 0, y: 0, width: 1000, height: 1000 } },
                { name: 'R', geometry: { x: 1000, y: 0, width: 300, height: 1000 } },
            ];
            const strip = new Strip(area, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(narrowNeighbor));
            const win = fakeWindow('w1', { width: 400 });
            strip.addWindow(win.adapter);

            strip.cycleAlignRight(); // centered
            strip.cycleAlignRight(); // right-aligned on the left screen (its own edge)
            win.setFrameGeometry.mockClear();

            strip.cycleAlignRight(); // right screen is too narrow (300 < 400) to cross onto: no-op

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

        it('shiftViewportLeft moves windows left by the configured step', () => {
            const { strip, win1 } = twoColumnStrip();

            strip.shiftViewportLeft();

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -100 }));
        });

        it('shiftViewportRight moves windows right by the configured step', () => {
            const { strip, win1, win2 } = twoColumnStrip();
            strip.shiftViewportLeft();
            win1.setFrameGeometry.mockClear();
            win2.setFrameGeometry.mockClear();

            strip.shiftViewportRight();

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
        });

        it('keeps moving windows left past the content right edge (contentWidth 1608, viewport 1280 -> maxOffset 328)', () => {
            const { strip, win2 } = twoColumnStrip();

            for (let i = 0; i < 10; i++) {
                strip.shiftViewportLeft();
            }

            // offset reaches 1000, well past maxOffset (328): real x = 808 - 1000
            expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 808 - 1000 }));
        });

        it('keeps moving windows right past the content left edge (offset goes negative)', () => {
            const { strip, win1 } = twoColumnStrip();

            strip.shiftViewportRight(); // offset 0 -> -100

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 100 }));
        });

        it('does not change which column is focused', () => {
            const { strip, win1, win2 } = twoColumnStrip();

            strip.shiftViewportLeft();
            strip.shiftViewportRight();

            expect(win1.activate).not.toHaveBeenCalled();
            expect(win2.activate).not.toHaveBeenCalled();
        });
    });

    describe('column-motion animation', () => {
        it('starts a pushed neighbor from its previous position and settles it at the new one', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const timer = fakeTimer();
                const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, timer, fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                const win2 = fakeWindow('w2');
                strip.addWindow(win1.adapter); // col1 @ x=0, focused
                strip.addWindow(win2.adapter); // col2 @ x=808, focused
                strip.focusLeft(); // focus back to col1
                win2.setFrameGeometry.mockClear();

                const win3 = fakeWindow('w3');
                strip.addWindow(win3.adapter); // inserted right of col1, pushes col2 to x=1616

                // first frame: col2 hasn't jumped yet, still at its previous position
                expect(win2.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 808 }));

                vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs);
                timer.fire();

                // settled at its new, pushed-right position
                expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1616 }));
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps excluding the actively-dragged window across an animation-continuation tick', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const timer = fakeTimer();
                const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, timer, fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                const win2 = fakeWindow('w2');
                strip.addWindow(win1.adapter); // col1 @ x=0, focused
                strip.addWindow(win2.adapter); // col2 @ x=808, focused
                strip.focusLeft(); // focus back to col1

                const win3 = fakeWindow('w3');
                strip.addWindow(win3.adapter); // col3, inserted right of col1; pushes col2 -> 1616 (animating)
                win3.setFrameGeometry.mockClear();

                // live drag-reorder tick: win3 is the dragged window, so it must be excluded
                strip.render(win3.adapter.id, false);
                win3.setFrameGeometry.mockClear();

                // animation-continuation tick, still mid-drag: win3 must stay excluded
                vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
                timer.fire();

                expect(win3.setFrameGeometry).not.toHaveBeenCalled();
                expect(win2.setFrameGeometry).toHaveBeenCalled(); // col2's push animation still continues
            } finally {
                vi.useRealTimers();
            }
        });

        it('renders a column at its exact logical position when instant=true, bypassing animation', () => {
            const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            const win2 = fakeWindow('w2');
            strip.addWindow(win1.adapter);
            strip.addWindow(win2.adapter); // col2 @ x=808
            strip.focusLeft();
            const win3 = fakeWindow('w3');
            strip.addWindow(win3.adapter); // pushes col2 to x=1616; its animation is still in-flight

            // first frame: col2 has not jumped to its new position yet
            expect(win2.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 808 }));
            win2.setFrameGeometry.mockClear();

            strip.render(undefined, true); // e.g. a live interactive-resize frame

            expect(win2.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 1616 }));
        });

        it('snapColumn settles one column instantly while a separately-animating neighbor keeps sliding', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const timer = fakeTimer();
                const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, timer, fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                const win2 = fakeWindow('w2');
                const win3 = fakeWindow('w3');
                strip.addWindow(win1.adapter); // col id 1 @ x=0, focused
                strip.addWindow(win2.adapter); // col id 2 @ x=808, focused
                strip.addWindow(win3.adapter); // col id 3 @ x=1616, focused
                strip.focusLeft();
                strip.focusLeft(); // focus back to col 1

                const win4 = fakeWindow('w4');
                strip.addWindow(win4.adapter); // col id 4, inserted right of col 1; pushes col2 -> 1616, col3 -> 2424
                win2.setFrameGeometry.mockClear();
                win3.setFrameGeometry.mockClear();

                strip.snapColumn(2); // settle col2 (win2) instantly; col3 (win3) keeps animating
                vi.setSystemTime(DEFAULT_SETTINGS.animationDurationMs / 2);
                strip.render();

                expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1616 }));
                const [lastCall] = win3.setFrameGeometry.mock.calls.slice(-1);
                const col3X = (lastCall[0] as { x: number }).x;
                expect(col3X).toBeGreaterThan(1616); // still mid-flight...
                expect(col3X).toBeLessThan(2424); // ...not yet at its target
            } finally {
                vi.useRealTimers();
            }
        });

        it('snaps a column back into place after fullscreen instead of animating from its pre-fullscreen position', () => {
            const strip = new Strip(WIDE_AREA, DEFAULT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            const win2 = fakeWindow('w2');
            strip.addWindow(win1.adapter); // col1 @ 0
            strip.addWindow(win2.adapter); // col2 @ 808, focused
            win2.setIsFullScreen(true);
            win2.triggerFullScreenChanged(); // excluded from render; forgets col2's motion state

            strip.focusLeft(); // focus back to col1
            const win3 = fakeWindow('w3');
            strip.addWindow(win3.adapter); // inserted right of col1, pushes col2 to x=1616 while it's still fullscreen

            win2.setIsFullScreen(false);
            win2.triggerFullScreenChanged(); // resumes rendering — must snap straight to 1616, not animate from 808

            expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1616 }));
        });
    });
});

describe('Strip — revealFocused multi-monitor alignment', () => {
    it('aligns a focused column that straddles a monitor bezel onto the closer screen', () => {
        const screens: ScreenInfo[] = [
            { name: 'L', geometry: { x: 0, y: 0, width: 1000, height: 1000 } },
            { name: 'R', geometry: { x: 1000, y: 0, width: 1000, height: 1000 } },
        ];
        const strip = new Strip(MULTI_MONITOR_AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter(screens));
        const win1 = fakeWindow('w1', { width: 900 });
        const win2 = fakeWindow('w2', { width: 200 });

        strip.addWindow(win1.adapter); // col1 @ x=0
        strip.addWindow(win2.adapter); // col2 @ x=908 — straddles the bezel at x=1000

        // Realigned fully onto the right screen: real x = 908 - (-92) = 1000
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1000 }));
    });
});
