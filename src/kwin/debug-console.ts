// A top-left OSD overlay showing the accumulated `debug()` log (../debug.ts).
// Built via `Qt.createQmlObject`, the same pattern as `qml-timer.ts`/`shortcuts.ts` —
// declarativescript has no static QML in this file tree for dynamically-parented
// runtime objects (docs §6.2).

import { setDebugSink } from '../debug';

const CONSOLE_QML = `import QtQuick 6.0
Rectangle {
    id: root
    property string lines: ""
    z: 1000
    anchors.left: parent.left
    anchors.leftMargin: 20
    anchors.top: parent.top
    anchors.topMargin: 20
    radius: 5
    color: Qt.rgba(0, 0, 0, 0.7)
    visible: false
    width: label.paintedWidth + 30
    height: label.paintedHeight + 30
    Text {
        id: label
        anchors.centerIn: parent
        text: root.lines
        color: "#ffffff"
        font.family: "monospace"
        font.pixelSize: 13
    }
}`;

export interface DebugConsole {
    toggle(): void;
}

export function createDebugConsole(parent: QmlObject): DebugConsole {
    const overlay = Qt.createQmlObject(CONSOLE_QML, parent) as QmlDebugOverlay;
    setDebugSink((text) => {
        overlay.lines = text;
    });
    return {
        toggle(): void {
            overlay.visible = !overlay.visible;
        },
    };
}
