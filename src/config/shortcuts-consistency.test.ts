/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';

// Shortcut sequences are unavoidably duplicated across three files that run in three
// different contexts: drift/contents/config/main.xml (read by KWin's own config
// system at runtime), src/config/settings.ts's DEFAULT_SETTINGS (bundled into the
// running KWin script as the readConfig() fallback), and
// drift/contents/bin/setup-shortcuts.sh's DRIFT_BINDINGS table (a standalone script
// that pre-seeds kglobalaccel before Drift's own registration runs, outside the
// bundle entirely). Rather than generating them from one source, this test catches
// drift between them directly.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// "shortcutFocusLeft" -> "DriftFocusLeft" — the naming convention that links a
// main.xml/settings.ts config key to its setup-shortcuts.sh kglobalaccel action name.
function driftActionNameFor(settingsKey: string): string {
    return `Drift${settingsKey.replace(/^shortcut/, '')}`;
}

function parseMainXmlShortcuts(): Map<string, string> {
    const xml = readFileSync(path.join(REPO_ROOT, 'drift/contents/config/main.xml'), 'utf8');
    const shortcuts = new Map<string, string>();
    const entryPattern = /<entry name="(shortcut\w+)" type="String">\s*<default>([^<]*)<\/default>/g;
    for (const match of xml.matchAll(entryPattern)) {
        shortcuts.set(match[1], match[2]);
    }
    return shortcuts;
}

function parseSetupShortcutsBindings(): Map<string, string> {
    const script = readFileSync(path.join(REPO_ROOT, 'drift/contents/bin/setup-shortcuts.sh'), 'utf8');
    const tableMatch = script.match(/DRIFT_BINDINGS='\n([\s\S]*?)\n'/);
    if (!tableMatch) {
        throw new Error('could not find DRIFT_BINDINGS table in setup-shortcuts.sh');
    }
    const bindings = new Map<string, string>();
    for (const line of tableMatch[1].split('\n')) {
        if (!line.trim()) continue;
        // Table columns are padded for readability; a trailing 4th column (alt
        // sequence, e.g. a numpad alternate) is optional and ignored here.
        const [actionName, , sequence] = line.split('|').map((field) => field.trim());
        bindings.set(actionName, sequence);
    }
    return bindings;
}

describe('shortcut sequences stay consistent across main.xml, settings.ts, and setup-shortcuts.sh', () => {
    const xmlShortcuts = parseMainXmlShortcuts();
    const shBindings = parseSetupShortcutsBindings();

    it('found shortcut entries in both main.xml and setup-shortcuts.sh', () => {
        expect(xmlShortcuts.size).toBeGreaterThan(0);
        expect(shBindings.size).toBeGreaterThan(0);
    });

    it('has no DEFAULT_SETTINGS shortcut key that main.xml does not declare', () => {
        const settingsShortcutKeys = Object.keys(DEFAULT_SETTINGS).filter((key) => key.startsWith('shortcut'));
        for (const key of settingsShortcutKeys) {
            expect(xmlShortcuts.has(key)).toBe(true);
        }
    });

    it('has no setup-shortcuts.sh binding that main.xml does not declare', () => {
        const expectedActions = new Set([...xmlShortcuts.keys()].map(driftActionNameFor));
        for (const actionName of shBindings.keys()) {
            expect(expectedActions.has(actionName)).toBe(true);
        }
    });

    for (const [settingsKey, xmlDefault] of parseMainXmlShortcuts()) {
        it(`${settingsKey}: main.xml, DEFAULT_SETTINGS, and setup-shortcuts.sh agree on "${xmlDefault}"`, () => {
            expect((DEFAULT_SETTINGS as unknown as Record<string, string>)[settingsKey]).toBe(xmlDefault);
            expect(shBindings.get(driftActionNameFor(settingsKey))).toBe(xmlDefault);
        });
    }
});
