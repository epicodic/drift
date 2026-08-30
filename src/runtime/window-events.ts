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
    deps.resizeColumn(columnId, Math.round(newReal.width), resizedEdge(oldReal, newReal));
    deps.render(win.isInteractiveResize() ? win.id : undefined);
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
