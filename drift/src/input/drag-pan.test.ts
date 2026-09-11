import { describe, expect, it } from 'vitest';
import { dragPanShouldPan } from './drag-pan';

describe('dragPanShouldPan', () => {
    it('pans when there has been no vertical movement at all', () => {
        expect(dragPanShouldPan(0, 40)).toBe(true);
    });

    it('pans while vertical movement stays under the tolerance', () => {
        expect(dragPanShouldPan(39, 40)).toBe(true);
    });

    it('stops panning once vertical movement reaches the tolerance', () => {
        expect(dragPanShouldPan(40, 40)).toBe(false);
    });

    it('stops panning once vertical movement exceeds the tolerance', () => {
        expect(dragPanShouldPan(100, 40)).toBe(false);
    });

    it('never pans when the tolerance is non-positive', () => {
        expect(dragPanShouldPan(0, 0)).toBe(false);
        expect(dragPanShouldPan(0, -5)).toBe(false);
        expect(dragPanShouldPan(1, 0)).toBe(false);
    });
});
