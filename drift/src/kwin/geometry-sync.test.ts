import { describe, it, expect } from 'vitest';
import { GeometrySync, toRealRect, toVirtualX } from './geometry-sync';
import type { WindowAdapter } from './window-adapter';

function fakeWindow(id: string): WindowAdapter {
    return { id, setFrameGeometry: () => {} } as unknown as WindowAdapter;
}

describe('toRealRect', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };

    it('subtracts the viewport scroll offset from the virtual x', () => {
        expect(toRealRect({ x: 1000, y: 0, width: 300, height: 1080 }, area, 800)).toEqual({
            x: 200,
            y: 0,
            width: 300,
            height: 1080,
        });
    });

    it('adds the area origin so the strip maps onto real screen space', () => {
        const shifted = { x: 1920, y: 0, width: 1920, height: 1080 };
        expect(toRealRect({ x: 0, y: 0, width: 300, height: 1080 }, shifted, 0)).toEqual({
            x: 1920,
            y: 0,
            width: 300,
            height: 1080,
        });
    });

    it('passes width and height through unchanged', () => {
        const rect = toRealRect({ x: 500, y: 0, width: 640, height: 480 }, area, 100);
        expect(rect.width).toBe(640);
        expect(rect.height).toBe(480);
    });

    it('subtracts the vertical viewport offset from the virtual y, defaulting to 0', () => {
        expect(toRealRect({ x: 0, y: 0, width: 300, height: 1080 }, area, 0)).toEqual({
            x: 0,
            y: 0,
            width: 300,
            height: 1080,
        });
        expect(toRealRect({ x: 0, y: 0, width: 300, height: 1080 }, area, 0, 1080)).toEqual({
            x: 0,
            y: -1080,
            width: 300,
            height: 1080,
        });
    });
});

describe('toVirtualX', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };

    it('is the inverse of toRealRect x mapping', () => {
        expect(toVirtualX(200, area, 800)).toBe(1000);
    });

    it('accounts for a non-zero area origin', () => {
        const shifted = { x: 1920, y: 0, width: 1920, height: 1080 };
        expect(toVirtualX(1920, shifted, 0)).toBe(0);
    });

    it('accounts for a zero viewport offset', () => {
        expect(toVirtualX(500, area, 0)).toBe(500);
    });

    it('round-trips through toRealRect for an arbitrary virtual x', () => {
        const virtualRect = { x: 640, y: 0, width: 300, height: 1080 };
        const real = toRealRect(virtualRect, area, 250);
        expect(toVirtualX(real.x, area, 250)).toBe(virtualRect.x);
    });
});

describe('GeometrySync', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };

    it('isEcho recognizes the most recently applied rect', () => {
        const sync = new GeometrySync(area);
        const rect = { x: 0, y: 0, width: 300, height: 1080 };

        sync.apply(fakeWindow('w1'), rect, 0);

        expect(sync.isEcho('w1', rect)).toBe(true);
    });

    it('isEcho returns false for a rect Drift never applied', () => {
        const sync = new GeometrySync(area);

        expect(sync.isEcho('w1', { x: 0, y: 0, width: 300, height: 1080 })).toBe(false);
    });

    it('isEcho recognizes a stale write whose confirming signal arrives after a newer one was already applied', () => {
        // A fast preview animation can call apply() several times before the compositor's
        // frameGeometryChanged signal for the FIRST of those writes comes back — remembering
        // only the latest applied rect would wrongly treat that stale signal as an external
        // resize (docs: 2026-09-07-drag-reorder-stack-refinement-design).
        const sync = new GeometrySync(area);
        const win = fakeWindow('w1');
        const first = { x: 0, y: 0, width: 300, height: 1080 };
        const second = { x: 0, y: 0, width: 300, height: 1200 };

        sync.apply(win, first, 0);
        sync.apply(win, second, 0);

        expect(sync.isEcho('w1', first)).toBe(true);
    });

    it('consuming an older echo also clears anything applied before it for that window', () => {
        const sync = new GeometrySync(area);
        const win = fakeWindow('w1');
        const first = { x: 0, y: 0, width: 300, height: 1080 };
        const second = { x: 0, y: 0, width: 300, height: 1200 };

        sync.apply(win, first, 0);
        sync.apply(win, second, 0);
        sync.isEcho('w1', second);

        expect(sync.isEcho('w1', first)).toBe(false);
    });

    it('does not grow unbounded when the same rect is re-applied every render tick without ever being confirmed', () => {
        const sync = new GeometrySync(area);
        const win = fakeWindow('w1');
        const rect = { x: 0, y: 0, width: 300, height: 1080 };

        for (let i = 0; i < 50; i++) {
            sync.apply(win, rect, 0);
        }

        expect(sync.isEcho('w1', rect)).toBe(true);
        expect(sync.isEcho('w1', rect)).toBe(false); // already consumed, no duplicate entries remained
    });

    it('setArea changes the origin used by later apply() calls', () => {
        const sync = new GeometrySync(area);
        const win = fakeWindow('w1');

        sync.setArea({ x: 0, y: 40, width: 1920, height: 1000 });
        sync.apply(win, { x: 0, y: 0, width: 300, height: 1000 }, 0);

        expect(sync.isEcho('w1', { x: 0, y: 40, width: 300, height: 1000 })).toBe(true);
    });

    it('forget clears any pending applied rects for that window', () => {
        const sync = new GeometrySync(area);
        const win = fakeWindow('w1');
        const rect = { x: 0, y: 0, width: 300, height: 1080 };

        sync.apply(win, rect, 0);
        sync.forget('w1');

        expect(sync.isEcho('w1', rect)).toBe(false);
    });
});
