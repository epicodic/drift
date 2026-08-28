// Translates virtual grid rects into real on-screen window geometry, applying the
// current viewport scroll offset. `toRealRect` is pure (unit-tested); `GeometrySync`
// applies the result to a real window through the adapter (docs §6.1).

import { Rect } from '../core/coordinates';
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
    constructor(private readonly area: Rect) {}

    apply(window: WindowAdapter, virtualRect: Rect, viewportOffsetX: number): void {
        window.setFrameGeometry(toRealRect(virtualRect, this.area, viewportOffsetX));
    }
}
