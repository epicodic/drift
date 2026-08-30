// Global entry point for window lifecycle events: decides whether a window should be
// tiled and routes it to the active strip. Per-window state lives in each strip's
// ColumnRegistry. Phase 2 (Plasma Activities) grows this to pick the strip for a
// window's (activity, desktop, screen) and to move a window when that context changes.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    constructor(private readonly stripManager: StripManager) {}

    addWindow(win: WindowAdapter): void {
        if (!win.isTileable()) {
            return;
        }
        this.stripManager.activeStrip().addWindow(win);
    }

    removeWindow(win: WindowAdapter): void {
        this.stripManager.activeStrip().removeWindow(win);
    }

    activateWindow(win: WindowAdapter | null): void {
        if (win === null) {
            return;
        }
        this.stripManager.activeStrip().activateWindow(win);
    }
}
