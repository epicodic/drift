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
import { NOOP_PULL_INDICATOR, type PullIndicatorOverlay } from '../kwin/pull-indicator-overlay';
import { StripStack } from './strip-stack';
import { TransientLinks } from './transient-links';

export type StripStackFactory = (
    area: Rect,
    settings: Settings,
    timer: Timer,
    workspaceAdapter: WorkspaceAdapter,
    transientLinks: TransientLinks,
    pullIndicator: PullIndicatorOverlay,
) => StripStack;

export class StripManager {
    private readonly stacks = new Map<string, StripStack>();
    private readonly ownerByWindow = new Map<string, string>();

    constructor(
        private area: Rect,
        private readonly settings: Settings,
        private readonly timer: Timer,
        private readonly workspaceAdapter: WorkspaceAdapter,
        // undefined skips StripStack's own createStrip parameter positionally so it falls back to
        // its default, while still supplying transientLinks/pullIndicator (the parameters after it).
        private readonly createStripStack: StripStackFactory = (
            area,
            settings,
            timer,
            workspaceAdapter,
            transientLinks,
            pullIndicator,
        ) => new StripStack(area, settings, timer, workspaceAdapter, undefined, transientLinks, pullIndicator),
        private readonly transientLinks: TransientLinks = new TransientLinks(),
        private readonly pullIndicator: PullIndicatorOverlay = NOOP_PULL_INDICATOR,
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

    /** Routes activation to the strip stack that owns `win`, if any. When `win` itself is
     * untracked (e.g. a transient dialog KWin redirected focus to), climbs `transientFor()`
     * to find its tiled ancestor — matching Karousel's ClientManager.findTiledWindowOfClient
     * — so focusing a window whose child dialog steals focus still scrolls to the right strip.
     * Returns whether an owning strip stack was found — used to gate the focus-flash highlight
     * to managed windows only (docs: 2026-09-05-focus-flash-highlight-design). */
    activate(win: WindowAdapter): boolean {
        const owned = this.findOwned(win);
        if (owned === null) {
            return false;
        }
        const key = this.ownerByWindow.get(owned.id);
        this.stacks.get(key!)?.activateWindow(owned);
        return true;
    }

    private findOwned(win: WindowAdapter): WindowAdapter | null {
        if (this.ownerByWindow.has(win.id)) {
            return win;
        }
        const parent = win.transientFor();
        return parent === null ? null : this.findOwned(parent);
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
            stack = this.createStripStack(
                this.area,
                this.settings,
                this.timer,
                this.workspaceAdapter,
                this.transientLinks,
                this.pullIndicator,
            );
            this.stacks.set(key, stack);
        }
        return stack;
    }
}
