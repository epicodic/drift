// Virtual coordinate system for a single horizontal strip of columns.
// Pure math, no KWin dependency: the area's horizontal extent is a function of
// the column widths, so growth/shrink falls out of recomputing these values.

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Total horizontal extent of the strip: summed widths plus gaps between columns. */
export function virtualWidth(widths: readonly number[], gap: number): number {
    if (widths.length === 0) {
        return 0;
    }
    const summedWidths = widths.reduce((total, width) => total + width, 0);
    return summedWidths + gap * (widths.length - 1);
}

/** Full-height rect for a column at `offset`. Columns always span the whole height. */
export function columnRect(offset: number, width: number, height: number): Rect {
    return { x: offset, y: 0, width, height };
}

export type ResizeEdge = 'left' | 'right';

/** Which border moved between two geometries of the same window: a changed left
 * edge (x) means the left border was dragged, otherwise the right border moved. */
export function resizedEdge(oldRect: Rect, newRect: Rect): ResizeEdge {
    return Math.round(newRect.x) !== Math.round(oldRect.x) ? 'left' : 'right';
}

export type VerticalResizeEdge = 'top' | 'bottom';

/** Which border moved between two geometries of the same window, vertically — the
 * sibling of `resizedEdge` for tile-height resize within a column (docs:
 * 2026-09-03-vertical-tiling-design). A changed top edge (y) means the top border
 * was dragged, otherwise the bottom border moved. */
export function verticalResizedEdge(oldRect: Rect, newRect: Rect): VerticalResizeEdge {
    return Math.round(newRect.y) !== Math.round(oldRect.y) ? 'top' : 'bottom';
}

/** Rect equality after rounding — KWin/Wayland can report fractional geometry. */
export function rectsEqualRounded(a: Rect, b: Rect): boolean {
    return (
        Math.round(a.x) === Math.round(b.x) &&
        Math.round(a.y) === Math.round(b.y) &&
        Math.round(a.width) === Math.round(b.width) &&
        Math.round(a.height) === Math.round(b.height)
    );
}

export type EdgeDirection = 'above' | 'below';

/** Which screen edge, if any, `pointerY` is within `borderWidth` pixels of, inside `area`'s
 * vertical bounds — used to detect the mouse pointer dragged to the strip's top/bottom edge,
 * the trigger for a cross-row drag (docs: 2026-09-02-cross-row-drag-design). Driven by the
 * pointer rather than the dragged window's own frame geometry, since the window is typically
 * grabbed away from its center (e.g. near the titlebar), so its far edge crosses the boundary
 * well before the pointer does. Checks "at or within the border", not "past" it: the OS clamps
 * the pointer to the screen, so it can never actually go past an edge the way an unclamped
 * dragged window's geometry can. `null` when `pointerY` is outside the border on both sides. */
export function edgeDirection(pointerY: number, area: Rect, borderWidth: number): EdgeDirection | null {
    if (pointerY <= area.y + borderWidth) {
        return 'above';
    }
    if (pointerY >= area.y + area.height - borderWidth) {
        return 'below';
    }
    return null;
}
