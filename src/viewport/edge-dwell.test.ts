import { describe, expect, it } from 'vitest';
import type { Timer } from './animator';
import { EdgeDwell } from './edge-dwell';

class FakeTimer implements Timer {
    started = false;
    stopped = false;
    private onTick: (() => void) | null = null;

    start(_intervalMs: number, onTick: () => void): void {
        this.started = true;
        this.stopped = false;
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

describe('EdgeDwell', () => {
    it('does not fire before the dwell duration elapses', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 50;
        timer.fire();

        expect(fired).toEqual([]);
    });

    it('fires once the dwell duration elapses while still armed', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 100;
        timer.fire();

        expect(fired).toEqual(['above']);
    });

    it('disarms after firing, so it does not refire while still held past the same edge', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 100;
        timer.fire();
        clock = 200;
        timer.fire();

        expect(fired).toEqual(['above']);
        expect(timer.stopped).toBe(true);
    });

    it('ignores further same-direction updates after firing, so a continuous drag only flips once (regression)', () => {
        // update() is driven by every drag tick, so a window held past an edge keeps reporting
        // the same direction on every frame — not just once. Firing must not re-arm from those
        // continued reports; only an actual return to null (leaving the zone) may re-arm it.
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 100;
        timer.fire(); // fires and disarms

        dwell.update('above'); // still held past the edge, unmoved - a later drag tick reporting in
        clock = 200;
        timer.fire();

        expect(fired).toEqual(['above']);
    });

    it('fires again after leaving and re-entering the same edge', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 100;
        timer.fire(); // fires and disarms

        dwell.update(null); // pointer back within bounds
        dwell.update('above'); // pointer past the edge again
        clock = 300; // 200ms later, but only 100ms since re-arming
        timer.fire();

        expect(fired).toEqual(['above', 'above']);
    });

    it('disarms and stops the timer when direction returns to null', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        dwell.update(null);
        clock = 100;
        timer.fire();

        expect(fired).toEqual([]);
        expect(timer.stopped).toBe(true);
    });

    it('does not restart the dwell when the same direction is reported again', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 50;
        dwell.update('above'); // still 'above' - must not push armedAt forward to 50
        clock = 100;
        timer.fire();

        expect(fired).toEqual(['above']); // fired at total elapsed 100, not restarted at 50
    });

    it('stop() disarms unconditionally', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        dwell.stop();
        clock = 100;
        timer.fire();

        expect(fired).toEqual([]);
        expect(timer.stopped).toBe(true);
    });

    it('switches direction without passing through null, re-arming for new direction', () => {
        const timer = new FakeTimer();
        let clock = 0;
        const fired: string[] = [];
        const dwell = new EdgeDwell(
            timer,
            () => clock,
            16,
            100,
            (direction) => fired.push(direction),
        );

        dwell.update('above');
        clock = 50;
        dwell.update('below'); // switch direction before dwell elapses
        clock = 150; // 100ms after the switch at clock 50
        timer.fire();

        expect(fired).toEqual(['below']);
    });
});
