import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';

describe('DEFAULT_SETTINGS', () => {
    it('uses Meta+Shift+Tab and Meta+Tab to focus the previous and next columns', () => {
        expect(DEFAULT_SETTINGS.shortcutFocusLeft).toBe('Meta+Shift+Tab');
        expect(DEFAULT_SETTINGS.shortcutFocusRight).toBe('Meta+Tab');
    });
});
