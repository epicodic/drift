import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import type { Rect } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import type { RowDragHooks, Strip } from './strip';
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

/** Pulls the `RowDragHooks` StripStack passed into a `fake.addWindow` call, so a test can
 * simulate a live drag by invoking them directly (docs: 2026-09-02-cross-row-drag-design). */
function capturedRowDragHooks(fake: FakeStrip): RowDragHooks {
    const lastCall = fake.addWindow.mock.calls[fake.addWindow.mock.calls.length - 1];
    return lastCall[2] as RowDragHooks;
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
    it('creates row 0 eagerly', () => {
        const { created } = makeStack();
        expect(created).toHaveLength(1);
    });

    it('routes addWindow to the active row (row 0 initially)', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');

        stack.addWindow(win);

        expect(created[0].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('clears skipTaskbar on a window entering a row via addWindow (regression)', () => {
        // A window carrying skipTaskbar: true from a parked row (switchToRow only toggles it on
        // its own two rows) can land in a brand-new row via a cross-desktop/activity move
        // (WindowManager.reassign does a plain remove() then addTo()) — without this, it stays
        // permanently hidden from the taskbar even though its new row is fully visible.
        const { stack } = makeStack();
        const win = fakeWin('w1');

        stack.addWindow(win);

        expect(win.setSkipTaskbar).toHaveBeenCalledWith(false);
    });

    it('routes removeWindow to the row that owns the window', () => {
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

    it('hands each row a ticker.subscribe() handle, not the raw timer', () => {
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

    it('delegates render, focusLeft/Right, cycleAlign, shiftViewport, and minimapSnapshot to the active row', () => {
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
        expect(snapshot.rows).toEqual([{ rowIndex: 0, columns: [] }]);
        expect(snapshot.viewport).toEqual({
            rowIndex: 0,
            offset: 0,
            width: AREA.width,
            contentLeft: 0,
            contentWidth: 0,
        });
        expect(snapshot.rowPitch).toBe(AREA.height);
    });
});

describe('StripStack row paging', () => {
    it('rowUp pages into a new row -1 when at row 0', () => {
        const { stack, created } = makeStack();

        stack.rowUp();
        stack.render();

        expect(created).toHaveLength(2); // row 0 and the newly created row -1
        expect(created[1].render).toHaveBeenCalled(); // render() now targets row -1
        expect(created[0].render).not.toHaveBeenCalled();
    });

    it('rowDown creates row 1 and makes it active', () => {
        const { stack, created } = makeStack();

        stack.rowDown();
        stack.render();

        expect(created).toHaveLength(2);
        expect(created[1].render).toHaveBeenCalled(); // render() now targets row 1
        expect(created[0].render).not.toHaveBeenCalled();
    });

    it('rowUp after rowDown returns to row 0', () => {
        const { stack, created } = makeStack();
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.rowDown();

        stack.rowUp();
        stack.render();

        expect(created[0].render).toHaveBeenCalled();
    });

    it('rowDown after rowUp returns to row 0', () => {
        const { stack, created } = makeStack();
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.rowUp(); // row 0 -> row -1

        stack.rowDown();
        stack.render();

        expect(created[0].render).toHaveBeenCalled();
    });

    it('animates the vertical transition, rendering both the outgoing and incoming row on each tick', () => {
        const { stack, created, timer } = makeStack({ animationDurationMs: 100 });
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it

        stack.rowDown();
        timer.fire();

        expect(created[0].render).toHaveBeenCalledWith(undefined, false, expect.any(Number));
        expect(created[1].render).toHaveBeenCalledWith(undefined, false, expect.any(Number));
    });

    it('sets skipTaskbar(true) on the outgoing row and skipTaskbar(false) on the incoming row', () => {
        const { stack, created } = makeStack();

        stack.rowDown();

        expect(created[0].setSkipTaskbar).toHaveBeenCalledWith(true);
        expect(created[1].setSkipTaskbar).toHaveBeenCalledWith(false);
    });

    it('snaps every other row to its resting offset instantly when paging', () => {
        const { stack, created } = makeStack();
        // Has a window, so leaving it won't prune it: without this, the prior rowDown()'s
        // pruneIfEmpty would delete row 0 from this.rows, silently dropping it from
        // snapRestingRows's iteration and breaking the render assertion below.
        created[0].isEmpty.mockReturnValue(false);
        stack.rowDown(); // row 1 active
        // Same reasoning as above, now for row 1.
        created[1].isEmpty.mockReturnValue(false);
        stack.rowDown(); // row 2 active, row 0 and row 1 both now "other"
        created[0].render.mockClear();
        created[1].render.mockClear();

        stack.rowDown(); // row 3 active

        expect(created[0].render).toHaveBeenCalledWith(undefined, true, expect.any(Number));
        expect(created[1].render).toHaveBeenCalledWith(undefined, true, expect.any(Number));
    });

    it('starts an interrupted transition from the live camera position, not the logical origin (regression)', () => {
        // Rapid rowDown presses must not teleport the camera: pressing rowDown again while the
        // first transition is still mid-flight should continue from wherever the camera actually
        // is, not from the outgoing row's logical origin (every horizontal call site in this
        // codebase already reads the live viewport offset the same way).
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer } = makeStack({ animationDurationMs: 100 });

            stack.rowDown(); // row 0 -> row 1, animating cameraY from 0 to 1000
            vi.setSystemTime(50); // halfway through the first transition
            timer.fire(); // records the live camera position via row 1's render() call

            // Recover the live camera position from what got rendered: row 1's resting offset
            // is cameraY - 1 * area.height, so cameraY = renderedOffsetY + area.height.
            const midFlightCall = created[1].render.mock.calls.find((call) => call[1] === false);
            const midFlightOffsetY = midFlightCall?.[2] as number;
            const liveCameraY = midFlightOffsetY + 1 * AREA.height;
            expect(liveCameraY).toBeGreaterThan(0);
            expect(liveCameraY).toBeLessThan(1000); // still mid-flight, short of row 1's logical origin

            created[1].render.mockClear();

            stack.rowDown(); // row 1 -> row 2, interrupting the first transition mid-flight

            // switchToRow primes row 2 with render(undefined, true, restingOffset(fromCameraY, 2)).
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

    it('aggregates every currently existing row, leaving a gap where a pruned row was', () => {
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
        stack.rowDown(); // row 1 active; row 1 stays empty (default isEmpty() === true)
        stack.rowDown(); // row 2 active; leaving empty row 1 prunes it, leaving a gap at index 1
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

        expect(snapshot.rows.map((row) => row.rowIndex)).toEqual([0, 2]); // row 1 pruned, gap preserved
        expect(snapshot.rows[0].columns[0].tiles[0].focused).toBe(false); // row 0 no longer active
        expect(snapshot.rows[1].columns[0].tiles[0].focused).toBe(true); // row 2 is active
        expect(snapshot.viewport.rowIndex).toBe(2);
    });
});

describe('StripStack.moveWindowToRowAbove/Below', () => {
    it('moveWindowToRowAbove moves the focused window into row -1 when at row 0', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToRowAbove();
        stack.render();

        expect(created[0].detachFocusedColumn).toHaveBeenCalled();
        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
        expect(created[1].render).toHaveBeenCalled(); // row -1 is now active
    });

    it('moveWindowToRowAbove is a no-op when the active row has no focused window', () => {
        const { stack, created } = makeStack();
        stack.rowDown(); // row 1 active, empty
        created[1].detachFocusedColumn.mockReturnValue([]);

        stack.moveWindowToRowAbove();

        expect(created).toHaveLength(2); // no new row created; detach found nothing to move
        expect(created[0].addWindow).not.toHaveBeenCalled();
    });

    it('moveWindowToRowBelow detaches the focused window, adds it to the row below, and follows it', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToRowBelow();
        stack.render();

        expect(created[0].detachFocusedColumn).toHaveBeenCalled();
        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
        expect(created[1].render).toHaveBeenCalled(); // row 1 is now active
    });

    it('primes the target row before addWindow ever touches it (regression)', () => {
        // Prevents an on-screen flash of the moved window at the wrong offset: switchToRow must
        // render the target row instantly at its correct resting offset before addWindow's own
        // internal render() call (which relies on that already-primed offset) ever runs.
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToRowBelow(); // row 0 -> row 1; switchToRow must prime row 1 before addWindow runs

        const instantCallIndex = created[1].render.mock.calls.findIndex((call) => call[1] === true);
        expect(instantCallIndex).toBeGreaterThanOrEqual(0); // switchToRow's priming render happened

        const primeOrder = created[1].render.mock.invocationCallOrder[instantCallIndex];
        const addWindowOrder = created[1].addWindow.mock.invocationCallOrder[0];
        expect(primeOrder).toBeLessThan(addWindowOrder);
    });

    it('prunes the source row if moving its last window empties it', () => {
        const { stack, created } = makeStack();
        created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
        stack.rowDown(); // row 1 active
        const win = fakeWin('w1');
        created[1].detachFocusedColumn.mockReturnValue([win]);
        created[1].isEmpty.mockReturnValue(true);

        stack.moveWindowToRowAbove(); // moves win from row 1 back to row 0, row 1 empties
        stack.rowDown(); // page back toward row 1 to prove it was pruned and recreated empty

        expect(created).toHaveLength(3); // row 0, the original (now-pruned) row 1, and a fresh row 1
    });

    it('moveWindowToRowAbove twice moves a window from row 0 through row -1 into row -2', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToRowAbove(); // win: row 0 -> row -1
        created[1].isEmpty.mockReturnValue(false); // row -1 now owns a window; don't prune it on the next move
        created[1].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToRowAbove(); // win: row -1 -> row -2

        expect(created[2].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('prunes row 0 once it becomes empty and inactive, recreating it fresh on return', () => {
        const { stack, created } = makeStack();
        // row 0 starts empty (created[0].isEmpty defaults to true)

        stack.rowDown(); // row 0 -> row 1; leaving empty row 0 behind prunes it
        stack.rowUp(); // page back toward row 0 to prove it was pruned and recreated

        expect(created).toHaveLength(3); // the original (now-pruned) row 0, row 1, and a fresh row 0
    });
});

describe('StripStack.activateWindow', () => {
    it('activates a window already in the active row without paging', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        stack.addWindow(win);

        stack.activateWindow(win);

        expect(created[0].activateWindow).toHaveBeenCalledWith(win);
        expect(created).toHaveLength(1); // no new row created/switched to
    });

    it('pages to the owning row before activating a window parked in an inactive row', () => {
        const { stack, created } = makeStack();
        stack.rowDown(); // row 1 active
        const win = fakeWin('w1');
        stack.addWindow(win); // lands in row 1
        created[1].isEmpty.mockReturnValue(false); // row 1 now owns a window, so rowUp mustn't prune it
        stack.rowUp(); // back to row 0; win is now in an inactive row
        created[0].render.mockClear(); // clear rowUp's own priming call so we only assert on what follows

        stack.activateWindow(win);
        stack.render();

        expect(created[1].activateWindow).toHaveBeenCalledWith(win);
        expect(created[0].render).not.toHaveBeenCalled(); // active row is now 1
        expect(created[1].render).toHaveBeenCalled();
    });

    it('ignores activation of an unowned window', () => {
        const { stack, created } = makeStack();

        expect(() => stack.activateWindow(fakeWin('ghost'))).not.toThrow();
        expect(created[0].activateWindow).not.toHaveBeenCalled();
    });
});

describe('StripStack cross-row drag', () => {
    it('keyboard-driven moveWindowToRowBelow still passes initiallyDragging=false and no exclusion (regression)', () => {
        const { stack, created } = makeStack();
        const win = fakeWin('w1');
        created[0].detachFocusedColumn.mockReturnValue([win]);

        stack.moveWindowToRowBelow();

        expect(created[1].addWindow).toHaveBeenCalledWith(win, false, expect.any(Object));
    });

    it('flips to the row above once the dwell elapses while the pointer is held past the top edge', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                rowDragDwellMs: 100,
            });
            created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
            stack.rowDown(); // row 1 active
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in row 1, wires the row-drag hooks
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedRowDragHooks(created[1]);

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

    it('flips to the row below once the dwell elapses while the pointer is held past the bottom edge', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                rowDragDwellMs: 100,
            });
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in row 0, wires the row-drag hooks
            created[0].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedRowDragHooks(created[0]);

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

    it("excludes the dragged window from the target row's priming render during a drag-triggered flip", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                rowDragDwellMs: 100,
            });
            created[0].isEmpty.mockReturnValue(false); // has a window, so leaving it won't prune it
            stack.rowDown(); // row 1 active
            const win = fakeWin('w1');
            stack.addWindow(win);
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedRowDragHooks(created[1]);
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
            const { stack, created, timer } = makeStack({ animationDurationMs: 0, rowDragDwellMs: 100 });
            const win = fakeWin('w1');
            stack.addWindow(win);
            const hooks = capturedRowDragHooks(created[0]);
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
                rowDragDwellMs: 100,
            });
            const win = fakeWin('w1');
            stack.addWindow(win);
            const hooks = capturedRowDragHooks(created[0]);
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
        // row instead of the one that was actually being dragged.
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                rowDragDwellMs: 100,
            });
            stack.rowDown(); // row 1 active, so an 'above' flip targets row 0 - a valid row
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in row 1, wires the row-drag hooks
            created[1].isEmpty.mockReturnValue(false);
            const hooks = capturedRowDragHooks(created[1]);
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
        // exactly one row over.
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const { stack, created, timer, workspaceAdapter } = makeStack({
                animationDurationMs: 0,
                rowDragDwellMs: 100,
            });
            const win = fakeWin('w1');
            stack.addWindow(win); // lands in row 0
            created[0].detachFocusedColumn.mockReturnValue([win]);
            const hooks = capturedRowDragHooks(created[0]);

            hooks.onDragStarted?.(win);
            workspaceAdapter.cursor = { x: 0, y: 1050 }; // pointer past the bottom edge
            hooks.onDragTick?.(win);
            vi.setSystemTime(100);
            timer.fire(); // first flip: row 0 -> row 1
            created[1].isEmpty.mockReturnValue(false);
            created[1].detachFocusedColumn.mockReturnValue([win]);

            const newHooks = capturedRowDragHooks(created[1]);
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
    it("delegate to the active row's Strip", () => {
        const { stack, created } = makeStack();

        stack.focusUp();
        stack.focusDown();
        stack.absorbRight();
        stack.expel();

        expect(created[0].focusUp).toHaveBeenCalledTimes(1);
        expect(created[0].focusDown).toHaveBeenCalledTimes(1);
        expect(created[0].absorbRight).toHaveBeenCalledTimes(1);
        expect(created[0].expel).toHaveBeenCalledTimes(1);
    });
});

describe('StripStack — moveFocusedWindowToRow with a stacked column', () => {
    it('re-adds every window detachFocusedColumn returns, each to its own column in the target row', () => {
        const { stack, created } = makeStack();
        const win1 = fakeWin('w1');
        const win2 = fakeWin('w2');
        created[0].detachFocusedColumn.mockReturnValue([win1, win2]);

        stack.moveWindowToRowBelow();

        expect(created[1].addWindow).toHaveBeenCalledWith(win1, false, expect.anything());
        expect(created[1].addWindow).toHaveBeenCalledWith(win2, false, expect.anything());
    });

    it('is a no-op when detachFocusedColumn returns an empty array', () => {
        const { stack, created } = makeStack();
        created[0].detachFocusedColumn.mockReturnValue([]);

        stack.moveWindowToRowBelow();

        expect(created).toHaveLength(1); // no new row created; detach found nothing to move
        expect(created[0].addWindow).not.toHaveBeenCalled();
    });
});
