// Global entry point for window lifecycle events: routes each tileable window to the
// strip for its single activity+desktop, leaves sticky/multi-assigned windows unmanaged,
// and moves a window between strips when its activity/desktop assignment changes.
// Per-window activity/desktop subscriptions live here because an unmanaged window belongs
// to no strip; strip ownership itself is tracked by StripManager.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    private readonly unsubscribeByWindow = new Map<string, () => void>();

    constructor(private readonly stripManager: StripManager) {}

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
        this.stripManager.remove(win);
    }

    activateWindow(win: WindowAdapter | null): void {
        if (win === null) {
            return;
        }
        this.stripManager.activate(win);
    }

    private place(win: WindowAdapter): void {
        const assignment = win.singleAssignment();
        if (assignment !== null) {
            this.stripManager.addTo(assignment.activity, assignment.desktop, win);
        }
    }

    private reassign(win: WindowAdapter): void {
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
