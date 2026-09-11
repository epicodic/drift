/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/settings';
import { DEFAULT_WINDOW_RULES } from './default-window-rules';
import { parseWindowRules } from './window-rules';

// The windowRules default is unavoidably duplicated across two files that run in two
// different contexts: .build/drift/contents/config/main.xml (read by KConfigDialogManager to
// populate the config dialog's textbox the first time it's opened) and
// drift/src/core/default-window-rules.ts (bundled into the running KWin script as the
// readConfig() fallback, and as DEFAULT_SETTINGS.windowRules). This test catches drift
// between them directly.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function xmlUnescape(text: string): string {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseMainXmlWindowRulesDefault(): string {
    const xml = readFileSync(path.join(REPO_ROOT, '.build/drift/contents/config/main.xml'), 'utf8');
    const match = xml.match(/<entry name="windowRules" type="String">\s*<default>([^<]*)<\/default>/);
    if (!match) {
        throw new Error('could not find the windowRules entry in main.xml');
    }
    return xmlUnescape(match[1]);
}

describe('windowRules default stays consistent across main.xml and default-window-rules.ts', () => {
    it('main.xml agrees with DEFAULT_WINDOW_RULES', () => {
        expect(parseMainXmlWindowRulesDefault()).toBe(DEFAULT_WINDOW_RULES);
    });

    it('DEFAULT_SETTINGS.windowRules agrees with DEFAULT_WINDOW_RULES', () => {
        expect(DEFAULT_SETTINGS.windowRules).toBe(DEFAULT_WINDOW_RULES);
    });

    it('parses as valid rules with zero warnings', () => {
        const { rules, warnings } = parseWindowRules(DEFAULT_WINDOW_RULES);

        expect(warnings).toEqual([]);
        expect(rules).toHaveLength(10);
    });
});
