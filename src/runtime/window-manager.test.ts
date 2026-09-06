import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../config/settings';
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

function fakeSettings(undockKeepAbove = true): Settings {
    return { undockKeepAbove } as unknown as Settings;
}

interface FakeWin {
    win: WindowAdapter;
    setAssignment: (assignment: { activity: string; desktop: string } | null) => void;
    fireActivities: () => void;
    fireDesktops: () => void;
    disconnectActivities: ReturnType<typeof vi.fn>;
    disconnectDesktops: ReturnType<typeof vi.fn>;
    setKeepAbove: ReturnType<typeof vi.fn>;
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
        setKeepAbove: vi.fn(),
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
        setKeepAbove: win.setKeepAbove as ReturnType<typeof vi.fn>,
    };
}

describe('WindowManager', () => {
    it('routes a single-assignment window to its strip', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });

        new WindowManager(sm.manager, fakeSettings()).addWindow(win.win);

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
    });

    it('leaves a sticky window unmanaged', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: null });

        new WindowManager(sm.manager, fakeSettings()).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('ignores non-tileable windows', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { tileable: false });

        new WindowManager(sm.manager, fakeSettings()).addWindow(win.win);

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('moves a managed window when its desktop changes', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager, fakeSettings());
        manager.addWindow(win.win);

        win.setAssignment({ activity: 'a', desktop: 'd2' });
        win.fireDesktops();

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(sm.addTo).toHaveBeenLastCalledWith('a', 'd2', win.win);
    });

    it('does nothing when the reassignment key is unchanged', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager, fakeSettings());
        manager.addWindow(win.win);
        sm.remove.mockClear();

        win.fireDesktops();

        expect(sm.remove).not.toHaveBeenCalled();
    });

    it('removes a managed window that becomes sticky', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager, fakeSettings());
        manager.addWindow(win.win);

        win.setAssignment(null);
        win.fireActivities();

        expect(sm.remove).toHaveBeenCalledWith(win.win);
    });

    it('adds an unmanaged window that becomes single-assignment', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: null });
        const manager = new WindowManager(sm.manager, fakeSettings());
        manager.addWindow(win.win);

        win.setAssignment({ activity: 'a', desktop: 'd1' });
        win.fireDesktops();

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd1', win.win);
    });

    it('unsubscribes and removes on removeWindow', () => {
        const sm = fakeStripManager();
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        const manager = new WindowManager(sm.manager, fakeSettings());
        manager.addWindow(win.win);

        manager.removeWindow(win.win);

        expect(win.disconnectActivities).toHaveBeenCalledTimes(1);
        expect(win.disconnectDesktops).toHaveBeenCalledTimes(1);
        expect(sm.remove).toHaveBeenCalledWith(win.win);
    });
});

describe('WindowManager.activateWindow', () => {
    it('returns true when the strip manager reports the window as managed', () => {
        const sm = fakeStripManager();
        sm.activate.mockReturnValue(true);
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1');

        expect(manager.activateWindow(win.win)).toBe(true);
        expect(sm.activate).toHaveBeenCalledWith(win.win);
    });

    it('returns false when the strip manager reports the window as unmanaged', () => {
        const sm = fakeStripManager();
        sm.activate.mockReturnValue(false);
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1');

        expect(manager.activateWindow(win.win)).toBe(false);
    });

    it('returns false for a null window without calling the strip manager', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());

        expect(manager.activateWindow(null)).toBe(false);
        expect(sm.activate).not.toHaveBeenCalled();
    });
});

describe('WindowManager.toggleFloating', () => {
    it('does nothing for a null window', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());

        manager.toggleFloating(null);

        expect(sm.remove).not.toHaveBeenCalled();
        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('does nothing for a window Drift does not manage', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1');

        manager.toggleFloating(win.win);

        expect(sm.remove).not.toHaveBeenCalled();
        expect(win.setKeepAbove).not.toHaveBeenCalled();
    });

    it('undocks a docked window: removes it from its strip and sets keepAbove when undockKeepAbove is true', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings(true));
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);

        manager.toggleFloating(win.win);

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(win.setKeepAbove).toHaveBeenCalledWith(true);
    });

    it('undocks a docked window without setting keepAbove when undockKeepAbove is false', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings(false));
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);

        manager.toggleFloating(win.win);

        expect(sm.remove).toHaveBeenCalledWith(win.win);
        expect(win.setKeepAbove).not.toHaveBeenCalled();
    });

    it('redocks a floating window: re-adds it via its current assignment and clears keepAbove', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings(true));
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);
        manager.toggleFloating(win.win); // dock -> undock
        sm.remove.mockClear();
        sm.addTo.mockClear();
        win.setKeepAbove.mockClear();

        win.setAssignment({ activity: 'a', desktop: 'd2' }); // moved activity while floating
        manager.toggleFloating(win.win); // undock -> dock

        expect(sm.addTo).toHaveBeenCalledWith('a', 'd2', win.win);
        expect(win.setKeepAbove).toHaveBeenCalledWith(false);
    });

    it('leaves a real window close cleaning up floating state (no stale redock)', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);
        manager.toggleFloating(win.win); // dock -> undock
        manager.removeWindow(win.win); // real close while floating
        sm.addTo.mockClear();

        manager.toggleFloating(win.win); // should be a no-op now, not a redock

        expect(sm.addTo).not.toHaveBeenCalled();
    });

    it('does not re-dock a floating window when its activity/desktop changes on its own', () => {
        const sm = fakeStripManager();
        const manager = new WindowManager(sm.manager, fakeSettings());
        const win = fakeWin('w1', { assignment: { activity: 'a', desktop: 'd1' } });
        manager.addWindow(win.win);
        manager.toggleFloating(win.win); // dock -> undock
        sm.remove.mockClear();
        sm.addTo.mockClear();

        win.setAssignment({ activity: 'a', desktop: 'd2' });
        win.fireDesktops();

        expect(sm.remove).not.toHaveBeenCalled();
        expect(sm.addTo).not.toHaveBeenCalled();
    });
});
