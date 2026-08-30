import { describe, it, expect } from 'vitest';
import { formatDebugState } from './debug-format';

describe('formatDebugState', () => {
    it('formats the camera line', () => {
        const text = formatDebugState([], { offset: 120, viewportWidth: 1920, contentLeft: 0, contentWidth: 2400 });

        expect(text).toBe('camera: offset=120 viewport=1920 content=[0..2400]');
    });

    it('formats one row per window with its title, virtual, and real geometry', () => {
        const text = formatDebugState(
            [
                {
                    columnId: 1,
                    id: 'win-1',
                    title: 'Firefox',
                    virtual: { x: 0, y: 0, width: 800, height: 1040 },
                    real: { x: -120, y: 0, width: 800, height: 1040 },
                },
            ],
            { offset: 120, viewportWidth: 1920, contentLeft: 0, contentWidth: 2400 },
        );

        expect(text).toBe(
            'camera: offset=120 viewport=1920 content=[0..2400]\n' +
                'col 1 (win win-1 "Firefox"): virtual={x:0,y:0,w:800,h:1040} real={x:-120,y:0,w:800,h:1040}',
        );
    });

    it('prepends a grid line when grid debug state is given', () => {
        const text = formatDebugState(
            [],
            { offset: 120, viewportWidth: 1920, contentLeft: 0, contentWidth: 2400 },
            {
                focusedColumnId: 2,
                nextId: 3,
                originX: -120,
                columns: [
                    { id: 1, width: 800, hidden: false },
                    { id: 2, width: 640, hidden: false },
                ],
            },
        );

        expect(text).toBe(
            'grid: focused=2 nextId=3 originX=-120 columns=[1:800,2:640]\n' +
                'camera: offset=120 viewport=1920 content=[0..2400]',
        );
    });
});
