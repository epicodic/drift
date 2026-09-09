// Translates virtual grid rects into real on-screen window geometry, applying the
// current viewport scroll offset. `toRealRect` is pure (unit-tested); `GeometrySync`
// applies the result to a real window through the adapter (docs §6.1).

import { Rect, rectsEqualRounded } from '../core/coordinates';
import { WindowAdapter } from './window-adapter';

/** Maps a rect from virtual strip coordinates into the real screen area. `viewportOffsetY`
 * is the strip-navigation vertical camera offset (docs: 2026-09-01-row-navigation-design) —
 * 0 for the active strip, non-zero to park an inactive strip's windows off-screen. */
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
    // A queue rather than a single last-applied rect: a fast preview animation can call
    // apply() several times before the compositor's frameGeometryChanged signal for an
    // OLDER write comes back, so isEcho must recognize any not-yet-confirmed write, not
    // only the latest one (docs: 2026-09-07-drag-reorder-stack-refinement-design).
    private static readonly MAX_PENDING_PER_WINDOW = 8;
    private readonly pending = new Map<string, Rect[]>();

    constructor(private area: Rect) {}

    setArea(area: Rect): void {
        this.area = area;
    }

    apply(window: WindowAdapter, virtualRect: Rect, viewportOffsetX: number, viewportOffsetY = 0): void {
        const real = toRealRect(virtualRect, this.area, viewportOffsetX, viewportOffsetY);
        window.setFrameGeometry(real);
        const queue = this.pending.get(window.id) ?? [];
        const last = queue[queue.length - 1];
        if (last === undefined || !rectsEqualRounded(last, real)) {
            queue.push(real);
            if (queue.length > GeometrySync.MAX_PENDING_PER_WINDOW) {
                queue.shift();
            }
        }
        this.pending.set(window.id, queue);
    }

    /** True when `rect` matches a geometry Drift itself applied to this window and not yet
     * confirmed by a compositor signal. Consumes that entry and anything applied before it. */
    isEcho(windowId: string, rect: Rect): boolean {
        const queue = this.pending.get(windowId);
        if (queue === undefined) {
            return false;
        }
        const index = queue.findIndex((applied) => rectsEqualRounded(applied, rect));
        if (index === -1) {
            return false;
        }
        queue.splice(0, index + 1);
        return true;
    }

    forget(windowId: string): void {
        this.pending.delete(windowId);
    }
}
