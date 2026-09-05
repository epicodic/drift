// A blurred border rectangle flashed around a window whenever Drift detects and handles
// a focus change of a managed window (docs: 2026-09-05-focus-flash-highlight-design).
// Built via `Qt.createQmlObject`, the same pattern as `minimap-overlay.ts`.

import { flashOpacity } from '../ui/focus-flash';
import { createQmlTimer } from './qml-timer';
import type { WindowAdapter } from './window-adapter';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const FOCUS_FLASH_OVERLAY_WINDOW_TITLE = 'Drift Focus Flash';

const FOCUS_FLASH_QML = `import QtQuick 6.0
import Qt5Compat.GraphicalEffects
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
PlasmaCore.Dialog {
    id: dialog
    property real borderWidth: 4
    property real blurRadius: 24
    title: "${FOCUS_FLASH_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Item {
        id: root
        width: dialog.width
        height: dialog.height
        implicitWidth: dialog.width
        implicitHeight: dialog.height
        // Mask that is opaque only in the outer blurRadius-wide band (its border) and
        // transparent in the center, so OpacityMask keeps the glow as a ring and lets the
        // window show through the middle.
        Rectangle {
            id: ringMask
            anchors.fill: parent
            color: "transparent"
            border.color: "black"
            border.width: dialog.blurRadius
            visible: false
            layer.enabled: true
        }
        // Filled highlight glow around the window-edge box. RectangularGlow always fills its
        // rectangle, so OpacityMask clips it to the outer band, leaving the center see-through.
        Item {
            anchors.fill: parent
            layer.enabled: true
            layer.effect: OpacityMask {
                maskSource: ringMask
            }
            RectangularGlow {
                anchors.fill: parent
                anchors.margins: dialog.blurRadius
                cornerRadius: dialog.blurRadius
                color: Kirigami.Theme.highlightColor
                glowRadius: dialog.blurRadius
                spread: 0
            }
        }
        // Crisp border at the window edge (inset by the halo margin).
        Rectangle {
            anchors.fill: parent
            anchors.margins: dialog.blurRadius
            color: "transparent"
            border.color: Kirigami.Theme.highlightColor
            border.width: dialog.borderWidth
        }
    }
}`;

export interface FocusFlashOverlay {
    show(win: WindowAdapter): void;
}

/** `tickMs` reuses the viewport's own animation clock interval (`settings.animationTickMs`)
 * so the flash tracks a simultaneous reveal-pan animation smoothly. `enabled` is fixed at
 * construction time, same as every other setting here — Drift settings all take effect on
 * restart, not live. */
export function createFocusFlashOverlay(
    parent: QmlObject,
    tickMs: number,
    borderWidth: number,
    blurRadius: number,
    durationMs: number,
    enabled: boolean,
): FocusFlashOverlay {
    const dialog = Qt.createQmlObject(FOCUS_FLASH_QML, parent) as QmlFocusFlashDialog;
    dialog.borderWidth = borderWidth;
    dialog.blurRadius = blurRadius;
    // Mapped once and never unmapped again: toggling `visible` re-triggers KWin's
    // slide-in-on-map effect for OnScreenDisplay windows on every flash. Opacity alone
    // hides it between flashes.
    dialog.opacity = 0;
    dialog.visible = true;
    const timer = createQmlTimer(parent);
    let startedAt = 0;

    return {
        show(win: WindowAdapter): void {
            if (!enabled) {
                return;
            }
            startedAt = Date.now();
            timer.start(tickMs, () => {
                const elapsed = Date.now() - startedAt;
                try {
                    const frame = win.frameGeometry();
                    dialog.x = Math.round(frame.x - blurRadius);
                    dialog.y = Math.round(frame.y - blurRadius);
                    dialog.width = Math.round(frame.width + blurRadius * 2);
                    dialog.height = Math.round(frame.height + blurRadius * 2);
                    dialog.opacity = flashOpacity(elapsed, durationMs);
                } catch (error) {
                    // The window can be closed mid-flash — never let that take down the timer.
                    void error;
                    timer.stop();
                    dialog.opacity = 0;
                    return;
                }
                if (elapsed >= durationMs) {
                    timer.stop();
                }
            });
        },
    };
}
