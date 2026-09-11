// Centralizes workspace signal registration. Window lifecycle signals drive the
// WindowManager; current activity/desktop changes re-render the now-active strip; and
// activity/desktop list changes prune strips whose context no longer exists.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(
    windowManager: WindowManager,
    stripManager: StripManager,
    workspaceAdapter: WorkspaceAdapter,
    onManagedWindowActivated?: (win: WindowAdapter) => void,
): void {
    workspaceAdapter.onWindowAdded((win) => windowManager.addWindow(win));
    workspaceAdapter.onWindowRemoved((win) => windowManager.removeWindow(win));
    workspaceAdapter.onWindowActivated((win) => {
        const managed = windowManager.activateWindow(win);
        if (win !== null && managed && onManagedWindowActivated) {
            onManagedWindowActivated(win);
        }
    });
    workspaceAdapter.onCurrentActivityChanged(() => stripManager.renderActive());
    workspaceAdapter.onCurrentDesktopChanged(() => stripManager.renderActive());
    workspaceAdapter.onActivitiesChanged(() => pruneStrips(stripManager, workspaceAdapter));
    workspaceAdapter.onDesktopsChanged(() => pruneStrips(stripManager, workspaceAdapter));
}

function pruneStrips(stripManager: StripManager, workspaceAdapter: WorkspaceAdapter): void {
    stripManager.prune(new Set(workspaceAdapter.activities()), new Set(workspaceAdapter.desktops()));
}
