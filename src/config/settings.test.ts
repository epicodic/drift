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

    it('defaults the strip-drag dwell to 400ms', () => {
        expect(DEFAULT_SETTINGS.stripDragDwellMs).toBe(400);
    });

    it('defaults the column-stack drag dwell to 400ms', () => {
        expect(DEFAULT_SETTINGS.columnDragDwellMs).toBe(400);
    });

    it('defaults the strip-drag edge border to 2px', () => {
        expect(DEFAULT_SETTINGS.stripDragEdgeBorderPx).toBe(2);
    });

    it('uses Meta+Page_Up and Meta+Page_Down to page to the strip above/below', () => {
        expect(DEFAULT_SETTINGS.shortcutStripUp).toBe('Meta+Page_Up');
        expect(DEFAULT_SETTINGS.shortcutStripDown).toBe('Meta+Page_Down');
    });

    it('uses Meta+Ctrl+Page_Up and Meta+Ctrl+Page_Down to move the whole focused column to the strip above/below', () => {
        expect(DEFAULT_SETTINGS.shortcutMoveColumnToStripAbove).toBe('Meta+Ctrl+Page_Up');
        expect(DEFAULT_SETTINGS.shortcutMoveColumnToStripBelow).toBe('Meta+Ctrl+Page_Down');
    });

    it('uses Meta+Home and Meta+End to focus the first/last column', () => {
        expect(DEFAULT_SETTINGS.shortcutFocusFirst).toBe('Meta+Home');
        expect(DEFAULT_SETTINGS.shortcutFocusLast).toBe('Meta+End');
    });

    it('uses Meta+Ctrl+Home and Meta+Ctrl+End to move the focused column to the start/end', () => {
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToStart).toBe('Meta+Ctrl+Home');
        expect(DEFAULT_SETTINGS.shortcutMoveWindowToEnd).toBe('Meta+Ctrl+End');
    });

    it('uses Meta+Alt+Home and Meta+Alt+End to pan the viewport to the start/end', () => {
        expect(DEFAULT_SETTINGS.shortcutViewportShiftToStart).toBe('Meta+Alt+Home');
        expect(DEFAULT_SETTINGS.shortcutViewportShiftToEnd).toBe('Meta+Alt+End');
    });

    it('uses Meta+Plus and Meta+Minus to step the focused column width, defaulting the step to 80px', () => {
        expect(DEFAULT_SETTINGS.shortcutIncreaseColumnWidth).toBe('Meta+Plus');
        expect(DEFAULT_SETTINGS.shortcutDecreaseColumnWidth).toBe('Meta+Minus');
        expect(DEFAULT_SETTINGS.columnWidthStep).toBe(80);
    });

    it('uses Meta+Shift+Plus and Meta+Shift+Minus to step the focused tile height, defaulting the step to 80px', () => {
        expect(DEFAULT_SETTINGS.shortcutIncreaseWindowHeight).toBe('Meta+Shift+Plus');
        expect(DEFAULT_SETTINGS.shortcutDecreaseWindowHeight).toBe('Meta+Shift+Minus');
        expect(DEFAULT_SETTINGS.windowHeightStep).toBe(80);
    });
});
