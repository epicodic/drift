// Virtual coordinate system for a single horizontal strip of columns.
// Pure math, no KWin dependency: the area's horizontal extent is a function of
// the column widths, so growth/shrink falls out of recomputing these values.

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Cumulative x-offset of each column, starting at 0, with `gap` between columns. */
export function columnOffsets(widths: readonly number[], gap: number): number[] {
    const offsets: number[] = [];
    let cursor = 0;
    for (let i = 0; i < widths.length; i++) {
        offsets.push(cursor);
        cursor += widths[i] + gap;
    }
    return offsets;
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
