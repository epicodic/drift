// Binds global shortcuts to Drift actions. Under declarativescript there is no
// `registerShortcut` global — each shortcut is a QML `ShortcutHandler` element from
// `org.kde.kwin`, created via `Qt.createQmlObject` parented to the QML root (docs §4).

export interface ShortcutActions {
    focusLeft(): void;
    focusRight(): void;
}

export function registerShortcuts(parent: QmlObject, actions: ShortcutActions): void {
    createShortcut(parent, 'DriftFocusLeft', 'Drift: Focus Column Left', 'Meta+A', actions.focusLeft);
    createShortcut(parent, 'DriftFocusRight', 'Drift: Focus Column Right', 'Meta+D', actions.focusRight);
}

function createShortcut(
    parent: QmlObject,
    name: string,
    text: string,
    sequence: string,
    onActivated: () => void,
): void {
    const qml = `import QtQuick 6.0
import org.kde.kwin 3.0
ShortcutHandler {
    name: "${name}"
    text: "${text}"
    sequence: "${sequence}"
}`;
    const handler = Qt.createQmlObject(qml, parent) as QmlShortcutHandler;
    handler.activated.connect(onActivated);
}
