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
    /** Shortcut sequence for focusing the column to the left. */
    shortcutFocusLeft: string;
    /** Shortcut sequence for focusing the column to the right. */
    shortcutFocusRight: string;
    /** Shortcut sequence for toggling the debug console. */
    shortcutToggleDebugConsole: string;
    /** Shortcut sequence for cycling the focused column's align/focus leftward. */
    shortcutCycleAlignLeft: string;
    /** Shortcut sequence for cycling the focused column's align/focus rightward. */
    shortcutCycleAlignRight: string;
    /** Shortcut sequence for panning the viewport left without changing focus. */
    shortcutViewportShiftLeft: string;
    /** Shortcut sequence for panning the viewport right without changing focus. */
    shortcutViewportShiftRight: string;
    /** Shortcut sequence for paging to the row above (docs: 2026-09-01-row-navigation-design). */
    shortcutRowUp: string;
    /** Shortcut sequence for paging to the row below. */
    shortcutRowDown: string;
    /** Shortcut sequence for moving the focused window to the row above and following it there. */
    shortcutMoveWindowToRowAbove: string;
    /** Shortcut sequence for moving the focused window to the row below and following it there. */
    shortcutMoveWindowToRowBelow: string;
    /** Distance the viewport pans per shortcut press, in pixels. */
    viewportShiftStep: number;
    /** How long the pointer must stay at the screen's top/bottom edge before the dragged
     * window flips into the row above/below, in milliseconds (docs:
     * 2026-09-02-cross-row-drag-design). */
    rowDragDwellMs: number;
    /** How close to the screen's top/bottom edge, in pixels, the pointer must be for a
     * cross-row drag to arm. The OS clamps the pointer to the screen, so it can only ever
     * reach the edge itself, not go past it — this border gives that a little slack against
     * rounding/jitter rather than requiring the exact boundary pixel. */
    rowDragEdgeBorderPx: number;
    /** How long the minimap overlay stays visible after the last focus-step press, in milliseconds. */
    minimapAutoHideMs: number;
    /** Whether the minimap's column boxes show a live preview of each window's content
     * (docs: 2026-09-01-minimap-thumbnails-design). Off falls back to icon-only, as before. */
    minimapShowThumbnails: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    columnGap: 8,
    defaultColumnWidth: 800,
    animationDurationMs: 200,
    animationTickMs: 16,
    bottomMargin: 0,
    shortcutFocusLeft: 'Meta+Shift+Tab',
    shortcutFocusRight: 'Meta+Tab',
    shortcutToggleDebugConsole: 'Meta+Shift+D',
    shortcutCycleAlignLeft: 'Meta+Left',
    shortcutCycleAlignRight: 'Meta+Right',
    shortcutViewportShiftLeft: 'Meta+Shift+Left',
    shortcutViewportShiftRight: 'Meta+Shift+Right',
    shortcutRowUp: 'Meta+Page_Up',
    shortcutRowDown: 'Meta+Page_Down',
    shortcutMoveWindowToRowAbove: 'Meta+Shift+Page_Up',
    shortcutMoveWindowToRowBelow: 'Meta+Shift+Page_Down',
    viewportShiftStep: 400,
    rowDragDwellMs: 400,
    rowDragEdgeBorderPx: 2,
    minimapAutoHideMs: 1200,
    minimapShowThumbnails: true,
};

/** Reads user-configurable settings from kwinrc (docs §5). Untestable glue (docs §8). */
export function loadSettings(): Settings {
    // Object spread is unsupported by KWin's declarativescript JS engine — use Object.assign.
    return Object.assign({}, DEFAULT_SETTINGS, {
        bottomMargin: readNumberConfig('bottomMargin', DEFAULT_SETTINGS.bottomMargin),
        columnGap: readNumberConfig('columnGap', DEFAULT_SETTINGS.columnGap),
        defaultColumnWidth: readNumberConfig('defaultColumnWidth', DEFAULT_SETTINGS.defaultColumnWidth),
        animationDurationMs: readNumberConfig('animationDurationMs', DEFAULT_SETTINGS.animationDurationMs),
        viewportShiftStep: readNumberConfig('viewportShiftStep', DEFAULT_SETTINGS.viewportShiftStep),
        rowDragDwellMs: readNumberConfig('rowDragDwellMs', DEFAULT_SETTINGS.rowDragDwellMs),
        rowDragEdgeBorderPx: readNumberConfig('rowDragEdgeBorderPx', DEFAULT_SETTINGS.rowDragEdgeBorderPx),
        minimapAutoHideMs: readNumberConfig('minimapAutoHideMs', DEFAULT_SETTINGS.minimapAutoHideMs),
        minimapShowThumbnails: readBooleanConfig('minimapShowThumbnails', DEFAULT_SETTINGS.minimapShowThumbnails),
        shortcutFocusLeft: readStringConfig('shortcutFocusLeft', DEFAULT_SETTINGS.shortcutFocusLeft),
        shortcutFocusRight: readStringConfig('shortcutFocusRight', DEFAULT_SETTINGS.shortcutFocusRight),
        shortcutToggleDebugConsole: readStringConfig(
            'shortcutToggleDebugConsole',
            DEFAULT_SETTINGS.shortcutToggleDebugConsole,
        ),
        shortcutCycleAlignLeft: readStringConfig('shortcutCycleAlignLeft', DEFAULT_SETTINGS.shortcutCycleAlignLeft),
        shortcutCycleAlignRight: readStringConfig('shortcutCycleAlignRight', DEFAULT_SETTINGS.shortcutCycleAlignRight),
        shortcutViewportShiftLeft: readStringConfig(
            'shortcutViewportShiftLeft',
            DEFAULT_SETTINGS.shortcutViewportShiftLeft,
        ),
        shortcutViewportShiftRight: readStringConfig(
            'shortcutViewportShiftRight',
            DEFAULT_SETTINGS.shortcutViewportShiftRight,
        ),
        shortcutRowUp: readStringConfig('shortcutRowUp', DEFAULT_SETTINGS.shortcutRowUp),
        shortcutRowDown: readStringConfig('shortcutRowDown', DEFAULT_SETTINGS.shortcutRowDown),
        shortcutMoveWindowToRowAbove: readStringConfig(
            'shortcutMoveWindowToRowAbove',
            DEFAULT_SETTINGS.shortcutMoveWindowToRowAbove,
        ),
        shortcutMoveWindowToRowBelow: readStringConfig(
            'shortcutMoveWindowToRowBelow',
            DEFAULT_SETTINGS.shortcutMoveWindowToRowBelow,
        ),
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

// Same rationale as readNumberConfig: never let a bad config value take down init().
function readStringConfig(key: string, defaultValue: string): string {
    try {
        const value = KWin.readConfig(key, defaultValue);
        return typeof value === 'string' && value.length > 0 ? value : defaultValue;
    } catch (error) {
        void error;
        return defaultValue;
    }
}

// Same rationale as readNumberConfig: never let a bad config value take down init().
function readBooleanConfig(key: string, defaultValue: boolean): boolean {
    try {
        const value = KWin.readConfig(key, defaultValue);
        return typeof value === 'boolean' ? value : defaultValue;
    } catch (error) {
        void error;
        return defaultValue;
    }
}
