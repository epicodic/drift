import { describe, it, expect } from 'vitest';
import { toRealRect } from './geometry-sync';

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
