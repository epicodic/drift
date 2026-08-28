// Hardcoded spike defaults (docs §7.2), overridable via the package's config/main.xml
// (KConfigXT, read through `KWin.readConfig`) — the same mechanism Karousel uses.

export interface Settings {
    /** Horizontal gap between columns, in pixels. */
    columnGap: number;
    /** Width given to a newly opened window's column, in pixels. */
    defaultColumnWidth: number;
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Timer tick interval driving the animation, in milliseconds (~60fps). */
    animationTickMs: number;
    /** Space reserved at the bottom of the screen (e.g. for a panel), in pixels. */
    bottomMargin: number;
}

export const DEFAULT_SETTINGS: Settings = {
    columnGap: 8,
    defaultColumnWidth: 800,
    animationDurationMs: 200,
    animationTickMs: 16,
    bottomMargin: 0,
};

/** Reads user-configurable settings from kwinrc (docs §5). Untestable glue (docs §8). */
export function loadSettings(): Settings {
    // Object spread is unsupported by KWin's declarativescript JS engine — use Object.assign.
    return Object.assign({}, DEFAULT_SETTINGS, {
        bottomMargin: readNumberConfig('marginBottom', DEFAULT_SETTINGS.bottomMargin),
    });
}

// A bad/unexpected value here must never take down the rest of init() (docs §8).
function readNumberConfig(key: string, defaultValue: number): number {
    try {
        const value = KWin.readConfig(key, defaultValue);
        return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
    } catch (error) {
        // Optional catch binding (`catch {`) is also unsupported by the same engine.
        void error;
        return defaultValue;
    }
}
