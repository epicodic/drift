import { describe, expect, it } from 'vitest';
import { Rect } from '../core/coordinates';
import { resolveStackTarget, stackTargetIndex, StackCandidate } from './drag-hover';

function rect(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
}

describe('resolveStackTarget', () => {
    it('returns null when there are no candidates', () => {
        expect(resolveStackTarget(rect(0, 0, 300, 200), [], 0.5)).toBeNull();
    });

    it('returns null when the only candidate fails the horizontal overlap gate', () => {
        // candidate spans x=[300,600) (width 300); dragged window spans x=[0,300+299]=
        // [0,299], leaving essentially zero horizontal overlap.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(300, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 400, 299, 100), candidates, 0.5)).toBeNull();
    });

    it("resolves 'above' when the dragged window's top edge is in the candidate's top quarter", () => {
        // candidate: y=[0,1000). Top-quarter boundary is y=250. Dragged top edge at y=100.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5)).toEqual({
            columnId: 1,
            tileId: 10,
            direction: 'above',
        });
    });

    it("resolves 'below' when the dragged window's top edge is in the candidate's bottom quarter", () => {
        // candidate: y=[0,1000). Bottom-quarter boundary is y=750. Dragged top edge at y=900.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 900, 300, 200), candidates, 0.5)).toEqual({
            columnId: 1,
            tileId: 10,
            direction: 'below',
        });
    });

    it("returns null when the dragged window's top edge is in the candidate's middle dead zone", () => {
        // candidate: y=[0,1000). Middle band is (250,750). Dragged top edge at y=500.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 500, 300, 200), candidates, 0.5)).toBeNull();
    });

    it("returns null when the dragged window's top edge is exactly at the top-quarter boundary", () => {
        // candidate: y=[0,1000). Top-quarter boundary is y=250. The comparison is strict
        // (topFraction < 0.25), so topFraction === 0.25 falls in the dead zone, not 'above'.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 250, 300, 200), candidates, 0.5)).toBeNull();
    });

    it("returns null when the dragged window's top edge is exactly at the bottom-quarter boundary", () => {
        // candidate: y=[0,1000). Bottom-quarter boundary is y=750. The comparison is strict
        // (topFraction > 0.75), so topFraction === 0.75 falls in the dead zone, not 'below'.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 750, 300, 200), candidates, 0.5)).toBeNull();
    });

    it("returns null when the dragged window's top-left corner is above the candidate's own range", () => {
        // candidate: y=[200,1000). Dragged top edge at y=100, above the candidate entirely,
        // even though the two rects still vertically overlap (dragged spans y=[100,300)).
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 200, 300, 800) }];
        expect(resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5)).toBeNull();
    });

    it("returns null when the dragged window's top-left corner is below the candidate's own range", () => {
        // candidate: y=[0,500). Dragged top edge at y=600, below the candidate entirely.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 500) }];
        expect(resolveStackTarget(rect(0, 600, 300, 200), candidates, 0.5)).toBeNull();
    });

    it('picks whichever gate-passing candidate the top-left corner actually bands into', () => {
        const candidates: StackCandidate[] = [
            // dragged top-left corner (y=100) is in this one's middle dead zone (y=[50,150)) -> excluded.
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 200) },
            // dragged top-left corner (y=100) is in this one's top quarter (y=[50,125)) -> 'above'.
            { columnId: 1, tileId: 20, rect: rect(0, 50, 300, 300) },
        ];
        const target = resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5);
        expect(target).toEqual({ columnId: 1, tileId: 20, direction: 'above' });
    });

    it('picks the gate-passing candidate over one with insufficient horizontal overlap', () => {
        const candidates: StackCandidate[] = [
            // banded correctly (top-left corner in its top quarter), but only 10% horizontal overlap.
            { columnId: 1, tileId: 10, rect: rect(270, 0, 300, 1000) },
            // fully within the dragged window horizontally, also banded correctly.
            { columnId: 2, tileId: 20, rect: rect(0, 50, 300, 300) },
        ];
        const target = resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5);
        expect(target?.tileId).toBe(20);
    });

    it('when multiple candidates band into a direction, the one with the most horizontal overlap wins', () => {
        const candidates: StackCandidate[] = [
            // dragged x=[0,300) vs target x=[150,450) -> overlap 150, exactly 50% -> at the gate.
            { columnId: 1, tileId: 10, rect: rect(150, 0, 300, 1000) },
            // fully within the dragged window horizontally -> 100% horizontal overlap, wins.
            { columnId: 2, tileId: 20, rect: rect(0, 0, 300, 1000) },
        ];
        const target = resolveStackTarget(rect(0, 100, 300, 1000), candidates, 0.5);
        expect(target?.tileId).toBe(20);
    });

    it('clears the horizontal gate when a narrow dragged window is fully contained in a wide candidate', () => {
        // dragged width 50, fully inside the candidate's width 300 -> overlap is capped at the
        // dragged window's own width, so the fraction is measured against min(dragged, target)
        // width, not always the candidate's width.
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(100, 100, 50, 200), candidates, 0.5)).toEqual({
            columnId: 1,
            tileId: 10,
            direction: 'above',
        });
    });
});

describe('stackTargetIndex', () => {
    it("resolves 'above' to the candidate tile's own index", () => {
        const tiles = [{ id: 10 }, { id: 20 }, { id: 30 }];
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'above' }, tiles)).toBe(1);
    });

    it("resolves 'below' to one past the candidate tile's own index", () => {
        const tiles = [{ id: 10 }, { id: 20 }, { id: 30 }];
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'below' }, tiles)).toBe(2);
    });

    it("resolves 'below' the last tile to an append index", () => {
        const tiles = [{ id: 10 }, { id: 20 }];
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'below' }, tiles)).toBe(2);
    });
});
