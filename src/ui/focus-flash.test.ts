import { describe, expect, it } from 'vitest';
import { flashOpacity } from './focus-flash';

describe('flashOpacity', () => {
    it('starts at 0 at the very beginning of the flash', () => {
        expect(flashOpacity(0, 300)).toBe(0);
    });

    it('reaches full opacity exactly at the midpoint', () => {
        expect(flashOpacity(150, 300)).toBe(1);
    });

    it('ramps up linearly during the first half', () => {
        expect(flashOpacity(75, 300)).toBeCloseTo(0.5);
    });

    it('ramps down linearly during the second half', () => {
        expect(flashOpacity(225, 300)).toBeCloseTo(0.5);
    });

    it('reaches 0 exactly at the end of the flash', () => {
        expect(flashOpacity(300, 300)).toBe(0);
    });

    it('stays at 0 past the end of the flash', () => {
        expect(flashOpacity(500, 300)).toBe(0);
    });

    it('returns 0 for a non-positive duration', () => {
        expect(flashOpacity(0, 0)).toBe(0);
        expect(flashOpacity(10, -50)).toBe(0);
    });
});
