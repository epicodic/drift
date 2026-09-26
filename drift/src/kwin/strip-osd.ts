// Two circular-segment arcs on the top and bottom screen edges, flashed whenever the active strip
// actually changes: each apex sweeps inward while the arc fades in, then back out while it fades
// away, in the strip's color, next to a large label (docs: 2026-09-14-strip-navigation-hints-design).
// The shape reuses the drag pull indicator's shader; animation state comes from ui/strip-osd-arc.ts
// (pure, tested). Built via Qt.createQmlObject, the same pattern as
// focus-flash-overlay.ts/minimap-overlay.ts.

import type { Rect } from '../core/coordinates';
import { stripColor } from '../ui/strip-identity';
import { stripOsdArc } from '../ui/strip-osd-arc';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const STRIP_OSD_WINDOW_TITLE = 'Drift Strip OSD';

const STRIP_OSD_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property var frameColor: ({ r: 1, g: 1, b: 1 })
    property real arcDepth: 0
    property real centerX: 0
    property real centerY: 0
    property real radius: 1
    property string label: ""
    title: "${STRIP_OSD_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Item {
        id: content
        width: dialog.width
        height: dialog.height
        function frameQColor(alpha) {
            return Qt.rgba(dialog.frameColor.r, dialog.frameColor.g, dialog.frameColor.b, alpha);
        }
        ShaderEffect {
            id: topArc
            x: 0
            y: 0
            width: content.width
            height: Math.max(dialog.arcDepth, 1)
            property color glowColor: content.frameQColor(1.0)
            property vector2d itemSize: Qt.vector2d(width, height)
            property vector2d center: Qt.vector2d(dialog.centerX, dialog.centerY)
            property real radius: dialog.radius
            property real alpha: 1.0
            fragmentShader: Qt.resolvedUrl("../shaders/pull_indicator.frag.qsb")
        }
        ShaderEffect {
            id: bottomArc
            x: 0
            y: content.height - height
            width: content.width
            height: Math.max(dialog.arcDepth, 1)
            rotation: 180
            property color glowColor: content.frameQColor(1.0)
            property vector2d itemSize: Qt.vector2d(width, height)
            property vector2d center: Qt.vector2d(dialog.centerX, dialog.centerY)
            property real radius: dialog.radius
            property real alpha: 1.0
            fragmentShader: Qt.resolvedUrl("../shaders/pull_indicator.frag.qsb")
        }
        Text {
            anchors {
                top: parent.top
                left: parent.left
                margins: 40
            }
            text: dialog.label
            color: content.frameQColor(1.0)
            font.bold: true
            font.pixelSize: 48
        }
    }
}`;

export interface StripOsd {
    show(label: string, hue: number, screenGeometry: Rect): void;
}

/** `tickMs` reuses the viewport's own animation clock interval, same as
 * `createFocusFlashOverlay`. `maxDepth` and `enabled` are fixed at construction time, same as
 * every other setting here — Drift settings all take effect on restart, not live. */
export function createStripOsd(
    parent: QmlObject,
    tickMs: number,
    maxDepth: number,
    durationMs: number,
    peakOpacity: number,
    enabled: boolean,
): StripOsd {
    const dialog = Qt.createQmlObject(STRIP_OSD_QML, parent) as QmlStripOsdDialog;
    dialog.opacity = 0;
    dialog.visible = true;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    return {
        show(label: string, hue: number, screenGeometry: Rect): void {
            if (!enabled) {
                return;
            }
            const width = Math.round(screenGeometry.width);
            const height = Math.round(screenGeometry.height);
            dialog.frameColor = stripColor(hue);
            dialog.label = label;
            dialog.x = Math.round(screenGeometry.x);
            dialog.y = Math.round(screenGeometry.y);
            dialog.width = width;
            dialog.height = height;
            startedAt = Date.now();
            timer.start(tickMs, () => {
                const elapsed = Date.now() - startedAt;
                const arc = stripOsdArc(elapsed, durationMs, width, maxDepth);
                if (arc === null) {
                    dialog.opacity = 0;
                } else {
                    dialog.arcDepth = arc.depth;
                    dialog.centerX = arc.circle.cx;
                    dialog.centerY = arc.circle.cy;
                    dialog.radius = arc.circle.r;
                    dialog.opacity = arc.opacity * peakOpacity;
                }
                if (elapsed >= durationMs) {
                    timer.stop();
                }
            });
        },
    };
}
