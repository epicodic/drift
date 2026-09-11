import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_RULES } from '../core/default-window-rules';
import { DEFAULT_SETTINGS } from './settings';
import type { Settings } from './settings';
import { SETTINGS_DEFINITIONS } from './settings-definitions';

describe('SETTINGS_DEFINITIONS', () => {
    it('has exactly one entry per known setting, with no duplicate names', () => {
        const names = SETTINGS_DEFINITIONS.map((def) => def.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.length).toBe(57);
    });

    it("each entry's default value type matches its declared kcfg type", () => {
        for (const def of SETTINGS_DEFINITIONS) {
            const actual = typeof def.default;
            if (def.type === 'Bool') {
                expect(actual, def.name).toBe('boolean');
            } else if (def.type === 'String') {
                expect(actual, def.name).toBe('string');
            } else {
                // UInt or Double
                expect(actual, def.name).toBe('number');
            }
        }
    });

    it('only shortcut* entries carry shortcut metadata, and vice versa', () => {
        for (const def of SETTINGS_DEFINITIONS) {
            if (def.name.startsWith('shortcut')) {
                expect(def.shortcut, def.name).toBeDefined();
            } else {
                expect(def.shortcut, def.name).toBeUndefined();
            }
        }
    });

    it('only 4 entries declare an altDefault (the width/height step shortcuts)', () => {
        const withAlt = SETTINGS_DEFINITIONS.filter((def) => def.shortcut?.altDefault !== undefined);
        expect(withAlt.map((def) => def.name).sort()).toEqual([
            'shortcutDecreaseColumnWidth',
            'shortcutDecreaseWindowHeight',
            'shortcutIncreaseColumnWidth',
            'shortcutIncreaseWindowHeight',
        ]);
    });

    it('every default matches the corresponding DEFAULT_SETTINGS value', () => {
        for (const def of SETTINGS_DEFINITIONS) {
            expect(def.default, def.name).toEqual((DEFAULT_SETTINGS as Record<keyof Settings, unknown>)[def.name]);
        }
    });

    it("windowRules' default is the bundled starter rule set", () => {
        const windowRulesDef = SETTINGS_DEFINITIONS.find((def) => def.name === 'windowRules');
        expect(windowRulesDef?.default).toBe(DEFAULT_WINDOW_RULES);
    });
});
