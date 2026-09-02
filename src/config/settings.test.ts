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

    it('defaults the four row-navigation shortcuts', () => {
        expect(DEFAULT_SETTINGS.shortcutRowUp).toBe('Meta+Up');
        expect(DEFAULT_SETTINGS.shortcutRowDown).toBe('Meta+Down');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToRowAbove).toBe('Meta+Shift+Up');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToRowBelow).toBe('Meta+Shift+Down');
    });

    it('defaults the row-drag dwell to 400ms', () => {
        expect(DEFAULT_SETTINGS.rowDragDwellMs).toBe(400);
    });

    it('defaults the row-drag edge border to 2px', () => {
        expect(DEFAULT_SETTINGS.rowDragEdgeBorderPx).toBe(2);
    });
});
