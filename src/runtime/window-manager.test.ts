import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';
import { WindowManager } from './window-manager';

function fakeStripManager() {
    const owners = new Map<string, string>();
    const addTo = vi.fn((activity: string, desktop: string, win: WindowAdapter) =>
        owners.set(win.id, `${activity}|${desktop}`),
    );
    const remove = vi.fn((win: WindowAdapter) => owners.delete(win.id));
    const activate = vi.fn();
    const ownerOf = vi.fn((id: string) => owners.get(id) ?? null);
    const keyOf = (activity: string, desktop: string) => `${activity}|${desktop}`;
    const manager = { addTo, remove, activate, ownerOf, keyOf } as unknown as StripManager;
    return { manager, addTo, remove, activate, ownerOf };
}

interface FakeWin {
    win: WindowAdapter;
    setAssignment: (assignment: { activity: string; desktop: string } | null) => void;
    fireActivities: () => void;
    fireDesktops: () => void;
    disconnectActivities: ReturnType<typeof vi.fn>;
    disconnectDesktops: ReturnType<typeof vi.fn>;
}

function fakeWin(
    id: string,
    options: { tileable?: boolean; assignment?: { activity: string; desktop: string } | null } = {},
): FakeWin {
    let assignment = options.assignment === undefined ? { activity: 'a', desktop: 'd1' } : options.assignment;
    let activitiesHandler = (): void => {};
    let desktopsHandler = (): void => {};
    const disconnectActivities = vi.fn();
    const disconnectDesktops = vi.fn();
    const win = {
        id,
        isTileable: () => options.tileable ?? true,
        singleAssignment: () => assignment,
        onActivitiesChanged: (handler: () => void) => {
            activitiesHandler = handler;
            return disconnectActivities;
        },
        onDesktopsChanged: (handler: () => void) => {
            desktopsHandler = handler;
            return disconnectDesktops;
        },
    } as unknown as WindowAdapter;
    return {
        win,
        setAssignment: (next) => {
            assignment = next;
        },
        fireActivities: () => activitiesHandler(),
        fireDesktops: () => desktopsHandler(),
        disconnectActivities,
        disconnectDesktops,
    };
}

describe('WindowManager', () => {
    it('routes a single-assignment window to its strip', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });

        new WindowManager(sm.manager).addWindow(win.win);

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
    });

    it('leaves a sticky window unmanaged', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: null });

        new WindowManager(sm.manager).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('ignores non-tileable windows', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { tileable: false });

        new WindowManager(sm.manager).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('moves a managed window when its desktop changes', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        win.setAssignment({ activity: 'a', desktop: 'd2' });
        win.fireDesktops();

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(sm.addTo).toHaveBeenLastCalledWith('a', 'd2', win.win);
    });

    it('does nothing when the reassignment key is unchanged', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);
        sm.remove.mockClear();

        win.fireDesktops();

        expect(sm.remove).not.toHaveBeenCalled();
    });

    it('removes a managed window that becomes sticky', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        win.setAssignment(null);
        win.fireActivities();

        expect(sm.remove).toHaveBeenCalledWith(win.win);
    });

    it('adds an unmanaged window that becomes single-assignment', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: null });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        win.setAssignment({ activity: 'a', desktop: 'd1' });
        win.fireDesktops();

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
    });

    it('unsubscribes and removes on removeWindow', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager);
        manager.addWindow(win.win);

        manager.removeWindow(win.win);

        expect(win.disconnectActivities).toHaveBeenCalledTimes(1);
        expect(win.disconnectDesktops).toHaveBeenCalledTimes(1);
        expect(sm.remove).toHaveBeenCalledWith(win.win);
    });
});
