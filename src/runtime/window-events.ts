// KWin window-signal handlers, extracted from main.ts's init() closures into pure
// functions that take their dependencies explicitly (a Strip satisfies WindowEventDeps),
// so the guard logic is unit-testable without a live compositor.

import {
    rectsEqualRounded,
    resizedEdge,
    verticalResizedEdge,
    type Rect,
    type ResizeEdge,
    type VerticalResizeEdge,
} from '../core/coordinates';
import type { WindowAdapter } from '../kwin/window-adapter';
import type { TileLocation } from './column-registry';

export interface WindowEventDeps {
    columnOf(windowId: string): number | null;
    tileOf(windowId: string): TileLocation | null;
    isHidden(columnId: number): boolean;
    isEcho(windowId: string, rect: Rect): boolean;
    resizeColumn(columnId: number, width: number, edge: ResizeEdge): void;
    resizeTile(columnId: number, tileId: number, height: number, edge: VerticalResizeEdge): void;
    hideColumn(columnId: number): void;
    showColumn(columnId: number): void;
    /** Hides/shows one tile's window without collapsing the rest of the column's
     * layout — used instead of hideColumn/showColumn when the window belongs to a
     * multi-tile stack (docs: 2026-09-03-vertical-tiling-design). */
    hideTile(columnId: number, tileId: number): void;
    showTile(columnId: number, tileId: number): void;
    setFullScreen(columnId: number, tileId: number, fullScreen: boolean): void;
    /** `instant`, when true, skips per-column position animation entirely — used for a
     * live interactive resize's neighbors, which must track the cursor with zero lag. */
    render(excludeWindowId?: string, instant?: boolean): void;
    revealFocused(): void;
    /** Whether `win`'s geometry already covers its output's fullscreen area (see workspace-adapter.ts). */
    isFullScreenGeometry(win: WindowAdapter): boolean;
}

export function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect, deps: WindowEventDeps): void {
    if (win.isFullScreen()) {
        return; // Drift never resizes columns/tiles or re-lays-out for a fullscreen window.
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
        if (Math.round(newReal.height) === Math.round(oldReal.height)) {
            return; // pure move: neither dimension changed
        }
        const location = deps.tileOf(win.id);
        if (location === null) {
            return; // height-only change on a plain (non-stacked) column: still ignored
        }
        const edge = verticalResizedEdge(oldReal, newReal);
        deps.resizeTile(location.columnId, location.tileId, Math.round(newReal.height), edge);
        deps.render(win.id, true);
        return;
    }
    if (win.isInteractiveResize()) {
        // A live border drag can tell us the left edge genuinely moved, and needs to render
        // immediately (excluding itself, and skipping neighbor animation) to track the pointer
        // without stutter.
        deps.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
        deps.render(win.id, true);
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
    const location = deps.tileOf(win.id);
    if (location === null) {
        return;
    }
    if (win.isMinimized()) {
        deps.hideTile(location.columnId, location.tileId);
        deps.render();
        // Collapsing the hidden tile's gap can slide a still-visible neighbor out from
        // under the (unchanged) viewport offset — re-check now, not just on the next focus
        // switch. Restoring deliberately skips this: it must not move the camera (docs:
        // 2026-08-30-minimized-windows-design).
        deps.revealFocused();
    } else {
        deps.showTile(location.columnId, location.tileId);
        deps.render();
    }
}

export function onFullScreenChanged(win: WindowAdapter, deps: WindowEventDeps): void {
    const location = deps.tileOf(win.id);
    if (location === null) {
        return;
    }
    deps.setFullScreen(location.columnId, location.tileId, win.isFullScreen());
    deps.render();
}
