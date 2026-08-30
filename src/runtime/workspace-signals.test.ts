import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

function fakeWorkspaceAdapter() {
    const handlers: Record<string, () => void> = {};
    const adapter = {
        onWindowAdded: (h: () => void) => (handlers.windowAdded = h),
        onWindowRemoved: (h: () => void) => (handlers.windowRemoved = h),
        onWindowActivated: (h: () => void) => (handlers.windowActivated = h),
        onCurrentActivityChanged: (h: () => void) => (handlers.currentActivity = h),
        onCurrentDesktopChanged: (h: () => void) => (handlers.currentDesktop = h),
        onActivitiesChanged: (h: () => void) => (handlers.activities = h),
        onDesktopsChanged: (h: () => void) => (handlers.desktops = h),
        activities: () => ['a'],
        desktops: () => ['d1'],
    } as unknown as WorkspaceAdapter;
    return { adapter, handlers };
}

describe('initWorkspaceSignals', () => {
    it('re-renders the active strip when the current activity changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.currentActivity();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('re-renders the active strip when the current desktop changes', () => {
        const renderActive = vi.fn();
        const stripManager = { renderActive, prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.currentDesktop();

        expect(renderActive).toHaveBeenCalledTimes(1);
    });

    it('prunes strips with the valid activity/desktop sets when activities change', () => {
        const prune = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune } as unknown as StripManager;
        const windowManager = { addWindow: vi.fn() } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.activities();

        expect(prune).toHaveBeenCalledWith(new Set(['a']), new Set(['d1']));
    });

    it('forwards added windows to the window manager', () => {
        const addWindow = vi.fn();
        const stripManager = { renderActive: vi.fn(), prune: vi.fn() } as unknown as StripManager;
        const windowManager = { addWindow } as unknown as WindowManager;
        const { adapter, handlers } = fakeWorkspaceAdapter();

        initWorkspaceSignals(windowManager, stripManager, adapter);
        handlers.windowAdded();

        expect(addWindow).toHaveBeenCalledTimes(1);
    });
});
