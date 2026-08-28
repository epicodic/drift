// Hardcoded spike defaults (docs §7.2). Real per-package configuration via
// `readConfig` comes later (docs §5); the spike only needs stable numbers.

export interface Settings {
    /** Horizontal gap between columns, in pixels. */
    columnGap: number;
    /** Width given to a newly opened window's column, in pixels. */
    defaultColumnWidth: number;
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Timer tick interval driving the animation, in milliseconds (~60fps). */
    animationTickMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
    columnGap: 8,
    defaultColumnWidth: 800,
    animationDurationMs: 200,
    animationTickMs: 16,
};
