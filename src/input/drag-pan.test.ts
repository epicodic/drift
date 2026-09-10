import { describe, expect, it } from 'vitest';
import { dragPanBlend } from './drag-pan';

describe('dragPanBlend', () => {
    it('returns 1 (pure pan) when there has been no vertical movement at all', () => {
        expect(dragPanBlend(0, 40)).toBe(1);
    });

    it('returns 0 once vertical movement reaches the tolerance', () => {
        expect(dragPanBlend(40, 40)).toBe(0);
    });

    it('returns 0 (clamped) once vertical movement exceeds the tolerance', () => {
        expect(dragPanBlend(100, 40)).toBe(0);
    });

    it('returns a linear midpoint blend', () => {
        expect(dragPanBlend(20, 40)).toBe(0.5);
    });

    it('treats a non-positive tolerance as "panning off" for any real movement', () => {
        expect(dragPanBlend(0, 0)).toBe(1);
        expect(dragPanBlend(1, 0)).toBe(0);
        expect(dragPanBlend(1, -5)).toBe(0);
    });
});
