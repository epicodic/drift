import { describe, expect, it } from 'vitest';
import { buildKcfgXml } from './kcfg-xml';
import type { SettingsDefinition } from './settings-definitions';

describe('buildKcfgXml', () => {
    it('renders a UInt entry with its default', () => {
        const xml = buildKcfgXml([{ name: 'horizontalGap', type: 'UInt', default: 8 }] as SettingsDefinition[]);
        expect(xml).toContain('<entry name="horizontalGap" type="UInt">');
        expect(xml).toContain('<default>8</default>');
    });

    it('renders a Bool entry with its default', () => {
        const xml = buildKcfgXml([{ name: 'undockKeepAbove', type: 'Bool', default: true }] as SettingsDefinition[]);
        expect(xml).toContain('<entry name="undockKeepAbove" type="Bool">');
        expect(xml).toContain('<default>true</default>');
    });

    it('renders a Double entry with its default', () => {
        const xml = buildKcfgXml([{ name: 'focusFlashOpacity', type: 'Double', default: 0.5 }] as SettingsDefinition[]);
        expect(xml).toContain('<entry name="focusFlashOpacity" type="Double">');
        expect(xml).toContain('<default>0.5</default>');
    });

    it('escapes &, <, and > in a String default', () => {
        const xml = buildKcfgXml([
            { name: 'windowRules', type: 'String', default: 'a & b <c> d' },
        ] as SettingsDefinition[]);
        expect(xml).toContain('<default>a &amp; b &lt;c&gt; d</default>');
    });

    it('wraps entries in the kcfg document structure with a kwinrc kcfgfile', () => {
        const xml = buildKcfgXml([{ name: 'horizontalGap', type: 'UInt', default: 8 }] as SettingsDefinition[]);
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain('<kcfgfile name="kwinrc" />');
        expect(xml.trim().startsWith('<?xml')).toBe(true);
        expect(xml.trim().endsWith('</kcfg>')).toBe(true);
    });
});
