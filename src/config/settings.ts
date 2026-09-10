// Settings and their defaults are defined once in settings-definitions.ts (single source of
// truth — docs/agents/specs/2026-09-06-settings-consolidation-design.md); this file derives
// DEFAULT_SETTINGS from it and reads the live values through `KWin.readConfig`, backed by
// the generated drift/contents/config/main.xml (KConfigXT schema).

import { SETTINGS_DEFINITIONS } from './settings-definitions';

export interface Settings {
    /** Horizontal gap between columns, in pixels. */
    horizontalGap: number;
    /** Vertical gap between tiles stacked within a column, in pixels. */
    verticalGap: number;
    /** Width given to a newly opened window's column, in pixels. */
    defaultColumnWidth: number;
    /** Duration of a focus-scroll animation, in milliseconds. */
    animationDurationMs: number;
    /** Space reserved at the top of the screen, in pixels. */
    topMargin: number;
    /** Space reserved at the bottom of the screen, in pixels. */
    bottomMargin: number;
    /** Space reserved at the left of the screen, in pixels. */
    leftMargin: number;
    /** Space reserved at the right of the screen, in pixels. */
    rightMargin: number;
    /** Shortcut sequence for focusing the column to the left. */
    shortcutFocusLeft: string;
    /** Shortcut sequence for focusing the column to the right. */
    shortcutFocusRight: string;
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
    /** Shortcut sequence for focusing the first column in the strip. */
    shortcutFocusFirst: string;
    /** Shortcut sequence for focusing the last column in the strip. */
    shortcutFocusLast: string;
    /** Shortcut sequence for moving the focused column to the start of the strip. */
    shortcutMoveWindowToStart: string;
    /** Shortcut sequence for moving the focused column to the end of the strip. */
    shortcutMoveWindowToEnd: string;
    /** Shortcut sequence for panning the viewport to the strip's start without changing focus. */
    shortcutViewportShiftToStart: string;
    /** Shortcut sequence for panning the viewport to the strip's end without changing focus. */
    shortcutViewportShiftToEnd: string;
    /** Shortcut sequence for growing the focused column's width by `columnWidthStep`. */
    shortcutIncreaseColumnWidth: string;
    /** Shortcut sequence for shrinking the focused column's width by `columnWidthStep`. */
    shortcutDecreaseColumnWidth: string;
    /** Shortcut sequence for growing the focused tile's height by `windowHeightStep` (stacked columns only). */
    shortcutIncreaseWindowHeight: string;
    /** Shortcut sequence for shrinking the focused tile's height by `windowHeightStep` (stacked columns only). */
    shortcutDecreaseWindowHeight: string;
    /** Distance the viewport pans per shortcut press, in pixels. */
    viewportShiftStep: number;
    /** Distance a column's width changes per `shortcutIncreaseColumnWidth`/`shortcutDecreaseColumnWidth`
     * press, in pixels. */
    columnWidthStep: number;
    /** Distance a stacked tile's height changes per `shortcutIncreaseWindowHeight`/`shortcutDecreaseWindowHeight`
     * press, in pixels. */
    windowHeightStep: number;
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
    /** Fraction of a neighbor column's width the dragged column's edge must penetrate
     * (measured from their shared boundary) before a reorder swap fires — generalizes the
     * old fixed 50% center-crossing threshold so a swap commits near the drag's final
     * post-swap position instead of at the halfway point, cutting down on swaps firing off
     * a drag that only grazed a neighbor (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    reorderThresholdFraction: number;
    /** Minimum horizontal overlap (as a fraction of the candidate tile's own width)
     * between the dragged window and a candidate tile before that tile is considered for
     * stacking at all (docs: 2026-09-07-drag-reorder-stack-refinement-design). */
    stackOverlapFraction: number;
    /** How long the minimap overlay stays visible after the last focus-step press, in milliseconds. */
    minimapAutoHideMs: number;
    /** Whether the minimap's column boxes show a live preview of each window's content
     * (docs: 2026-09-01-minimap-thumbnails-design). Off falls back to icon-only, as before. */
    minimapShowThumbnails: boolean;
    /** Whether the focus-flash highlight is shown at all (docs:
     * 2026-09-05-focus-flash-highlight-design). */
    focusFlashEnabled: boolean;
    /** Width of the focus-flash highlight's border, in pixels. */
    focusFlashBorderWidth: number;
    /** Blur radius of the focus-flash highlight, in pixels. */
    focusFlashBlurRadius: number;
    /** Total duration of the focus-flash fade-in-then-fade-out, in milliseconds. */
    focusFlashDurationMs: number;
    /** Peak opacity of the focus-flash highlight at the midpoint of its fade-in-then-fade-out
     * (docs: 2026-09-05-focus-flash-highlight-design.md). */
    focusFlashOpacity: number;
    /** Whether an undocked window is kept above still-docked windows (docs:
     * 2026-09-06-manual-undock-redock-design). */
    undockKeepAbove: boolean;
    /** Whether the on-screen debug console overlay is created at all. Off by default — it's a
     * developer tool, not user-facing. Takes effect on restart, like every other setting here. */
    debugConsoleEnabled: boolean;
    /** Shortcut sequence for toggling the active window between docked and floating. */
    shortcutToggleFloating: string;
    /** Raw JSON array of window rules, matched by resourceClass/caption to override a newly
     * opened window's float/width/align, and (currently inert) screen (docs:
     * 2026-09-06-window-rules-design). Defaults to `DEFAULT_WINDOW_RULES`, a starter set
     * translated from Karousel's own bundled defaults. */
    windowRules: string;
}

function buildDefaultSettings(): Settings {
    // Object spread/Object.fromEntries are unsupported (spread confirmed; fromEntries
    // unconfirmed) by KWin's declarativescript JS engine — build the object with a plain
    // loop and bracket assignment instead, both already used elsewhere in this codebase.
    const settings: Record<string, unknown> = {};
    for (const definition of SETTINGS_DEFINITIONS) {
        settings[definition.name] = definition.default;
    }
    return settings as unknown as Settings;
}

export const DEFAULT_SETTINGS: Settings = buildDefaultSettings();

/** Reads user-configurable settings from kwinrc (docs §5). Untestable glue (docs §8). */
export function loadSettings(): Settings {
    const settings: Record<string, unknown> = {};
    for (const definition of SETTINGS_DEFINITIONS) {
        switch (definition.type) {
            case 'UInt':
            case 'Double':
                settings[definition.name] = readNumberConfig(definition.name, definition.default as number);
                break;
            case 'String':
                settings[definition.name] = readStringConfig(definition.name, definition.default as string);
                break;
            case 'Bool':
                settings[definition.name] = readBooleanConfig(definition.name, definition.default as boolean);
                break;
        }
    }
    return settings as unknown as Settings;
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
