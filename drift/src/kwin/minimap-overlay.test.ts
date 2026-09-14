import { describe, expect, it } from 'vitest';
import type { StripStackMinimapSnapshot } from '../ui/minimap';
import { panelLayout, toPanelViewportBox } from './minimap-overlay';

/** Two strips whose columns span the same total width (0..8), matching the bug report:
 * strip 0 hugs its viewport to the left edge of its first column, strip 1 hugs its viewport to
 * the left edge of its second column. The viewport (width 10) is wider than the strip content,
 * so it always overhangs — by a different amount depending on which strip is active. */
function twoStripSnapshot(activeStripIndex: 0 | 1): StripStackMinimapSnapshot {
    return {
        strips: [
            {
                stripIndex: 0,
                columns: [
                    { id: 1, x: 0, width: 5, tiles: [] },
                    { id: 2, x: 5, width: 3, tiles: [] },
                ],
            },
            {
                stripIndex: 1,
                columns: [
                    { id: 3, x: 0, width: 3, tiles: [] },
                    { id: 4, x: 3, width: 5, tiles: [] },
                ],
            },
        ],
        viewport: {
            stripIndex: activeStripIndex,
            offset: activeStripIndex === 0 ? 0 : 3,
            width: 10,
            contentLeft: 0,
            contentWidth: 8,
        },
        gridHeight: 1,
        stripPitch: 1,
    };
}

describe('panelLayout', () => {
    it('keeps the same scale regardless of which strip is active, even when its viewport overhangs by a different amount', () => {
        const scaleWithStrip0Active = panelLayout(twoStripSnapshot(0)).scale;
        const scaleWithStrip1Active = panelLayout(twoStripSnapshot(1)).scale;

        expect(scaleWithStrip1Active).toBe(scaleWithStrip0Active);
    });
});

describe('toPanelViewportBox', () => {
    it('reports the viewport box at its true, unclamped extent when it overhangs past the strip content, so the QML template can crop it visually instead of the scale absorbing it', () => {
        const snapshot = twoStripSnapshot(1);
        const { scale } = panelLayout(snapshot);
        const { panelWidth } = panelLayout(snapshot);

        const box = toPanelViewportBox(snapshot);

        // offset 3, width 10 -> right edge at 13, scaled: (13 - 0) * scale
        expect(box.x + box.width).toBeCloseTo(13 * scale);
        expect(box.x + box.width).toBeGreaterThan(panelWidth);
    });
});
