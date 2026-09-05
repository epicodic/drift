// Root orchestrator constructed by main.ts's init(). Owns the StripManager and
// WindowManager, wires the workspace signals and global shortcuts, and starts the
// script. Contains coordination only — no layout, camera, or geometry math.

import type { Settings } from '../config/settings';
import { createDebugConsole, type DebugConsole } from '../kwin/debug-console';
import { createMinimapOverlay, type MinimapOverlay } from '../kwin/minimap-overlay';
import { createQmlTimer } from '../kwin/qml-timer';
import { WorkspaceAdapter } from '../kwin/workspace-adapter';
import { registerShortcuts } from '../input/shortcuts';
import type { StripStack } from './strip-stack';
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
        this.minimapOverlay = createMinimapOverlay(root, settings.minimapAutoHideMs, settings.minimapShowThumbnails);
        this.stripManager = new StripManager(area, settings, createQmlTimer(root), this.workspaceAdapter);
        this.windowManager = new WindowManager(this.stripManager);
    }

    start(): void {
        initWorkspaceSignals(this.windowManager, this.stripManager, this.workspaceAdapter);
        registerShortcuts(this.root, this.settings, {
            focusLeft: () => this.focusAndShowMinimap((stack) => stack.focusLeft()),
            focusRight: () => this.focusAndShowMinimap((stack) => stack.focusRight()),
            toggleDebugConsole: () => this.debugConsole.toggle(),
            cycleAlignLeft: () => this.stripManager.activeStripStack().cycleAlignLeft(),
            cycleAlignRight: () => this.stripManager.activeStripStack().cycleAlignRight(),
            shiftViewportLeft: () => this.stripManager.activeStripStack().shiftViewportLeft(),
            shiftViewportRight: () => this.stripManager.activeStripStack().shiftViewportRight(),
            navigateUp: () => this.focusAndShowMinimap((stack) => stack.navigateUp()),
            navigateDown: () => this.focusAndShowMinimap((stack) => stack.navigateDown()),
            moveWindowToStripAbove: () => this.focusAndShowMinimap((stack) => stack.moveWindowToStripAbove()),
            moveWindowToStripBelow: () => this.focusAndShowMinimap((stack) => stack.moveWindowToStripBelow()),
            absorbRight: () => this.focusAndShowMinimap((stack) => stack.absorbRight()),
            expel: () => this.focusAndShowMinimap((stack) => stack.expel()),
            moveWindowLeft: () => this.focusAndShowMinimap((stack) => stack.moveWindowLeft()),
            moveWindowRight: () => this.focusAndShowMinimap((stack) => stack.moveWindowRight()),
            stripUp: () => this.focusAndShowMinimap((stack) => stack.stripUp()),
            stripDown: () => this.focusAndShowMinimap((stack) => stack.stripDown()),
            moveColumnToStripAbove: () => this.focusAndShowMinimap((stack) => stack.moveColumnToStripAbove()),
            moveColumnToStripBelow: () => this.focusAndShowMinimap((stack) => stack.moveColumnToStripBelow()),
        });
        void this.scriptUiDirUrl; // only used by the disabled conflict check above
        console.log('Drift: initialized');
    }

    private focusAndShowMinimap(move: (stack: StripStack) => void): void {
        const stack = this.stripManager.activeStripStack();
        move(stack);
        const snapshot = stack.minimapSnapshot();
        const activeStrip = snapshot.strips.find((strip) => strip.stripIndex === snapshot.viewport.stripIndex);
        if (!activeStrip?.columns.some((column) => column.tiles.some((tile) => tile.focused))) {
            return;
        }
        this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
    }
}
