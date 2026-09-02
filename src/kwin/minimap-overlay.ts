// A centered OSD overlay showing every strip in the active StripStack, aligned to their real
// relative positions, shown on Meta+Left/Meta+Right/Meta+PgUp/Meta+PgDown (docs:
// 2026-09-01-minimap-design, 2026-09-01-minimap-thumbnails-design,
// 2026-09-02-multi-strip-minimap-design). Built via `Qt.createQmlObject`, the same pattern as
// `debug-console.ts`.

import type { Rect } from '../core/coordinates';
import type { StripStackMinimapSnapshot } from '../ui/minimap';
import { createQmlTimer } from './qml-timer';

/** Identifies the overlay's own window so Drift excludes it from tiling (see `WindowAdapter.isTileable`). */
export const MINIMAP_OVERLAY_WINDOW_TITLE = 'Drift Minimap';

const PANEL_WIDTH = 900;
const MAX_MINIMAP_HEIGHT = 600;
const PANEL_MARGIN = 20;

const MINIMAP_QML = `import QtQuick 6.0
import QtQuick.Effects
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
import org.kde.kwin 3.0 as KWinComponents
PlasmaCore.Dialog {
    id: dialog
    property var rows: []
    property var viewportBox: ({ x: 0, y: 0, width: 0 })
    property real panelWidth: ${PANEL_WIDTH}
    property real panelHeight: ${MAX_MINIMAP_HEIGHT}
    property real rowHeight: ${MAX_MINIMAP_HEIGHT}
    property bool showThumbnails: false
    title: "${MINIMAP_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: Rectangle {
        radius: 8
        color: Qt.rgba(0, 0, 0, 0.75)
        implicitWidth: dialog.panelWidth + ${PANEL_MARGIN * 2}
        implicitHeight: dialog.panelHeight + ${PANEL_MARGIN * 2}
        Item {
            anchors.fill: parent
            anchors.margins: ${PANEL_MARGIN}
            Repeater {
                model: dialog.rows
                delegate: Item {
                    x: 0
                    y: modelData.y
                    width: parent.width
                    height: dialog.rowHeight
                    Repeater {
                        model: modelData.columns
                        delegate: Rectangle {
                            x: modelData.x
                            width: Math.max(modelData.width, 2)
                            height: dialog.rowHeight
                            radius: 4
                            color: modelData.focused ? "#3daee9" : "#5c5c5c"
                            clip: true
                            KWinComponents.WindowThumbnail {
                                client: modelData.thumbnail
                                visible: dialog.showThumbnails && modelData.thumbnail !== null
                                anchors.fill: parent
                            }
                            Kirigami.Icon {
                                anchors.centerIn: parent
                                width: Math.min(parent.width - 8, 32)
                                height: width
                                source: modelData.icon
                                visible: !dialog.showThumbnails && modelData.icon !== null && parent.width > 12
                            }
                            Kirigami.Icon {
                                anchors {
                                    right: parent.right
                                    bottom: parent.bottom
                                    margins: 2
                                }
                                width: Math.min(parent.width - 4, 20)
                                height: width
                                source: modelData.icon
                                visible: dialog.showThumbnails && modelData.icon !== null && parent.width > 12
                            }
                            // Painted last so the focus indicator stays on top of the window
                            // thumbnail, regardless of when its async live content arrives.
                            Item {
                                id: focusRingSource
                                anchors.fill: parent
                                visible: false
                                Rectangle {
                                    anchors.fill: parent
                                    radius: 4
                                    color: "transparent"
                                    border.color: "#3daee9"
                                    border.width: 4
                                }
                            }
                            MultiEffect {
                                anchors.fill: focusRingSource
                                source: focusRingSource
                                visible: modelData.focused
                                blurEnabled: true
                                blur: 1.0
                                blurMax: 24
                                brightness: 0.15
                            }
                            Rectangle {
                                anchors.fill: parent
                                radius: 4
                                color: "transparent"
                                border.color: "#3daee9"
                                border.width: 2
                                visible: modelData.focused
                            }
                        }
                    }
                }
            }
            Rectangle {
                x: dialog.viewportBox.x
                y: dialog.viewportBox.y - 6
                width: Math.max(dialog.viewportBox.width, 2)
                height: dialog.rowHeight + 12
                radius: 4
                color: "transparent"
                border.color: "#ffffff"
                border.width: 2
            }
        }
    }
}`;

interface PanelColumn {
    x: number;
    width: number;
    focused: boolean;
    icon: QIcon | null;
    thumbnail: Window | null;
}

interface PanelRow {
    y: number;
    columns: PanelColumn[];
}

interface PanelViewportBox {
    x: number;
    y: number;
    width: number;
}

export interface MinimapOverlay {
    show(snapshot: StripStackMinimapSnapshot, screen: Rect): void;
}

export function createMinimapOverlay(parent: QmlObject, autoHideMs: number, showThumbnails: boolean): MinimapOverlay {
    const dialog = Qt.createQmlObject(MINIMAP_QML, parent) as QmlMinimapDialog;
    dialog.showThumbnails = showThumbnails;
    const hideTimer = createQmlTimer(parent);

    return {
        show(snapshot: StripStackMinimapSnapshot, screen: Rect): void {
            const { panelWidth, panelHeight, rowHeight } = panelLayout(snapshot);
            dialog.rows = toPanelRows(snapshot);
            dialog.viewportBox = toPanelViewportBox(snapshot);
            dialog.panelWidth = panelWidth;
            dialog.panelHeight = panelHeight;
            dialog.rowHeight = rowHeight;
            const dialogWidth = panelWidth + PANEL_MARGIN * 2;
            const dialogHeight = panelHeight + PANEL_MARGIN * 2;
            dialog.width = dialogWidth;
            dialog.height = dialogHeight;
            dialog.x = Math.round(screen.x + (screen.width - dialogWidth) / 2);
            dialog.y = Math.round(screen.y + (screen.height - dialogHeight) / 2);
            dialog.visible = true;
            hideTimer.start(autoHideMs, () => {
                hideTimer.stop();
                dialog.visible = false;
            });
        },
    };
}

/** The uniform scale factor is `min` of the two per-axis fits (not each axis scaled
 * independently) so that a column's rendered width:height ratio always matches its true
 * `columnWidth : gridHeight` ratio (docs: 2026-09-01-minimap-thumbnails-design). Spans every
 * row's columns (plus the active viewport's own extent) horizontally, and every row's real
 * `rowIndex * rowPitch` position vertically — a row with no entry between the lowest and
 * highest existing `rowIndex` (pruned or never created) is simply never drawn, leaving real
 * blank space at its position (docs: 2026-09-02-multi-strip-minimap-design). */
function panelLayout(snapshot: StripStackMinimapSnapshot): {
    left: number;
    top: number;
    scale: number;
    panelWidth: number;
    panelHeight: number;
    rowHeight: number;
} {
    const { viewport } = snapshot;
    let left = Math.min(viewport.contentLeft, viewport.offset);
    let right = Math.max(viewport.contentLeft + viewport.contentWidth, viewport.offset + viewport.width);
    let minRowIndex = viewport.rowIndex;
    let maxRowIndex = viewport.rowIndex;
    for (const row of snapshot.rows) {
        minRowIndex = Math.min(minRowIndex, row.rowIndex);
        maxRowIndex = Math.max(maxRowIndex, row.rowIndex);
        for (const column of row.columns) {
            left = Math.min(left, column.x);
            right = Math.max(right, column.x + column.width);
        }
    }
    const top = minRowIndex * snapshot.rowPitch;
    const bottom = maxRowIndex * snapshot.rowPitch + snapshot.gridHeight;

    const virtualWidth = Math.max(right - left, 1);
    const virtualHeight = Math.max(bottom - top, 1);
    const scale = Math.min(PANEL_WIDTH / virtualWidth, MAX_MINIMAP_HEIGHT / virtualHeight);
    return {
        left,
        top,
        scale,
        panelWidth: virtualWidth * scale,
        panelHeight: virtualHeight * scale,
        rowHeight: snapshot.gridHeight * scale,
    };
}

function toPanelRows(snapshot: StripStackMinimapSnapshot): PanelRow[] {
    const { left, top, scale } = panelLayout(snapshot);
    return snapshot.rows.map((row) => ({
        y: (row.rowIndex * snapshot.rowPitch - top) * scale,
        columns: row.columns.map((column) => ({
            x: (column.x - left) * scale,
            width: column.width * scale,
            focused: column.focused,
            icon: column.icon,
            thumbnail: column.thumbnail,
        })),
    }));
}

function toPanelViewportBox(snapshot: StripStackMinimapSnapshot): PanelViewportBox {
    const { left, top, scale } = panelLayout(snapshot);
    return {
        x: (snapshot.viewport.offset - left) * scale,
        y: (snapshot.viewport.rowIndex * snapshot.rowPitch - top) * scale,
        width: snapshot.viewport.width * scale,
    };
}
