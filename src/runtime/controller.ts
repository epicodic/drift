// Root orchestrator constructed by main.ts's init(). Owns the StripManager and
// WindowManager, wires the workspace signals and global shortcuts, and starts the
// script. Contains coordination only — no layout, camera, or geometry math.

import type { Settings } from '../config/settings';
import { createDebugConsole, type DebugConsole } from '../kwin/debug-console';
import { createQmlTimer } from '../kwin/qml-timer';
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { registerShortcuts } from '../input/shortcuts';
import { StripManager } from './strip-manager';
import { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

export class Controller {
    private readonly workspaceAdapter = new WorkspaceAdapter();
    private readonly stripManager: StripManager;
    private readonly windowManager: WindowManager;
    private readonly debugConsole: DebugConsole;

    constructor(
        private readonly root: QmlObject,
        settings: Settings,
    ) {
        const area = this.workspaceAdapter.combinedGeometry();
        // Create the debug console before the animation timer, matching the original init() order.
        this.debugConsole = createDebugConsole(root);
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager);
    }

    start(): void {
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter);
        registerShortcuts(this.root, {
            focusLeft: () => this.stripManager.activeStrip().focusLeft(),
            focusRight: () => this.stripManager.activeStrip().focusRight(),
            toggleDebugConsole: () => this.debugConsole.toggle(),
        });
        console.log('Drift: initialized');
    }
}
