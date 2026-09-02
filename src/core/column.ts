// A single column in the strip: identity, width, and an ordered vertical stack of
// tiles. A column with exactly one tile behaves exactly like a plain single-window
// column (docs: 2026-09-03-vertical-tiling-design).

import type { Rect, VerticalResizeEdge } from './coordinates';

function assertPositiveWidth(width: number): void {
    if (!(width > 0)) {
        throw new Error(`Column width must be positive, got ${width}`);
    }
}

function assertPositiveHeight(height: number): void {
    if (!(height > 0)) {
        throw new Error(`Tile height must be positive, got ${height}`);
    }
}

export interface Tile {
    readonly id: number;
    height: number;
}

export class Column {
    private columnWidth: number;
    private isHidden = false;
    private readonly stack: Tile[] = [];
    private nextTileId = 1;
    private focusedTile: number;

    constructor(
        public readonly id: number,
        width: number,
        height: number,
    ) {
        assertPositiveWidth(width);
        assertPositiveHeight(height);
        this.columnWidth = width;
        const firstId = this.nextTileId++;
        this.stack.push({ id: firstId, height });
        this.focusedTile = firstId;
    }

    get width(): number {
        return this.columnWidth;
    }

    setWidth(width: number): void {
        assertPositiveWidth(width);
        this.columnWidth = width;
    }

    /** True while the column's window is minimized (docs: minimized-windows design). */
    get hidden(): boolean {
        return this.isHidden;
    }

    setHidden(hidden: boolean): void {
        this.isHidden = hidden;
    }

    /** Every tile in the stack, top to bottom. A plain column has exactly one. */
    tiles(): readonly Tile[] {
        return this.stack.slice();
    }

    tileCount(): number {
        return this.stack.length;
    }

    get focusedTileId(): number {
        return this.focusedTile;
    }

    setFocusedTile(id: number): void {
        this.requireTileIndex(id);
        this.focusedTile = id;
    }

    /** Appends a new tile at the bottom of the stack (absorb), splitting height evenly
     * across every tile including the new one. Does not change which tile is focused.
     * Returns the new tile's id. */
    addTile(): number {
        const totalHeight = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const evenHeight = totalHeight / (this.stack.length + 1);
        for (const tile of this.stack) {
            tile.height = evenHeight;
        }
        const id = this.nextTileId++;
        this.stack.push({ id, height: evenHeight });
        return id;
    }

    /** Removes a tile (expel), redistributing its height proportionally to the rest.
     * Reassigns focus to the nearest remaining tile if the removed one was focused.
     * Throws if `id` is the column's only tile — callers must check `tileCount() > 1`
     * first (expel is a no-op on a 1-tile column, docs: 2026-09-03-vertical-tiling-design). */
    removeTile(id: number): void {
        if (this.stack.length <= 1) {
            throw new Error('Cannot remove the last tile in a column');
        }
        const index = this.requireTileIndex(id);
        const [removed] = this.stack.splice(index, 1);
        const remainingHeight = this.stack.reduce((sum, tile) => sum + tile.height, 0);
        const scale = (remainingHeight + removed.height) / remainingHeight;
        for (const tile of this.stack) {
            tile.height *= scale;
        }
        if (this.focusedTile === id) {
            this.focusedTile = this.stack[Math.min(index, this.stack.length - 1)].id;
        }
    }

    /** Resizes one tile, taking the delta from its neighbor on the moved edge's side —
     * heights always sum to the column's fixed total, there is no "grow the column"
     * option vertically the way `Grid.resizeColumn` has horizontally. A no-op if there
     * is no neighbor on that side (resizing past the top/bottom of the stack); throws
     * if the resize would push either tile to zero or below. */
    resizeTile(id: number, height: number, edge: VerticalResizeEdge = 'bottom'): void {
        assertPositiveHeight(height);
        const index = this.requireTileIndex(id);
        const neighborIndex = edge === 'top' ? index - 1 : index + 1;
        const neighbor = this.stack[neighborIndex];
        if (neighbor === undefined) {
            return;
        }
        const delta = height - this.stack[index].height;
        const neighborHeight = neighbor.height - delta;
        assertPositiveHeight(neighborHeight);
        this.stack[index].height = height;
        neighbor.height = neighborHeight;
    }

    /** Derives a tile's y/height sub-rect from the column's own full rect (from
     * `Grid.columnRect`). Tiles sit back to back with no vertical gap this pass. */
    tileRect(id: number, columnRect: Rect): Rect {
        const index = this.requireTileIndex(id);
        let y = columnRect.y;
        for (let i = 0; i < index; i++) {
            y += this.stack[i].height;
        }
        return {
            x: columnRect.x,
            y,
            width: columnRect.width,
            height: this.stack[index].height,
        };
    }

    /** Moves tile focus up (toward the top of the stack). No-op at the top. */
    focusUp(): void {
        this.moveTileFocus(-1);
    }

    /** Moves tile focus down (toward the bottom of the stack). No-op at the bottom. */
    focusDown(): void {
        this.moveTileFocus(1);
    }

    private moveTileFocus(step: number): void {
        const index = this.stack.findIndex((tile) => tile.id === this.focusedTile);
        const target = index + step;
        if (target < 0 || target >= this.stack.length) {
            return;
        }
        this.focusedTile = this.stack[target].id;
    }

    private requireTileIndex(id: number): number {
        const index = this.stack.findIndex((tile) => tile.id === id);
        if (index === -1) {
            throw new Error(`Unknown tile id: ${id}`);
        }
        return index;
    }
}
