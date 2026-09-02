import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';

describe('DEFAULT_SETTINGS', () => {
    it('uses Meta+Shift+Tab and Meta+Tab to focus the previous and next columns', () => {
        expect(DEFAULT_SETTINGS.shortcutFocusLeft).toBe('Meta+Shift+Tab');
        expect(DEFAULT_SETTINGS.shortcutFocusRight).toBe('Meta+Tab');
    });

    it('auto-hides the minimap after 1200ms by default', () => {
        expect(DEFAULT_SETTINGS.minimapAutoHideMs).toBe(1200);
    });

    it('shows minimap thumbnails by default', () => {
        expect(DEFAULT_SETTINGS.minimapShowThumbnails).toBe(true);
    });

    it('defaults the four row-navigation shortcuts', () => {
        expect(DEFAULT_SETTINGS.shortcutRowUp).toBe('Meta+Page_Up');
        expect(DEFAULT_SETTINGS.shortcutRowDown).toBe('Meta+Page_Down');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToRowAbove).toBe('Meta+Shift+Page_Up');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToRowBelow).toBe('Meta+Shift+Page_Down');
    });

    it('defaults the row-drag dwell to 400ms', () => {
        expect(DEFAULT_SETTINGS.rowDragDwellMs).toBe(400);
    });
});
