// The layout model: an ordered horizontal strip of columns. Pure and KWin-free.
// Positions are always derived from column order and width, so adding, removing,
// or resizing a column shifts its neighbors and grows/shrinks the virtual area
// without any gaps (docs §2.1, requirements 5 and 12).

import { Column } from './column';
import { columnRect, Rect, ResizeEdge } from './coordinates';

/** Width in pixels allocated to hidden columns for layout spacing (prevents taskbar confusion). */
const HIDDEN_COLUMN_WIDTH = 1;

export interface GridDebugState {
    focusedColumnId: number | null;
    nextId: number;
    originX: number;
    columns: { id: number; width: number; hidden: boolean; tileCount: number }[];
}

/** A column-sized hole in the layout standing in for a dragged stack tile: previewed as if the
 * tile were already a standalone column at `index`, so the columns after it slide over to make
 * room (docs: 2026-09-18-drag-stack-phantom-design). */
export interface PhantomColumn {
    /** The insertion position in the column order, as `moveColumn` takes it; must be in `[0, columns().length]`. */
    index: number;
    width: number;
}

/** One position in a laid-out column order — a real column (`columnId`) or the phantom (`null`).
 * `width` is the layout width (hidden columns take `HIDDEN_COLUMN_WIDTH`), matching what
 * `insertionIndexForSlots` thresholds against. */
export interface LayoutSlot {
    columnId: number | null;
    offset: number;
    width: number;
    hidden: boolean;
}

/** The horizontal layout `Strip.render` shows: every slot in order, each real column's rect (at
 * its real width, like `columnRect`), and the resulting virtual width. */
export interface PreviewLayout {
    slots: LayoutSlot[];
    rects: Map<number, Rect>;
    virtualWidth: number;
}

/** Index of the nearest non-hidden slot from `index` in direction `step`, or null at the edge. */
export function visibleNeighborSlot(slots: readonly LayoutSlot[], index: number, step: 1 | -1): number | null {
    for (let i = index + step; i >= 0 && i < slots.length; i += step) {
        if (!slots[i].hidden) {
            return i;
        }
    }
    return null;
}

/** Where the slot at `index` should move given the dragged window's own edges: the right
 * neighbor's index once `rightEdgeVirtualX` penetrates `thresholdFraction` of that neighbor's
 * width, the left neighbor's index symmetrically, else `index` itself. Pure over a slot list so
 * it serves both a real column (`Grid.insertionIndexForEdges`) and a phantom in a preview layout
 * (docs: 2026-09-07-drag-reorder-stack-refinement-design, 2026-09-18-drag-stack-phantom-design). */
export function insertionIndexForSlots(
    slots: readonly LayoutSlot[],
    index: number,
    leftEdgeVirtualX: number,
    rightEdgeVirtualX: number,
    thresholdFraction: number,
): number {
    const rightIndex = visibleNeighborSlot(slots, index, 1);
    if (
        rightIndex !== null &&
        rightEdgeVirtualX > slots[rightIndex].offset + slots[rightIndex].width * thresholdFraction
    ) {
        return rightIndex;
    }
    const leftIndex = visibleNeighborSlot(slots, index, -1);
    // `offset + width - width * f`, not `offset + width * (1 - f)`: `1 - 0.85` is inexact in
    // IEEE 754, so 300 * (1 - 0.85) is 45.00000000000001 and misfires on an exact-integer edge.
    if (
        leftIndex !== null &&
        leftEdgeVirtualX < slots[leftIndex].offset + slots[leftIndex].width - slots[leftIndex].width * thresholdFraction
    ) {
        return leftIndex;
    }
    return index;
}

export class Grid {
    private readonly ordered: Column[] = [];
    private focusedColumnId: number | null = null;
    private nextId = 1;
    private originX = 0;

    constructor(
        private height: number,
        private readonly gap: number = 0,
        private readonly rowGap: number = 0,
    ) {}

    columns(): readonly Column[] {
        return this.ordered.slice();
    }

    /** The strip's screen height — every column's rect uses this same value (see
     * `columnRect`), so a consumer needing the real aspect ratio without an existing
     * column (the minimap's live thumbnails) can read it directly (docs:
     * 2026-09-01-minimap-thumbnails-design). Normally constant for the life of the
     * grid; `setHeight` exists only for the work area changing after startup (a
     * panel/dock resizing, or the initial KWin startup race with panel registration). */
    screenHeight(): number {
        return this.height;
    }

    /** Also rescales every existing column's tiles proportionally (see `Column.rescaleHeight`)
     * so already-tiled windows fill the new height too, not just columns created afterward. */
    setHeight(height: number): void {
        if (height === this.height) {
            return;
        }
        this.height = height;
        for (const column of this.ordered) {
            column.rescaleHeight(height);
        }
    }

    focusedColumn(): Column | null {
        if (this.focusedColumnId === null) {
            return null;
        }
        return this.columnById(this.focusedColumnId);
    }

    setFocus(id: number): void {
        this.requireIndex(id);
        this.focusedColumnId = id;
    }

    /** Adds a column to the right of the focused one (or at the end) and focuses it. */
    addColumn(width: number): Column {
        const column = new Column(this.nextId++, width, this.height, this.rowGap);
        const insertAt = this.focusedColumnId === null ? this.ordered.length : this.indexOf(this.focusedColumnId) + 1;
        this.ordered.splice(insertAt, 0, column);
        this.focusedColumnId = column.id;
        return column;
    }

    /** Removes a column and reassigns focus to the nearest visible column. */
    removeColumn(id: number): void {
        const index = this.requireIndex(id);
        this.ordered.splice(index, 1);
        if (this.focusedColumnId !== id) {
            return;
        }
        const next = this.nearestVisibleFrom(index);
        this.focusedColumnId = next ? next.id : null;
    }

    /** Hides a column's window (e.g. minimized) without removing it from the strip:
     * it keeps its place in `columns()` but stops contributing width/gap to layout. */
    hideColumn(id: number): void {
        this.requireColumn(id).setHidden(true);
    }

    /** Reverses `hideColumn` — the column resumes contributing to layout at its same position. */
    showColumn(id: number): void {
        this.requireColumn(id).setHidden(false);
    }

    isHidden(id: number): boolean {
        return this.requireColumn(id).hidden;
    }

    resizeColumn(id: number, width: number, edge: ResizeEdge = 'right'): void {
        const column = this.requireColumn(id);
        const delta = width - column.width;
        column.setWidth(width);
        if (edge === 'left') {
            this.originX -= delta;
        }
    }

    moveColumn(id: number, toIndex: number): void {
        const from = this.requireIndex(id);
        const [column] = this.ordered.splice(from, 1);
        this.ordered.splice(toIndex, 0, column);
    }

    focusLeft(): Column | null {
        return this.moveFocus(-1);
    }

    focusRight(): Column | null {
        return this.moveFocus(1);
    }

    /** Jumps focus directly to the first visible column, regardless of current focus —
     * unlike `focusLeft`, which walks one column at a time. No-op if already there, or if
     * there is no focused column at all (empty grid). */
    focusFirst(): Column | null {
        return this.focusEdge(0, 1);
    }

    /** Jumps focus directly to the last visible column — see `focusFirst`. */
    focusLast(): Column | null {
        return this.focusEdge(this.ordered.length - 1, -1);
    }

    virtualWidth(): number {
        return this.previewLayout().virtualWidth;
    }

    contentLeft(): number {
        return this.originX;
    }

    /** Also well-defined for a hidden column: its 1px-slot offset (see `previewLayout`)
     * paired with its real (unshrunk) width — lets `Strip.render()` keep a minimized
     * window's real on-screen x tracking the viewport instead of freezing it. */
    columnRect(id: number): Rect {
        this.requireColumn(id);
        const rect = this.previewLayout().rects.get(id);
        if (rect === undefined) {
            throw new Error(`Column ${id} has no layout rect`);
        }
        return rect;
    }

    /** Lays every column out in order, with `phantom` inserted at `phantom.index` when given —
     * the columns at or after that index shift right by `phantom.width + gap`. Pure: the grid
     * itself is untouched. Every other layout query on this class is derived from it. */
    previewLayout(phantom?: PhantomColumn): PreviewLayout {
        const entries: { columnId: number | null; width: number; realWidth: number; hidden: boolean }[] =
            this.ordered.map((column) => ({
                columnId: column.id,
                width: column.hidden ? HIDDEN_COLUMN_WIDTH : column.width,
                realWidth: column.width,
                hidden: column.hidden,
            }));
        if (phantom !== undefined) {
            entries.splice(phantom.index, 0, {
                columnId: null,
                width: phantom.width,
                realWidth: phantom.width,
                hidden: false,
            });
        }
        const slots: LayoutSlot[] = [];
        const rects = new Map<number, Rect>();
        let cursor = this.originX;
        entries.forEach((entry, index) => {
            slots.push({ columnId: entry.columnId, offset: cursor, width: entry.width, hidden: entry.hidden });
            if (entry.columnId !== null) {
                rects.set(entry.columnId, columnRect(cursor, entry.realWidth, this.height));
            }
            cursor += entry.width;
            if (!entry.hidden && index < entries.length - 1) {
                cursor += this.gap;
            }
        });
        const last = slots[slots.length - 1];
        return { slots, rects, virtualWidth: last === undefined ? 0 : last.offset + last.width - this.originX };
    }

    /** Target `moveColumn` index for the dragged column `excludeId`, judged by its
     * own leading edges rather than its center: it trades places with its current
     * immediate right neighbor once its own right edge crosses `thresholdFraction`
     * of the way into that neighbor (measured from their shared boundary), or with
     * its immediate left neighbor symmetrically. `thresholdFraction = 0.5` is a
     * plain center-crossing swap; a higher fraction requires the drag to travel
     * further into the neighbor before firing — near its final post-swap position
     * rather than merely past the halfway point (docs:
     * 2026-09-07-drag-reorder-stack-refinement-design). Hidden columns are skipped
     * when looking for a neighbor. Returns `excludeId`'s own current index (i.e. no
     * move) when neither immediate neighbor has been crossed. */
    insertionIndexForEdges(
        excludeId: number,
        leftEdgeVirtualX: number,
        rightEdgeVirtualX: number,
        thresholdFraction: number,
    ): number {
        return insertionIndexForSlots(
            this.previewLayout().slots,
            this.requireIndex(excludeId),
            leftEdgeVirtualX,
            rightEdgeVirtualX,
            thresholdFraction,
        );
    }

    /** Ids of `columnId`'s immediate visible left/right neighbors (skipping hidden
     * columns), in the same "immediate neighbor" sense `insertionIndexForEdges`
     * uses — `[left, right]` with either side omitted if it has no visible
     * neighbor. Used by drag-to-stack to gather cross-column stack candidates
     * without a pointer-position column lookup (docs:
     * 2026-09-07-drag-reorder-stack-refinement-design). */
    visibleNeighborColumnIds(columnId: number): number[] {
        const slots = this.previewLayout().slots;
        const index = this.requireIndex(columnId);
        const ids: number[] = [];
        for (const step of [-1, 1] as const) {
            const neighbor = visibleNeighborSlot(slots, index, step);
            const id = neighbor === null ? null : slots[neighbor].columnId;
            if (id !== null) {
                ids.push(id);
            }
        }
        return ids;
    }

    indexOf(id: number): number {
        return this.ordered.findIndex((column) => column.id === id);
    }

    /** Direct access to a column instance for callers that need its per-tile methods
     * (Strip) — unlike the rest of Grid's API, which is id-based. Null if unknown. */
    column(id: number): Column | null {
        return this.columnById(id);
    }

    /** Absorb: pull the column immediately to the right of `columnId` into its stack,
     * appended as a new tile. Null (no-op) if there is no right neighbor, or it
     * already holds more than one tile (docs: 2026-09-03-vertical-tiling-design). */
    absorbColumnRight(columnId: number): { fromColumnId: number; fromTileId: number; toTileId: number } | null {
        const index = this.requireIndex(columnId);
        const rightIndex = visibleNeighborSlot(this.previewLayout().slots, index, 1);
        if (rightIndex === null) {
            return null;
        }
        const rightColumn = this.ordered[rightIndex];
        if (rightColumn.tileCount() !== 1) {
            return null;
        }
        const targetColumn = this.ordered[index];
        const fromTileId = rightColumn.tiles()[0].id;
        this.ordered.splice(rightIndex, 1);
        const toTileId = targetColumn.addTile();
        return { fromColumnId: rightColumn.id, fromTileId, toTileId };
    }

    /** Removes `fromTileId` from `fromColumnId` (deleting that column entirely if it
     * was its only tile) and inserts it as a new tile at `slot` in `toColumnId` — the
     * general form of `absorbColumnRight`, for any source/target pair and slot,
     * driven by a live drag rather than a fixed keyboard shortcut. `fromColumnId` and
     * `toColumnId` must differ — same-column reordering uses `Column.moveTile`
     * directly instead, which preserves the tile's own identity and height
     * (docs: 2026-09-03-drag-to-stack-design). Returns the new tile's id. */
    moveTileIntoColumn(fromColumnId: number, fromTileId: number, toColumnId: number, slot: number): number {
        if (fromColumnId === toColumnId) {
            throw new Error('Cannot move a tile into its own column');
        }
        const fromColumn = this.requireColumn(fromColumnId);
        if (fromColumn.tileCount() === 1) {
            this.removeColumn(fromColumnId);
        } else {
            fromColumn.removeTile(fromTileId);
        }
        const toColumn = this.requireColumn(toColumnId);
        return toColumn.insertTileAt(slot);
    }

    /** Moves `tileId` out of `columnId` into a brand-new standalone column of `newColumnWidth`,
     * inserted after the focused column and focused (see `addColumn`). Returns null (no-op) for a
     * single-tile column. The caller positions the new column with `moveColumn` if it belongs
     * somewhere else (docs: 2026-09-18-drag-stack-phantom-design). */
    expelTile(
        columnId: number,
        tileId: number,
        newColumnWidth: number,
    ): { toColumnId: number; toTileId: number } | null {
        const column = this.requireColumn(columnId);
        if (column.tileCount() <= 1) {
            return null;
        }
        column.removeTile(tileId);
        const newColumn = this.addColumn(newColumnWidth);
        return { toColumnId: newColumn.id, toTileId: newColumn.tiles()[0].id };
    }

    /** `expelTile` applied to `columnId`'s focused tile, also reporting which tile moved. */
    expelFocusedTile(
        columnId: number,
        newColumnWidth: number,
    ): { fromTileId: number; toColumnId: number; toTileId: number } | null {
        const fromTileId = this.requireColumn(columnId).focusedTileId;
        const result = this.expelTile(columnId, fromTileId, newColumnWidth);
        return result === null ? null : { fromTileId, toColumnId: result.toColumnId, toTileId: result.toTileId };
    }

    /** Raw internal state for the debug console (docs §8) — not used by layout logic. */
    debugState(): GridDebugState {
        return {
            focusedColumnId: this.focusedColumnId,
            nextId: this.nextId,
            originX: this.originX,
            columns: this.ordered.map((column) => ({
                id: column.id,
                width: column.width,
                hidden: column.hidden,
                tileCount: column.tileCount(),
            })),
        };
    }

    /** Nearest visible column at or after `index`, else nearest visible before it, else null. */
    private nearestVisibleFrom(index: number): Column | null {
        for (let i = index; i < this.ordered.length; i++) {
            if (!this.ordered[i].hidden) {
                return this.ordered[i];
            }
        }
        for (let i = index - 1; i >= 0; i--) {
            if (!this.ordered[i].hidden) {
                return this.ordered[i];
            }
        }
        return null;
    }

    private moveFocus(step: number): Column | null {
        if (this.focusedColumnId === null) {
            return null;
        }
        const current = this.indexOf(this.focusedColumnId);
        for (let target = current + step; target >= 0 && target < this.ordered.length; target += step) {
            if (!this.ordered[target].hidden) {
                this.focusedColumnId = this.ordered[target].id;
                return this.ordered[target];
            }
        }
        return this.columnById(this.focusedColumnId);
    }

    /** Scans from `start` in direction `step` for the first visible column, skipping
     * hidden ones, and focuses it. Falls back to the current focus if none is found
     * (e.g. every column is hidden), or returns null if there's no focus to fall back to. */
    private focusEdge(start: number, step: number): Column | null {
        if (this.focusedColumnId === null) {
            return null;
        }
        for (let i = start; i >= 0 && i < this.ordered.length; i += step) {
            if (!this.ordered[i].hidden) {
                this.focusedColumnId = this.ordered[i].id;
                return this.ordered[i];
            }
        }
        return this.columnById(this.focusedColumnId);
    }

    private columnById(id: number): Column | null {
        return this.ordered.find((column) => column.id === id) ?? null;
    }

    private requireColumn(id: number): Column {
        const column = this.columnById(id);
        if (column === null) {
            throw new Error(`Unknown column id: ${id}`);
        }
        return column;
    }

    private requireIndex(id: number): number {
        const index = this.indexOf(id);
        if (index === -1) {
            throw new Error(`Unknown column id: ${id}`);
        }
        return index;
    }
}
