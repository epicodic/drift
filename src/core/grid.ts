// The layout model: an ordered horizontal strip of columns. Pure and KWin-free.
// Positions are always derived from column order and width, so adding, removing,
// or resizing a column shifts its neighbors and grows/shrinks the virtual area
// without any gaps (docs §2.1, requirements 5 and 12).

import { Column } from './column';
import { columnOffsets, columnRect, virtualWidth, Rect } from './coordinates';

export class Grid {
    private readonly ordered: Column[] = [];
    private focusedColumnId: number | null = null;
    private nextId = 1;

    constructor(
        private readonly height: number,
        private readonly gap: number = 0,
    ) {}

    columns(): readonly Column[] {
        return this.ordered.slice();
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

    removeColumn(id: number): void {
        const index = this.requireIndex(id);
        this.ordered.splice(index, 1);
        if (this.focusedColumnId !== id) {
            return;
        }
        // Prefer the right neighbor (now at the same index), else the left, else none.
        const next = this.ordered[index] ?? this.ordered[index - 1] ?? null;
        this.focusedColumnId = next ? next.id : null;
    }

    resizeColumn(id: number, width: number): void {
        this.requireColumn(id).setWidth(width);
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
        return virtualWidth(this.widths(), this.gap);
    }

    columnRect(id: number): Rect {
        const index = this.requireIndex(id);
        const offset = columnOffsets(this.widths(), this.gap)[index];
        return columnRect(offset, this.ordered[index].width, this.height);
    }

    indexOf(id: number): number {
        return this.ordered.findIndex((column) => column.id === id);
    }

    private moveFocus(step: number): Column | null {
        if (this.focusedColumnId === null) {
            return null;
        }
        const current = this.indexOf(this.focusedColumnId);
        const target = Math.min(Math.max(current + step, 0), this.ordered.length - 1);
        this.focusedColumnId = this.ordered[target].id;
        return this.ordered[target];
    }

    private widths(): number[] {
        return this.ordered.map((column) => column.width);
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
