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

describe('Viewport — setOffset', () => {
    it('sets the camera position exactly, bypassing the content clamp', () => {
        const viewport = new Viewport(1000);
        viewport.setContentWidth(3000); // maxOffset = 2000
        viewport.setOffset(9000);
        expect(viewport.offset()).toBe(9000);
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

describe('Viewport — offsetToRevealOnScreen (multi-monitor alignment)', () => {
    it('does not move when the column is already fully on the closer screen', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        viewport.scrollTo(500); // view [500,2500]
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // col [1600,1800] already fully within the right screen's view [1500,2500]
        expect(viewport.offsetToRevealOnScreen(1600, 200, screens)).toBe(500);
    });

    it('snaps a bezel-straddling column onto whichever screen needs less movement', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        viewport.scrollTo(500); // view [500,2500]
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // col [1450,1650] straddles the bezel at x=1500 in the current view.
        // Left screen would need offset 650 (delta 150); right screen needs offset 450 (delta 50).
        expect(viewport.offsetToRevealOnScreen(1450, 200, screens)).toBe(450);
    });

    it('still aligns a straddling column when total content is narrower than the combined desktop', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(1408); // only two columns open: [0,700] and [708,1408]
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // The "never show empty space" clamp is dropped for this path entirely, so the right
        // screen's minimal-movement offset -292 fully separates the column instead of the
        // combined-content clamp pinning the offset to 0 and leaving it straddling the bezel at x=1000.
        expect(viewport.offsetToRevealOnScreen(708, 700, screens)).toBe(-292);
    });

    it('falls back to the combined-area reveal when the column is wider than every screen', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        expect(viewport.offsetToRevealOnScreen(1000, 1500, screens)).toBe(500);
        expect(viewport.offsetToRevealOnScreen(1000, 1500, screens)).toBe(viewport.offsetToReveal(1000, 1500));
    });

    it('picks the exact-width screen with zero movement over a wider, farther one', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(4000);
        const screens = [
            { left: 0, width: 1000 },
            { left: 1000, width: 1000 },
        ];
        // col [1000,2000] exactly matches the right screen's width and is already aligned to it.
        expect(viewport.offsetToRevealOnScreen(1000, 1000, screens)).toBe(0);
    });

    it('does not re-clamp a stale offset, unlike offsetToReveal — empty space is accepted, not avoided', () => {
        const viewport = new Viewport(2000);
        viewport.setContentWidth(2000);
        viewport.setOffset(5000); // stale offset, e.g. left over from an unclamped shiftViewport pan
        const screens = [{ left: 0, width: 2000 }];
        // offsetToReveal would clamp this back to 0 (no empty space); offsetToRevealOnScreen
        // always targets the exact minimal-movement position instead.
        expect(viewport.offsetToRevealOnScreen(1000, 1000, screens)).toBe(1000);
        expect(viewport.offsetToReveal(1000, 1000)).toBe(0);
    });
});
