// Binds global shortcuts to Drift actions. Under declarativescript there is no
// `registerShortcut` global — each shortcut is a QML `ShortcutHandler` element from
// `org.kde.kwin`, created via `Qt.createQmlObject` parented to the QML root (docs §4).

import type { Settings } from '../config/settings';
import { debug } from '../debug';

export interface ShortcutActions {
    focusLeft(): void;
    focusRight(): void;
    toggleDebugConsole(): void;
    cycleAlignLeft(): void;
    cycleAlignRight(): void;
    shiftViewportLeft(): void;
    shiftViewportRight(): void;
    navigateUp(): void;
    navigateDown(): void;
    moveWindowToStripAbove(): void;
    moveWindowToStripBelow(): void;
    absorbRight(): void;
    expel(): void;
    moveWindowLeft(): void;
    moveWindowRight(): void;
    stripUp(): void;
    stripDown(): void;
    moveColumnToStripAbove(): void;
    moveColumnToStripBelow(): void;
    focusFirst(): void;
    focusLast(): void;
    moveWindowToStart(): void;
    moveWindowToEnd(): void;
    shiftViewportToStart(): void;
    shiftViewportToEnd(): void;
    increaseColumnWidth(): void;
    decreaseColumnWidth(): void;
    increaseWindowHeight(): void;
    decreaseWindowHeight(): void;
}

export function registerShortcuts(parent: QmlObject, settings: Settings, actions: ShortcutActions): void {
    createShortcut(parent, 'DriftFocusLeft', 'Drift: Focus Column Left', settings.shortcutFocusLeft, actions.focusLeft);
    createShortcut(
        parent,
        'DriftFocusRight',
        'Drift: Focus Column Right',
        settings.shortcutFocusRight,
        actions.focusRight,
    );
    createShortcut(
        parent,
        'DriftToggleDebugConsole',
        'Drift: Toggle Debug Console',
        settings.shortcutToggleDebugConsole,
        actions.toggleDebugConsole,
    );
    createShortcut(
        parent,
        'DriftCycleAlignLeft',
        'Drift: Cycle Column Align Left',
        settings.shortcutCycleAlignLeft,
        actions.cycleAlignLeft,
    );
    createShortcut(
        parent,
        'DriftCycleAlignRight',
        'Drift: Cycle Column Align Right',
        settings.shortcutCycleAlignRight,
        actions.cycleAlignRight,
    );
    createShortcut(
        parent,
        'DriftViewportShiftLeft',
        'Drift: Shift Viewport Left',
        settings.shortcutViewportShiftLeft,
        actions.shiftViewportLeft,
    );
    createShortcut(
        parent,
        'DriftViewportShiftRight',
        'Drift: Shift Viewport Right',
        settings.shortcutViewportShiftRight,
        actions.shiftViewportRight,
    );
    createShortcut(parent, 'DriftNavigateUp', 'Drift: Navigate Up', settings.shortcutNavigateUp, actions.navigateUp);
    createShortcut(
        parent,
        'DriftNavigateDown',
        'Drift: Navigate Down',
        settings.shortcutNavigateDown,
        actions.navigateDown,
    );
    createShortcut(
        parent,
        'DriftMoveWindowToStripAbove',
        'Drift: Move Window To Strip Above',
        settings.shortcutMoveWindowToStripAbove,
        actions.moveWindowToStripAbove,
    );
    createShortcut(
        parent,
        'DriftMoveWindowToStripBelow',
        'Drift: Move Window To Strip Below',
        settings.shortcutMoveWindowToStripBelow,
        actions.moveWindowToStripBelow,
    );
    createShortcut(
        parent,
        'DriftAbsorbRight',
        'Drift: Absorb Column Right',
        settings.shortcutAbsorbRight,
        actions.absorbRight,
    );
    createShortcut(parent, 'DriftExpel', 'Drift: Expel Focused Tile', settings.shortcutExpel, actions.expel);
    createShortcut(
        parent,
        'DriftMoveWindowLeft',
        'Drift: Move Window Left',
        settings.shortcutMoveWindowLeft,
        actions.moveWindowLeft,
    );
    createShortcut(
        parent,
        'DriftMoveWindowRight',
        'Drift: Move Window Right',
        settings.shortcutMoveWindowRight,
        actions.moveWindowRight,
    );
    createShortcut(parent, 'DriftStripUp', 'Drift: Strip Up', settings.shortcutStripUp, actions.stripUp);
    createShortcut(parent, 'DriftStripDown', 'Drift: Strip Down', settings.shortcutStripDown, actions.stripDown);
    createShortcut(
        parent,
        'DriftMoveColumnToStripAbove',
        'Drift: Move Column To Strip Above',
        settings.shortcutMoveColumnToStripAbove,
        actions.moveColumnToStripAbove,
    );
    createShortcut(
        parent,
        'DriftMoveColumnToStripBelow',
        'Drift: Move Column To Strip Below',
        settings.shortcutMoveColumnToStripBelow,
        actions.moveColumnToStripBelow,
    );
    createShortcut(
        parent,
        'DriftFocusFirst',
        'Drift: Focus First Column',
        settings.shortcutFocusFirst,
        actions.focusFirst,
    );
    createShortcut(parent, 'DriftFocusLast', 'Drift: Focus Last Column', settings.shortcutFocusLast, actions.focusLast);
    createShortcut(
        parent,
        'DriftMoveWindowToStart',
        'Drift: Move Window To Start',
        settings.shortcutMoveWindowToStart,
        actions.moveWindowToStart,
    );
    createShortcut(
        parent,
        'DriftMoveWindowToEnd',
        'Drift: Move Window To End',
        settings.shortcutMoveWindowToEnd,
        actions.moveWindowToEnd,
    );
    createShortcut(
        parent,
        'DriftViewportShiftToStart',
        'Drift: Shift Viewport To Start',
        settings.shortcutViewportShiftToStart,
        actions.shiftViewportToStart,
    );
    createShortcut(
        parent,
        'DriftViewportShiftToEnd',
        'Drift: Shift Viewport To End',
        settings.shortcutViewportShiftToEnd,
        actions.shiftViewportToEnd,
    );
    createShortcut(
        parent,
        'DriftIncreaseColumnWidth',
        'Drift: Increase Column Width',
        settings.shortcutIncreaseColumnWidth,
        actions.increaseColumnWidth,
    );
    createShortcut(
        parent,
        'DriftDecreaseColumnWidth',
        'Drift: Decrease Column Width',
        settings.shortcutDecreaseColumnWidth,
        actions.decreaseColumnWidth,
    );
    createShortcut(
        parent,
        'DriftIncreaseWindowHeight',
        'Drift: Increase Window Height',
        settings.shortcutIncreaseWindowHeight,
        actions.increaseWindowHeight,
    );
    createShortcut(
        parent,
        'DriftDecreaseWindowHeight',
        'Drift: Decrease Window Height',
        settings.shortcutDecreaseWindowHeight,
        actions.decreaseWindowHeight,
    );
}

export function createShortcut(
    parent: QmlObject,
    name: string,
    text: string,
    sequence: string,
    onActivated: () => void,
): void {
    const qml = `import QtQuick 6.0
import org.kde.kwin 3.0
ShortcutHandler {
    name: ${JSON.stringify(name)}
    text: ${JSON.stringify(text)}
    sequence: ${JSON.stringify(sequence)}
}`;
    const handler = Qt.createQmlObject(qml, parent) as QmlShortcutHandler;
    handler.activated.connect(() => {
        debug(`shortcut activated: ${name}`);
        onActivated();
    });
}
