// Builds .build/drift/contents/config/main.xml's content from SETTINGS_DEFINITIONS. Pure and
// side-effect-free so it's directly unit-testable; generate-main-xml.ts is the thin
// script wrapper that actually prints this to stdout for the build.

import type { SettingsDefinition } from './settings-definitions';

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildKcfgXml(definitions: SettingsDefinition[]): string {
    const entries = definitions
        .map((def) => {
            const defaultText = typeof def.default === 'string' ? escapeXml(def.default) : String(def.default);
            const entryStart = `        <entry name="${def.name}" type="${def.type}">`;
            const entryEnd = '        </entry>';
            return `${entryStart}\n            <default>${defaultText}</default>\n${entryEnd}`;
        })
        .join('\n');
    const kcfgStart =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<kcfg xmlns="http://www.kde.org/standards/kcfg/1.0" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'xsi:schemaLocation="http://www.kde.org/standards/kcfg/1.0 ' +
        'http://www.kde.org/standards/kcfg/1.0/kcfg.xsd">\n' +
        '    <kcfgfile name="kwinrc" />\n' +
        '    <group name="">\n';
    return kcfgStart + entries + '\n    </group>\n</kcfg>\n';
}
