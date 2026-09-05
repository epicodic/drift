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
    /** Shortcut sequence for moving tile focus up within the focused column's stack if
     * it can, otherwise paging to the strip above (docs: 2026-09-01-row-navigation-design,
     * 2026-09-03-vertical-tiling-design). */
    shortcutNavigateUp: string;
    /** Shortcut sequence for moving tile focus down within the focused column's stack if
     * it can, otherwise paging to the strip below. */
    shortcutNavigateDown: string;
    /** Shortcut sequence for moving the focused tile up within its column's stack if it can;
     * otherwise (already at the top, or a single-tile column) expelling it to the strip
     * above and following it there. */
    shortcutMoveWindowToStripAbove: string;
    /** Shortcut sequence for moving the focused tile down within its column's stack if it
     * can; otherwise (already at the bottom, or a single-tile column) expelling it to the
     * strip below and following it there. */
    shortcutMoveWindowToStripBelow: string;
    /** Shortcut sequence for absorbing the column to the right into the focused
     * column's stack, as a new tile. */
    shortcutAbsorbRight: string;
    /** Shortcut sequence for expelling the focused tile into its own new column
     * to the right. */
    shortcutExpel: string;
    /** Shortcut sequence for moving the focused window's column left within the strip. */
    shortcutMoveWindowLeft: string;
    /** Shortcut sequence for moving the focused window's column right within the strip. */
    shortcutMoveWindowRight: string;
    /** Shortcut sequence for paging to the strip above, without touching tile focus within
     * the current column's stack — unlike `shortcutNavigateUp`, this always changes strips,
     * even for a stacked column that isn't focused on its top tile. */
    shortcutStripUp: string;
    /** Shortcut sequence for paging to the strip below — see `shortcutStripUp`. */
    shortcutStripDown: string;
    /** Shortcut sequence for moving the whole focused column — every tile in its stack, kept
     * together — to the strip above and following it there. Unlike
     * `shortcutMoveWindowToStripAbove`, this always changes strips, even when the focused
     * tile isn't at the top of its stack. */
    shortcutMoveColumnToStripAbove: string;
    /** Shortcut sequence for moving the whole focused column to the strip below — see
     * `shortcutMoveColumnToStripAbove`. */
    shortcutMoveColumnToStripBelow: string;
    /** Distance the viewport pans per shortcut press, in pixels. */
    viewportShiftStep: number;
    /** How long the pointer must stay at the screen's top/bottom edge before the dragged
     * window flips into the strip above/below, in milliseconds (docs:
     * 2026-09-02-cross-row-drag-design). */
    stripDragDwellMs: number;
    /** How close to the screen's top/bottom edge, in pixels, the pointer must be for a
     * cross-strip drag to arm. The OS clamps the pointer to the screen, so it can only ever
     * reach the edge itself, not go past it — this border gives that a little slack against
     * rounding/jitter rather than requiring the exact boundary pixel. */
    stripDragEdgeBorderPx: number;
    /** How long the pointer must dwell over a neighbor column before a cross-column drag
     * previews stacking into it (docs: 2026-09-04-drag-reorder-stack-priority-design). Until
     * the dwell elapses, hovering a neighbor whose edge-crossing threshold hasn't fired shows
     * no preview at all — this is what stops a fast drag-through from flashing a stack preview
     * on its way to a genuine reorder swap. */
    columnDragDwellMs: number;
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
    shortcutFocusLeft: 'Meta+Left',
    shortcutFocusRight: 'Meta+Right',
    shortcutToggleDebugConsole: 'Meta+Shift+D',
    shortcutCycleAlignLeft: 'Meta+Shift+Left',
    shortcutCycleAlignRight: 'Meta+Shift+Right',
    shortcutViewportShiftLeft: 'Meta+Alt+Left',
    shortcutViewportShiftRight: 'Meta+Alt+Right',
    shortcutNavigateUp: 'Meta+Up',
    shortcutNavigateDown: 'Meta+Down',
    shortcutMoveWindowToStripAbove: 'Meta+Ctrl+Up',
    shortcutMoveWindowToStripBelow: 'Meta+Ctrl+Down',
    shortcutAbsorbRight: 'Meta+I',
    shortcutExpel: 'Meta+O',
    shortcutMoveWindowLeft: 'Meta+Ctrl+Left',
    shortcutMoveWindowRight: 'Meta+Ctrl+Right',
    shortcutStripUp: 'Meta+Page_Up',
    shortcutStripDown: 'Meta+Page_Down',
    shortcutMoveColumnToStripAbove: 'Meta+Ctrl+Page_Up',
    shortcutMoveColumnToStripBelow: 'Meta+Ctrl+Page_Down',
    viewportShiftStep: 400,
    stripDragDwellMs: 400,
    stripDragEdgeBorderPx: 2,
    columnDragDwellMs: 400,
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
        stripDragDwellMs: readNumberConfig('stripDragDwellMs', DEFAULT_SETTINGS.stripDragDwellMs),
        stripDragEdgeBorderPx: readNumberConfig('stripDragEdgeBorderPx', DEFAULT_SETTINGS.stripDragEdgeBorderPx),
        columnDragDwellMs: readNumberConfig('columnDragDwellMs', DEFAULT_SETTINGS.columnDragDwellMs),
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
        shortcutNavigateUp: readStringConfig('shortcutNavigateUp', DEFAULT_SETTINGS.shortcutNavigateUp),
        shortcutNavigateDown: readStringConfig('shortcutNavigateDown', DEFAULT_SETTINGS.shortcutNavigateDown),
        shortcutMoveWindowToStripAbove: readStringConfig(
            'shortcutMoveWindowToStripAbove',
            DEFAULT_SETTINGS.shortcutMoveWindowToStripAbove,
        ),
        shortcutMoveWindowToStripBelow: readStringConfig(
            'shortcutMoveWindowToStripBelow',
            DEFAULT_SETTINGS.shortcutMoveWindowToStripBelow,
        ),
        shortcutAbsorbRight: readStringConfig('shortcutAbsorbRight', DEFAULT_SETTINGS.shortcutAbsorbRight),
        shortcutExpel: readStringConfig('shortcutExpel', DEFAULT_SETTINGS.shortcutExpel),
        shortcutMoveWindowLeft: readStringConfig('shortcutMoveWindowLeft', DEFAULT_SETTINGS.shortcutMoveWindowLeft),
        shortcutMoveWindowRight: readStringConfig('shortcutMoveWindowRight', DEFAULT_SETTINGS.shortcutMoveWindowRight),
        shortcutStripUp: readStringConfig('shortcutStripUp', DEFAULT_SETTINGS.shortcutStripUp),
        shortcutStripDown: readStringConfig('shortcutStripDown', DEFAULT_SETTINGS.shortcutStripDown),
        shortcutMoveColumnToStripAbove: readStringConfig(
            'shortcutMoveColumnToStripAbove',
            DEFAULT_SETTINGS.shortcutMoveColumnToStripAbove,
        ),
        shortcutMoveColumnToStripBelow: readStringConfig(
            'shortcutMoveColumnToStripBelow',
            DEFAULT_SETTINGS.shortcutMoveColumnToStripBelow,
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
