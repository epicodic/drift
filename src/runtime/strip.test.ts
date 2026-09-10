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
// Also zeroes verticalGap: this is the first task to wire settings.verticalGap into Grid at all
// (Strip's Grid construction previously only ever passed 2 args, so rowGap was always 0
// regardless of settings) — every existing stacked-tile height assertion in this file was
// written against that always-0 rowGap and breaks otherwise. horizontalGap is deliberately left
// at its DEFAULT_SETTINGS value (8): it was already effectively wired (via the old, now-renamed
// settings.columnGap) and every existing column-position assertion already bakes in that gap
// (e.g. col2 @ x=808 = 800 + 8).
const SETTINGS = {
    ...DEFAULT_SETTINGS,
    topMargin: 0,
    bottomMargin: 0,
    leftMargin: 0,
    rightMargin: 0,
    verticalGap: 0,
    // Every existing drag test here simulates a purely-horizontal drag (constant y) and
    // asserts it triggers an immediate reorder/stack — exactly the case drag-pan (docs:
    // 2026-09-10-drag-viewport-pan-design) repurposes into panning. Keep those tests
    // exercising reorder/stack logic only; drag-pan itself is covered by drag-pan.test.ts.
    dragPanEnabled: false,
};
const INSTANT_SETTINGS = { ...SETTINGS, animationDurationMs: 0 };

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

interface FakeWorkspaceAdapter extends WorkspaceAdapter {
    cursor: { x: number; y: number };
}

function fakeWorkspaceAdapter(screens: ScreenInfo[] = []): FakeWorkspaceAdapter {
    const adapter = {
        screens: () => screens,
        cursor: { x: 0, y: 0 },
        cursorPos(): { x: number; y: number } {
            return adapter.cursor;
        },
    };
    return adapter as unknown as FakeWorkspaceAdapter;
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
    minimize(): void;
    restore(): void;
    setFrameGeometryValue(rect: Rect): void;
    triggerFrameGeometryChanged(oldGeometry: Rect): void;
    startDrag(): void;
    finishDrag(): void;
    startResize(): void;
    finishResize(): void;
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
    let isMinimized = options.minimized ?? false;
    let isInteractiveMove = false;
    let isInteractiveResize = false;
    let currentRect: Rect = { x: 0, y: 0, width: options.width ?? 800, height: 1000 };
    let fullScreenHandler: (() => void) | undefined;
    let minimizedHandler: (() => void) | undefined;
    let moveStartedHandler: (() => void) | undefined;
    const frameGeometryHandlers: ((oldGeometry: Rect) => void)[] = [];
    const moveFinishedHandlers: (() => void)[] = [];
    const adapter = {
        id,
        caption: id,
        frameGeometry: () => currentRect,
        setFrameGeometry,
        activate,
        icon: () => null,
        windowHandle: () => null,
        output: () => FAKE_OUTPUT,
        isMinimized: () => isMinimized,
        isFullScreen: () => isFullScreen,
        isInteractiveResize: () => isInteractiveResize,
        isInteractiveMove: () => isInteractiveMove,
        onFrameGeometryChanged: (handler: (oldGeometry: Rect) => void) => {
            frameGeometryHandlers.push(handler);
            return disconnects.frameGeometry;
        },
        onMinimizedChanged: (handler: () => void) => {
            minimizedHandler = handler;
            return disconnects.minimized;
        },
        onFullScreenChanged: (handler: () => void) => {
            fullScreenHandler = handler;
            return disconnects.fullScreen;
        },
        onInteractiveMoveResizeStarted: (handler: () => void) => {
            moveStartedHandler = handler;
            return disconnects.moveStarted;
        },
        onInteractiveMoveResizeFinished: (handler: () => void) => {
            moveFinishedHandlers.push(handler);
            return disconnects.moveFinished;
        },
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
        minimize: () => {
            isMinimized = true;
            minimizedHandler?.();
        },
        restore: () => {
            isMinimized = false;
            minimizedHandler?.();
        },
        setFrameGeometryValue: (rect) => {
            currentRect = rect;
        },
        triggerFrameGeometryChanged: (oldGeometry) => {
            for (const handler of frameGeometryHandlers) {
                handler(oldGeometry);
            }
        },
        startDrag: () => {
            isInteractiveMove = true;
            moveStartedHandler?.();
        },
        finishDrag: () => {
            for (const handler of moveFinishedHandlers) {
                handler();
            }
        },
        startResize: () => {
            isInteractiveResize = true;
        },
        finishResize: () => {
            isInteractiveResize = false;
            // KWin fires the same interactiveMoveResizeFinished signal for a border resize
            // as for a move drag.
            for (const handler of moveFinishedHandlers) {
                handler();
            }
        },
    };
}

describe('Strip', () => {
    it('updateArea resizes the grid height and re-renders windows at the new height', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.updateArea({ x: 0, y: 0, width: AREA.width, height: 900 });

        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ height: 900 }));
    });

    it('updateArea shifts window geometry to a new area origin', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.updateArea({ x: 0, y: 40, width: AREA.width, height: 960 });

        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: 40 }));
    });

    it('adds an already-minimized window without throwing and still positions it via geometry sync', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { minimized: true });

        expect(() => strip.addWindow(win.adapter)).not.toThrow();
        expect(win.setFrameGeometry).toHaveBeenCalled();
    });

    it('applies real geometry to a newly added window', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');

        strip.addWindow(win.adapter);

        expect(win.setFrameGeometry).toHaveBeenCalled();
    });

    it('tears down every window signal when the window is removed', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);

        strip.removeWindow(win.adapter);

        // Two independent onFrameGeometryChanged subscribers: window-events.ts's resize/fullscreen
        // handling, and drag.ts's live drag-reorder preview.
        expect(win.disconnects.frameGeometry).toHaveBeenCalledTimes(2);
        expect(win.disconnects.minimized).toHaveBeenCalledTimes(1);
        expect(win.disconnects.fullScreen).toHaveBeenCalledTimes(1);
        expect(win.disconnects.moveStarted).toHaveBeenCalledTimes(1);
        // Two independent onInteractiveMoveResizeFinished subscribers: wireTile's own
        // post-resize motion reseed, and drag.ts's live drag-reorder finish handling.
        expect(win.disconnects.moveFinished).toHaveBeenCalledTimes(2);
    });

    it('ignores removal of a window it never registered', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const ghost = fakeWindow('ghost');

        expect(() => strip.removeWindow(ghost.adapter)).not.toThrow();
        expect(ghost.disconnects.frameGeometry).not.toHaveBeenCalled();
    });

    it('stops writing geometry to a window after it is removed', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        strip.removeWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('keeps a window at its live-resized width once the border-drag ends and something else renders', () => {
        // Reproduces: resize window A's border, then switch focus to window B (which reveals B
        // and re-renders every window, including A, without excluding it) — A's width must not
        // snap back to its pre-resize value.
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a', { width: 400 });
        strip.addWindow(a.adapter);
        const b = fakeWindow('b');
        strip.addWindow(b.adapter);

        // Live border-drag resize of `a` from 400 to 800, as KWin reports it while dragging.
        a.startResize();
        a.setFrameGeometryValue({ x: 0, y: 0, width: 800, height: 1000 });
        a.triggerFrameGeometryChanged({ x: 0, y: 0, width: 400, height: 1000 });
        a.finishResize();

        a.setFrameGeometry.mockClear();

        // Some later, unrelated full render — e.g. triggered by switching focus to `b` and
        // revealing it — must not exclude `a` and must keep it at its resized width.
        strip.render();

        expect(a.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ width: 800 }));
    });

    it('activates a known window and focus stepping do not throw', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);

        expect(() => strip.activateWindow(win.adapter)).not.toThrow();
        expect(() => strip.focusLeft()).not.toThrow();
        expect(() => strip.focusRight()).not.toThrow();
    });

    it('reports a minimap snapshot with the focused column flagged', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);

        const snapshot = strip.minimapSnapshot();

        expect(snapshot.columns).toHaveLength(1);
        expect(snapshot.columns[0].tiles[0].focused).toBe(true);
    });

    it('reports the reveal animation target offset immediately, not the stale pre-move offset', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter); // col1 @ x=0, width 800 — fits, no scroll
        strip.addWindow(win2.adapter); // col2 @ x=808, width 800 — revealFocused animates offset 0 -> 328

        const snapshot = strip.minimapSnapshot();

        expect(snapshot.viewport.offset).toBe(328);
    });

    it('activates the window of the column focus moves to', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
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
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { fullScreen: true });
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('stops writing geometry once fullScreenChanged reports the window entered fullscreen, even via an unrelated render()', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setIsFullScreen(true);
        win.triggerFullScreenChanged();
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it('resumes writing geometry once fullScreenChanged reports the window left fullscreen', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
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
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setIsFullScreen(true);
        win.triggerFullScreenChanged();
        win.setIsFullScreen(false); // live property drifts without a matching signal
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });

    it("still positions a stacked column's other tile when one tile in the stack is fullscreen", () => {
        // Regression guard for the allTilesExcluded check in render(): a fullscreen tile must
        // only exclude ITSELF from geometry sync, not silently freeze/skip its still-visible
        // sibling in the same stack (docs: 2026-09-03-vertical-tiling-design).
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');
        strip.addWindow(top.adapter);
        strip.addWindow(bottom.adapter);
        strip.focusLeft(); // refocus top's column
        strip.absorbRight(); // top column: [top, bottom]

        top.setIsFullScreen(true);
        top.triggerFullScreenChanged();
        top.setFrameGeometry.mockClear();
        bottom.setFrameGeometry.mockClear();

        // instant=true: bypasses bottom's tile-motion animation so this only asserts the
        // fullscreen-exclusion property below, not an unrelated in-flight animation frame.
        strip.render(undefined, true);

        expect(top.setFrameGeometry).not.toHaveBeenCalled(); // fullscreen tile's geometry left alone
        expect(bottom.setFrameGeometry).toHaveBeenCalled(); // sibling tile still positioned
        const bottomCalls = bottom.setFrameGeometry.mock.calls;
        const bottomRect = bottomCalls[bottomCalls.length - 1][0];
        expect(bottomRect.height).toBeGreaterThan(0);
        expect(bottomRect.height).toBeLessThan(AREA.height); // stacked, not full column height
        expect(bottomRect.y).toBeGreaterThan(0); // sits below top's (still-allocated) space
    });

    it('renders a window shifted by the vertical offset passed to render()', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render(undefined, true, 1000);

        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: -1000 }));
    });

    it('defaults render() to no vertical offset', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.render();

        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
    });

    it('remembers a parked vertical offset across an internal render() call that passes none (regression)', () => {
        // StripStack parks an inactive strip off-screen via an explicit render(undefined, true, offset)
        // call, then never touches that strip again except through Strip's own internal call sites
        // (addWindow, removeWindow, detachFocusedColumn, window-events handlers, ...) which all omit
        // the third argument. Before the fix, render()'s third parameter defaulted to 0, so any such
        // internal-only call silently reset the strip's already-visible windows back to y=0, right on
        // top of whatever strip was actually on screen.
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter);
        strip.render(undefined, true, 1000); // park this strip off-screen, as StripStack does for an inactive strip
        win1.setFrameGeometry.mockClear();

        const win2 = fakeWindow('w2');
        strip.addWindow(win2.adapter); // internal-only call: addWindow's own render() passes no offset

        const calls = win1.setFrameGeometry.mock.calls;
        const lastCall = calls[calls.length - 1][0] as { y: number };
        expect(lastCall.y).toBe(-1000); // still parked, not reset to y=0
    });

    it('detachFocusedColumn removes the focused column and returns its window', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter); // focused
        strip.addWindow(win2.adapter); // becomes focused (added right of the focused column)

        const detached = strip.detachFocusedColumn();

        expect(detached).toEqual([win2.adapter]);
        expect(strip.isEmpty()).toBe(false); // win1's column remains
    });

    it('detachFocusedColumn returns an empty array when the strip has no columns', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(strip.detachFocusedColumn()).toEqual([]);
    });

    it('isEmpty reflects whether any window is registered', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(strip.isEmpty()).toBe(true);

        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        expect(strip.isEmpty()).toBe(false);

        strip.removeWindow(win.adapter);
        expect(strip.isEmpty()).toBe(true);
    });

    it('excludes the newly-added window from its own trailing render when added mid-drag', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const existing = fakeWindow('existing', { width: 400 });
        strip.addWindow(existing.adapter);
        existing.setFrameGeometry.mockClear();
        const dragged = fakeWindow('dragged', { width: 400 });

        strip.addWindow(dragged.adapter, true);

        expect(dragged.setFrameGeometry).not.toHaveBeenCalled();
        expect(existing.setFrameGeometry).toHaveBeenCalled(); // neighbor still gets positioned normally
    });

    it('does not exclude the newly-added window when added normally (regression)', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 400 });

        strip.addWindow(win.adapter);

        expect(win.setFrameGeometry).toHaveBeenCalled();
    });

    it('skips revealFocused for a window added mid-drag, so a strip-overflow reveal-pan never fights the live drag (regression)', () => {
        // AREA is 1280 wide; two 800-wide columns overflow it (1608 virtual width), so
        // revealFocused() for the second one already pans the viewport — the scenario in
        // which an un-guarded revealFocused() on a mid-drag add would start a real Animator
        // pan whose tick calls render() with no excludeWindowId, writing real geometry to
        // the actively-dragged window and fighting the live KWin interactive move.
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const timer = fakeTimer();
            const strip = new Strip(AREA, SETTINGS, timer, fakeWorkspaceAdapter());
            const existing1 = fakeWindow('existing1', { width: 800 });
            const existing2 = fakeWindow('existing2', { width: 800 });
            strip.addWindow(existing1.adapter); // col1 @ x=0, focused
            strip.addWindow(existing2.adapter); // col2 @ x=808, focused; reveal pans right (overflow)

            // Let existing2's own reveal-pan settle fully first, so any later geometry write on
            // "dragged" can only come from the mid-drag add's own (would-be) reveal, not this one.
            vi.setSystemTime(SETTINGS.animationDurationMs);
            timer.fire();

            const dragged = fakeWindow('dragged', { width: 400 });
            strip.addWindow(dragged.adapter, true); // mid-drag add: must not trigger a reveal-pan
            dragged.setFrameGeometry.mockClear();

            // Advance further in case a wrongly-called revealFocused() started a new pan animation.
            vi.setSystemTime(SETTINGS.animationDurationMs * 2);
            timer.fire();

            expect(dragged.setFrameGeometry).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('still reveals the focused column when a window is added normally (regression)', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const revealFocusedSpy = vi.spyOn(strip, 'revealFocused');
        const win = fakeWindow('w1', { width: 400 });

        strip.addWindow(win.adapter);

        expect(revealFocusedSpy).toHaveBeenCalledTimes(1);
    });

    it('seeds an already-dragging connection when added mid-drag, so a geometry tick reorders without a Started signal', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const existing = fakeWindow('existing', { width: 400 });
        strip.addWindow(existing.adapter);
        const dragged = fakeWindow('dragged', { width: 400 });
        strip.addWindow(dragged.adapter, true); // reparented mid-drag - Started never fires on this connection
        existing.setFrameGeometry.mockClear();
        dragged.setFrameGeometry.mockClear();

        // Move the dragged window's real geometry (as KWin would during the live move) back over
        // "existing"'s center, without ever firing interactiveMoveResizeStarted on this connection.
        dragged.setFrameGeometryValue({ x: 50, y: 0, width: 400, height: 1000 });
        dragged.triggerFrameGeometryChanged({ x: 0, y: 0, width: 400, height: 1000 });

        // The dragged window's own geometry must still never be written mid-drag...
        expect(dragged.setFrameGeometry).not.toHaveBeenCalled();
        // ...while "existing" (displaced) gets a real geometry write from the live-preview reorder.
        expect(existing.setFrameGeometry).toHaveBeenCalled();
    });

    it('invokes the supplied strip-drag hooks on start/tick/finish', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 400 });
        const onDragStarted = vi.fn();
        const onDragTick = vi.fn();
        const onDragFinished = vi.fn();
        strip.addWindow(win.adapter, false, { onDragStarted, onDragTick, onDragFinished });

        win.startDrag();
        expect(onDragStarted).toHaveBeenCalledWith(win.adapter);

        win.triggerFrameGeometryChanged({ x: 0, y: 0, width: 400, height: 1000 });
        expect(onDragTick).toHaveBeenCalledWith(win.adapter);

        win.finishDrag();
        expect(onDragFinished).toHaveBeenCalled();
    });

    it('reveals the dragged column when the drag finishes, in case reordering pushed it out of the viewport (regression)', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 400 });
        strip.addWindow(win.adapter);
        const revealFocusedSpy = vi.spyOn(strip, 'revealFocused');
        revealFocusedSpy.mockClear(); // drop addWindow's own initial reveal call

        win.startDrag();
        win.finishDrag();

        expect(revealFocusedSpy).toHaveBeenCalledTimes(1);
    });

    it('does not invoke onDragTick when the window is not currently dragging (regression)', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 400 });
        const onDragTick = vi.fn();
        strip.addWindow(win.adapter, false, { onDragTick });

        win.triggerFrameGeometryChanged({ x: 0, y: 0, width: 400, height: 1000 });

        expect(onDragTick).not.toHaveBeenCalled();
    });

    it('setSkipTaskbar toggles every window currently in the strip', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter);
        const setSkipTaskbar1 = vi.fn();
        const setSkipTaskbar2 = vi.fn();
        (win1.adapter as unknown as { setSkipTaskbar: typeof setSkipTaskbar1 }).setSkipTaskbar = setSkipTaskbar1;
        (win2.adapter as unknown as { setSkipTaskbar: typeof setSkipTaskbar2 }).setSkipTaskbar = setSkipTaskbar2;

        strip.setSkipTaskbar(true);

        expect(setSkipTaskbar1).toHaveBeenCalledWith(true);
        expect(setSkipTaskbar2).toHaveBeenCalledWith(true);
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

        it("keeps a minimized window's real x tracking the pan instead of freezing it (regression)", () => {
            const strip = new Strip(AREA, SHIFT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            const win2 = fakeWindow('w2', { minimized: true });
            strip.addWindow(win1.adapter);
            strip.addWindow(win2.adapter); // col2, hidden: virtual x 808 (800 + gap 8)
            strip.focusLeft(); // back to col1, offset 0
            win2.setFrameGeometry.mockClear();

            strip.shiftViewportLeft(); // offset 0 -> 100

            expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 708 })); // 808 - 100
        });
    });

    describe('minimizing a window that overflows the viewport (regression)', () => {
        it('keeps the still-visible, focused neighbor on screen after the gap collapses', () => {
            const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            const win2 = fakeWindow('w2');
            strip.addWindow(win1.adapter);
            strip.addWindow(win2.adapter); // col2 focused; revealFocused scrolls right to show it fully
            win1.setFrameGeometry.mockClear();
            win2.setFrameGeometry.mockClear();

            win1.minimize();

            // Before the fix this landed at x=-327: win2 slid left with the collapsed gap but the
            // viewport offset never re-centered on it, pushing it mostly off screen.
            const calls = win2.setFrameGeometry.mock.calls;
            const real = calls[calls.length - 1][0];
            expect(real.x).toBeGreaterThanOrEqual(0);
            expect(real.x + real.width).toBeLessThanOrEqual(AREA.width);
        });
    });

    describe('axis-motion animation', () => {
        it('starts a pushed neighbor from its previous position and settles it at the new one', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const timer = fakeTimer();
                const strip = new Strip(WIDE_AREA, SETTINGS, timer, fakeWorkspaceAdapter());
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

                vi.setSystemTime(SETTINGS.animationDurationMs);
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
                const strip = new Strip(WIDE_AREA, SETTINGS, timer, fakeWorkspaceAdapter());
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
                vi.setSystemTime(SETTINGS.animationDurationMs / 2);
                timer.fire();

                expect(win3.setFrameGeometry).not.toHaveBeenCalled();
                expect(win2.setFrameGeometry).toHaveBeenCalled(); // col2's push animation still continues
            } finally {
                vi.useRealTimers();
            }
        });

        it('renders a column at its exact logical position when instant=true, bypassing animation', () => {
            const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
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

        it('animates a column width change instead of jumping to the new width', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                strip.addWindow(win1.adapter); // col1 @ x=0, width 800
                win1.setFrameGeometry.mockClear();

                strip.increaseColumnWidth();

                vi.setSystemTime(SETTINGS.animationDurationMs / 2);
                strip.render();

                const [lastCall] = win1.setFrameGeometry.mock.calls.slice(-1);
                const width = (lastCall[0] as { width: number }).width;
                expect(width).toBeGreaterThan(SETTINGS.defaultColumnWidth);
                expect(width).toBeLessThan(SETTINGS.defaultColumnWidth + SETTINGS.columnWidthStep);
            } finally {
                vi.useRealTimers();
            }
        });

        it("keeps a stacked column's tiles at identical x and width while the column slides", () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                const win2 = fakeWindow('w2');
                const win3 = fakeWindow('w3');
                strip.addWindow(win1.adapter); // col1
                strip.addWindow(win2.adapter); // col2
                strip.focusLeft();
                strip.absorbRight(); // win2 becomes col1's second tile, flying in from col2's x
                strip.addWindow(win3.adapter); // new column right of col1
                // Let the absorb's own fly-in finish, so both tiles start this move at rest.
                vi.setSystemTime(SETTINGS.animationDurationMs);
                strip.render();
                strip.focusFirst();
                strip.moveWindowRight(); // col1 slides right; both its tiles must move together
                win1.setFrameGeometry.mockClear();
                win2.setFrameGeometry.mockClear();

                vi.setSystemTime(SETTINGS.animationDurationMs * 1.5);
                strip.render();

                const [call1] = win1.setFrameGeometry.mock.calls.slice(-1);
                const [call2] = win2.setFrameGeometry.mock.calls.slice(-1);
                const rect1 = call1[0] as { x: number; width: number };
                const rect2 = call2[0] as { x: number; width: number };
                expect(rect2.x).toBe(rect1.x);
                expect(rect2.width).toBe(rect1.width);
            } finally {
                vi.useRealTimers();
            }
        });

        it('seedMotionFrom drifts a window from the seeded rect into its layout slot', () => {
            vi.useFakeTimers();
            vi.setSystemTime(0);
            try {
                const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
                const win1 = fakeWindow('w1');
                strip.addWindow(win1.adapter); // col1 @ x=0
                win1.setFrameGeometry.mockClear();

                strip.seedMotionFrom(win1.adapter.id, { x: 400 });
                strip.render();

                expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 400 }));

                vi.setSystemTime(SETTINGS.animationDurationMs / 2);
                strip.render();

                const [lastCall] = win1.setFrameGeometry.mock.calls.slice(-1);
                const x = (lastCall[0] as { x: number }).x;
                expect(x).toBeLessThan(400);
                expect(x).toBeGreaterThan(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('seedMotionFrom leaves omitted channels resting where they were', () => {
            const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
            const win1 = fakeWindow('w1');
            strip.addWindow(win1.adapter);
            win1.setFrameGeometry.mockClear();

            strip.seedMotionFrom(win1.adapter.id, { y: 300 });
            strip.render();

            expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0, y: 300 }));
        });

        describe('keyboard column moves animate instead of jumping', () => {
            const cases: { name: string; focus: 'first' | 'last'; act: (strip: Strip) => void; targetX: number }[] = [
                { name: 'moveWindowRight', focus: 'first', act: (s) => s.moveWindowRight(), targetX: 808 },
                { name: 'moveWindowToEnd', focus: 'first', act: (s) => s.moveWindowToEnd(), targetX: 1616 },
                { name: 'moveWindowLeft', focus: 'last', act: (s) => s.moveWindowLeft(), targetX: 808 },
                { name: 'moveWindowToStart', focus: 'last', act: (s) => s.moveWindowToStart(), targetX: 0 },
            ];

            for (const { name, focus, act, targetX } of cases) {
                it(`${name} eases the moved column from its old slot to its new one`, () => {
                    vi.useFakeTimers();
                    vi.setSystemTime(0);
                    try {
                        const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
                        const windows = [fakeWindow('w1'), fakeWindow('w2'), fakeWindow('w3')];
                        for (const win of windows) {
                            strip.addWindow(win.adapter); // cols @ x=0, 808, 1616
                        }
                        const moved = focus === 'first' ? windows[0] : windows[2];
                        const startX = focus === 'first' ? 0 : 1616;
                        if (focus === 'first') {
                            strip.focusFirst();
                        } else {
                            strip.focusLast();
                        }
                        moved.setFrameGeometry.mockClear();

                        act(strip);

                        vi.setSystemTime(SETTINGS.animationDurationMs / 2);
                        strip.render();

                        const [midCall] = moved.setFrameGeometry.mock.calls.slice(-1);
                        const midX = (midCall[0] as { x: number }).x;
                        expect(midX).toBeGreaterThan(Math.min(startX, targetX));
                        expect(midX).toBeLessThan(Math.max(startX, targetX));

                        vi.setSystemTime(SETTINGS.animationDurationMs);
                        strip.render();

                        expect(moved.setFrameGeometry).toHaveBeenLastCalledWith(
                            expect.objectContaining({ x: targetX }),
                        );
                    } finally {
                        vi.useRealTimers();
                    }
                });
            }
        });

        it('snaps a column back into place after fullscreen instead of animating from its pre-fullscreen position', () => {
            const strip = new Strip(WIDE_AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
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

    it('insets the grid, viewport, and geometry sync by the configured margins', () => {
        const marginSettings = { ...SETTINGS, topMargin: 10, bottomMargin: 20, leftMargin: 30, rightMargin: 40 };
        const strip = new Strip(AREA, marginSettings, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');

        strip.addWindow(win.adapter);

        // AREA is { x: 0, y: 0, width: 1280, height: 1000 }; margins carve 30px off the left
        // and 10px off the top, and the column fills the remaining height (1000 - 10 - 20 = 970).
        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 30, y: 10, height: 970 }));
    });

    it('re-applies margins to the new area on updateArea', () => {
        const marginSettings = { ...SETTINGS, topMargin: 10, bottomMargin: 20, leftMargin: 30, rightMargin: 40 };
        const strip = new Strip(AREA, marginSettings, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1');
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.updateArea({ x: 100, y: 200, width: 1280, height: 1000 });

        // New area origin (100, 200) plus the same left/top margins (30, 10).
        expect(win.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ x: 130, y: 210, height: 970 }));
    });
});

describe('Strip — stack motion animation', () => {
    it("animates a newly-stacked tile's y/height from its previous standalone position to its new stacked slot", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const timer = fakeTimer();
            const strip = new Strip(AREA, SETTINGS, timer, fakeWorkspaceAdapter());
            const left = fakeWindow('left');
            const right = fakeWindow('right');
            strip.addWindow(left.adapter);
            strip.addWindow(right.adapter);
            strip.focusLeft();
            right.setFrameGeometry.mockClear();

            strip.absorbRight(); // right becomes left's second tile, stacked below

            // first frame: right hasn't jumped yet, still at its previous standalone y/height
            expect(right.setFrameGeometry).toHaveBeenCalledWith(expect.objectContaining({ y: 0, height: AREA.height }));

            vi.setSystemTime(SETTINGS.animationDurationMs);
            timer.fire();

            const settled = right.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
            expect(settled.y).toBeGreaterThan(0); // now below its stack-mate
            expect(settled.height).toBeLessThan(AREA.height); // now sharing the column
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders a stacked tile at its exact logical y/height when instant=true, bypassing animation', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight();
        right.setFrameGeometry.mockClear();

        strip.render(undefined, true); // e.g. a live interactive-resize frame

        const rect = right.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
        expect(rect.y).toBeGreaterThan(0);
        expect(rect.height).toBeLessThan(AREA.height);
    });

    it('snaps a stack tile back into place after fullscreen instead of animating from its pre-fullscreen position', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a');
        const b = fakeWindow('b');
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [a, b], b stacked below a
        b.setIsFullScreen(true);
        b.triggerFullScreenChanged(); // excluded from render; forgets b's y/height motion

        const c = fakeWindow('c');
        strip.addWindow(c.adapter); // pushes nothing here, but let's actually change the stack: absorb c too
        strip.focusLeft(); // back to the [a, b] column (still focused on a's tile)
        strip.absorbRight(); // column becomes [a, b, c] while b is still fullscreen-excluded

        b.setIsFullScreen(false);
        b.triggerFullScreenChanged(); // resumes rendering — must snap straight to its new 3-way slot

        const rect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
        // 3-way split of AREA.height, b in the middle slot — allow a couple of pixels of
        // rounding slack rather than assuming an exactly-integer-divisible split.
        expect(Math.abs(rect.height - AREA.height / 3)).toBeLessThanOrEqual(2);
        expect(Math.abs(rect.y - AREA.height / 3)).toBeLessThanOrEqual(2);
    });

    it('snaps a minimized stack tile back into place after restore instead of animating from its pre-minimize position', () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a');
        const b = fakeWindow('b');
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [a, b]
        b.minimize(); // excluded from render; forgets b's y/height motion

        const c = fakeWindow('c');
        strip.addWindow(c.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column becomes [a, b, c] while b is still minimize-excluded

        b.restore(); // resumes rendering — must snap straight to its new 3-way slot

        const rect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
        expect(Math.abs(rect.height - AREA.height / 3)).toBeLessThanOrEqual(2);
        expect(Math.abs(rect.y - AREA.height / 3)).toBeLessThanOrEqual(2);
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

    it('holds the left and right margins when two columns together are wider than the screen', () => {
        const marginSettings = { ...INSTANT_SETTINGS, leftMargin: 8, rightMargin: 8 };
        const screens: ScreenInfo[] = [{ name: 's1', geometry: { x: 0, y: 0, width: 1280, height: 1000 } }];
        const strip = new Strip(AREA, marginSettings, fakeTimer(), fakeWorkspaceAdapter(screens));
        const win1 = fakeWindow('w1', { width: 700 });
        const win2 = fakeWindow('w2', { width: 700 });

        strip.addWindow(win1.adapter); // col1 @ virtualX=0
        strip.addWindow(win2.adapter); // col2 @ virtualX=708, focused — combined width 1408 > the 1264px usable area

        // Right margin held: col2's real right edge sits at area.x + area.width = 8 + 1264 = 1272.
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 572 }));

        strip.focusLeft();

        // Left margin held: col1's real left edge sits at area.x = 8.
        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 8 }));
    });
});

describe('Strip — absorb/expel', () => {
    it('absorbRight merges the right column into the focused one as a new tile', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        // addWindow focuses the newly added column each time — refocus "left" explicitly.
        strip.focusLeft();

        strip.absorbRight();

        expect(left.setFrameGeometry).toHaveBeenCalled();
        expect(right.setFrameGeometry).toHaveBeenCalled();
        const leftCalls = left.setFrameGeometry.mock.calls;
        const rightCalls = right.setFrameGeometry.mock.calls;
        const leftRect = leftCalls[leftCalls.length - 1][0];
        const rightRect = rightCalls[rightCalls.length - 1][0];
        expect(leftRect.x).toBe(rightRect.x); // same column now
        expect(leftRect.y).toBe(0);
        expect(rightRect.y).toBe(leftRect.height); // stacked below
    });

    it('absorbRight is a no-op with no right neighbor', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);
        const callsBefore = only.setFrameGeometry.mock.calls.length;

        strip.absorbRight();

        expect(only.setFrameGeometry.mock.calls.length).toBe(callsBefore);
    });

    it('expel moves the focused tile back into its own column to the right', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column now has 2 tiles: left (focused), right

        strip.expel();

        const leftCalls = left.setFrameGeometry.mock.calls;
        const rightCalls = right.setFrameGeometry.mock.calls;
        const leftRect = leftCalls[leftCalls.length - 1][0];
        const rightRect = rightCalls[rightCalls.length - 1][0];
        expect(rightRect.height).toBe(AREA.height); // right is alone in the original column now, full height
        expect(leftRect.x).toBeGreaterThan(rightRect.x); // left (expelled, focused) got the new column to the right
    });

    it('expel is a no-op on a single-tile column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);
        const callsBefore = only.setFrameGeometry.mock.calls.length;

        strip.expel();

        expect(only.setFrameGeometry.mock.calls.length).toBe(callsBefore);
    });
});

describe('Strip — commitTileIntoStack', () => {
    it("moves a standalone column's window into another column as a new tile, removing the source column", () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        const leftLocation = strip.locationOf('left')!;
        const rightLocation = strip.locationOf('right')!;

        strip.commitTileIntoStack(leftLocation.columnId, leftLocation.tileId, rightLocation.columnId, 0);
        strip.render();

        expect(strip.locationOf('left')!.columnId).toBe(rightLocation.columnId); // left now shares right's column
        const rightCalls = right.setFrameGeometry.mock.calls;
        const rightRect = rightCalls[rightCalls.length - 1][0];
        expect(rightRect.height).toBeLessThan(AREA.height); // now sharing the column
    });

    it("does not disturb the target column's other tiles beyond the requested slot", () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a');
        const b = fakeWindow('b');
        const c = fakeWindow('c');
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column: [a, b]
        strip.addWindow(c.adapter);
        const stackColumnId = strip.locationOf('a')!.columnId;
        const cLocation = strip.locationOf('c')!;

        strip.commitTileIntoStack(cLocation.columnId, cLocation.tileId, stackColumnId, 0);
        strip.render();

        expect(strip.locationOf('a')!.columnId).toBe(stackColumnId);
        expect(strip.locationOf('b')!.columnId).toBe(stackColumnId);
        expect(strip.locationOf('c')!.columnId).toBe(stackColumnId);
    });
});

describe('Strip — live reorder commit', () => {
    it('commits a real Grid.moveColumn swap, live, once the dragged edge passes reorderThresholdFraction', () => {
        // Regression coverage for docs: 2026-09-04-drag-reorder-stack-priority-design — reorder
        // is live again (not deferred to release), and triggers off the dragged WINDOW's own
        // edge, not the real pointer. Goes through the real Strip.addWindow wiring, not a direct
        // strip.render(...) call, so it exercises the actual DragReorderDeps.render wrapper too.
        const workspaceAdapter = fakeWorkspaceAdapter();
        const strip = new Strip(WIDE_AREA, INSTANT_SETTINGS, fakeTimer(), workspaceAdapter);
        const a = fakeWindow('a', { width: 640 });
        const b = fakeWindow('b', { width: 640 });
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);

        const aCalls = a.setFrameGeometry.mock.calls;
        const aRealX = aCalls[aCalls.length - 1][0].x;
        const bCalls = b.setFrameGeometry.mock.calls;
        const bRealX = bCalls[bCalls.length - 1][0].x;

        b.startDrag();
        // reorderThresholdFraction defaults to 0.85, so a's (the left neighbor's) swap
        // threshold sits at aRealX + 640 * (1 - 0.85) = aRealX + 96 — deep into a, not merely
        // past its center. b's LEFT edge (aRealX + 50) clears that with comfortable margin.
        b.setFrameGeometryValue({ x: aRealX + 50, y: 0, width: 640, height: 1000 });
        b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 });

        const aCallsAfter = a.setFrameGeometry.mock.calls;
        expect(aCallsAfter[aCallsAfter.length - 1][0].x).toBe(bRealX); // a slides into b's old real slot

        b.finishDrag();

        // The commit is real, not a preview: it survives an unrelated render() with no drag state.
        strip.render();
        const aFinalCalls = a.setFrameGeometry.mock.calls;
        expect(aFinalCalls[aFinalCalls.length - 1][0].x).toBe(bRealX);
    });
});

describe('Strip — reorder release eases into place', () => {
    it('eases the dragged column from its drop position into its resolved slot, instead of snapping', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const timer = new ManualTimer();
            const workspaceAdapter = fakeWorkspaceAdapter();
            const strip = new Strip(WIDE_AREA, SETTINGS, timer, workspaceAdapter);
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter); // col a @ x=0
            strip.addWindow(b.adapter); // col b @ x=808

            const aRealX = a.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;
            const bRealX = b.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;

            b.startDrag();
            const dropX = aRealX + 50; // deep enough into a to trigger the live swap
            b.setFrameGeometryValue({ x: dropX, y: 0, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 }); // commits the swap live

            b.finishDrag();

            // right after release: eased in from the actual drop point, not snapped to the
            // resolved slot
            const rightAfterRelease = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { x: number };
            expect(rightAfterRelease.x).toBe(dropX);

            vi.setSystemTime(SETTINGS.animationDurationMs);
            timer.fire();

            const settled = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { x: number };
            expect(settled.x).toBe(aRealX); // now resting exactly at its resolved (swapped-into) slot
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not corrupt a stack sibling's x when the dragged tile settles back into its own multi-tile column without ever committing a reorder or a stack move", () => {
        // Regression: lastStackHover === null does NOT imply the released tile's column is
        // standalone — it's also null whenever tickInner never armed a stack target at all
        // (e.g. no candidate ever overlapped vertically, or the dwell never elapsed). In that
        // case location.columnId can still be the tile's original multi-tile stack column, and
        // seeding its shared x from the dragged tile's own (slightly off) live position would
        // corrupt every sibling's x for one frame.
        const strip = new Strip(WIDE_AREA, SETTINGS, new ManualTimer(), fakeWorkspaceAdapter());
        const a = fakeWindow('a', { width: 640 });
        const b = fakeWindow('b', { width: 640 });
        const c = fakeWindow('c', { width: 640 });
        strip.addWindow(a.adapter); // col A
        strip.addWindow(b.adapter); // col B
        strip.focusLeft();
        strip.absorbRight(); // col A becomes stack [a, b]; col B removed
        strip.addWindow(c.adapter); // col C, inserted right after col A — gives A a right neighbor

        const aRealX = a.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;
        const bRect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as {
            x: number;
            y: number;
            width: number;
            height: number;
        };

        b.startDrag();
        // Nudge b 10px right — nowhere near reorderThresholdFraction's swap threshold against
        // C, and b's y never changes, so it never vertically overlaps a (the only same-column
        // candidate) at all: resolveCurrentTarget resolves null, no stack target is ever armed,
        // and lastStackHover stays null — yet col A (b's home column) is still a 2-tile stack.
        b.setFrameGeometryValue({ x: bRect.x + 10, y: bRect.y, width: bRect.width, height: bRect.height });
        b.triggerFrameGeometryChanged({ x: bRect.x, y: bRect.y, width: bRect.width, height: bRect.height });

        b.finishDrag();

        // a was never touched — its x must stay exactly where it was, not jump to b's own
        // (10px-off) drop position.
        const aAfterRelease = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as { x: number };
        expect(aAfterRelease.x).toBe(aRealX);
    });
});

describe('Strip — stack release eases into place', () => {
    it('eases the dragged tile from its drop y/height into its resolved cross-column stack slot', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const strip = new Strip(WIDE_AREA, { ...SETTINGS, columnDragDwellMs: 100 }, timer, workspaceAdapter);
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter);
            strip.addWindow(b.adapter);
            const bRealX = b.setFrameGeometry.mock.calls.slice(-1)[0][0].x as number;

            b.startDrag();
            // Dragged down to y=100 (its own live screen position, e.g. wherever the cursor
            // left it — distinct from both its pre-drag y=0 and its eventual resolved slot
            // y=0, so the assertions below can't pass by coincidence). topFraction = 100/1000
            // = 0.1, comfortably under resolveStackTarget's 0.25 'above' threshold, so this
            // still resolves to the 'above' direction (see the equivalent dwell-preview test
            // for the rest of the geometry rationale).
            b.setFrameGeometryValue({ x: 200, y: 100, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 }); // arms the dwell

            vi.setSystemTime(100);
            timer.fire(); // dwell elapses, resolves+previews the cross-column stack target

            b.finishDrag(); // commits the cross-column stack move

            // right after release: eased in from the actual drop y/height, not snapped to the
            // resolved slot
            const rightAfterRelease = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as {
                y: number;
                height: number;
            };
            expect(rightAfterRelease.y).toBe(100);
            expect(rightAfterRelease.height).toBe(1000);

            vi.setSystemTime(100 + SETTINGS.animationDurationMs);
            timer.fire();

            const settled = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
            expect(settled.y).toBe(0); // top slot of the 2-tile stack
            expect(settled.height).toBeLessThan(1000); // redistributed within the stack
        } finally {
            vi.useRealTimers();
        }
    });

    it('eases the dragged tile from its drop y into its resolved same-column stack slot', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const strip = new Strip(WIDE_AREA, { ...SETTINGS, columnDragDwellMs: 100 }, timer, workspaceAdapter);
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter); // col A
            strip.addWindow(b.adapter); // col B
            strip.focusLeft();
            strip.absorbRight(); // col A becomes stack [a, b], eased in from a's/b's prior geometry

            // Let the absorb's own eased transition finish before dragging, so the rects below
            // reflect the stack's actual settled geometry: a (y=0,h=500) on top, b (y=500,h=500)
            // on the bottom.
            vi.setSystemTime(SETTINGS.animationDurationMs);
            timer.fire();

            const aRect = a.setFrameGeometry.mock.calls.slice(-1)[0][0] as {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            const bRect = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as {
                x: number;
                y: number;
                width: number;
                height: number;
            };

            b.startDrag();
            // Dragged up to y=100, its own live screen position — well clear of a's y=0/h=500
            // top-25% band (topFraction = 100/500 = 0.2 < 0.25), so this resolves to a same-column
            // target: {columnId: A, tileId: a, direction: 'above'}. Column A has no neighbor
            // columns at all (col B was absorbed away), so reorder and edge-expel never fire on
            // this tick, and the only stack candidate resolveCurrentTarget can gather is a's own
            // tile — ruling out an accidental cross-column resolution.
            b.setFrameGeometryValue({ x: bRect.x, y: 100, width: bRect.width, height: bRect.height });
            b.triggerFrameGeometryChanged({ x: bRect.x, y: bRect.y, width: bRect.width, height: bRect.height }); // arms the dwell

            const dwellFiresAt = SETTINGS.animationDurationMs + 100;
            vi.setSystemTime(dwellFiresAt);
            timer.fire(); // dwell elapses, resolves+previews the same-column stack target

            b.finishDrag(); // commits the same-column move via Column.moveTile

            // right after release: eased in from the actual drop y, not snapped to the resolved
            // slot
            const rightAfterRelease = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as {
                y: number;
                height: number;
            };
            expect(rightAfterRelease.y).toBe(100);
            expect(rightAfterRelease.height).toBe(bRect.height);

            vi.setSystemTime(dwellFiresAt + SETTINGS.animationDurationMs);
            timer.fire();

            const settled = b.setFrameGeometry.mock.calls.slice(-1)[0][0] as { y: number; height: number };
            expect(settled.y).toBe(aRect.y); // now the stack's top slot, swapped ahead of a
            // Unlike a cross-column drop, Column.moveTile never redistributes height — b keeps
            // exactly the height it had at drop.
            expect(settled.height).toBe(bRect.height);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Strip — stack dwell preview (docs: 2026-09-04-drag-reorder-stack-priority-design)', () => {
    it('shows no preview while merely hovering a neighbor, before the dwell elapses', () => {
        const workspaceAdapter = fakeWorkspaceAdapter();
        const strip = new Strip(WIDE_AREA, INSTANT_SETTINGS, fakeTimer(), workspaceAdapter);
        const a = fakeWindow('a', { width: 640 });
        const b = fakeWindow('b', { width: 640 });
        strip.addWindow(a.adapter);
        strip.addWindow(b.adapter);
        const bCalls = b.setFrameGeometry.mock.calls;
        const bRealX = bCalls[bCalls.length - 1][0].x;
        a.setFrameGeometry.mockClear();

        // b's own window geometry never moved — reorder's edge-crossing check (which measures
        // the window, not the pointer) never fires.
        b.startDrag();
        b.setFrameGeometryValue({ x: bRealX, y: 0, width: 640, height: 1000 });
        b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 });

        // No stack preview yet: a's own tile rect is untouched (no gap opened) — render() always
        // reapplies geometry to every visible column, so a call happens, but its rect must still
        // be the plain, full-height, ungapped one.
        const aCalls = a.setFrameGeometry.mock.calls;
        expect(aCalls[aCalls.length - 1][0]).toEqual({ x: 0, y: 0, width: 640, height: 1000 });

        b.finishDrag();
    });

    it('previews stacking into the hovered neighbor once the dwell elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const workspaceAdapter = fakeWorkspaceAdapter();
            const timer = new ManualTimer();
            const strip = new Strip(
                WIDE_AREA,
                { ...INSTANT_SETTINGS, columnDragDwellMs: 100 },
                timer,
                workspaceAdapter,
            );
            const a = fakeWindow('a', { width: 640 });
            const b = fakeWindow('b', { width: 640 });
            strip.addWindow(a.adapter);
            strip.addWindow(b.adapter);
            const bCalls = b.setFrameGeometry.mock.calls;
            const bRealX = bCalls[bCalls.length - 1][0].x;
            a.setFrameGeometry.mockClear();

            b.startDrag();
            // b's own geometry (not the pointer) is what stack resolution measures now: parked
            // at x=200 it overlaps a's [0,640) rect by 440px — 68.75% of a's width, clearing the
            // default 50% stackOverlapFraction gate — while its left edge (200) stays short of
            // the reorder threshold (640 * (1 - 0.85) = 96), so reorder never preempts the stack
            // check. y=0 keeps its top edge flush with a's, landing in a's top-25% band, which
            // resolves to direction 'above'.
            b.setFrameGeometryValue({ x: 200, y: 0, width: 640, height: 1000 });
            b.triggerFrameGeometryChanged({ x: bRealX, y: 0, width: 640, height: 1000 }); // arms the dwell

            const aCallsBeforeFire = a.setFrameGeometry.mock.calls;
            expect(aCallsBeforeFire[aCallsBeforeFire.length - 1][0]).toEqual({
                x: 0,
                y: 0,
                width: 640,
                height: 1000,
            }); // still just armed, not fired — no gap yet

            vi.setSystemTime(100);
            timer.fire(); // dwell elapses

            // a's column now shows a gap-opening preview for the incoming stack tile: its own
            // tile shifts down to make room for the gap above it (slot 0), instead of sitting
            // at y=0 like the plain, ungapped rect above.
            const aCallsAfterFire = a.setFrameGeometry.mock.calls;
            expect(aCallsAfterFire[aCallsAfterFire.length - 1][0].y).toBeGreaterThan(0);

            b.finishDrag();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Strip — drag handler after column membership changes (regression)', () => {
    it("keeps resolving a tile's live column after absorbRight changed which column it belongs to", () => {
        // Before Task 8, registerDragReorder closed over a fixed columnId captured once when
        // its drag handler was first connected (in Strip.addWindow). If a window later became a
        // stacked tile (e.g. via absorbRight), its drag handler kept pointing at the original,
        // since-removed column id — so dragging an already-stacked tile's title bar never worked
        // correctly. The fix: registerDragReorder no longer takes a columnId at all; it resolves
        // the window's CURRENT {columnId, tileId} fresh via registry.tileOf() on every tick and
        // on release (docs: 2026-09-03-drag-to-stack-design).
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left', { width: 800 });
        const right = fakeWindow('right', { width: 800 });
        strip.addWindow(left.adapter); // column A, focused
        strip.addWindow(right.adapter); // column B, focused — right's drag handler connects HERE, against column B
        strip.focusLeft(); // refocus column A
        strip.absorbRight(); // right becomes column A's second tile; column B is removed from the grid entirely

        const stackedLocation = strip.locationOf('right');
        expect(stackedLocation).not.toBeNull();
        expect(stackedLocation!.columnId).toBe(strip.locationOf('left')!.columnId); // right now lives in left's column
        const stackColumnId = stackedLocation!.columnId;

        // Simulate a drag on "right": its onInteractiveMoveResizeStarted/onFrameGeometryChanged/
        // onInteractiveMoveResizeFinished handlers were registered back when it was column B's own
        // standalone tile. Column B no longer exists in the grid at all — if drag.ts still resolved
        // against a stale captured columnId, this would throw ("Unknown column id") instead of
        // resolving cleanly against right's real, current column.
        right.startDrag();
        expect(() => {
            right.triggerFrameGeometryChanged({ x: 0, y: 0, width: 800, height: 1000 });
        }).not.toThrow();
        expect(() => right.finishDrag()).not.toThrow();

        // The drag operated on right's CURRENT column throughout: the registry stayed consistent,
        // and both tiles are still findable in the real (non-stale) column.
        const afterLocation = strip.locationOf('right');
        expect(afterLocation).not.toBeNull();
        expect(afterLocation!.columnId).toBe(stackColumnId);
        expect(strip.locationOf('left')!.columnId).toBe(stackColumnId);
    });
});

describe('Strip — focusUp/focusDown', () => {
    it("move activation between tiles in the focused column's stack", () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column: [left (focused), right]
        left.activate.mockClear();
        right.activate.mockClear();

        expect(strip.focusDown()).toBe(true);
        expect(right.activate).toHaveBeenCalledTimes(1);

        expect(strip.focusDown()).toBe(false); // already at the bottom — no-op
        expect(right.activate).toHaveBeenCalledTimes(1);

        expect(strip.focusUp()).toBe(true);
        expect(left.activate).toHaveBeenCalledTimes(1);
    });

    it('return false when the focused column has no stack to move within', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('solo').adapter);

        expect(strip.focusUp()).toBe(false);
        expect(strip.focusDown()).toBe(false);
    });

    it('return false when there is no focused column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(strip.focusUp()).toBe(false);
        expect(strip.focusDown()).toBe(false);
    });
});

describe('Strip — moveTileUp/moveTileDown', () => {
    it("reorder the focused tile within its column's stack without changing which tile is focused", () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');
        strip.addWindow(top.adapter);
        strip.addWindow(bottom.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [top (focused), bottom]
        top.setFrameGeometry.mockClear();
        bottom.setFrameGeometry.mockClear();

        expect(strip.moveTileDown()).toBe(true); // column: [bottom, top (focused)]

        const topCallsAfterDown = top.setFrameGeometry.mock.calls;
        const bottomCallsAfterDown = bottom.setFrameGeometry.mock.calls;
        expect(topCallsAfterDown[topCallsAfterDown.length - 1][0]).toEqual(expect.objectContaining({ y: 500 }));
        expect(bottomCallsAfterDown[bottomCallsAfterDown.length - 1][0]).toEqual(expect.objectContaining({ y: 0 }));

        top.setFrameGeometry.mockClear();
        bottom.setFrameGeometry.mockClear();
        expect(strip.moveTileUp()).toBe(true); // column: [top (focused), bottom]

        const topCallsAfterUp = top.setFrameGeometry.mock.calls;
        expect(topCallsAfterUp[topCallsAfterUp.length - 1][0]).toEqual(expect.objectContaining({ y: 0 }));
    });

    it('return false and no-op at the top/bottom of the stack, on a single-tile column, and with no focused column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(strip.moveTileUp()).toBe(false);
        expect(strip.moveTileDown()).toBe(false);

        strip.addWindow(fakeWindow('solo').adapter);
        expect(strip.moveTileUp()).toBe(false);
        expect(strip.moveTileDown()).toBe(false);

        const top = fakeWindow('top2');
        const bottom = fakeWindow('bottom2');
        strip.addWindow(top.adapter);
        strip.addWindow(bottom.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [top (focused), bottom]
        expect(strip.moveTileUp()).toBe(false); // already at the top
    });
});

describe('Strip — detachFocusedTile', () => {
    it('detaches just the focused tile, leaving the rest of a stacked column behind', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');
        strip.addWindow(top.adapter);
        strip.addWindow(bottom.adapter);
        strip.focusLeft();
        strip.absorbRight(); // column: [top (focused), bottom]

        const detached = strip.detachFocusedTile();

        expect(detached?.id).toBe('top');
        expect(strip.detachFocusedColumn().map((w) => w.id)).toEqual(['bottom']);
    });

    it('detaches the whole column when it only had one tile', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);

        const detached = strip.detachFocusedTile();

        expect(detached?.id).toBe('only');
        expect(strip.isEmpty()).toBe(true);
    });

    it('returns null when there is no focused column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(strip.detachFocusedTile()).toBeNull();
    });
});

describe('Strip — addWindowStack', () => {
    it('adds every window as tiles of a single stacked column, preserving order', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const top = fakeWindow('top');
        const middle = fakeWindow('middle');
        const bottom = fakeWindow('bottom');

        strip.addWindowStack([top.adapter, middle.adapter, bottom.adapter]);

        const detached = strip.detachFocusedColumn();
        expect(detached.map((w) => w.id)).toEqual(['top', 'middle', 'bottom']);
        expect(strip.isEmpty()).toBe(true); // detaching the only column emptied the strip
    });

    it('splits height evenly across the stacked tiles, top to bottom', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');

        strip.addWindowStack([top.adapter, bottom.adapter]);

        const topCalls = top.setFrameGeometry.mock.calls;
        const bottomCalls = bottom.setFrameGeometry.mock.calls;
        expect(topCalls[topCalls.length - 1][0]).toEqual(expect.objectContaining({ y: 0, height: 500 }));
        expect(bottomCalls[bottomCalls.length - 1][0]).toEqual(expect.objectContaining({ y: 500, height: 500 }));
    });

    it('focuses the first window, and focusDown moves through the rest of the stack', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');

        strip.addWindowStack([top.adapter, bottom.adapter]);
        top.activate.mockClear();
        bottom.activate.mockClear();

        expect(strip.focusDown()).toBe(true);
        expect(bottom.activate).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an empty array', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(() => strip.addWindowStack([])).not.toThrow();
        expect(strip.isEmpty()).toBe(true);
    });
});

describe('Strip — removeWindow on a stacked column', () => {
    it('removes just that tile, redistributing height, when siblings remain', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight(); // left column: [left, right]

        strip.removeWindow(right.adapter);

        const leftCalls = left.setFrameGeometry.mock.calls;
        const leftRect = leftCalls[leftCalls.length - 1][0];
        expect(leftRect.height).toBe(AREA.height); // left alone again, full height
    });

    it('removes the whole column when it was the only tile', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const only = fakeWindow('only');
        strip.addWindow(only.adapter);

        strip.removeWindow(only.adapter);

        expect(strip.isEmpty()).toBe(true);
    });
});

describe("Strip — detachFocusedColumn returns every tile's window", () => {
    it('returns all windows in a stacked column, and clears the strip', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const left = fakeWindow('left');
        const right = fakeWindow('right');
        strip.addWindow(left.adapter);
        strip.addWindow(right.adapter);
        strip.focusLeft();
        strip.absorbRight();

        const detached = strip.detachFocusedColumn();

        expect(detached.map((w) => w.id)).toEqual(expect.arrayContaining(['left', 'right']));
        expect(detached).toHaveLength(2);
        expect(strip.isEmpty()).toBe(true);
    });

    it('returns an empty array when the strip has no columns', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        expect(strip.detachFocusedColumn()).toEqual([]);
    });
});

describe('Strip — focusFirst/focusLast', () => {
    function threeColumnStrip(): {
        strip: Strip;
        win1: FakeWindow;
        win2: FakeWindow;
        win3: FakeWindow;
    } {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        const win3 = fakeWindow('w3');
        strip.addWindow(win1.adapter);
        strip.addWindow(win2.adapter);
        strip.addWindow(win3.adapter); // col3 focused
        win1.activate.mockClear();
        win2.activate.mockClear();
        win3.activate.mockClear();
        return { strip, win1, win2, win3 };
    }

    it('focusFirst activates the first column from anywhere in the strip', () => {
        const { strip, win1 } = threeColumnStrip();

        strip.focusFirst();

        expect(win1.activate).toHaveBeenCalled();
    });

    it('focusLast activates the last column from anywhere in the strip', () => {
        const { strip, win3 } = threeColumnStrip();
        strip.focusFirst();
        win3.activate.mockClear();

        strip.focusLast();

        expect(win3.activate).toHaveBeenCalled();
    });
});

describe('Strip — moveWindowToStart/moveWindowToEnd', () => {
    it('moves the focused column to index 0', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('w1').adapter);
        strip.addWindow(fakeWindow('w2').adapter);
        strip.addWindow(fakeWindow('w3').adapter); // col3 focused, at index 2

        strip.moveWindowToStart();

        const focusedFlags = strip.minimapSnapshot().columns.map((c) => c.tiles[0].focused);
        expect(focusedFlags).toEqual([true, false, false]);
    });

    it('moves the focused column to the last index', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('w1').adapter);
        strip.addWindow(fakeWindow('w2').adapter);
        strip.addWindow(fakeWindow('w3').adapter);
        strip.focusLeft();
        strip.focusLeft(); // back to col1, focused, at index 0

        strip.moveWindowToEnd();

        const focusedFlags = strip.minimapSnapshot().columns.map((c) => c.tiles[0].focused);
        expect(focusedFlags).toEqual([false, false, true]);
    });

    it('is a no-op with zero or one column', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(() => strip.moveWindowToStart()).not.toThrow();
        expect(() => strip.moveWindowToEnd()).not.toThrow();

        strip.addWindow(fakeWindow('w1').adapter);

        expect(() => strip.moveWindowToStart()).not.toThrow();
        expect(() => strip.moveWindowToEnd()).not.toThrow();
    });
});

describe('Strip — shiftViewportToStart/shiftViewportToEnd', () => {
    function twoColumnStrip(): { strip: Strip; win1: FakeWindow; win2: FakeWindow } {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
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

    it('shiftViewportToEnd pans to contentWidth-minus-viewportWidth (1608 - 1280 = 328)', () => {
        const { strip, win2 } = twoColumnStrip();

        strip.shiftViewportToEnd();

        // col2's virtual x is 808 (800 + gap 8); real x = virtual x - offset
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 808 - 328 }));
    });

    it('shiftViewportToStart pans back to offset 0', () => {
        const { strip, win1 } = twoColumnStrip();
        strip.shiftViewportToEnd();
        win1.setFrameGeometry.mockClear();

        strip.shiftViewportToStart();

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
    });

    it('does not change which column is focused', () => {
        const { strip, win1, win2 } = twoColumnStrip();

        strip.shiftViewportToEnd();
        strip.shiftViewportToStart();

        expect(win1.activate).not.toHaveBeenCalled();
        expect(win2.activate).not.toHaveBeenCalled();
    });
});

describe('Strip — increaseColumnWidth/decreaseColumnWidth', () => {
    const STEP_SETTINGS = { ...INSTANT_SETTINGS, columnWidthStep: 50 };

    it('grows the focused column by columnWidthStep', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1'); // defaultColumnWidth 800
        strip.addWindow(win1.adapter);
        win1.setFrameGeometry.mockClear();

        strip.increaseColumnWidth();

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 850 }));
    });

    it('shrinks the focused column by columnWidthStep', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter);
        win1.setFrameGeometry.mockClear();

        strip.decreaseColumnWidth();

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 750 }));
    });

    it('clamps shrinking at columnWidthStep, never reaching zero or below', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        strip.addWindow(win1.adapter);

        for (let i = 0; i < 20; i++) {
            strip.decreaseColumnWidth();
        }

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 50 }));
    });

    it('is a no-op with no focused column', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(() => strip.increaseColumnWidth()).not.toThrow();
        expect(() => strip.decreaseColumnWidth()).not.toThrow();
    });
});

describe('Strip — increaseWindowHeight/decreaseWindowHeight', () => {
    const STEP_SETTINGS = { ...INSTANT_SETTINGS, windowHeightStep: 50 };

    it('grows the focused (top) tile, taking space from its neighbor below', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindowStack([win1.adapter, win2.adapter]); // stacked column: 500/500 (AREA.height 1000)
        win1.setFrameGeometry.mockClear();
        win2.setFrameGeometry.mockClear();

        expect(strip.increaseWindowHeight()).toBe(true);

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 550 }));
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 450 }));
    });

    it('shrinks the focused (top) tile, giving space to its neighbor below', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win1 = fakeWindow('w1');
        const win2 = fakeWindow('w2');
        strip.addWindowStack([win1.adapter, win2.adapter]);
        win1.setFrameGeometry.mockClear();
        win2.setFrameGeometry.mockClear();

        expect(strip.decreaseWindowHeight()).toBe(true);

        expect(win1.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 450 }));
        expect(win2.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ height: 550 }));
    });

    it('is a no-op on a single-tile column', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        strip.addWindow(fakeWindow('w1').adapter);

        expect(strip.increaseWindowHeight()).toBe(false);
        expect(strip.decreaseWindowHeight()).toBe(false);
    });

    it('is a no-op with no focused column', () => {
        const strip = new Strip(AREA, STEP_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());

        expect(strip.increaseWindowHeight()).toBe(false);
    });
});

describe('Strip.setFocusedColumnWidth', () => {
    it("resizes the focused column's window and re-renders", () => {
        const strip = new Strip(AREA, SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 400 });
        strip.addWindow(win.adapter);

        strip.setFocusedColumnWidth(900);

        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ width: 900 }));
    });
});

describe('Strip.alignFocusedColumn', () => {
    it('jumps directly to the left/center/right edge, without cycling through phases', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { width: 1600 });
        strip.addWindow(win.adapter);

        strip.alignFocusedColumn('right');
        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -320 }));

        strip.alignFocusedColumn('center');
        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: -160 }));

        strip.alignFocusedColumn('left');
        expect(win.setFrameGeometry).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0 }));
    });

    it('does nothing when the focused column is hidden (minimized)', () => {
        const strip = new Strip(AREA, INSTANT_SETTINGS, fakeTimer(), fakeWorkspaceAdapter());
        const win = fakeWindow('w1', { minimized: true });
        strip.addWindow(win.adapter);
        win.setFrameGeometry.mockClear();

        strip.alignFocusedColumn('right');

        expect(win.setFrameGeometry).not.toHaveBeenCalled();
    });
});
