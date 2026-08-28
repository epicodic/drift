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
