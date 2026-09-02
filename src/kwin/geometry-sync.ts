// Translates virtual grid rects into real on-screen window geometry, applying the
// current viewport scroll offset. `toRealRect` is pure (unit-tested); `GeometrySync`
// applies the result to a real window through the adapter (docs §6.1).

import { Rect, rectsEqualRounded } from '../core/coordinates';
import { WindowAdapter } from './window-adapter';

/** Maps a rect from virtual strip coordinates into the real screen area. `viewportOffsetY`
 * is the row-navigation vertical camera offset (docs: 2026-09-01-row-navigation-design) —
 * 0 for the active row, non-zero to park an inactive row's windows off-screen. */
export function toRealRect(virtualRect: Rect, area: Rect, viewportOffsetX: number, viewportOffsetY = 0): Rect {
    return {
        x: area.x + virtualRect.x - viewportOffsetX,
        y: area.y + virtualRect.y - viewportOffsetY,
        width: virtualRect.width,
        height: virtualRect.height,
    };
}

/** Maps a real screen x-coordinate (e.g. the cursor position) into virtual strip
 * coordinates — the inverse of `toRealRect`'s x mapping. */
export function toVirtualX(realX: number, area: Rect, viewportOffsetX: number): number {
    return realX - area.x + viewportOffsetX;
}

export class GeometrySync {
    private readonly lastApplied = new Map<string, Rect>();

    constructor(private readonly area: Rect) {}

    apply(window: WindowAdapter, virtualRect: Rect, viewportOffsetX: number, viewportOffsetY = 0): void {
        const real = toRealRect(virtualRect, this.area, viewportOffsetX, viewportOffsetY);
        window.setFrameGeometry(real);
        this.lastApplied.set(window.id, real);
    }

    /** True when `rect` matches the geometry Drift itself last wrote to this window. */
    isEcho(windowId: string, rect: Rect): boolean {
        const last = this.lastApplied.get(windowId);
        return last !== undefined && rectsEqualRounded(last, rect);
    }

    forget(windowId: string): void {
        this.lastApplied.delete(windowId);
    }
}
