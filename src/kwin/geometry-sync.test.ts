import { describe, it, expect } from 'vitest';
import { toRealRect, toVirtualX } from './geometry-sync';

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
