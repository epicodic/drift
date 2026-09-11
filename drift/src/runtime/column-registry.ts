// Maps (columnId, tileId) pairs to the live WindowAdapter tiled there, plus that
// window's signal connections — the only place runtime code holds a KWin window
// reference per tile (docs: 2026-09-03-vertical-tiling-design).

import type { WindowAdapter } from '../kwin/window-adapter';
import type { SignalManager } from '../utils/signal-manager';

interface Entry {
    window: WindowAdapter;
    signals: SignalManager;
}

export interface TileLocation {
    columnId: number;
    tileId: number;
}

export class ColumnRegistry {
    private readonly byColumn = new Map<number, Map<number, Entry>>();

    set(columnId: number, tileId: number, window: WindowAdapter, signals: SignalManager): void {
        let tiles = this.byColumn.get(columnId);
        if (tiles === undefined) {
            tiles = new Map();
            this.byColumn.set(columnId, tiles);
        }
        tiles.set(tileId, { window, signals });
    }

    get(columnId: number, tileId: number): WindowAdapter | undefined {
        return this.byColumn.get(columnId)?.get(tileId)?.window;
    }

    tileOf(windowId: string): TileLocation | null {
        for (const [columnId, tiles] of this.byColumn) {
            for (const [tileId, entry] of tiles) {
                if (entry.window.id === windowId) {
                    return { columnId, tileId };
                }
            }
        }
        return null;
    }

    columnOf(windowId: string): number | null {
        return this.tileOf(windowId)?.columnId ?? null;
    }

    /** Every window registered under a column, in no particular tile order — used
     * where a whole column is being torn down or moved as a unit. */
    windowsInColumn(columnId: number): WindowAdapter[] {
        const tiles = this.byColumn.get(columnId);
        return tiles === undefined ? [] : Array.from(tiles.values(), (entry) => entry.window);
    }

    isEmpty(): boolean {
        return this.byColumn.size === 0;
    }

    windows(): WindowAdapter[] {
        const result: WindowAdapter[] = [];
        for (const tiles of this.byColumn.values()) {
            for (const entry of tiles.values()) {
                result.push(entry.window);
            }
        }
        return result;
    }

    /** Moves one window's registration between (column, tile) slots, preserving its
     * signal connections — used by absorb/expel, which relocate a window between
     * column-hood and tile-hood without tearing down its listeners. */
    moveWindow(fromColumnId: number, fromTileId: number, toColumnId: number, toTileId: number): void {
        const tiles = this.byColumn.get(fromColumnId);
        if (tiles === undefined) {
            return;
        }
        const entry = tiles.get(fromTileId);
        if (entry === undefined) {
            return;
        }
        tiles.delete(fromTileId);
        if (tiles.size === 0) {
            this.byColumn.delete(fromColumnId);
        }
        this.set(toColumnId, toTileId, entry.window, entry.signals);
    }

    deleteTile(columnId: number, tileId: number): void {
        const tiles = this.byColumn.get(columnId);
        if (tiles === undefined) {
            return;
        }
        const entry = tiles.get(tileId);
        if (entry === undefined) {
            return;
        }
        entry.signals.destroy();
        tiles.delete(tileId);
        if (tiles.size === 0) {
            this.byColumn.delete(columnId);
        }
    }

    deleteColumn(columnId: number): void {
        const tiles = this.byColumn.get(columnId);
        if (tiles === undefined) {
            return;
        }
        for (const entry of tiles.values()) {
            entry.signals.destroy();
        }
        this.byColumn.delete(columnId);
    }
}
