// A top-left OSD overlay showing the accumulated `debug()` log (../debug.ts).
// Built via `Qt.createQmlObject`, the same pattern as `qml-timer.ts`/`shortcuts.ts`.
// A plain `Item`/`Rectangle` never gets composited under declarativescript — KWin
// scripts need a real `PlasmaCore.Dialog` (the mechanism KZones uses for its own
// overlays, docs §debug console) to get an on-screen surface at all.

import { setDebugSink } from '../debug';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const DEBUG_CONSOLE_WINDOW_TITLE = 'Drift Debug Console';

const CONSOLE_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property string lines: ""
    title: "${DEBUG_CONSOLE_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    x: 20
    y: 20
    visible: true
    mainItem: Rectangle {
        id: root
        radius: 5
        color: Qt.rgba(0, 0, 0, 0.7)
        implicitWidth: 1200
        implicitHeight: 800
        Text {
            id: label
            anchors.fill: parent
            anchors.margins: 15
            text: dialog.lines
            color: "#ffffff"
            font.family: "monospace"
            font.pixelSize: 13
            wrapMode: Text.Wrap
            verticalAlignment: Text.AlignTop
        }
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
