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

/** Which screen edge, if any, `rect` has crossed past within `area`'s vertical bounds — used
 * to detect a window dragged past the strip's top/bottom edge, the trigger for a cross-row
 * drag (docs: 2026-09-02-cross-row-drag-design). `null` when `rect` is still fully within
 * `area` vertically. */
export function edgeDirection(rect: Rect, area: Rect): EdgeDirection | null {
    if (rect.y < area.y) {
        return 'above';
    }
    if (rect.y + rect.height > area.y + area.height) {
        return 'below';
    }
    return null;
}
