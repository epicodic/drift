import { describe, it, expect } from 'vitest';
import { Column } from './column';

describe('Column', () => {
    it('exposes its id and width', () => {
        const column = new Column(1, 300);
        expect(column.id).toBe(1);
        expect(column.width).toBe(300);
    });

    it('updates its width', () => {
        const column = new Column(1, 300);
        column.setWidth(500);
        expect(column.width).toBe(500);
    });

    it('rejects a non-positive width on construction', () => {
        expect(() => new Column(1, 0)).toThrow();
        expect(() => new Column(1, -10)).toThrow();
    });

    it('rejects a non-positive width on resize', () => {
        const column = new Column(1, 300);
        expect(() => column.setWidth(0)).toThrow();
    });
});
