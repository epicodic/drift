import { describe, expect, it, vi } from 'vitest';
import { SignalManager } from './signal-manager';

describe('SignalManager', () => {
    it('calls every registered disconnect on destroy', () => {
        const a = vi.fn();
        const b = vi.fn();
        const signals = new SignalManager();
        signals.add(a);
        signals.add(b);

        signals.destroy();

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('does not call disconnects again on a second destroy', () => {
        const a = vi.fn();
        const signals = new SignalManager();
        signals.add(a);

        signals.destroy();
        signals.destroy();

        expect(a).toHaveBeenCalledTimes(1);
    });
});
