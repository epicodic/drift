// KWin window-signal handlers, extracted from main.ts's init() closures into pure
// functions that take their dependencies explicitly (a Strip satisfies WindowEventDeps),
// so the guard logic is unit-testable without a live compositor.

import { rectsEqualRounded, resizedEdge, type Rect, type ResizeEdge } from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';

export interface WindowEventDeps {
    columnOf(windowId: string): number | null;
    isHidden(columnId: number): boolean;
    isEcho(windowId: string, rect: Rect): boolean;
    resizeColumn(columnId: number, width: number, edge: ResizeEdge): void;
    hideColumn(columnId: number): void;
    showColumn(columnId: number): void;
    setFullScreen(columnId: number, fullScreen: boolean): void;
    render(excludeWindowId?: string): void;
    revealFocused(): void;
    /** Whether `win`'s geometry already covers its output's fullscreen area (see workspace-adapter.ts). */
    isFullScreenGeometry(win: WindowAdapter): boolean;
}

export function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect, deps: WindowEventDeps): void {
    if (win.isFullScreen()) {
        return; // Drift never resizes columns or re-lays-out for a fullscreen window.
    }
    const columnId = deps.columnOf(win.id);
    if (columnId === null || deps.isHidden(columnId)) {
        return;
    }
    const newReal = win.frameGeometry();
    if (rectsEqualRounded(oldReal, newReal)) {
        return;
    }
    if (deps.isEcho(win.id, newReal)) {
        return;
    }
    if (Math.round(newReal.width) === Math.round(oldReal.width)) {
        return; // width-only step: ignore pure moves and height-only changes
    }
    if (win.isInteractiveResize()) {
        // A live border drag can tell us the left edge genuinely moved, and needs to render
        // immediately (excluding itself) to track the pointer without stutter.
        deps.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
        deps.render(win.id);
        return;
    }
    // This can be the compositor resizing the frame to cover the screen as the *first* step of
    // entering fullscreen, before it flips `fullScreen` / emits fullScreenChanged (the two
    // events' relative order isn't guaranteed) — `win.isFullScreen()` above cannot be trusted for
    // this specific transition. Check the geometry's shape instead of the live property.
    if (deps.isFullScreenGeometry(win)) {
        return;
    }
    // A programmatic jump (maximize, quick-tile, snap) reports whatever x the compositor chose
    // for the new size, which is meaningless as a drag direction and would otherwise corrupt the
    // strip's origin — treat it as a right-edge resize that leaves the column's own virtual x
    // untouched.
    deps.resizeColumn(columnId, Math.round(newReal.width), 'right');
    deps.render();
    // A programmatic resize (e.g. maximize) can grow a column out of view without any focus
    // change to trigger a reveal — re-check now, not just on the next focus switch.
    deps.revealFocused();
}

export function onMinimizedChanged(win: WindowAdapter, deps: WindowEventDeps): void {
    const columnId = deps.columnOf(win.id);
    if (columnId === null) {
        return;
    }
    if (win.isMinimized()) {
        deps.hideColumn(columnId);
    } else {
        deps.showColumn(columnId);
    }
    deps.render();
}

export function onFullScreenChanged(win: WindowAdapter, deps: WindowEventDeps): void {
    const columnId = deps.columnOf(win.id);
    if (columnId === null) {
        return;
    }
    deps.setFullScreen(columnId, win.isFullScreen());
    deps.render();
}
