import { describe, expect, it } from 'vitest';
import { buildShortcutBindingsScript, driftActionNameFor } from './shortcut-bindings';
import type { SettingsDefinition } from './settings-definitions';

describe('driftActionNameFor', () => {
    it('strips the "shortcut" prefix and prepends "Drift"', () => {
        expect(driftActionNameFor('shortcutFocusLeft')).toBe('DriftFocusLeft');
        expect(driftActionNameFor('shortcutToggleFloating')).toBe('DriftToggleFloating');
    });
});

describe('buildShortcutBindingsScript', () => {
    it('emits a 3-column row for a shortcut with no altDefault', () => {
        const script = buildShortcutBindingsScript([
            {
                name: 'shortcutFocusLeft',
                type: 'String',
                default: 'Meta+Left',
                shortcut: { label: 'Focus Column Left' },
            },
        ] as SettingsDefinition[]);
        expect(script).toContain('DriftFocusLeft|Drift: Focus Column Left|Meta+Left');
    });

    it('emits a 4-column row for a shortcut with an altDefault', () => {
        const script = buildShortcutBindingsScript([
            {
                name: 'shortcutIncreaseColumnWidth',
                type: 'String',
                default: 'Meta+Plus',
                shortcut: { label: 'Increase Column Width', altDefault: 'Meta+Num+Plus' },
            },
        ] as SettingsDefinition[]);
        expect(script).toContain('DriftIncreaseColumnWidth|Drift: Increase Column Width|Meta+Plus|Meta+Num+Plus');
    });

    it('skips non-shortcut definitions', () => {
        const script = buildShortcutBindingsScript([
            { name: 'columnGap', type: 'UInt', default: 8 },
        ] as SettingsDefinition[]);
        expect(script).not.toContain('columnGap');
    });

    it('wraps the rows in a DRIFT_BINDINGS shell assignment', () => {
        const script = buildShortcutBindingsScript([
            { name: 'shortcutExpel', type: 'String', default: 'Meta+O', shortcut: { label: 'Expel Focused Tile' } },
        ] as SettingsDefinition[]);
        expect(script).toContain("DRIFT_BINDINGS='");
        expect(script.trim().endsWith("'")).toBe(true);
    });
});
