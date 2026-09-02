// The column-id <-> window mapping for a single strip, plus ownership of each
// window's SignalManager. Replaces main.ts's loose `windowsByColumn` map and the
// linear-scan `columnOf()`; deleting a column tears down its signals in one call.

import type { WindowAdapter } from '../kwin/window-adapter';
import type { SignalManager } from '../utils/signal-manager';

interface Entry {
    window: WindowAdapter;
    signals: SignalManager;
}

export class ColumnRegistry {
    private readonly byColumn = new Map<number, Entry>();

    set(columnId: number, window: WindowAdapter, signals: SignalManager): void {
        this.byColumn.set(columnId, { window, signals });
    }

    get(columnId: number): WindowAdapter | undefined {
        return this.byColumn.get(columnId)?.window;
    }

    columnOf(windowId: string): number | null {
        for (const [columnId, entry] of this.byColumn) {
            if (entry.window.id === windowId) {
                return columnId;
            }
        }
        return null;
    }

    isEmpty(): boolean {
        return this.byColumn.size === 0;
    }

    windows(): WindowAdapter[] {
        return Array.from(this.byColumn.values(), (entry) => entry.window);
    }

    delete(columnId: number): void {
        const entry = this.byColumn.get(columnId);
        if (entry === undefined) {
            return;
        }
        entry.signals.destroy();
        this.byColumn.delete(columnId);
    }
}
