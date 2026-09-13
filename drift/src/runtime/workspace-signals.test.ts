import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { TransientLinks } from './transient-links';
import type { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

function fakeWorkspaceAdapter() {
    const handlers: Record<string, (win?: WindowAdapter | null) => void> = {};
    const adapter = {
        onWindowAdded: (h: () => void) => (handlers.windowAdded = h),
        onWindowRemoved: (h: () => void) => (handlers.windowRemoved = h),
        onWindowActivated: (h: (win?: WindowAdapter | null) => void) => (handlers.windowActivated = h),
        onCurrentActivityChanged: (h: () => void) => (handlers.currentActivity = h),
        onCurrentDesktopChanged: (h: () => void) => (handlers.currentDesktop = h),
        onActivitiesChanged: (h: () => void) => (handlers.activities = h),
        onDesktopsChanged: (h: () => void) => (handlers.desktops = h),
        activities: () => ['a'],
        desktops: () => ['d1'],
    } as unknown as WorkspaceAdapter;
    return { adapter, handlers };
}

function fakeTransientLinks() {
    return { link: vi.fn(), unlink: vi.fn() } as unknown as TransientLinks;
}

describe('initWorkspaceSignals', () => {
    it('re-renders the active strip when the current activity changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.currentActivity();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('re-renders the active strip when the current desktop changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.currentDesktop();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('prunes strips with the valid activity/desktop sets when activities change', () => {
        const prune = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.activities();

        expect(prune).toHaveBeenCalledWith(new Set(['a']), new Set(['d1']));
    });

    it('forwards added windows to the window manager', () => {
        const addWindow = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.windowAdded();

        expect(addWindow).toHaveBeenCalledTimes(1);
    });

    it('forwards activated windows to the window manager', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);
        handlers.windowActivated(win);

        expect(activateWindow).toHaveBeenCalledWith(win);
    });

    it('invokes onManagedWindowActivated when the activation was managed', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const onManagedWindowActivated = vi.fn();
        const win = {} as WindowAdapter;

        initWorkspaceSignals(
            windowManager,
            stripManager,
            fakeTransientLinks(),
            true,
            adapter,
            onManagedWindowActivated,
        );
        handlers.windowActivated(win);

        expect(onManagedWindowActivated).toHaveBeenCalledWith(win);
    });

    it('does not invoke onManagedWindowActivated when the activation was not managed', () => {
        const activateWindow = vi.fn(() => false);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const onManagedWindowActivated = vi.fn();

        initWorkspaceSignals(
            windowManager,
            stripManager,
            fakeTransientLinks(),
            true,
            adapter,
            onManagedWindowActivated,
        );
        handlers.windowActivated({} as WindowAdapter);

        expect(onManagedWindowActivated).not.toHaveBeenCalled();
    });

    it('does not throw for a null activated window or an omitted callback', () => {
        const activateWindow = vi.fn(() => true);
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), activateWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, fakeTransientLinks(), true, adapter);

        expect(() => handlers.windowActivated(null)).not.toThrow();
        expect(activateWindow).toHaveBeenCalledWith(null);
    });

    it('links an added window when popup pinning is enabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const addWindow = vi.fn();
        const windowManager = { addWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const link = vi.fn();
        const transientLinks = { link, unlink: vi.fn() } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, true, adapter);
        handlers.windowAdded(win);

        expect(link).toHaveBeenCalledWith(win);
        expect(addWindow).toHaveBeenCalledWith(win);
    });

    it('does not link an added window when popup pinning is disabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const link = vi.fn();
        const transientLinks = { link, unlink: vi.fn() } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, false, adapter);
        handlers.windowAdded(win);

        expect(link).not.toHaveBeenCalled();
    });

    it('unlinks a removed window when popup pinning is enabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const removeWindow = vi.fn();
        const windowManager = { addWindow: vi.fn(), removeWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const unlink = vi.fn();
        const transientLinks = { link: vi.fn(), unlink } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, true, adapter);
        handlers.windowRemoved(win);

        expect(unlink).toHaveBeenCalledWith(win);
        expect(removeWindow).toHaveBeenCalledWith(win);
    });

    it('does not unlink a removed window when popup pinning is disabled', () => {
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn(), removeWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();
        const unlink = vi.fn();
        const transientLinks = { link: vi.fn(), unlink } as unknown as TransientLinks;
        const win = {} as WindowAdapter;

        initWorkspaceSignals(windowManager, stripManager, transientLinks, false, adapter);
        handlers.windowRemoved(win);

        expect(unlink).not.toHaveBeenCalled();
    });
});
