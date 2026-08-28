// Translates virtual grid rects into real on-screen window geometry, applying the
// current viewport scroll offset. `toRealRect` is pure (unit-tested); `GeometrySync`
// applies the result to a real window through the adapter (docs §6.1).

import { Rect, rectsEqualRounded } from '../core/coordinates';
import { WindowAdapter } from './window-adapter';

/** Maps a rect from virtual strip coordinates into the real screen area. */
export function toRealRect(virtualRect: Rect, area: Rect, viewportOffsetX: number): Rect {
    return {
        x: area.x + virtualRect.x - viewportOffsetX,
        y: area.y + virtualRect.y,
        width: virtualRect.width,
        height: virtualRect.height,
    };
}

export class GeometrySync {
    private readonly lastApplied = new Map<string, Rect>();

    constructor(private readonly area: Rect) {}

    apply(window: WindowAdapter, virtualRect: Rect, viewportOffsetX: number): void {
        const real = toRealRect(virtualRect, this.area, viewportOffsetX);
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
