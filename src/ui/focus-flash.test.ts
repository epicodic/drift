import { describe, expect, it } from 'vitest';
import { flashOpacity } from './focus-flash';

describe('flashOpacity', () => {
    it('starts at 0 at the very beginning of the flash', () => {
        expect(flashOpacity(0, 300)).toBe(0);
    });

    it('reaches full opacity exactly at the end', () => {
        expect(flashOpacity(300, 300)).toBeCloseTo(0);
    });

    it('ramps up smoothly with sine curve during progression', () => {
        expect(flashOpacity(75, 300)).toBeCloseTo(Math.sin(0.25 * Math.PI));
    });

    it('continues ramping up smoothly with sine curve', () => {
        expect(flashOpacity(225, 300)).toBeCloseTo(Math.sin(0.75 * Math.PI));
    });

    it('stays at 0 past the end of the flash', () => {
        expect(flashOpacity(500, 300)).toBe(0);
    });

    it('returns 0 for a non-positive duration', () => {
        expect(flashOpacity(0, 0)).toBe(0);
        expect(flashOpacity(10, -50)).toBe(0);
    });
});
