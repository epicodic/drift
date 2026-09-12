import { describe, expect, it } from 'vitest';
import { dragPanHolding } from './drag-pan';

describe('dragPanHolding', () => {
    it('is not holding before the vertical trigger is reached', () => {
        expect(dragPanHolding(19, 0, 20, 10)).toBe(false);
    });

    it('is holding once the vertical trigger is exactly reached, with no drift yet', () => {
        expect(dragPanHolding(20, 0, 20, 10)).toBe(true);
    });

    it('is holding once the vertical trigger is exceeded, with no drift yet', () => {
        expect(dragPanHolding(50, 0, 20, 10)).toBe(true);
    });

    it('stays holding while horizontal drift is under the tolerance', () => {
        expect(dragPanHolding(50, 9, 20, 10)).toBe(true);
        expect(dragPanHolding(50, -9, 20, 10)).toBe(true);
    });

    it('still holds when horizontal drift exactly equals the tolerance (inclusive boundary)', () => {
        expect(dragPanHolding(50, 10, 20, 10)).toBe(true);
        expect(dragPanHolding(50, -10, 20, 10)).toBe(true);
    });

    it('cancels the hold once horizontal drift exceeds the tolerance', () => {
        expect(dragPanHolding(50, 25, 20, 10)).toBe(false);
    });

    it('always holds at zero drift regardless of tolerance, once past the trigger', () => {
        expect(dragPanHolding(50, 0, 20, 0)).toBe(true);
    });
});
