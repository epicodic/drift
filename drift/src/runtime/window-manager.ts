// Global entry point for window lifecycle events: routes each tileable window to the
// strip for its single activity+desktop, leaves sticky/multi-assigned windows unmanaged,
// and moves a window between strips when its activity/desktop assignment changes.
// Per-window activity/desktop subscriptions live here because an unmanaged window belongs
// to no strip; strip ownership itself is tracked by StripManager.
//
// Also matches each newly added window against `settings.windowRules` (docs:
// 2026-09-06-window-rules-design), once, at add-time: a `float: true` match diverts the
// window straight to undocked instead of tiling it; a `width`/`align` match is applied to
// the column right after it's placed. `screen` is matched but never acted on — logged via
// `debug()` so the gap stays visible, since nothing in Drift moves windows across monitors.

import type { Settings } from '../config/settings';
import {
    matchRule,
    parseWindowRules,
    resolveWidth,
    type WindowRule,
    type WindowRuleOverrides,
} from '../core/window-rules';
import { debug } from '../debug';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { StripManager } from './strip-manager';

export class WindowManager {
    private readonly unsubscribeByWindow = new Map<string, () => void>();
    private readonly undocked = new Set<string>();
    private readonly windowRules: WindowRule[];

    constructor(
        private readonly stripManager: StripManager,
        private readonly settings: Settings,
    ) {
        const { rules, warnings } = parseWindowRules(settings.windowRules);
        this.windowRules = rules;
        warnings.forEach((warning) => debug(warning));
    }

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

        const rule = matchRule(this.windowRules, win.resourceClass, win.caption);
        if (rule?.screen !== undefined) {
            debug(
                `windowRules: rule matched with screen=${rule.screen}, but cross-monitor placement isn't implemented`,
            );
        }
        if (rule?.float === true) {
            this.undock(win);
            return;
        }
        this.place(win);
        if (rule !== null) {
            this.applyColumnOverrides(win, rule);
        }
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
        this.undock(win);
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

    /** Marks `win` as undocked and applies `undockKeepAbove` — shared by the manual
     * `toggleFloating` path and a matched `float: true` window rule. */
    private undock(win: WindowAdapter): void {
        this.undocked.add(win.id);
        if (this.settings.undockKeepAbove) {
            win.setKeepAbove(true);
        }
    }

    /** Resolves and applies a matched rule's `width`/`align` to the column `win` was just
     * placed into — distinct from `StripManager.applyRuleOverrides`, which this delegates
     * to once both fields are resolved. Screen handling lives in `addWindow`, not here,
     * since it must run even when the rule also floats the window (docs:
     * 2026-09-06-window-rules-design). */
    private applyColumnOverrides(win: WindowAdapter, rule: WindowRule): void {
        const overrides: WindowRuleOverrides = {};
        if (rule.width !== undefined) {
            const width = resolveWidth(rule.width, win.screenWidth());
            if (width !== undefined) {
                overrides.width = width;
            }
        }
        if (rule.align !== undefined) {
            overrides.align = rule.align;
        }
        if (overrides.width !== undefined || overrides.align !== undefined) {
            this.stripManager.applyRuleOverrides(win, overrides);
        }
    }
}
