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

    onCurrentActivityChanged(handler: () => void): () => void {
        Workspace.currentActivityChanged.connect(handler);
        return () => Workspace.currentActivityChanged.disconnect(handler);
    }

    onCurrentDesktopChanged(handler: () => void): () => void {
        Workspace.currentDesktopChanged.connect(handler);
        return () => Workspace.currentDesktopChanged.disconnect(handler);
    }

    onActivitiesChanged(handler: () => void): () => void {
        Workspace.activitiesChanged.connect(handler);
        return () => Workspace.activitiesChanged.disconnect(handler);
    }

    onDesktopsChanged(handler: () => void): () => void {
        Workspace.desktopsChanged.connect(handler);
        return () => Workspace.desktopsChanged.disconnect(handler);
    }

    /** The mouse pointer's current position in global screen coordinates. */
    cursorPos(): { x: number; y: number } {
        const cursor = Workspace.cursorPos;
        return { x: cursor.x, y: cursor.y };
    }

    screens(): ScreenInfo[] {
        return Workspace.screens.map((output) => ({ name: output.name, geometry: toRect(output.geometry) }));
    }

    /** The screen geometry under the mouse pointer (used to center the minimap on the pointer's screen). */
    screenGeometryAtCursor(): Rect {
        const cursor = Workspace.cursorPos;
        const screen = this.screens().find(
            (candidate) =>
                cursor.x >= candidate.geometry.x &&
                cursor.x < candidate.geometry.x + candidate.geometry.width &&
                cursor.y >= candidate.geometry.y &&
                cursor.y < candidate.geometry.y + candidate.geometry.height,
        );
        return screen?.geometry ?? this.combinedGeometry();
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

    /**
     * Whether `win`'s current frame geometry already covers its own output's fullscreen area.
     * Ported from Karousel's `Clients.isFullScreenGeometry`: KWin may resize a window to its
     * fullscreen geometry before flipping `Window.fullScreen`, so this shape check — not the
     * live boolean — is what must gate layout writes during that transition.
     */
    isFullScreenGeometry(win: WindowAdapter): boolean {
        const desktops = win.desktops();
        const desktop = desktops.length === 1 ? desktops[0] : Workspace.currentDesktop;
        const area = Workspace.clientArea(ClientAreaOption.FullScreenArea, win.output(), desktop);
        const geometry = win.frameGeometry();
        return Math.round(geometry.width) >= area.width && Math.round(geometry.height) >= area.height;
    }
}

function toRect(rect: QRect): Rect {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
