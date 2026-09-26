import { describe, expect, it } from 'vitest';

import { stripOsdArc } from './strip-osd-arc';

describe('stripOsdArc', () => {
    it('is absent before the flash starts', () => {
        expect(stripOsdArc(0, 500, 1920, 60)).toBeNull();
    });

    it('is absent once the flash is over', () => {
        expect(stripOsdArc(501, 500, 1920, 60)).toBeNull();
    });

    it('is absent for a non-positive duration or depth', () => {
        expect(stripOsdArc(10, 0, 1920, 60)).toBeNull();
        expect(stripOsdArc(250, 500, 1920, 0)).toBeNull();
    });

    it('reaches full depth and full opacity at the midpoint', () => {
        const arc = stripOsdArc(250, 500, 1920, 60);
        expect(arc?.depth).toBeCloseTo(60);
        expect(arc?.opacity).toBeCloseTo(1);
    });

    it('moves the apex inward then outward, symmetrically', () => {
        const early = stripOsdArc(125, 500, 1920, 60);
        const mid = stripOsdArc(250, 500, 1920, 60);
        const late = stripOsdArc(375, 500, 1920, 60);
        expect(early!.depth).toBeLessThan(mid!.depth);
        expect(late!.depth).toBeLessThan(mid!.depth);
        expect(early!.depth).toBeCloseTo(late!.depth);
    });

    it('keeps opacity in lock-step with depth', () => {
        const arc = stripOsdArc(125, 500, 1920, 60)!;
        expect(arc.opacity).toBeCloseTo(arc.depth / 60);
    });

    it('traces a circle through both top corners and the apex', () => {
        const width = 1920;
        const arc = stripOsdArc(125, 500, width, 60)!;
        const { cx, cy, r } = arc.circle;
        expect(Math.hypot(0 - cx, 0 - cy)).toBeCloseTo(r);
        expect(Math.hypot(width - cx, 0 - cy)).toBeCloseTo(r);
        expect(Math.hypot(width / 2 - cx, arc.depth - cy)).toBeCloseTo(r);
    });
});
