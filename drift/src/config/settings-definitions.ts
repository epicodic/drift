// The single source of truth for every setting's kcfg schema entry and runtime default —
// generated build output (.build/drift/contents/config/main.xml via generate-main-xml.ts,
// .build/drift/contents/bin/shortcut-bindings.generated.sh via generate-shortcut-bindings.ts) and
// drift/src/config/settings.ts's DEFAULT_SETTINGS/loadSettings() are all derived from this array
// instead of duplicating it by hand (docs/agents/specs/2026-09-06-settings-consolidation-design.md).

import { DEFAULT_WINDOW_RULES } from '../core/default-window-rules';
import type { Settings } from './settings';

/** KConfigXT entry types Drift's settings use. */
export type KcfgType = 'UInt' | 'Bool' | 'String' | 'Double';

/** Metadata for a `shortcut*` setting, feeding the setup-shortcuts.sh generator — absent on
 * every non-shortcut entry. */
export interface ShortcutMetadata {
    /** kglobalaccel action text, without the "Drift: " prefix (the generator adds it). */
    label: string;
    /** Optional second key sequence for the same action (e.g. a numpad alternate). Has no
     * counterpart in Drift's own QML `ShortcutHandler` (src/input/shortcuts.ts) — only
     * reaches kglobalaccel through the generated shortcut-bindings file. */
    altDefault?: string;
}

/** One setting's complete definition. */
export interface SettingsDefinition<K extends keyof Settings = keyof Settings> {
    name: K;
    type: KcfgType;
    default: Settings[K];
    shortcut?: ShortcutMetadata;
}

// A plain generic type parameter doesn't distribute over a union when used as an array's
// element type, so `SettingsDefinition[]` collapses `Settings[K]` to the union of every
// setting's value type instead of checking each entry against its own `name`'s field type.
// This mapped-indexed-access form forces per-element narrowing by `name` instead.
export type AnySettingsDefinition = { [K in keyof Settings]: SettingsDefinition<K> }[keyof Settings];

export const SETTINGS_DEFINITIONS: AnySettingsDefinition[] = [
    { name: 'horizontalGap', type: 'UInt', default: 8 },
    { name: 'verticalGap', type: 'UInt', default: 8 },
    { name: 'defaultColumnWidth', type: 'UInt', default: 800 },
    { name: 'animationDurationMs', type: 'UInt', default: 200 },
    { name: 'topMargin', type: 'UInt', default: 8 },
    { name: 'bottomMargin', type: 'UInt', default: 8 },
    { name: 'leftMargin', type: 'UInt', default: 8 },
    { name: 'rightMargin', type: 'UInt', default: 8 },
    { name: 'shortcutFocusLeft', type: 'String', default: 'Meta+Left', shortcut: { label: 'Focus Column Left' } },
    { name: 'shortcutFocusRight', type: 'String', default: 'Meta+Right', shortcut: { label: 'Focus Column Right' } },
    {
        name: 'shortcutCycleAlignLeft',
        type: 'String',
        default: 'Meta+Shift+Left',
        shortcut: { label: 'Cycle Column Align Left' },
    },
    {
        name: 'shortcutCycleAlignRight',
        type: 'String',
        default: 'Meta+Shift+Right',
        shortcut: { label: 'Cycle Column Align Right' },
    },
    {
        name: 'shortcutViewportShiftLeft',
        type: 'String',
        default: 'Meta+Alt+Left',
        shortcut: { label: 'Shift Viewport Left' },
    },
    {
        name: 'shortcutViewportShiftRight',
        type: 'String',
        default: 'Meta+Alt+Right',
        shortcut: { label: 'Shift Viewport Right' },
    },
    { name: 'shortcutNavigateUp', type: 'String', default: 'Meta+Up', shortcut: { label: 'Navigate Up' } },
    { name: 'shortcutNavigateDown', type: 'String', default: 'Meta+Down', shortcut: { label: 'Navigate Down' } },
    {
        name: 'shortcutMoveWindowToStripAbove',
        type: 'String',
        default: 'Meta+Ctrl+Up',
        shortcut: { label: 'Move Window To Strip Above' },
    },
    {
        name: 'shortcutMoveWindowToStripBelow',
        type: 'String',
        default: 'Meta+Ctrl+Down',
        shortcut: { label: 'Move Window To Strip Below' },
    },
    { name: 'shortcutAbsorbRight', type: 'String', default: 'Meta+I', shortcut: { label: 'Absorb Column Right' } },
    { name: 'shortcutExpel', type: 'String', default: 'Meta+O', shortcut: { label: 'Expel Focused Tile' } },
    {
        name: 'shortcutMoveWindowLeft',
        type: 'String',
        default: 'Meta+Ctrl+Left',
        shortcut: { label: 'Move Window Left' },
    },
    {
        name: 'shortcutMoveWindowRight',
        type: 'String',
        default: 'Meta+Ctrl+Right',
        shortcut: { label: 'Move Window Right' },
    },
    { name: 'shortcutStripUp', type: 'String', default: 'Meta+Page_Up', shortcut: { label: 'Strip Up' } },
    { name: 'shortcutStripDown', type: 'String', default: 'Meta+Page_Down', shortcut: { label: 'Strip Down' } },
    {
        name: 'shortcutMoveColumnToStripAbove',
        type: 'String',
        default: 'Meta+Ctrl+Page_Up',
        shortcut: { label: 'Move Column To Strip Above' },
    },
    {
        name: 'shortcutMoveColumnToStripBelow',
        type: 'String',
        default: 'Meta+Ctrl+Page_Down',
        shortcut: { label: 'Move Column To Strip Below' },
    },
    { name: 'shortcutFocusFirst', type: 'String', default: 'Meta+Home', shortcut: { label: 'Focus First Column' } },
    { name: 'shortcutFocusLast', type: 'String', default: 'Meta+End', shortcut: { label: 'Focus Last Column' } },
    {
        name: 'shortcutMoveWindowToStart',
        type: 'String',
        default: 'Meta+Ctrl+Home',
        shortcut: { label: 'Move Window To Start' },
    },
    {
        name: 'shortcutMoveWindowToEnd',
        type: 'String',
        default: 'Meta+Ctrl+End',
        shortcut: { label: 'Move Window To End' },
    },
    {
        name: 'shortcutViewportShiftToStart',
        type: 'String',
        default: 'Meta+Alt+Home',
        shortcut: { label: 'Shift Viewport To Start' },
    },
    {
        name: 'shortcutViewportShiftToEnd',
        type: 'String',
        default: 'Meta+Alt+End',
        shortcut: { label: 'Shift Viewport To End' },
    },
    {
        name: 'shortcutIncreaseColumnWidth',
        type: 'String',
        default: 'Meta+Plus',
        shortcut: { label: 'Increase Column Width', altDefault: 'Meta+Num+Plus' },
    },
    {
        name: 'shortcutDecreaseColumnWidth',
        type: 'String',
        default: 'Meta+Minus',
        shortcut: { label: 'Decrease Column Width', altDefault: 'Meta+Num+Minus' },
    },
    {
        name: 'shortcutIncreaseWindowHeight',
        type: 'String',
        default: 'Meta+Shift+Plus',
        shortcut: { label: 'Increase Window Height', altDefault: 'Meta+Shift+Num+Plus' },
    },
    {
        name: 'shortcutDecreaseWindowHeight',
        type: 'String',
        default: 'Meta+Shift+Minus',
        shortcut: { label: 'Decrease Window Height', altDefault: 'Meta+Shift+Num+Minus' },
    },
    { name: 'viewportShiftStep', type: 'UInt', default: 400 },
    { name: 'columnWidthStep', type: 'UInt', default: 80 },
    { name: 'windowHeightStep', type: 'UInt', default: 80 },
    { name: 'stripDragDwellMs', type: 'UInt', default: 400 },
    { name: 'stripDragEdgeBorderPx', type: 'UInt', default: 2 },
    { name: 'columnDragDwellMs', type: 'UInt', default: 400 },
    { name: 'reorderThresholdFraction', type: 'Double', default: 0.85 },
    { name: 'stackOverlapFraction', type: 'Double', default: 0.5 },
    { name: 'dragPanEnabled', type: 'Bool', default: true },
    { name: 'dragPanVerticalTolerancePx', type: 'UInt', default: 40 },
    { name: 'minimapAutoHideMs', type: 'UInt', default: 1200 },
    { name: 'minimapShowThumbnails', type: 'Bool', default: true },
    { name: 'focusFlashEnabled', type: 'Bool', default: true },
    { name: 'focusFlashBorderWidth', type: 'UInt', default: 4 },
    { name: 'focusFlashBlurRadius', type: 'UInt', default: 24 },
    { name: 'focusFlashDurationMs', type: 'UInt', default: 300 },
    { name: 'focusFlashOpacity', type: 'Double', default: 0.5 },
    { name: 'undockKeepAbove', type: 'Bool', default: true },
    { name: 'debugConsoleEnabled', type: 'Bool', default: false },
    { name: 'shortcutToggleFloating', type: 'String', default: 'Meta+Space', shortcut: { label: 'Toggle Floating' } },
    { name: 'windowRules', type: 'String', default: DEFAULT_WINDOW_RULES },
];
