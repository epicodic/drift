import { describe, expect, it } from 'vitest';
import { Rect } from '../core/coordinates';
import {
    horizontalOverlapFraction,
    initialPhantomIndex,
    resolveSlotFromPointer,
    resolveStackTarget,
    stackTargetIndex,
    StackCandidate,
} from './drag-hover';

function rect(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
}

describe('horizontalOverlapFraction', () => {
    it('is 0 without overlap', () => {
        expect(horizontalOverlapFraction(rect(0, 0, 300, 100), rect(300, 0, 300, 100))).toBe(0);
    });

    it('divides by the narrower width so a narrow window fully inside a wide one is 1', () => {
        expect(horizontalOverlapFraction(rect(100, 0, 50, 100), rect(0, 0, 300, 100))).toBe(1);
        expect(horizontalOverlapFraction(rect(0, 0, 300, 100), rect(100, 0, 50, 100))).toBe(1);
    });

    it('is the overlapped fraction for equal widths', () => {
        expect(horizontalOverlapFraction(rect(150, 0, 300, 100), rect(0, 0, 300, 100))).toBe(0.5);
    });
});

describe('resolveSlotFromPointer', () => {
    const tiles: StackCandidate[] = [
        { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 400) },
        { columnId: 1, tileId: 20, rect: rect(0, 400, 300, 600) },
    ];

    it('returns null for an empty tile list', () => {
        expect(resolveSlotFromPointer(100, [])).toBeNull();
    });

    it("resolves 'above' in the upper half of the tile under the pointer", () => {
        expect(resolveSlotFromPointer(199, tiles)).toEqual({ tileId: 10, direction: 'above' });
        expect(resolveSlotFromPointer(600, tiles)).toEqual({ tileId: 20, direction: 'above' });
    });

    it("resolves 'below' from the midline down", () => {
        expect(resolveSlotFromPointer(200, tiles)).toEqual({ tileId: 10, direction: 'below' });
        expect(resolveSlotFromPointer(399, tiles)).toEqual({ tileId: 10, direction: 'below' });
        expect(resolveSlotFromPointer(950, tiles)).toEqual({ tileId: 20, direction: 'below' });
    });

    it('clamps a pointer above the first tile to above it, and below the last tile to below it', () => {
        expect(resolveSlotFromPointer(-50, tiles)).toEqual({ tileId: 10, direction: 'above' });
        expect(resolveSlotFromPointer(5000, tiles)).toEqual({ tileId: 20, direction: 'below' });
    });

    it('treats a pointer in the gap between two tiles as above the lower one', () => {
        const gapped: StackCandidate[] = [
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 400) },
            { columnId: 1, tileId: 20, rect: rect(0, 500, 300, 400) },
        ];
        expect(resolveSlotFromPointer(450, gapped)).toEqual({ tileId: 20, direction: 'above' });
    });
});

describe('resolveStackTarget', () => {
    it('returns null without candidates', () => {
        expect(resolveStackTarget(rect(0, 0, 300, 200), 100, [], 0.5)).toBeNull();
    });

    it('returns null when no column clears the overlap gate', () => {
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(300, 0, 300, 1000) }];
        expect(resolveStackTarget(rect(0, 0, 299, 200), 100, candidates, 0.5)).toBeNull();
    });

    it('picks the column with the most overlap and the slot from the pointer', () => {
        const candidates: StackCandidate[] = [
            { columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) },
            { columnId: 2, tileId: 20, rect: rect(310, 0, 300, 500) },
            { columnId: 2, tileId: 21, rect: rect(310, 500, 300, 500) },
        ];
        // dragged [200,500): 100px over column 1, 190px over column 2
        expect(resolveStackTarget(rect(200, 0, 300, 200), 900, candidates, 0.5)).toEqual({
            columnId: 2,
            tileId: 21,
            direction: 'below',
        });
    });

    it("ignores the dragged window's own height and top edge entirely", () => {
        const candidates: StackCandidate[] = [{ columnId: 1, tileId: 10, rect: rect(0, 0, 300, 1000) }];
        const tall = resolveStackTarget(rect(0, 900, 300, 5000), 100, candidates, 0.5);
        const short = resolveStackTarget(rect(0, 0, 300, 10), 100, candidates, 0.5);
        expect(tall).toEqual(short);
        expect(tall?.direction).toBe('above');
    });
});

describe('initialPhantomIndex', () => {
    const home = rect(1000, 0, 400, 1000); // center 1200

    it("takes the home index when the dragged center is left of the home column's center", () => {
        expect(initialPhantomIndex(rect(700, 0, 400, 1000), home, 3)).toBe(3); // center 900
    });

    it('takes the next index when the dragged center is at or right of it', () => {
        expect(initialPhantomIndex(rect(1000, 0, 400, 1000), home, 3)).toBe(4); // center 1200
        expect(initialPhantomIndex(rect(1300, 0, 400, 1000), home, 3)).toBe(4);
    });
});

describe('stackTargetIndex', () => {
    const tiles = [{ id: 10 }, { id: 20 }, { id: 30 }];

    it("maps 'above' to the tile's own index", () => {
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'above' }, tiles)).toBe(1);
    });

    it("maps 'below' to the index after the tile", () => {
        expect(stackTargetIndex({ columnId: 1, tileId: 20, direction: 'below' }, tiles)).toBe(2);
        expect(stackTargetIndex({ columnId: 1, tileId: 30, direction: 'below' }, tiles)).toBe(3);
    });
});
