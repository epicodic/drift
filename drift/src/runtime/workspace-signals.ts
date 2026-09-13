// Centralizes workspace signal registration. Window lifecycle signals drive the
// WindowManager and, when popup pinning is enabled, the TransientLinks parent/child graph;
// current activity/desktop changes re-render the now-active strip; and activity/desktop list
// changes prune strips whose context no longer exists.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { StripManager } from './strip-manager';
import type { TransientLinks } from './transient-links';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(
    windowManager: WindowManager,
    stripManager: StripManager,
    transientLinks: TransientLinks,
    popupPinningEnabled: boolean,
    workspaceAdapter: WorkspaceAdapter,
    onManagedWindowActivated?: (win: WindowAdapter) => void,
): void {
    workspaceAdapter.onWindowAdded((win) => {
        windowManager.addWindow(win);
        if (popupPinningEnabled) {
            transientLinks.link(win);
        }
    });
    workspaceAdapter.onWindowRemoved((win) => {
        windowManager.removeWindow(win);
        if (popupPinningEnabled) {
            transientLinks.unlink(win);
        }
    });
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
