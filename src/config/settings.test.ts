import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';

describe('DEFAULT_SETTINGS', () => {
    it('uses Meta+Left and Meta+Right to focus the previous and next columns', () => {
        expect(DEFAULT_SETTINGS.shortcutFocusLeft).toBe('Meta+Left');
        expect(DEFAULT_SETTINGS.shortcutFocusRight).toBe('Meta+Right');
    });

    it('auto-hides the minimap after 1200ms by default', () => {
        expect(DEFAULT_SETTINGS.minimapAutoHideMs).toBe(1200);
    });

    it('shows minimap thumbnails by default', () => {
        expect(DEFAULT_SETTINGS.minimapShowThumbnails).toBe(true);
    });

    it('defaults the row-drag dwell to 400ms', () => {
        expect(DEFAULT_SETTINGS.rowDragDwellMs).toBe(400);
    });

    it('defaults the column-stack drag dwell to 400ms', () => {
        expect(DEFAULT_SETTINGS.columnDragDwellMs).toBe(400);
    });

    it('defaults the row-drag edge border to 2px', () => {
        expect(DEFAULT_SETTINGS.rowDragEdgeBorderPx).toBe(2);
    });
});
