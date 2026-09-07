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

    it('picks the candidate with the most vertical overlap among several passing the gate', () => {
        const candidates: StackCandidate[] = [
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 200) }, // dragged overlaps y=[100,200) -> 100px
            // dragged overlaps y=[200,300) -> 100px... see below
            { columnId: 1, tileId: 20, rect: rect(0, 200, 300, 400) },
            // dragged overlaps y=[100,300) -> 200px, most overlap
            { columnId: 1, tileId: 30, rect: rect(0, 50, 300, 300) },
        ];
        // dragged window: y=[100,300)
        const target = resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5);
        expect(target?.tileId).toBe(30);
    });

    it('picks the gate-passing candidate over one with more vertical but insufficient horizontal overlap', () => {
        const candidates: StackCandidate[] = [
            // wins on vertical overlap alone, but only 10% horizontal overlap with the dragged window.
            { columnId: 1, tileId: 10, rect: rect(270, 0, 300, 1000) },
            // less generous vertical overlap, but fully within the dragged window horizontally.
            { columnId: 2, tileId: 20, rect: rect(0, 50, 300, 300) },
        ];
        const target = resolveStackTarget(rect(0, 100, 300, 200), candidates, 0.5);
        expect(target?.tileId).toBe(20);
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
