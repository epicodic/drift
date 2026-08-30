import { describe, expect, it, vi } from 'vitest';
import type { WindowAdapter } from '../kwin/window-adapter';
import { SignalManager } from '../utils/signal-manager';
import { ColumnRegistry } from './column-registry';

function fakeWindow(id: string): WindowAdapter {
    return { id } as unknown as WindowAdapter;
}

describe('ColumnRegistry', () => {
    it('maps a column id to its window', () => {
        const registry = new ColumnRegistry();
        const win = fakeWindow('w1');

        registry.set(1, win, new SignalManager());

        expect(registry.get(1)).toBe(win);
    });

    it('finds the column id for a window id', () => {
        const registry = new ColumnRegistry();
        registry.set(1, fakeWindow('w1'), new SignalManager());
        registry.set(2, fakeWindow('w2'), new SignalManager());

        expect(registry.columnOf('w2')).toBe(2);
        expect(registry.columnOf('missing')).toBeNull();
    });

    it('destroys the window signals when a column is deleted', () => {
        const registry = new ColumnRegistry();
        const signals = new SignalManager();
        const disconnect = vi.fn();
        signals.add(disconnect);
        registry.set(1, fakeWindow('w1'), signals);

        registry.delete(1);

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(registry.get(1)).toBeUndefined();
    });
});
