import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport — scrolling and clamping', () => {
    it('starts at offset 0', () => {
        expect(new Viewport(1000).offset()).toBe(0);
    });

    it('clamps scrolling to a non-negative offset', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(-50);
        expect(viewport.offset()).toBe(0);
    });

    it('clamps scrolling to the content end', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000); // maxOffset = 2000
        viewport.scrollTo(5000);
        expect(viewport.offset()).toBe(2000);
    });

    it('scrolls by a delta and clamps', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollBy(800);
        expect(viewport.offset()).toBe(800);
        viewport.scrollBy(5000);
        expect(viewport.offset()).toBe(2000);
    });

    it('re-clamps the current offset when the content shrinks', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(2000);
        viewport.setContentWidth(1500); // maxOffset now 500
        expect(viewport.offset()).toBe(500);
    });
});

describe('Viewport — revealing a column (focus scroll)', () => {
    it('scrolls right so a column past the right edge becomes fully visible', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        // view [0,1000], column at 1500..1800 is off to the right
        expect(viewport.offsetToReveal(1500, 300)).toBe(800); // 1800 - 1000
    });

    it('scrolls left so a column past the left edge becomes fully visible', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(800); // view [800,1800]
        expect(viewport.offsetToReveal(500, 200)).toBe(500);
    });

    it('does not move when the column is already fully visible', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(800); // view [800,1800]
        expect(viewport.offsetToReveal(1500, 300)).toBe(800);
    });

    it('revealColumn applies the clamped target offset', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000); // maxOffset 2000
        viewport.revealColumn(2900, 300); // wants 2200, clamps to 2000
        expect(viewport.offset()).toBe(2000);
    });
});
