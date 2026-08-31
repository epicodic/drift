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
