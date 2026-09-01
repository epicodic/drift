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
    columns: { id: number; width: number; hidden: boolean }[];
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
        const column = new Column(this.nextId++, width);
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

    columnRect(id: number): Rect {
        const column = this.requireColumn(id);
        if (column.hidden) {
            throw new Error(`Column ${id} is hidden`);
        }
        const offset = this.layoutOffsets()[this.indexOf(id)];
        return columnRect(offset, column.width, this.height);
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

    indexOf(id: number): number {
        return this.ordered.findIndex((column) => column.id === id);
    }

    /** Raw internal state for the debug console (docs §8) — not used by layout logic. */
    debugState(): GridDebugState {
        return {
            focusedColumnId: this.focusedColumnId,
            nextId: this.nextId,
            originX: this.originX,
            columns: this.ordered.map((column) => ({ id: column.id, width: column.width, hidden: column.hidden })),
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
