// src/core/window-rules.test.ts
import { describe, expect, it } from 'vitest';
import { matchRule, parseWindowRules, resolveWidth } from './window-rules';

describe('parseWindowRules', () => {
    it('parses a rule with every field set', () => {
        const { rules, warnings } = parseWindowRules(
            '[{"class":"firefox","caption":"Picture","float":true,"width":900,"align":"left","screen":1}]',
        );

        expect(warnings).toEqual([]);
        expect(rules).toHaveLength(1);
        expect(rules[0].float).toBe(true);
        expect(rules[0].width).toBe(900);
        expect(rules[0].align).toBe('left');
        expect(rules[0].screen).toBe(1);
        expect(rules[0].matchesClass?.('Firefox')).toBe(true);
        expect(rules[0].matchesCaption?.('Picture-in-Picture')).toBe(true);
    });

    it('parses a rule with every field left out except a matcher', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"slack"}]');

        expect(warnings).toEqual([]);
        expect(rules[0].float).toBeUndefined();
        expect(rules[0].width).toBeUndefined();
        expect(rules[0].align).toBeUndefined();
        expect(rules[0].screen).toBeUndefined();
    });

    it('falls back to no rules on invalid JSON', () => {
        const { rules, warnings } = parseWindowRules('not json');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it('falls back to no rules when the top level is not an array', () => {
        const { rules, warnings } = parseWindowRules('{"class":"firefox"}');

        expect(rules).toEqual([]);
        expect(warnings).toEqual(['windowRules: expected a JSON array, no rules loaded']);
    });

    it('skips one malformed entry but keeps the rest', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"firefox","width":"banana"},{"class":"slack"}]');

        expect(rules).toHaveLength(1);
        expect(rules[0].matchesClass?.('slack')).toBe(true);
        expect(warnings).toHaveLength(1);
    });

    it('compiles a /pattern/flags matcher as a real regex', () => {
        const { rules } = parseWindowRules('[{"caption":"/^zoom($| )/i"}]');

        expect(rules[0].matchesCaption?.('Zoom Meeting')).toBe(true);
        expect(rules[0].matchesCaption?.('not a match')).toBe(false);
    });

    it('skips an entry with an invalid regex', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"/(unclosed/"}]');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it('rejects a non-positive width', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"x","width":0}]');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it('rejects an align value outside left/center/right', () => {
        const { rules, warnings } = parseWindowRules('[{"class":"x","align":"up"}]');

        expect(rules).toEqual([]);
        expect(warnings).toHaveLength(1);
    });
});

describe('matchRule', () => {
    it('matches a case-insensitive substring by default', () => {
        const { rules } = parseWindowRules('[{"class":"firefox"}]');

        expect(matchRule(rules, 'Firefox-esr', 'anything')).toBe(rules[0]);
    });

    it('requires both class and caption to match when both are set (AND, not OR)', () => {
        const { rules } = parseWindowRules('[{"class":"zoom","caption":"Meeting"}]');

        expect(matchRule(rules, 'zoom', 'Meeting')).toBe(rules[0]);
        expect(matchRule(rules, 'other-app', 'Meeting')).toBeNull();
    });

    it('matches everything for a rule with no matcher at all', () => {
        const { rules } = parseWindowRules('[{"float":true}]');

        expect(matchRule(rules, 'anything', 'anything')).toBe(rules[0]);
    });

    it('returns the first matching rule (first-match-wins)', () => {
        const { rules } = parseWindowRules('[{"class":"firefox","align":"left"},{"class":"firefox","align":"right"}]');

        expect(matchRule(rules, 'firefox', 'x')?.align).toBe('left');
    });

    it('returns null when nothing matches', () => {
        const { rules } = parseWindowRules('[{"class":"firefox"}]');

        expect(matchRule(rules, 'slack', 'x')).toBeNull();
    });
});

describe('resolveWidth', () => {
    it('passes a plain number through unchanged', () => {
        expect(resolveWidth(900, 1920)).toBe(900);
    });

    it('resolves a percentage string against the given screen width', () => {
        expect(resolveWidth('50%', 1920)).toBe(960);
    });

    it('returns undefined for an undefined width', () => {
        expect(resolveWidth(undefined, 1920)).toBeUndefined();
    });
});
