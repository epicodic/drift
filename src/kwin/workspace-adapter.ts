// Wraps the KWin workspace singleton. Reads screens for later multi-monitor work
// (docs §5); the spike uses the naive combined geometry for the viewport (§7.2).
// Untestable without a live compositor (docs §8) — kept deliberately thin.

import { Rect } from '../core/coordinates';
import { WindowAdapter } from './window-adapter';

export interface ScreenInfo {
    name: string;
    geometry: Rect;
}

export class WorkspaceAdapter {
    /** The full combined area across all outputs, bezels ignored (docs §4, §7.2). */
    combinedGeometry(): Rect {
        return toRect(Workspace.virtualScreenGeometry);
    }

    /** The mouse cursor's x position in real (screen) coordinates. */
    cursorX(): number {
        return Workspace.cursorPos.x;
    }

    currentActivity(): string {
        return Workspace.currentActivity;
    }

    /** The id of the current virtual desktop. */
    currentDesktop(): string {
        return Workspace.currentDesktop.id;
    }

    activities(): string[] {
        return Workspace.activities;
    }

    /** The ids of all virtual desktops. */
    desktops(): string[] {
        return Workspace.desktops.map((desktop) => desktop.id);
    }

    onCurrentActivityChanged(handler: () => void): void {
        Workspace.currentActivityChanged.connect(handler);
    }

    onCurrentDesktopChanged(handler: () => void): void {
        Workspace.currentDesktopChanged.connect(handler);
    }

    onActivitiesChanged(handler: () => void): void {
        Workspace.activitiesChanged.connect(handler);
    }

    onDesktopsChanged(handler: () => void): void {
        Workspace.desktopsChanged.connect(handler);
    }

    screens(): ScreenInfo[] {
        return Workspace.screens.map((output) => ({ name: output.name, geometry: toRect(output.geometry) }));
    }

    activeWindow(): WindowAdapter | null {
        return Workspace.activeWindow ? new WindowAdapter(Workspace.activeWindow) : null;
    }

    onWindowAdded(handler: (window: WindowAdapter) => void): void {
        Workspace.windowAdded.connect((window) => handler(new WindowAdapter(window)));
    }

    onWindowRemoved(handler: (window: WindowAdapter) => void): void {
        Workspace.windowRemoved.connect((window) => handler(new WindowAdapter(window)));
    }

    onWindowActivated(handler: (window: WindowAdapter | null) => void): void {
        Workspace.windowActivated.connect((window) => handler(window ? new WindowAdapter(window) : null));
    }
}

function toRect(rect: QRect): Rect {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
