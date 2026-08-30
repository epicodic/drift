import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport — scrolling and clamping', () => {
    it('starts at offset 0', () => {
        expect(new Viewport(1000).offset()).toBe(0);
    });

    it('exposes the viewport width', () => {
        const viewport = new Viewport(1000);
        expect(viewport.viewportWidth()).toBe(1000);
        viewport.setViewportWidth(1200);
        expect(viewport.viewportWidth()).toBe(1200);
    });

    it('exposes the content geometry', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(50, 3000);
        expect(viewport.contentLeft()).toBe(50);
        expect(viewport.contentWidth()).toBe(3000);
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

    it('keeps the camera fixed when the content shrinks under it (layout is separate from the camera)', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(2000);
        viewport.setContentWidth(1500); // content shrank under the camera; maxOffset now 500
        expect(viewport.offset()).toBe(2000); // camera unchanged — a resize must not pan the view
        viewport.scrollBy(0); // the next explicit scroll re-clamps to the new bounds
        expect(viewport.offset()).toBe(500);
    });

    it('does not pan the view when content is trimmed from the right while pinned to the right edge', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(0, 2500); // content [0, 2500], maxOffset 1500
        viewport.scrollTo(1500); // pinned to the right edge
        viewport.setContentGeometry(0, 2300); // shrink an interior column by 200
        expect(viewport.offset()).toBe(1500); // left-anchored content stays put on screen
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

    it('moves to fully cover the viewport when an oversized column only partially overlaps it', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        expect(viewport.offsetToReveal(100, 1200)).toBe(100);
    });

    it('moves to fully cover the viewport when a screen-wide column only partially overlaps it', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        expect(viewport.offsetToReveal(100, 1000)).toBe(100);
    });

    it('does not move when an oversized column already fully covers the viewport', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(150); // view [150,1150], within column [100,1300]
        expect(viewport.offsetToReveal(100, 1200)).toBe(150);
    });

    it('does not move when a visible column follows a left-edge resize in narrow content', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(100, 800); // content [100, 900], narrower than the viewport
        expect(viewport.offsetToReveal(100, 400)).toBe(0);
    });

    it('re-clamps a stale offset once the resized strip fits the viewport', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(0, 2000);
        viewport.scrollTo(200);
        viewport.setContentGeometry(100, 800); // content [100, 900], narrower than the viewport
        // The old offset (200) would leave the content's left edge (100) scrolled out of view.
        expect(viewport.offsetToReveal(100, 400)).toBe(100);
    });

    it('re-clamps a stale offset even when only one column remains', () => {
        const viewport = new Viewport(5120);
        viewport.setContentGeometry(0, 6000); // wide content, e.g. several columns
        viewport.scrollTo(1288); // camera legitimately panned right
        viewport.setContentGeometry(0, 2270); // columns closed, one narrow column remains
        expect(viewport.offsetToReveal(0, 2270)).toBe(0);
    });

    it('reveals the nearest edge when an oversized column is completely right of the viewport', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        expect(viewport.offsetToReveal(1500, 1200)).toBe(1500);
    });

    it('reveals the nearest edge when an oversized column is completely left of the viewport', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(1500); // view [1500,2500]
        expect(viewport.offsetToReveal(0, 1200)).toBe(200);
    });

    it('revealColumn applies the clamped target offset', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000); // maxOffset 2000
        viewport.revealColumn(2900, 300); // wants 2200, clamps to 2000
        expect(viewport.offset()).toBe(2000);
    });
});

describe('Viewport — content that starts left of zero', () => {
    it('clamps the low end to the content-left, not to zero', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(-200, 3000); // content spans [-200, 2800]
        viewport.scrollTo(-500);
        expect(viewport.offset()).toBe(-200);
    });

    it('clamps the high end to content-left + width - viewportWidth', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(-200, 3000); // maxOffset = -200 + 3000 - 1000
        viewport.scrollTo(9000);
        expect(viewport.offset()).toBe(1800);
    });

    it('reveals a column that sits left of zero', () => {
        const viewport = new Viewport(1000);
        viewport.setContentGeometry(-200, 3000);
        viewport.scrollTo(500); // view [500, 1500]
        expect(viewport.offsetToReveal(-100, 200)).toBe(-100);
    });

    it('setContentWidth keeps the origin at zero', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000);
        viewport.scrollTo(-50);
        expect(viewport.offset()).toBe(0);
    });
});
