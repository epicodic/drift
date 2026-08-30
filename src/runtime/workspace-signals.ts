// Centralizes the workspace signal registration that used to be inline in main.ts's
// init(). Phase 2 adds currentActivityChanged / currentDesktopChanged / screensChanged
// handlers here to drive the StripManager.

import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { WindowManager } from './window-manager';

export function initWorkspaceSignals(windowManager: WindowManager, workspaceAdapter: WorkspaceAdapter): void {
    workspaceAdapter.onWindowAdded((win) => windowManager.addWindow(win));
    workspaceAdapter.onWindowRemoved((win) => windowManager.removeWindow(win));
    workspaceAdapter.onWindowActivated((win) => windowManager.activateWindow(win));
}
