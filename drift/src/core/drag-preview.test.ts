import { describe, expect, it } from 'vitest';
import { Column } from './column';
import type { Rect } from './coordinates';
import { previewTileRects } from './drag-preview';

const COLUMN_RECT: Rect = { x: 0, y: 0, width: 300, height: 1000 };

function twoTileColumn(): { column: Column; topId: number; bottomId: number } {
    const column = new Column(1, 300, 1000, 0);
    const topId = column.tiles()[0].id;
    const bottomId = column.addTile();
    return { column, topId, bottomId };
}

describe('previewTileRects', () => {
    it('returns the committed tile rects when there is no preview', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, undefined);
        expect(rects.get(topId)).toEqual(column.tileRect(topId, COLUMN_RECT));
        expect(rects.get(bottomId)).toEqual(column.tileRect(bottomId, COLUMN_RECT));
    });

    it('returns the committed rects when the preview names other columns', () => {
        const { column, topId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, {
            leaving: { columnId: 99, tileId: 1 },
            entering: { columnId: 98, index: 0, gapHeight: 100 },
        });
        expect(rects.get(topId)).toEqual(column.tileRect(topId, COLUMN_RECT));
    });

    it('opens a gap when the preview enters this column', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, {
            entering: { columnId: 1, index: 0, gapHeight: 200 },
        });
        expect(rects).toEqual(column.previewRectsWithGapAt(0, 200, COLUMN_RECT, undefined));
        expect(rects.get(topId)?.y).toBe(200);
        expect(rects.get(bottomId)?.y).toBe(700);
    });

    it('closes up around the leaving tile when the preview leaves this column', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, { leaving: { columnId: 1, tileId: topId } });
        expect(rects.has(topId)).toBe(false);
        expect(rects.get(bottomId)?.y).toBe(0);
    });

    it('prefers entering over leaving for the same column (same-column reorder)', () => {
        const { column, topId, bottomId } = twoTileColumn();
        const rects = previewTileRects(column, COLUMN_RECT, {
            leaving: { columnId: 1, tileId: bottomId },
            entering: { columnId: 1, index: 1, gapHeight: 200, excludeTileId: bottomId },
        });
        expect(rects.has(bottomId)).toBe(false);
        // The gap is the trailing slot, but excludeTileId is set, so previewRectsWithGapAt no
        // longer shrinks the last remaining tile: bottomId's own height already funds the gap.
        expect(rects.get(topId)).toEqual({ x: 0, y: 0, width: 300, height: 500 });
    });
});
