import { describe, expect, it } from 'vitest';
import type { Timer } from './animator';
import { SharedTicker } from './shared-ticker';

class FakeTimer implements Timer {
    started = false;
    stopped = false;
    startCount = 0;
    private onTick: (() => void) | null = null;

    start(_intervalMs: number, onTick: () => void): void {
        this.started = true;
        this.stopped = false;
        this.startCount += 1;
        this.onTick = onTick;
    }

    stop(): void {
        this.stopped = true;
        this.onTick = null;
    }

    fire(): void {
        this.onTick?.();
    }
}

describe('SharedTicker', () => {
    it('starts the real timer when one subscriber starts', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);

        ticker.subscribe().start(16, () => {});

        expect(timer.started).toBe(true);
    });

    it('does not restart the real timer when a second subscriber starts', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const first = ticker.subscribe();
        const second = ticker.subscribe();

        first.start(16, () => {});
        second.start(16, () => {});

        expect(timer.startCount).toBe(1);
    });

    it('fires every active subscriber on a single real tick', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        let aCalls = 0;
        let bCalls = 0;
        a.start(16, () => (aCalls += 1));
        b.start(16, () => (bCalls += 1));

        timer.fire();

        expect(aCalls).toBe(1);
        expect(bCalls).toBe(1);
    });

    it('keeps the real timer running when only one of two subscribers stops', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        a.start(16, () => {});
        b.start(16, () => {});

        a.stop();

        expect(timer.stopped).toBe(false);
    });

    it('stops the real timer once every subscriber has stopped', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        a.start(16, () => {});
        b.start(16, () => {});

        a.stop();
        b.stop();

        expect(timer.stopped).toBe(true);
    });

    it('a subscriber that stopped no longer fires on later ticks', () => {
        const timer = new FakeTimer();
        const ticker = new SharedTicker(timer, 16);
        const a = ticker.subscribe();
        const b = ticker.subscribe();
        let aCalls = 0;
        a.start(16, () => (aCalls += 1));
        b.start(16, () => {});

        a.stop();
        timer.fire();

        expect(aCalls).toBe(0);
    });
});
