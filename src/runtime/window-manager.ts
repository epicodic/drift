// Global entry point for window lifecycle events: routes each tileable window to the
// strip for its single activity+desktop, leaves sticky/multi-assigned windows unmanaged,
// and moves a window between strips when its activity/desktop assignment changes.
// Per-window activity/desktop subscriptions live here because an unmanaged window belongs
// to no strip; strip ownership itself is tracked by StripManager.

import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    private readonly unsubscribeByWindow = new Map<string, () => void>();
    private readonly undocked = new Set<string>();

    constructor(
        private readonly stripManager: StripManager,
        private readonly settings: Settings,
    ) {}

    addWindow(win: WindowAdapter): void {
        if (!win.isTileable() || this.unsubscribeByWindow.has(win.id)) {
            return;
        }
        const disconnectActivities = win.onActivitiesChanged(() => this.reassign(win));
        const disconnectDesktops = win.onDesktopsChanged(() => this.reassign(win));
        this.unsubscribeByWindow.set(win.id, () => {
            disconnectActivities();
            disconnectDesktops();
        });
        this.place(win);
    }

    removeWindow(win: WindowAdapter): void {
        const unsubscribe = this.unsubscribeByWindow.get(win.id);
        if (unsubscribe !== undefined) {
            unsubscribe();
            this.unsubscribeByWindow.delete(win.id);
        }
        this.undocked.delete(win.id);
        this.stripManager.remove(win);
    }

    /** Returns whether `win` was actually a Drift-managed window — used to gate the
     * focus-flash highlight to managed windows only (docs:
     * 2026-09-05-focus-flash-highlight-design). */
    activateWindow(win: WindowAdapter | null): boolean {
        if (win === null) {
            return false;
        }
        return this.stripManager.activate(win);
    }

    /** Toggles `win` between docked (managed by its strip) and floating/undocked (normal
     * KWin floating behavior, outside any strip) — docs: 2026-09-06-manual-undock-redock-design. */
    toggleFloating(win: WindowAdapter | null): void {
        if (win === null) {
            return;
        }
        if (this.undocked.has(win.id)) {
            this.undocked.delete(win.id);
            win.setKeepAbove(false);
            this.place(win);
            return;
        }
        if (this.stripManager.ownerOf(win.id) === null) {
            return;
        }
        this.stripManager.remove(win);
        this.undocked.add(win.id);
        if (this.settings.undockKeepAbove) {
            win.setKeepAbove(true);
        }
    }

    private place(win: WindowAdapter): void {
        const assignment = win.singleAssignment();
        if (assignment !== null) {
            this.stripManager.addTo(assignment.activity, assignment.desktop, win);
        }
    }

    private reassign(win: WindowAdapter): void {
        if (this.undocked.has(win.id)) {
            return;
        }
        const currentKey = this.stripManager.ownerOf(win.id);
        const assignment = win.singleAssignment();
        const newKey = assignment === null ? null : this.stripManager.keyOf(assignment.activity, assignment.desktop);
        if (currentKey === newKey) {
            return;
        }
        this.stripManager.remove(win);
        if (assignment !== null) {
            this.stripManager.addTo(assignment.activity, assignment.desktop, win);
        }
    }
}
