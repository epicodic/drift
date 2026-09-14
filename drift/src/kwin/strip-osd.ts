// A full-screen inward glow plus a large label badge, flashed whenever the active strip
// actually changes (docs: 2026-09-14-strip-navigation-hints-design). Reuses the same
// drift/shaders/focus_glow.frag shader as focus-flash-overlay.ts, sized to the screen instead
// of a window frame. Built via Qt.createQmlObject, the same pattern as
// focus-flash-overlay.ts/minimap-overlay.ts.

import type { Rect } from '../core/coordinates';
import { flashOpacity } from '../ui/focus-flash';
import { stripColor } from '../ui/strip-identity';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const STRIP_OSD_WINDOW_TITLE = 'Drift Strip OSD';

const STRIP_OSD_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property real glowRadius: 60
    property real bleedRadius: 8
    property var glowRgb: ({ r: 1, g: 1, b: 1 })
    property string label: ""
    title: "${STRIP_OSD_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Item {
        width: dialog.width
        height: dialog.height
        ShaderEffect {
            id: glow
            anchors.fill: parent
            property color glowColor: Qt.rgba(dialog.glowRgb.r, dialog.glowRgb.g, dialog.glowRgb.b, 1.0)
            property vector2d itemSize: Qt.vector2d(width, height)
            property real glow: dialog.glowRadius
            property real sharpness: 1.5
            property real bleed: dialog.bleedRadius
            fragmentShader: Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")
        }
        Text {
            anchors {
                top: parent.top
                left: parent.left
                margins: 40
            }
            text: dialog.label
            color: Qt.rgba(dialog.glowRgb.r, dialog.glowRgb.g, dialog.glowRgb.b, 1.0)
            font.bold: true
            font.pixelSize: 120
        }
    }
}`;

export interface StripOsd {
    show(label: string, hue: number, screenGeometry: Rect): void;
}

/** `tickMs` reuses the viewport's own animation clock interval, same as
 * `createFocusFlashOverlay`. `enabled` is fixed at construction time, same as every other
 * setting here — Drift settings all take effect on restart, not live. */
export function createStripOsd(
    parent: QmlObject,
    tickMs: number,
    glowRadius: number,
    durationMs: number,
    peakOpacity: number,
    enabled: boolean,
): StripOsd {
    const dialog = Qt.createQmlObject(STRIP_OSD_QML, parent) as QmlStripOsdDialog;
    dialog.glowRadius = glowRadius;
    dialog.opacity = 0;
    dialog.visible = true;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    return {
        show(label: string, hue: number, screenGeometry: Rect): void {
            if (!enabled) {
                return;
            }
            dialog.glowRgb = stripColor(hue);
            dialog.label = label;
            dialog.x = Math.round(screenGeometry.x);
            dialog.y = Math.round(screenGeometry.y);
            dialog.width = Math.round(screenGeometry.width);
            dialog.height = Math.round(screenGeometry.height);
            startedAt = Date.now();
            timer.start(tickMs, () => {
                const elapsed = Date.now() - startedAt;
                dialog.opacity = flashOpacity(elapsed, durationMs) * peakOpacity;
                if (elapsed >= durationMs) {
                    timer.stop();
                }
            });
        },
    };
}
