import { describe, expect, it } from 'vitest';
import { stripColor, stripHue, stripLabel } from './strip-identity';

describe('stripLabel', () => {
    it('labels the home strip (index 0) "1"', () => {
        expect(stripLabel(0)).toBe('1');
    });

    it('labels strips upward from home with digits counting from 1', () => {
        expect(stripLabel(-1)).toBe('2');
        expect(stripLabel(-2)).toBe('3');
        expect(stripLabel(-9)).toBe('10');
    });

    it('labels strips downward from home with letters starting at A', () => {
        expect(stripLabel(1)).toBe('A');
        expect(stripLabel(2)).toBe('B');
        expect(stripLabel(26)).toBe('Z');
    });

    it('continues the letter sequence spreadsheet-column style past Z', () => {
        expect(stripLabel(27)).toBe('AA');
        expect(stripLabel(28)).toBe('AB');
        expect(stripLabel(52)).toBe('AZ');
        expect(stripLabel(53)).toBe('BA');
    });
});

describe('stripHue', () => {
    it('returns 0 for the home strip', () => {
        expect(stripHue(0)).toBe(0);
    });

    it('spreads hues via the golden-ratio conjugate for positive indices', () => {
        expect(stripHue(1)).toBeCloseTo(0.6180339887498949, 10);
        expect(stripHue(2)).toBeCloseTo(0.2360679774997898, 10);
    });

    it('spreads hues for negative indices too, staying within [0, 1)', () => {
        const hue = stripHue(-1);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(1);
        expect(hue).toBeCloseTo(0.3819660112501051, 10);
    });
});

describe('stripColor', () => {
    it('renders hue 0 as red-dominant', () => {
        const { r, g, b } = stripColor(0);
        expect(r).toBeCloseTo(0.9, 5);
        expect(g).toBeCloseTo(0.315, 5);
        expect(b).toBeCloseTo(0.315, 5);
    });

    it('renders hue 1/3 as green-dominant', () => {
        const { r, g, b } = stripColor(1 / 3);
        expect(g).toBeCloseTo(0.9, 5);
        expect(r).toBeCloseTo(0.315, 5);
        expect(b).toBeCloseTo(0.315, 5);
    });

    it('renders hue 2/3 as blue-dominant', () => {
        const { r, g, b } = stripColor(2 / 3);
        expect(b).toBeCloseTo(0.9, 5);
        expect(r).toBeCloseTo(0.315, 5);
        expect(g).toBeCloseTo(0.315, 5);
    });

    it('keeps every channel within [0, 1] across the full hue range', () => {
        for (let i = 0; i < 12; i += 1) {
            const { r, g, b } = stripColor(i / 12);
            for (const channel of [r, g, b]) {
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThanOrEqual(1);
            }
        }
    });
});
