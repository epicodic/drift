// src/core/window-rules.ts
// Per-application window rules: matches a window by resourceClass/caption (case-insensitive
// substring, or /regex/flags for precise matching) and returns float/width/align/screen
// overrides. Pure and KWin-free — parsing, matching, and width resolution only; no window
// mutation (docs: 2026-09-06-window-rules-design).

export type ColumnAlign = 'left' | 'center' | 'right';

export interface WindowRule {
    matchesClass: ((resourceClass: string) => boolean) | null;
    matchesCaption: ((caption: string) => boolean) | null;
    float?: boolean;
    width?: number | string;
    align?: ColumnAlign;
    screen?: number;
}

export interface WindowRuleOverrides {
    width?: number;
    align?: ColumnAlign;
}

const REGEX_FORM = /^\/(.*)\/([a-z]*)$/;
const PERCENT_FORM = /^(\d+(?:\.\d+)?)%$/;

function makeMatcher(pattern: string): ((value: string) => boolean) | null {
    const regexForm = REGEX_FORM.exec(pattern);
    if (regexForm !== null) {
        try {
            const regex = new RegExp(regexForm[1], regexForm[2]);
            return (value: string) => regex.test(value);
        } catch (error) {
            void error;
            return null;
        }
    }
    const needle = pattern.toLowerCase();
    return (value: string) => value.toLowerCase().includes(needle);
}

function parseRuleEntry(entry: unknown, index: number, warnings: string[]): WindowRule | null {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        warnings.push(`windowRules[${index}]: not an object, skipped`);
        return null;
    }
    const raw = entry as Record<string, unknown>;

    let matchesClass: ((value: string) => boolean) | null = null;
    if (raw.class !== undefined) {
        if (typeof raw.class !== 'string') {
            warnings.push(`windowRules[${index}]: "class" must be a string, skipped`);
            return null;
        }
        matchesClass = makeMatcher(raw.class);
        if (matchesClass === null) {
            warnings.push(`windowRules[${index}]: invalid "class" regex, skipped`);
            return null;
        }
    }

    let matchesCaption: ((value: string) => boolean) | null = null;
    if (raw.caption !== undefined) {
        if (typeof raw.caption !== 'string') {
            warnings.push(`windowRules[${index}]: "caption" must be a string, skipped`);
            return null;
        }
        matchesCaption = makeMatcher(raw.caption);
        if (matchesCaption === null) {
            warnings.push(`windowRules[${index}]: invalid "caption" regex, skipped`);
            return null;
        }
    }

    let float: boolean | undefined;
    if (raw.float !== undefined) {
        if (typeof raw.float !== 'boolean') {
            warnings.push(`windowRules[${index}]: "float" must be a boolean, skipped`);
            return null;
        }
        float = raw.float;
    }

    let width: number | string | undefined;
    if (raw.width !== undefined) {
        if (typeof raw.width === 'number') {
            if (raw.width <= 0) {
                warnings.push(`windowRules[${index}]: "width" must be a positive number, skipped`);
                return null;
            }
            width = raw.width;
        } else if (typeof raw.width === 'string' && PERCENT_FORM.test(raw.width)) {
            width = raw.width;
        } else {
            warnings.push(`windowRules[${index}]: "width" must be a positive number or a "NN%" string, skipped`);
            return null;
        }
    }

    let align: ColumnAlign | undefined;
    if (raw.align !== undefined) {
        if (raw.align === 'left' || raw.align === 'center' || raw.align === 'right') {
            align = raw.align;
        } else {
            warnings.push(`windowRules[${index}]: "align" must be "left", "center", or "right", skipped`);
            return null;
        }
    }

    let screen: number | undefined;
    if (raw.screen !== undefined) {
        if (typeof raw.screen !== 'number' || !Number.isInteger(raw.screen) || raw.screen < 0) {
            warnings.push(`windowRules[${index}]: "screen" must be a non-negative integer, skipped`);
            return null;
        }
        screen = raw.screen;
    }

    const rule: WindowRule = { matchesClass, matchesCaption };
    if (float !== undefined) {
        rule.float = float;
    }
    if (width !== undefined) {
        rule.width = width;
    }
    if (align !== undefined) {
        rule.align = align;
    }
    if (screen !== undefined) {
        rule.screen = screen;
    }
    return rule;
}

/** Parses the raw `windowRules` config string into validated rules, plus a warning for
 * every entry (or the whole string) that had to be skipped. Never throws — the caller is
 * expected to log `warnings` (e.g. via `debug()`) and use `rules` regardless. */
export function parseWindowRules(json: string): { rules: WindowRule[]; warnings: string[] } {
    const warnings: string[] = [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        warnings.push(`windowRules: invalid JSON (${String(error)}), no rules loaded`);
        return { rules: [], warnings };
    }
    if (!Array.isArray(parsed)) {
        warnings.push('windowRules: expected a JSON array, no rules loaded');
        return { rules: [], warnings };
    }
    const rules: WindowRule[] = [];
    parsed.forEach((entry, index) => {
        const rule = parseRuleEntry(entry, index, warnings);
        if (rule !== null) {
            rules.push(rule);
        }
    });
    return { rules, warnings };
}

/** First-match-wins lookup: both `class` and `caption` must match when both are set on a
 * rule (AND, not OR). A rule with neither matcher matches every window and doubles as a
 * default/catch-all. */
export function matchRule(rules: WindowRule[], resourceClass: string, caption: string): WindowRule | null {
    for (const rule of rules) {
        const classOk = rule.matchesClass === null || rule.matchesClass(resourceClass);
        const captionOk = rule.matchesCaption === null || rule.matchesCaption(caption);
        if (classOk && captionOk) {
            return rule;
        }
    }
    return null;
}

/** Resolves a rule's `width` against the screen it's opening on: a plain number passes
 * through unchanged, a `"NN%"` string resolves to that percentage of `screenWidth`. Returns
 * `undefined` for a missing width or a non-positive result. */
export function resolveWidth(width: number | string | undefined, screenWidth: number): number | undefined {
    if (width === undefined) {
        return undefined;
    }
    if (typeof width === 'number') {
        return width;
    }
    const match = PERCENT_FORM.exec(width);
    if (match === null) {
        return undefined;
    }
    const resolved = Math.round((Number(match[1]) / 100) * screenWidth);
    return resolved > 0 ? resolved : undefined;
}
