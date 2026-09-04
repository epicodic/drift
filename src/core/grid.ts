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

export class Grid {
    private readonly ordered: Column[] = [];
    private focusedColumnId: number | null = null;
    private nextId = 1;
    private originX = 0;

    constructor(
        private readonly height: number,
        private readonly gap: number = 0,
    ) {}

    columns(): readonly Column[] {
        return this.ordered.slice();
    }

    /** The strip's constant screen height — every column's rect uses this same value
     * (see `columnRect`), so a consumer needing the real aspect ratio without an
     * existing column (the minimap's live thumbnails) can read it directly
     * (docs: 2026-09-01-minimap-thumbnails-design). */
    screenHeight(): number {
        return this.height;
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
        const column = new Column(this.nextId++, width, this.height);
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

    virtualWidth(): number {
        if (this.ordered.length === 0) {
            return 0;
        }
        const lastIndex = this.ordered.length - 1;
        return this.layoutOffsets()[lastIndex] + this.layoutWidths()[lastIndex] - this.originX;
    }

    contentLeft(): number {
        return this.originX;
    }

    /** Also well-defined for a hidden column: its 1px-slot offset (see `layoutOffsets`)
     * paired with its real (unshrunk) width — lets `Strip.render()` keep a minimized
     * window's real on-screen x tracking the viewport instead of freezing it. */
    columnRect(id: number): Rect {
        const column = this.requireColumn(id);
        const offset = this.layoutOffsets()[this.indexOf(id)];
        return columnRect(offset, column.width, this.height);
    }

    /** Id of whichever column's horizontal span currently contains `virtualX` — used
     * to resolve a live drag's hover target. Clamped to the first/last visible column
     * when `virtualX` falls entirely outside the strip's content extent. Null only
     * when the grid has no visible columns at all
     * (docs: 2026-09-03-drag-to-stack-design). */
    columnAtVirtualX(virtualX: number): number | null {
        const offsets = this.layoutOffsets();
        const widths = this.layoutWidths();
        let lastVisible: Column | null = null;
        for (let i = 0; i < this.ordered.length; i++) {
            if (this.ordered[i].hidden) {
                continue;
            }
            lastVisible = this.ordered[i];
            if (virtualX < offsets[i] + widths[i]) {
                return this.ordered[i].id;
            }
        }
        return lastVisible ? lastVisible.id : null;
    }

    /** Target `moveColumn` index for the dragged column `excludeId`, judged by its
     * own leading edges rather than its center: it trades places with its current
     * immediate right neighbor once its own right edge crosses that neighbor's
     * real center, or with its immediate left neighbor once its own left edge
     * crosses that neighbor's real center. Hidden columns are skipped when
     * looking for a neighbor. Returns `excludeId`'s own current index (i.e. no
     * move) when neither immediate neighbor has been crossed. */
    insertionIndexForEdges(excludeId: number, leftEdgeVirtualX: number, rightEdgeVirtualX: number): number {
        const index = this.requireIndex(excludeId);
        const rightIndex = this.visibleNeighborIndex(index, 1);
        if (rightIndex !== null && rightEdgeVirtualX > this.centerAt(rightIndex)) {
            return rightIndex;
        }
        const leftIndex = this.visibleNeighborIndex(index, -1);
        if (leftIndex !== null && leftEdgeVirtualX < this.centerAt(leftIndex)) {
            return leftIndex;
        }
        return index;
    }

    /** Drag-to-stack's equivalent of `insertionIndexForEdges` for a stacked tile dragged
     * toward open space rather than toward a real neighbor: whether `columnId`'s own
     * dragged edge has crossed past its own outer boundary on a side where it has no
     * visible neighbor to reorder against at all. There is no neighbor center to cross
     * on that side, so the column's own edge is the threshold instead. Checked right
     * side first, then left, mirroring `insertionIndexForEdges`'s own priority. Returns
     * null when a visible neighbor exists on both sides, or neither edge has crossed. */
    expelDirectionForEdges(
        columnId: number,
        leftEdgeVirtualX: number,
        rightEdgeVirtualX: number,
    ): 'left' | 'right' | null {
        const index = this.requireIndex(columnId);
        const offsets = this.layoutOffsets();
        const widths = this.layoutWidths();
        if (this.visibleNeighborIndex(index, 1) === null && rightEdgeVirtualX > offsets[index] + widths[index]) {
            return 'right';
        }
        if (this.visibleNeighborIndex(index, -1) === null && leftEdgeVirtualX < offsets[index]) {
            return 'left';
        }
        return null;
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
        const rightIndex = this.visibleNeighborIndex(index, 1);
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

    /** Expel: remove `columnId`'s focused tile and give it a brand-new column
     * immediately to its right, at `newColumnWidth`, focused. Null (no-op) if
     * `columnId` only has one tile — there's nothing to expel. */
    expelFocusedTile(
        columnId: number,
        newColumnWidth: number,
    ): { fromTileId: number; toColumnId: number; toTileId: number } | null {
        const column = this.requireColumn(columnId);
        if (column.tileCount() <= 1) {
            return null;
        }
        const fromTileId = column.focusedTileId;
        column.removeTile(fromTileId);
        const newColumn = this.addColumn(newColumnWidth);
        return { fromTileId, toColumnId: newColumn.id, toTileId: newColumn.tiles()[0].id };
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

    /** Widths for layout calculations: visible columns use their width, hidden use HIDDEN_COLUMN_WIDTH. */
    private layoutWidths(): number[] {
        return this.ordered.map((column) => (column.hidden ? HIDDEN_COLUMN_WIDTH : column.width));
    }

    /** Offset of every column (visible or hidden). The gap only follows a VISIBLE column,
     * so a run of hidden columns fits inside the single surrounding gap instead of
     * bracketing itself with a gap on both sides. */
    private layoutOffsets(): number[] {
        const offsets: number[] = [];
        let cursor = this.originX;
        this.ordered.forEach((column, index) => {
            offsets.push(cursor);
            cursor += column.hidden ? HIDDEN_COLUMN_WIDTH : column.width;
            if (!column.hidden && index < this.ordered.length - 1) {
                cursor += this.gap;
            }
        });
        return offsets;
    }

    /** Real center of the column at `index` in the full ordered list (offset plus half width). */
    private centerAt(index: number): number {
        return this.layoutOffsets()[index] + this.layoutWidths()[index] / 2;
    }

    /** Index of the nearest VISIBLE column strictly in direction `step` (+1 right,
     * -1 left) from `index`, skipping hidden columns, or null if there is none. */
    private visibleNeighborIndex(index: number, step: 1 | -1): number | null {
        for (let i = index + step; i >= 0 && i < this.ordered.length; i += step) {
            if (!this.ordered[i].hidden) {
                return i;
            }
        }
        return null;
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
