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
    render(excludeWindowId?: string): void;
    revealFocused(): void;
}

export function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect, deps: WindowEventDeps): void {
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
    // Only a live border drag can tell us the left edge genuinely moved. A programmatic
    // jump (maximize, quick-tile, snap) reports whatever x the compositor chose for the
    // new size, which is meaningless as a drag direction and would otherwise corrupt the
    // strip's origin — treat those as a right-edge resize that leaves the column's own
    // virtual x untouched.
    const edge = win.isInteractiveResize() ? resizedEdge(oldReal, newReal) : 'right';
    deps.resizeColumn(columnId, Math.round(newReal.width), edge);
    deps.render(win.isInteractiveResize() ? win.id : undefined);
    if (!win.isInteractiveResize()) {
        // A programmatic resize (e.g. maximize) can grow a column out of view without any
        // focus change to trigger a reveal — re-check now, not just on the next focus switch.
        deps.revealFocused();
    }
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
