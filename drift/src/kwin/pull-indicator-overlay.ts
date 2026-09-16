// A filled circular-segment overlay grown beneath a dragged window's top edge while a
// pull-to-rearrange gesture is in progress (docs:
// 2026-09-16-drag-pull-threshold-indicator-design). Built via `Qt.createQmlObject`, the same
// pattern as `focus-flash-overlay.ts`.

import { pullIndicatorAlpha, pullIndicatorCircle } from '../input/pull-indicator';
import { createQmlTimer } from './qml-timer';
import type { WindowAdapter } from './window-adapter';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const PULL_INDICATOR_OVERLAY_WINDOW_TITLE = 'Drift Pull Indicator';

/** How long the abort fade-out takes, in milliseconds — fixed, not user-configurable (docs:
 * 2026-09-16-drag-pull-threshold-indicator-design, Out of Scope). */
const ABORT_FADE_MS = 150;

const PULL_INDICATOR_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
PlasmaCore.Dialog {
    id: dialog
    property real centerX: 0
    property real centerY: 0
    property real radius: 1
    property real alpha: 0
    title: "${PULL_INDICATOR_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: ShaderEffect {
        id: root
        width: dialog.width
        height: dialog.height
        implicitWidth: dialog.width
        implicitHeight: dialog.height
        property color glowColor: Kirigami.Theme.highlightColor
        property vector2d itemSize: Qt.vector2d(width, height)
        property vector2d center: Qt.vector2d(dialog.centerX, dialog.centerY)
        property real radius: dialog.radius
        property real alpha: dialog.alpha
        fragmentShader: Qt.resolvedUrl("../shaders/pull_indicator.frag.qsb")
    }
}`;

export interface PullIndicatorOverlay {
    /** Repositions/resizes to `win`'s current frame and grows the arc for this tick's
     * `dyTotal` — a pull distance in pixels measured from drag start, not the window's own
     * (pinned) rendered position. `topY` is the window's pinned top edge (`startY` in
     * `drag.ts`) — the chord's fixed anchor. It must be passed explicitly rather than read from
     * `win.frameGeometry().y`: this is called before the current tick's pin-write, while the
     * window's real geometry still reflects that tick's unpinned, pointer-following position
     * (`startY + dyTotal`), which would otherwise make the chord itself drift downward with the
     * pull instead of staying fixed at the window's true top edge (docs:
     * 2026-09-16-drag-pull-threshold-indicator-design). Hides immediately if `dyTotal <= 0` or
     * the overlay is disabled. */
    update(win: WindowAdapter, topY: number, dyTotal: number, triggerPx: number): void;
    /** Vanishes instantly, no fade — used the tick a drag frees, and on drag finish/cancel. */
    hide(): void;
    /** Fades out over `ABORT_FADE_MS` — used the tick a pull latches aborted. */
    fadeOut(): void;
}

/** No-op stand-in used as the default `pullIndicator` dependency wherever a real KWin overlay
 * isn't wired up — every existing `Strip`/`StripStack`/`StripManager` test, and any construction
 * path that predates this feature. Plays the same role `TransientLinks`'s own defaulted
 * constructor parameter does one layer up (docs: 2026-09-16-drag-pull-threshold-indicator-design). */
export const NOOP_PULL_INDICATOR: PullIndicatorOverlay = {
    update: () => {},
    hide: () => {},
    fadeOut: () => {},
};

/** `tickMs` reuses the viewport's own animation clock interval (`ANIMATION_TICK_MS`), same as
 * `createFocusFlashOverlay`. `enabled` is fixed at construction time, same as every other
 * setting in this codebase — Drift settings all take effect on restart, not live. */
export function createPullIndicatorOverlay(
    parent: QmlObject,
    tickMs: number,
    opacity: number,
    enabled: boolean,
): PullIndicatorOverlay {
    const dialog = Qt.createQmlObject(PULL_INDICATOR_QML, parent) as QmlPullIndicatorDialog;
    dialog.opacity = 0;
    dialog.visible = true;
    const fadeTimer = createQmlTimer(parent);
    let fadeStartedAt = 0;

    return {
        update(win: WindowAdapter, topY: number, dyTotal: number, triggerPx: number): void {
            fadeTimer.stop();
            if (!enabled || dyTotal <= 0) {
                dialog.opacity = 0;
                return;
            }
            const frame = win.frameGeometry();
            const circle = pullIndicatorCircle(frame.width, dyTotal);
            dialog.x = frame.x;
            dialog.y = topY;
            dialog.width = frame.width;
            dialog.height = Math.max(dyTotal, 1);
            dialog.centerX = circle.cx;
            dialog.centerY = circle.cy;
            dialog.radius = circle.r;
            dialog.alpha = pullIndicatorAlpha(dyTotal, triggerPx) * opacity;
            dialog.opacity = 1;
        },
        hide(): void {
            fadeTimer.stop();
            dialog.opacity = 0;
        },
        fadeOut(): void {
            fadeTimer.stop();
            if (!enabled) {
                return;
            }
            fadeStartedAt = Date.now();
            const startOpacity = dialog.opacity;
            fadeTimer.start(tickMs, () => {
                const elapsed = Date.now() - fadeStartedAt;
                if (elapsed >= ABORT_FADE_MS) {
                    dialog.opacity = 0;
                    fadeTimer.stop();
                    return;
                }
                dialog.opacity = startOpacity * (1 - elapsed / ABORT_FADE_MS);
            });
        },
    };
}
