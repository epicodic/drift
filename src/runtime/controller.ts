// Root orchestrator constructed by main.ts's init(). Owns the StripManager and
// WindowManager, wires the workspace signals and global shortcuts, and starts the
// script. Contains coordination only — no layout, camera, or geometry math.

import type { Settings } from '../config/settings';
import { createDebugConsole, type DebugConsole } from '../kwin/debug-console';
import { createMinimapOverlay, type MinimapOverlay } from '../kwin/minimap-overlay';
import { createQmlTimer } from '../kwin/qml-timer';
// import { checkForShortcutConflicts } from '../kwin/shortcut-conflicts'; // disabled, see start()
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { registerShortcuts } from '../input/shortcuts';
import type { Strip } from './strip';
import { StripManager } from './strip-manager';
import { WindowManager } from './window-manager';
import { initWorkspaceSignals } from './workspace-signals';

// How long to wait after registering shortcuts before checking whether kglobalaccel
// actually granted them — the grant may not be settled the instant the ShortcutHandler
// QML objects are constructed.
// const SHORTCUT_CONFLICT_CHECK_DELAY_MS = 1000; // disabled, see start()

export class Controller {
    private readonly workspaceAdapter = new WorkspaceAdapter();
    private readonly stripManager: StripManager;
    private readonly windowManager: WindowManager;
    private readonly debugConsole: DebugConsole;
    private readonly minimapOverlay: MinimapOverlay;

    constructor(
        private readonly root: QmlObject,
        private readonly settings: Settings,
        private readonly scriptUiDirUrl: string,
    ) {
        const area = this.workspaceAdapter.combinedGeometry();
        // Create the debug console before the animation timer, matching the original init() order.
        this.debugConsole = createDebugConsole(root);
        this.minimapOverlay = createMinimapOverlay(root, settings.minimapAutoHideMs);
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager);
    }

    start(): void {
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter);
        registerShortcuts(this.root, this.settings, {
            focusLeft: () => this.focusAndShowMinimap((strip) => strip.focusLeft()),
            focusRight: () => this.focusAndShowMinimap((strip) => strip.focusRight()),
            toggleDebugConsole: () => this.debugConsole.toggle(),
            cycleAlignLeft: () => this.stripManager.activeStrip().cycleAlignLeft(),
            cycleAlignRight: () => this.stripManager.activeStrip().cycleAlignRight(),
            shiftViewportLeft: () => this.stripManager.activeStrip().shiftViewportLeft(),
            shiftViewportRight: () => this.stripManager.activeStrip().shiftViewportRight(),
        });
        // Disabled: the OSD conflict notice kept firing incorrectly. Left in place, not deleted, per user request.
        // const conflictCheckTimer = createQmlTimer(this.root);
        // conflictCheckTimer.start(SHORTCUT_CONFLICT_CHECK_DELAY_MS, () => {
        //     conflictCheckTimer.stop();
        //     checkForShortcutConflicts(this.root, this.scriptUiDirUrl);
        // });
        void this.scriptUiDirUrl; // only used by the disabled conflict check above
        console.log('Drift: initialized');
    }

    private focusAndShowMinimap(move: (strip: Strip) => void): void {
        const strip = this.stripManager.activeStrip();
        move(strip);
        const output = strip.focusedWindowOutput();
        if (output === null) {
            return;
        }
        this.minimapOverlay.show(strip.minimapSnapshot(), this.workspaceAdapter.screenGeometryFor(output));
    }
}
