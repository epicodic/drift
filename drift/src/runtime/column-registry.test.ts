import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import { SignalManager } from '../utils/signal-manager';
import { ColumnRegistry } from './column-registry';

function fakeWindow(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

describe('ColumnRegistry', () => {
    it('maps a (column, tile) pair to its window', () => {
        const registry = new ColumnRegistry();
        const win = fakeWindow('w1');

        registry.set(1, 1, win, new SignalManager());

        expect(registry.get(1, 1)).toBe(win);
        expect(registry.get(1, 2)).toBeUndefined();
        expect(registry.get(2, 1)).toBeUndefined();
    });

    it('supports more than one tile under the same column', () => {
        const registry = new ColumnRegistry();
        const top = fakeWindow('top');
        const bottom = fakeWindow('bottom');
        registry.set(1, 1, top, new SignalManager());
        registry.set(1, 2, bottom, new SignalManager());

        expect(registry.get(1, 1)).toBe(top);
        expect(registry.get(1, 2)).toBe(bottom);
        expect(registry.windowsInColumn(1)).toEqual(expect.arrayContaining([top, bottom]));
        expect(registry.windowsInColumn(1)).toHaveLength(2);
    });

    it('finds the (column, tile) location for a window id via tileOf, and columnOf as a convenience', () => {
        const registry = new ColumnRegistry();
        registry.set(1, 1, fakeWindow('w1'), new SignalManager());
        registry.set(2, 1, fakeWindow('w2'), new SignalManager());

        expect(registry.tileOf('w2')).toEqual({ columnId: 2, tileId: 1 });
        expect(registry.tileOf('missing')).toBeNull();
        expect(registry.columnOf('w2')).toBe(2);
        expect(registry.columnOf('missing')).toBeNull();
    });

    it('moveWindow relocates a window between (column, tile) slots without destroying its signals', () => {
        const registry = new ColumnRegistry();
        const signals = new SignalManager();
        const disconnect = vi.fn();
        signals.add(disconnect);
        const win = fakeWindow('w1');
        registry.set(1, 1, win, signals);

        registry.moveWindow(1, 1, 2, 5);

        expect(registry.get(1, 1)).toBeUndefined();
        expect(registry.get(2, 5)).toBe(win);
        expect(disconnect).not.toHaveBeenCalled();
    });

    it("deleteTile destroys that tile's signals and leaves sibling tiles alone", () => {
        const registry = new ColumnRegistry();
        const topSignals = new SignalManager();
        const topDisconnect = vi.fn();
        topSignals.add(topDisconnect);
        registry.set(1, 1, fakeWindow('top'), topSignals);
        registry.set(1, 2, fakeWindow('bottom'), new SignalManager());

        registry.deleteTile(1, 1);

        expect(topDisconnect).toHaveBeenCalledTimes(1);
        expect(registry.get(1, 1)).toBeUndefined();
        expect(registry.get(1, 2)).toBeDefined();
    });

    it("deleteColumn destroys every tile's signals under that column", () => {
        const registry = new ColumnRegistry();
        const disconnectA = vi.fn();
        const disconnectB = vi.fn();
        const signalsA = new SignalManager();
        signalsA.add(disconnectA);
        const signalsB = new SignalManager();
        signalsB.add(disconnectB);
        registry.set(1, 1, fakeWindow('a'), signalsA);
        registry.set(1, 2, fakeWindow('b'), signalsB);

        registry.deleteColumn(1);

        expect(disconnectA).toHaveBeenCalledTimes(1);
        expect(disconnectB).toHaveBeenCalledTimes(1);
        expect(registry.windowsInColumn(1)).toEqual([]);
    });

    it('reports empty only when it holds no columns', () => {
        const registry = new ColumnRegistry();
        expect(registry.isEmpty()).toBe(true);

        registry.set(1, 1, fakeWindow('w1'), new SignalManager());
        expect(registry.isEmpty()).toBe(false);

        registry.deleteColumn(1);
        expect(registry.isEmpty()).toBe(true);
    });

    it('lists every registered window across every column and tile', () => {
        const registry = new ColumnRegistry();
        const w1 = fakeWindow('w1');
        const w2 = fakeWindow('w2');
        registry.set(1, 1, w1, new SignalManager());
        registry.set(2, 1, w2, new SignalManager());

        expect(registry.windows()).toEqual(expect.arrayContaining([w1, w2]));
        expect(registry.windows()).toHaveLength(2);
    });
});
