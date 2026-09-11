// Owns one StripStack per (activity, virtualDesktop) pair and tracks which strip stack
// owns each window. Grids always span all screens, so screen is not part of the key.
// activeStripStack() follows the workspace's current activity/desktop; strip stacks are
// created lazily and pruned when their activity or desktop disappears.

import type { Rect } from '../core/coordinates';
import type { WindowRuleOverrides } from '../core/window-rules';
import type { Settings } from '../config/settings';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { WorkspaceAdapter } from '../kwin/workspace-adapter';
import type { Timer } from '../viewport/animator';
import { StripStack } from './strip-stack';

export type StripStackFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
) => StripStack;

export class StripManager {
    private readonly stacks = new Map<string, StripStack>();
    private readonly ownerByWindow = new Map<string, string>();

    constructor(
        private area: Rect,
        private readonly settings: Settings,
        private readonly timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        private readonly createStripStack: StripStackFactory = (area, settings, timer, workspaceAdapter) =>
            new StripStack(area, settings, timer, workspaceAdapter),
    ) {}

    keyOf(activity: string, desktop: string): string {
        return `${activity}|${desktop}`;
    }

    stripStackFor(activity: string, desktop: string): StripStack {
        return this.stack(this.keyOf(activity, desktop));
    }

    activeStripStack(): StripStack {
        return this.stripStackFor(this.workspaceAdapter.currentActivity(), this.workspaceAdapter.currentDesktop());
    }

    ownerOf(windowId: string): string | null {
        return this.ownerByWindow.get(windowId) ?? null;
    }

    addTo(activity: string, desktop: string, win: WindowAdapter): void {
        const key = this.keyOf(activity, desktop);
        this.stack(key).addWindow(win);
        this.ownerByWindow.set(win.id, key);
    }

    /** Applies a matched window rule's width/align overrides to the column that owns
     * `win` — called once, immediately after `addTo`, from `WindowManager.addWindow`
     * (docs: 2026-09-06-window-rules-design). */
    applyRuleOverrides(win: WindowAdapter, overrides: WindowRuleOverrides): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        const stack = this.stacks.get(key);
        if (stack === undefined) {
            return;
        }
        if (overrides.width !== undefined) {
            stack.setFocusedColumnWidth(overrides.width);
        }
        if (overrides.align !== undefined) {
            stack.alignFocusedColumn(overrides.align);
        }
    }

    remove(win: WindowAdapter): void {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return;
        }
        this.stacks.get(key)?.removeWindow(win);
        this.ownerByWindow.delete(win.id);
    }

    /** Routes activation to the strip stack that owns `win`, if any. Returns whether `win`
     * was actually managed by Drift — used to gate the focus-flash highlight to managed
     * windows only (docs: 2026-09-05-focus-flash-highlight-design). */
    activate(win: WindowAdapter): boolean {
        const key = this.ownerByWindow.get(win.id);
        if (key === undefined) {
            return false;
        }
        this.stacks.get(key)?.activateWindow(win);
        return true;
    }

    renderActive(): void {
        this.activeStripStack().render();
    }

    /** Fans a changed work area out to every strip stack already created, and remembers it
     * for any strip stack created lazily afterward (see `StripStack.updateArea`). */
    updateArea(area: Rect): void {
        this.area = area;
        for (const stack of this.stacks.values()) {
            stack.updateArea(area);
        }
    }

    prune(validActivities: ReadonlySet<string>, validDesktops: ReadonlySet<string>): void {
        for (const key of Array.from(this.stacks.keys())) {
            const [activity, desktop] = key.split('|');
            if (validActivities.has(activity) && validDesktops.has(desktop)) {
                continue;
            }
            this.stacks.delete(key);
            for (const [windowId, owner] of Array.from(this.ownerByWindow)) {
                if (owner === key) {
                    this.ownerByWindow.delete(windowId);
                }
            }
        }
    }

    private stack(key: string): StripStack {
        let stack = this.stacks.get(key);
        if (stack === undefined) {
            stack = this.createStripStack(this.area, this.settings, this.timer, this.workspaceAdapter);
            this.stacks.set(key, stack);
        }
        return stack;
    }
}
