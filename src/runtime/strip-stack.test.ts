import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import type { StripDragHooks, Strip } from './strip';
import { StripStack, type StripFactory } from './strip-stack';

const AREA: Rect = { x: 0, y: 0, width: 1280, height: 1000 };

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

/** `cursor` starts within `AREA`'s bounds and can be mutated by a test to simulate the pointer
 * moving past the top/bottom edge during a drag (docs: 2026-09-02-cross-row-drag-design). */
function fakeWorkspaceAdapter(): FakeWorkspaceAdapter {
    const adapter = {
        cursor: { x: 0, y: 500 },
        cursorPos(): { x: number; y: number } {
            return adapter.cursor;
        },
    };
    return adapter as unknown as FakeWorkspaceAdapter;
}

interface FakeStrip {
    strip: Strip;
    addWindow: ReturnType<typeof vi.fn>;
    removeWindow: ReturnType<typeof vi.fn>;
    activateWindow: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    focusLeft: ReturnType<typeof vi.fn>;
    focusRight: ReturnType<typeof vi.fn>;
    focusUp: ReturnType<typeof vi.fn>;
    focusDown: ReturnType<typeof vi.fn>;
    absorbRight: ReturnType<typeof vi.fn>;
    expel: ReturnType<typeof vi.fn>;
    cycleAlignLeft: ReturnType<typeof vi.fn>;
    cycleAlignRight: ReturnType<typeof vi.fn>;
    shiftViewportLeft: ReturnType<typeof vi.fn>;
    shiftViewportRight: ReturnType<typeof vi.fn>;
    minimapSnapshot: ReturnType<typeof vi.fn>;
    detachFocusedColumn: ReturnType<typeof vi.fn>;
    isEmpty: ReturnType<typeof vi.fn>;
    setSkipTaskbar: ReturnType<typeof vi.fn>;
}

function fakeStrip(): FakeStrip {
    const fns = {
        addWindow: vi.fn(),
        removeWindow: vi.fn(),
        activateWindow: vi.fn(),
        render: vi.fn(),
        focusLeft: vi.fn(),
        focusRight: vi.fn(),
        focusUp: vi.fn(),
        focusDown: vi.fn(),
        absorbRight: vi.fn(),
        expel: vi.fn(),
        cycleAlignLeft: vi.fn(),
        cycleAlignRight: vi.fn(),
        shiftViewportLeft: vi.fn(),
        shiftViewportRight: vi.fn(),
        minimapSnapshot: vi.fn(() => ({
            columns: [],
            viewport: { offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 0 },
            gridHeight: AREA.height,
        })),
        detachFocusedColumn: vi.fn(() => []),
        isEmpty: vi.fn(() => true),
        setSkipTaskbar: vi.fn(),
    };
    const strip = { ...fns } as unknown as Strip;
    return { strip, ...fns };
}

function recordingFactory(): { factory: StripFactory; created: FakeStrip[] } {
    const created: FakeStrip[] = [];
    const factory: StripFactory = () => {
        const fake = fakeStrip();
        created.push(fake);
        return fake.strip;
    };
    return { factory, created };
}

/** Pulls the `StripDragHooks` StripStack passed into a `fake.addWindow` call, so a test can
 * simulate a live drag by invoking them directly (docs: 2026-09-02-cross-row-drag-design). */
function capturedStripDragHooks(fake: FakeStrip): StripDragHooks {
    const lastCall = fake.addWindow.mock.calls[fake.addWindow.mock.calls.length - 1];
    return lastCall[2] as StripDragHooks;
}

function fakeWin(id: string, rect: Rect = { x: 0, y: 0, width: 400, height: 1000 }): WindowAdapter {
    return { id, setSkipTaskbar: vi.fn(), frameGeometry: () => rect } as unknown as WindowAdapter;
}

function makeStack(settingsOverride: Partial<typeof DEFAULT_SETTINGS> = {}) {
    const { factory, created } = recordingFactory();
    const timer = fakeTimer();
    const workspaceAdapter = fakeWorkspaceAdapter();
    const stack = new StripStack(AREA, { ...DEFAULT_SETTINGS, ...settingsOverride }, timer, workspaceAdapter, factory);
    return { stack, created, timer, workspaceAdapter };
}

describe('StripStack', () => {
    it('creates strip 0 eagerly', () => {
        const { created } = makeStack();
        expect(created).toHaveLength(1);
    });

    it('routes addWindow to the active strip (strip 0 initially)', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');

        stack.addWindow(win);

        expect(created[0].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('clears skipTaskbar on a window entering a strip via addWindow (regression)', () => {
        // A window carrying skipTaskbar: true from a parked strip (switchToStrip only toggles it on
        // its own two strips) can land in a brand-new strip via a cross-desktop/activity move
        // (WindowManager.reassign does a plain remove() then addTo()) — without this, it stays
        // permanently hidden from the taskbar even though its new strip is fully visible.
        const { stack } = makeStack();
        const win = fakeWin('w1');

        stack.addWindow(win);

        expect(win.setSkipTaskbar).toHaveBeenCalledWith(false);
    });

    it('routes removeWindow to the strip that owns the window', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.removeWindow(win);

        expect(created[0].removeWindow).toHaveBeenCalledWith(win);
    });

    it('ignores removeWindow for an unowned window', () => {
        const { stack, created } = makeStack();

        expect(() => stack.removeWindow(fakeWin('ghost'))).not.toThrow();
        expect(created[0].removeWindow).not.toHaveBeenCalled();
    });

    it('hands each strip a ticker.subscribe() handle, not the raw timer', () => {
        const rawTimer = fakeTimer();
        const receivedTimers: Timer[] = [];
        const factory: StripFactory = (_area, _settings, timer) => {
            receivedTimers.push(timer);
            return fakeStrip().strip;
        };

        new StripStack(AREA, DEFAULT_SETTINGS, rawTimer, fakeWorkspaceAdapter(), factory);

        expect(receivedTimers).toHaveLength(1);
        expect(receivedTimers[0]).not.toBe(rawTimer);
    });

    it('delegates render, focusLeft/Right, cycleAlign, shiftViewport, and minimapSnapshot to the active strip', () => {
        const { stack, created } = makeStack();

        stack.render();
        stack.focusLeft();
        stack.focusRight();
        stack.cycleAlignLeft();
        stack.cycleAlignRight();
        stack.shiftViewportLeft();
        stack.shiftViewportRight();
        const snapshot = stack.minimapSnapshot();

        expect(created[0].render).toHaveBeenCalled();
        expect(created[0].focusLeft).toHaveBeenCalled();
        expect(created[0].focusRight).toHaveBeenCalled();
        expect(created[0].cycleAlignLeft).toHaveBeenCalled();
        expect(created[0].cycleAlignRight).toHaveBeenCalled();
        expect(created[0].shiftViewportLeft).toHaveBeenCalled();
        expect(created[0].shiftViewportRight).toHaveBeenCalled();
        expect(created[0].minimapSnapshot).toHaveBeenCalled();
        expect(snapshot.strips).toEqual([{ stripIndex: 0, columns: [] }]);
        expect(snapshot.viewport).toEqual({
            stripIndex: 0,
            offset: 0,
            width: AREA.width,
            contentLeft: 0,
            contentWidth: 0,
        });
        expect(snapshot.stripPitch).toBe(AREA.height);
    });
});

describe('StripStack strip paging', () => {
    it('stripUp pages into a new strip -1 when at strip 0', () => {
        const { stack, created } = makeStack();

        stack.stripUp();
        stack.render();

        expect(created).toHaveLength(2); // strip 0 and the newly created strip -1
        expect(created[1].render).toHaveBeenCalled(); // render() now targets strip -1
        expect(created[0].render).not.toHaveBeenCalled();
    });

    it('stripDown creates strip 1 and makes it active', () => {
        const { stack, created } = makeStack();

        stack.stripDown();
        stack.render();

        expect(created).toHaveLength(2);
        expect(created[1].render).toHaveBeenCalled(); // render() now targets strip 1
        expect(created[0].render).not.toHaveBeenCalled();
    });

    it('stripUp after stripDown returns to strip 0', () => {
        const { stack, created } = makeStack();
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.stripDown();

        stack.stripUp();
        stack.render();

        expect(created[0].render).toHaveBeenCalled();
    });

    it('stripDown after stripUp returns to strip 0', () => {
        const { stack, created } = makeStack();
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.stripUp(); // strip 0 -> strip -1

        stack.stripDown();
        stack.render();

        expect(created[0].render).toHaveBeenCalled();
    });

    it('animates the vertical transition, rendering both the outgoing and incoming strip on each tick', () => {
        const { stack, created, timer } = makeStack({ animationDurationMs: 100 });
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it

        stack.stripDown();
        timer.fire();

        expect(created[0].render).toHaveBeenCalledWith(undefined, false, expect.any(Number));
        expect(created[1].render).toHaveBeenCalledWith(undefined, false, expect.any(Number));
    });

    it('sets skipTaskbar(true) on the outgoing strip and skipTaskbar(false) on the incoming strip', () => {
        const { stack, created } = makeStack();

        stack.stripDown();

        expect(created[0].setSkipTaskbar).toHaveBeenCalledWith(true);
        expect(created[1].setSkipTaskbar).toHaveBeenCalledWith(false);
    });

    it('snaps every other strip to its resting offset instantly when paging', () => {
        const { stack, created } = makeStack();
        // Has a window, so leaving it won't prune it: without this, the prior stripDown()'s
        // pruneIfEmpty would delete strip 0 from this.strips, silently dropping it from
        // snapRestingStrips's iteration and breaking the render assertion below.
        created[0].isEmpty.mockReturnValue(false);
        stack.stripDown(); // strip 1 active
        // Same reasoning as above, now for strip 1.
        created[1].isEmpty.mockReturnValue(false);
        stack.stripDown(); // strip 2 active, strip 0 and strip 1 both now "other"
        created[0].render.mockClear();
        created[1].render.mockClear();

        stack.stripDown(); // strip 3 active

        expect(created[0].render).toHaveBeenCalledWith(undefined, true, expect.any(Number));
        expect(created[1].render).toHaveBeenCalledWith(undefined, true, expect.any(Number));
    });

    it('starts an interrupted transition from the live camera position, not the logical origin (regression)', () => {
        // Rapid stripDown presses must not teleport the camera: pressing stripDown again while the
        // first transition is still mid-flight should continue from wherever the camera actually
        // is, not from the outgoing strip's logical origin (every horizontal call site in this
        // codebase already reads the live viewport offset the same way).
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 100 });

            stack.stripDown(); // strip 0 -> strip 1, animating cameraY from 0 to 1000
            vi.setSystemTime(50); // halfway through the first transition
            timer.fire(); // records the live camera position via strip 1's render() call

            // Recover the live camera position from what got rendered: strip 1's resting offset
            // is cameraY - 1 * area.height, so cameraY = renderedOffsetY + area.height.
            const midFlightCall = created[1].render.mock.calls.find((call) => call[1] === false);
            const midFlightOffsetY = midFlightCall?.[2] as number;
            const liveCameraY = midFlightOffsetY + 1 * AREA.height;
            expect(liveCameraY).toBeGreaterThan(0);
            expect(liveCameraY).toBeLessThan(1000); // still mid-flight, short of strip 1's logical origin

            created[1].render.mockClear();

            stack.stripDown(); // strip 1 -> strip 2, interrupting the first transition mid-flight

            // switchToStrip primes strip 2 with render(undefined, true, restingOffset(fromCameraY, 2)).
            // Recover the `from` value the new animation actually used the same way.
            const primeCall = created[2].render.mock.calls.find((call) => call[1] === true);
            const primedOffsetY = primeCall?.[2] as number;
            const impliedFromCameraY = primedOffsetY + 2 * AREA.height;

            expect(impliedFromCameraY).toBeCloseTo(liveCameraY, 5);
            expect(impliedFromCameraY).not.toBe(1 * AREA.height); // would be the (wrong) logical origin
        } finally {
            vi.useRealTimers();
        }
    });

    it('aggregates every currently existing strip, leaving a gap where a pruned strip was', () => {
        const { stack, created } = makeStack();
        created[0].minimapSnapshot.mockReturnValue({
            columns: [
                {
                    id: 1,
                    x: 0,
                    width: 400,
                    tiles: [{ y: 0, height: AREA.height, focused: true, icon: null, thumbnail: null }],
                },
            ],
            viewport: { offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 400 },
            gridHeight: AREA.height,
        });
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.stripDown(); // strip 1 active; strip 1 stays empty (default isEmpty() === true)
        stack.stripDown(); // strip 2 active; leaving empty strip 1 prunes it, leaving a gap at index 1
        created[2].minimapSnapshot.mockReturnValue({
            columns: [
                {
                    id: 2,
                    x: 0,
                    width: 300,
                    tiles: [{ y: 0, height: AREA.height, focused: true, icon: null, thumbnail: null }],
                },
            ],
            viewport: { offset: 0, width: AREA.width, contentLeft: 0, contentWidth: 300 },
            gridHeight: AREA.height,
        });

        const snapshot = stack.minimapSnapshot();

        expect(snapshot.strips.map((strip) => strip.stripIndex)).toEqual([0, 2]); // strip 1 pruned, gap preserved
        expect(snapshot.strips[0].columns[0].tiles[0].focused).toBe(false); // strip 0 no longer active
        expect(snapshot.strips[1].columns[0].tiles[0].focused).toBe(true); // strip 2 is active
        expect(snapshot.viewport.stripIndex).toBe(2);
    });
});

describe('StripStack.moveWindowToStripAbove/Below', () => {
    it('moveWindowToStripAbove moves the focused window into strip -1 when at strip 0', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToStripAbove();
        stack.render();

        expect(created[0].detachFocusedColumn).toHaveBeenCalled();
        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
        expect(created[1].render).toHaveBeenCalled(); // strip -1 is now active
    });

    it('moveWindowToStripAbove is a no-op when the active strip has no focused window', () => {
        const { stack, created } = makeStack();
        stack.stripDown(); // strip 1 active, empty
        created[1].detachFocusedColumn.mockReturnValue([]);

        stack.moveWindowToStripAbove();

        expect(created).toHaveLength(2); // no new strip created; detach found nothing to move
        expect(created[0].addWindow).not.toHaveBeenCalled();
    });

    it('moveWindowToStripBelow detaches the focused window, adds it to the strip below, and follows it', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToStripBelow();
        stack.render();

        expect(created[0].detachFocusedColumn).toHaveBeenCalled();
        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
        expect(created[1].render).toHaveBeenCalled(); // strip 1 is now active
    });

    it('primes the target strip before addWindow ever touches it (regression)', () => {
        // Prevents an on-screen flash of the moved window at the wrong offset: switchToStrip must
        // render the target strip instantly at its correct resting offset before addWindow's own
        // internal render() call (which relies on that already-primed offset) ever runs.
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToStripBelow(); // strip 0 -> strip 1; switchToStrip must prime strip 1 before addWindow runs

        const instantCallIndex = created[1].render.mock.calls.findIndex((call) => call[1] === true);
        expect(instantCallIndex).toBeGreaterThanOrEqual(0); // switchToStrip's priming render happened

        const primeOrder = created[1].render.mock.invocationCallOrder[instantCallIndex];
        const addWindowOrder = created[1].addWindow.mock.invocationCallOrder[0];
        expect(primeOrder).toBeLessThan(addWindowOrder);
    });

    it('prunes the source strip if moving its last window empties it', () => {
        const { stack, created } = makeStack();
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.stripDown(); // strip 1 active
        const win = fakeWin('w1');
        created[1].detachFocusedColumn.mockReturnValue([win]);
        created[1].isEmpty.mockReturnValue(true);

        stack.moveWindowToStripAbove(); // moves win from strip 1 back to strip 0, strip 1 empties
        stack.stripDown(); // page back toward strip 1 to prove it was pruned and recreated empty

        expect(created).toHaveLength(3); // strip 0, the original (now-pruned) strip 1, and a fresh strip 1
    });

    it('moveWindowToStripAbove twice moves a window from strip 0 through strip -1 into strip -2', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToStripAbove(); // win: strip 0 -> strip -1
        created[1].isEmpty.mockReturnValue(false); // strip -1 now owns a window; don't prune it on the next move
        created[1].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToStripAbove(); // win: strip -1 -> strip -2

        expect(created[2].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('prunes strip 0 once it becomes empty and inactive, recreating it fresh on return', () => {
        const { stack, created } = makeStack();
        // strip 0 starts empty (created[0].isEmpty defaults to true)

        stack.stripDown(); // strip 0 -> strip 1; leaving empty strip 0 behind prunes it
        stack.stripUp(); // page back toward strip 0 to prove it was pruned and recreated

        expect(created).toHaveLength(3); // the original (now-pruned) strip 0, strip 1, and a fresh strip 0
    });
});

describe('StripStack.activateWindow', () => {
    it('activates a window already in the active strip without paging', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.activateWindow(win);

        expect(created[0].activateWindow).toHaveBeenCalledWith(win);
        expect(created).toHaveLength(1); // no new strip created/switched to
    });

    it('pages to the owning strip before activating a window parked in an inactive strip', () => {
        const { stack, created } = makeStack();
        stack.stripDown(); // strip 1 active
        const win = fakeWin('w1');
        stack.addWindow(win); // lands in strip 1
        created[1].isEmpty.mockReturnValue(false); // strip 1 now owns a window, so stripUp mustn't prune it
        stack.stripUp(); // back to strip 0; win is now in an inactive strip
        created[0].render.mockClear(); // clear stripUp's own priming call so we only assert on what follows

        stack.activateWindow(win);
        stack.render();

        expect(created[1].activateWindow).toHaveBeenCalledWith(win);
        expect(created[0].render).not.toHaveBeenCalled(); // active strip is now 1
        expect(created[1].render).toHaveBeenCalled();
    });

    it('ignores activation of an unowned window', () => {
        const { stack, created } = makeStack();

        expect(() => stack.activateWindow(fakeWin('ghost'))).not.toThrow();
        expect(created[0].activateWindow).not.toHaveBeenCalled();
    });
});

describe('StripStack cross-strip drag', () => {
    it('keyboard-driven moveWindowToStripBelow still passes initiallyDragging=false and no exclusion (regression)', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToStripBelow();

        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('flips to the strip above once the dwell elapses while the pointer is held past the top edge', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                stripDragDwellMs: 100,
            });
            created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
            stack.stripDown(); // strip 1 active
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in strip 1, wires the strip-drag hooks
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedStripDragHooks(created[1]);

            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: -50 }; // pointer past the top edge (area.y = 0)
            hooks.onDragTick?.(win);
            vi.setSystemTime(100);
            timer.fire(); // dwell elapses

            expect(created[1].detachFocusedColumn).toHaveBeenCalled();
            expect(created[0].addWindow).toHaveBeenCalledWith(win, true, expect.any(Object));
        } finally {
            vi.useRealTimers();
        }
    });

    it('flips to the strip below once the dwell elapses while the pointer is held past the bottom edge', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                stripDragDwellMs: 100,
            });
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in strip 0, wires the strip-drag hooks
            created[0].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedStripDragHooks(created[0]);

            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: 1050 }; // pointer past the bottom edge (area bottom = 1000)
            hooks.onDragTick?.(win);
            vi.setSystemTime(100);
            timer.fire(); // dwell elapses

            expect(created[0].detachFocusedColumn).toHaveBeenCalled();
            expect(created[1].addWindow).toHaveBeenCalledWith(win, true, expect.any(Object));
        } finally {
            vi.useRealTimers();
        }
    });

    it("excludes the dragged window from the target strip's priming render during a drag-triggered flip", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                stripDragDwellMs: 100,
            });
            created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
            stack.stripDown(); // strip 1 active
            const win = fakeWin('w1');
            stack.addWindow(win);
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedStripDragHooks(created[1]);
            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: -50 };
            hooks.onDragTick?.(win);

            vi.setSystemTime(100);
            timer.fire();

            const primeCall = created[0].render.mock.calls.find((call) => call[0] === win.id);
            expect(primeCall).toBeDefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not flip while the pointer is within bounds', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 0, stripDragDwellMs: 100 });
            const win = fakeWin('w1');
            stack.addWindow(win);
            const hooks = capturedStripDragHooks(created[0]);
            hooks.onDragStarted?.(win);
            hooks.onDragTick?.(win); // cursor within AREA bounds (default fake position) - never arms

            vi.setSystemTime(100);
            timer.fire();

            expect(created[0].detachFocusedColumn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops watching once the drag finishes, so a later stray tick cannot fire', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                stripDragDwellMs: 100,
            });
            const win = fakeWin('w1');
            stack.addWindow(win);
            const hooks = capturedStripDragHooks(created[0]);
            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: -50 }; // past the top edge
            hooks.onDragTick?.(win);

            hooks.onDragFinished?.();
            vi.setSystemTime(100);
            timer.fire();

            expect(created[0].detachFocusedColumn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops watching once the dragged window is removed mid-drag, so a stale timer cannot relocate the wrong window', () => {
        // Regression: a closed/crashed window tears down its signals without ever firing
        // interactiveMoveResizeFinished, so onDragFinished never runs for it. Without an explicit
        // stop in removeWindow, the armed dwell timer would keep ticking after the window is gone
        // and re-fire onEdgeDwellFired, relocating whatever window happens to be focused in the
        // strip instead of the one that was actually being dragged.
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                stripDragDwellMs: 100,
            });
            stack.stripDown(); // strip 1 active, so an 'above' flip targets strip 0 - a valid strip
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in strip 1, wires the strip-drag hooks
            created[1].isEmpty.mockReturnValue(false);
            const hooks = capturedStripDragHooks(created[1]);
            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: -50 }; // past the top edge
            hooks.onDragTick?.(win); // arms the watch, no onDragFinished ever follows

            stack.removeWindow(win); // window closes/crashes mid-drag

            vi.setSystemTime(100);
            timer.fire();

            expect(created[1].detachFocusedColumn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not flip a second time while the pointer keeps holding past the same edge (regression)', () => {
        // A single continuous drag that lingers past an edge (e.g. while the user completes the
        // drop) must only flip once — flipping repeatedly makes it impossible to move a window
        // exactly one strip over.
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                stripDragDwellMs: 100,
            });
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in strip 0
            created[0].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedStripDragHooks(created[0]);

            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: 1050 }; // pointer past the bottom edge
            hooks.onDragTick?.(win);
            vi.setSystemTime(100);
            timer.fire(); // first flip: strip 0 -> strip 1
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue([win]);

            const newHooks = capturedStripDragHooks(created[1]);
            newHooks.onDragTick?.(win); // pointer still held past the bottom edge, unmoved
            vi.setSystemTime(200);
            timer.fire();

            expect(created[1].detachFocusedColumn).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('StripStack — focusUp/focusDown/absorbRight/expel', () => {
    it("delegate to the active strip's Strip and propagate its return value", () => {
        const { stack, created } = makeStack();
        created[0].focusUp.mockReturnValue(true);
        created[0].focusDown.mockReturnValue(false);

        expect(stack.focusUp()).toBe(true);
        expect(stack.focusDown()).toBe(false);
        stack.absorbRight();
        stack.expel();

        expect(created[0].focusUp).toHaveBeenCalledTimes(1);
        expect(created[0].focusDown).toHaveBeenCalledTimes(1);
        expect(created[0].absorbRight).toHaveBeenCalledTimes(1);
        expect(created[0].expel).toHaveBeenCalledTimes(1);
    });
});

describe('StripStack — navigateUp/navigateDown', () => {
    it("moves tile focus within the active strip's stack when it can", () => {
        const { stack, created } = makeStack();
        created[0].focusUp.mockReturnValue(true);
        created[0].focusDown.mockReturnValue(true);

        stack.navigateUp();
        stack.navigateDown();
        stack.render();

        expect(created[0].focusUp).toHaveBeenCalledTimes(1);
        expect(created[0].focusDown).toHaveBeenCalledTimes(1);
        expect(created).toHaveLength(1); // no strip paging happened
    });

    it('pages to the strip above when there is no adjacent tile to focus up to', () => {
        const { stack, created } = makeStack();
        created[0].focusUp.mockReturnValue(false);

        stack.navigateUp();
        stack.render();

        expect(created).toHaveLength(2); // strip 0 and the newly created strip -1
        expect(created[1].render).toHaveBeenCalled();
    });

    it('pages to the strip below when there is no adjacent tile to focus down to', () => {
        const { stack, created } = makeStack();
        created[0].focusDown.mockReturnValue(false);

        stack.navigateDown();
        stack.render();

        expect(created).toHaveLength(2); // strip 0 and the newly created strip 1
        expect(created[1].render).toHaveBeenCalled();
    });
});

describe('StripStack — moveFocusedWindowToStrip with a stacked column', () => {
    it('re-adds every window detachFocusedColumn returns, each to its own column in the target strip', () => {
        const { stack, created } = makeStack();
        const win1 = fakeWin('w1');
        const win2 = fakeWin('w2');
        created[0].detachFocusedColumn.mockReturnValue([win1, win2]);

        stack.moveWindowToStripBelow();

        expect(created[1].addWindow).toHaveBeenCalledWith(win1, false, expect.anything());
        expect(created[1].addWindow).toHaveBeenCalledWith(win2, false, expect.anything());
    });

    it('is a no-op when detachFocusedColumn returns an empty array', () => {
        const { stack, created } = makeStack();
        created[0].detachFocusedColumn.mockReturnValue([]);

        stack.moveWindowToStripBelow();

        expect(created).toHaveLength(1); // no new strip created; detach found nothing to move
        expect(created[0].addWindow).not.toHaveBeenCalled();
    });
});
