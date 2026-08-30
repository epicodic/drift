// Owns one Strip per (activity, virtualDesktop) pair and tracks which strip owns each
// window. Grids always span all screens, so screen is not part of the key. activeStrip()
// follows the workspace's current activity/desktop; strips are created lazily and pruned
// when their activity or desktop disappears.

import type { Rect } from '../core/coordinates';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { Strip } from './strip';

export type StripFactory = (area: Rect, settings: Settings, timer: Timer, workspaceAdapter: WorkspaceAdapter) => Strip;

export class StripManager {
    private readonly strips = new Map<string, Strip>();
    private readonly ownerByWindow = new Map<string, string>();

    constructor(
        private readonly area: Rect,
        private readonly settings: Settings,
        private readonly timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStrip: StripFactory = (area, settings, timer, workspaceAdapter) =>
            new Strip(area, settings, timer, workspaceAdapter),
    ) {}

    keyOf(activity: string, desktop: string): string {
        return `${activity}|${desktop}`;
    }

    stripFor(activity: string, desktop: string): Strip {
        return this.strip(this.keyOf(activity, desktop));
    }

    activeStrip(): Strip {
        return this.stripFor(this.workspaceAdapter.currentActivity(), this.workspaceAdapter.currentDesktop());
    }

    ownerOf(windowId: string): string | null {
        return this.ownerByWindow.get(windowId) ?? null;
    }

    addTo(activity: string, desktop: string, win: WindowAdapter): void {
        const key = this.keyOf(activity, desktop);
        this.strip(key).addWindow(win);
        this.ownerByWindow.set(win.id, key);
    }

    remove(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.strips.get(key)?.removeWindow(win);
        this.ownerByWindow.delete(win.id);
    }

    activate(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.strips.get(key)?.activateWindow(win);
    }

    renderActive(): void {
        this.activeStrip().render();
    }

    prune(validActivities: ReadonlySet<string>, validDesktops: ReadonlySet<string>): void {
        for (const key of Array.from(this.strips.keys())) {
            const [activity, desktop] = key.split('|');
            if (validActivities.has(activity) && validDesktops.has(desktop)) {
                continue;
            }
            this.strips.delete(key);
            for (const [windowId, owner] of Array.from(this.ownerByWindow)) {
                if (owner === key) {
                    this.ownerByWindow.delete(windowId);
                }
            }
        }
    }

    private strip(key: string): Strip {
        let strip = this.strips.get(key);
        if (strip === undefined) {
            strip = this.createStrip(this.area, this.settings, this.timer, this.workspaceAdapter);
            this.strips.set(key, strip);
        }
        return strip;
    }
}
