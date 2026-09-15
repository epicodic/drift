// A vector "chevron frame" hugging the screen edges, flashed whenever the active strip
// actually changes (docs: 2026-09-14-strip-navigation-hints-design, 2026-09-15-chevron-frame-osd).
// Geometry comes from ui/chevron-frame.ts (pure, tested); this file only turns that into
// QtQuick.Shapes QML. Built via Qt.createQmlObject, the same pattern as
// focus-flash-overlay.ts/minimap-overlay.ts.

import type { Rect } from '../core/coordinates';
import { chevronFramePoints, type Point } from '../ui/chevron-frame';
import { flashOpacity } from '../ui/focus-flash';
import { stripColor } from '../ui/strip-identity';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const STRIP_OSD_WINDOW_TITLE = 'Drift Strip OSD';

const STRIP_OSD_QML = `import QtQuick 6.0
import QtQuick.Shapes
import org.kde.plasma.core as PlasmaCore
PlasmaCore.Dialog {
    id: dialog
    property real thickness: 18
    property var frameColor: ({ r: 1, g: 1, b: 1 })
    property var topPoints: []
    property var bottomPoints: []
    property var leftPoints: []
    property var rightPoints: []
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
        function toQmlPoints(pts) {
            return pts.map(function (p) { return Qt.point(p.x, p.y); });
        }
        function frameQColor(alpha) {
            return Qt.rgba(dialog.frameColor.r, dialog.frameColor.g, dialog.frameColor.b, alpha);
        }
        Shape {
            id: frameShape
            anchors.fill: parent
            ShapePath {
                strokeWidth: -1
                fillGradient: LinearGradient {
                    x1: 0
                    y1: dialog.thickness
                    x2: 0
                    y2: 0
                    GradientStop { position: 0.0; color: content.frameQColor(1.0) }
                    GradientStop { position: 1.0; color: content.frameQColor(0.35) }
                }
                PathPolyline { path: content.toQmlPoints(dialog.topPoints) }
            }
            ShapePath {
                strokeWidth: -1
                fillGradient: LinearGradient {
                    x1: 0
                    y1: frameShape.height - dialog.thickness
                    x2: 0
                    y2: frameShape.height
                    GradientStop { position: 0.0; color: content.frameQColor(1.0) }
                    GradientStop { position: 1.0; color: content.frameQColor(0.35) }
                }
                PathPolyline { path: content.toQmlPoints(dialog.bottomPoints) }
            }
            ShapePath {
                strokeWidth: -1
                fillGradient: RadialGradient {
                    centerX: dialog.thickness
                    centerY: frameShape.height / 2
                    focalX: centerX
                    focalY: centerY
                    centerRadius: frameShape.height * 1.6
                    GradientStop { position: 0.0; color: content.frameQColor(1.0) }
                    GradientStop { position: 1.0; color: content.frameQColor(0.35) }
                }
                PathPolyline { path: content.toQmlPoints(dialog.leftPoints) }
            }
            ShapePath {
                strokeWidth: -1
                fillGradient: RadialGradient {
                    centerX: frameShape.width - dialog.thickness
                    centerY: frameShape.height / 2
                    focalX: centerX
                    focalY: centerY
                    centerRadius: frameShape.height * 1.6
                    GradientStop { position: 0.0; color: content.frameQColor(1.0) }
                    GradientStop { position: 1.0; color: content.frameQColor(0.35) }
                }
                PathPolyline { path: content.toQmlPoints(dialog.rightPoints) }
            }
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
 * `createFocusFlashOverlay`. `thickness` and `enabled` are fixed at construction time, same as
 * every other setting here — Drift settings all take effect on restart, not live. */
export function createStripOsd(
    parent: QmlObject,
    tickMs: number,
    thickness: number,
    durationMs: number,
    peakOpacity: number,
    enabled: boolean,
): StripOsd {
    const dialog = Qt.createQmlObject(STRIP_OSD_QML, parent) as QmlStripOsdDialog;
    dialog.thickness = thickness;
    dialog.opacity = 0;
    dialog.visible = true;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    const toPlain = (points: Point[]): unknown => points.map((p) => ({ x: p.x, y: p.y }));

    return {
        show(label: string, hue: number, screenGeometry: Rect): void {
            if (!enabled) {
                return;
            }
            const width = Math.round(screenGeometry.width);
            const height = Math.round(screenGeometry.height);
            const frame = chevronFramePoints(width, height, thickness);
            dialog.frameColor = stripColor(hue);
            dialog.topPoints = toPlain(frame.top);
            dialog.bottomPoints = toPlain(frame.bottom);
            dialog.leftPoints = toPlain(frame.left);
            dialog.rightPoints = toPlain(frame.right);
            dialog.label = label;
            dialog.x = Math.round(screenGeometry.x);
            dialog.y = Math.round(screenGeometry.y);
            dialog.width = width;
            dialog.height = height;
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
