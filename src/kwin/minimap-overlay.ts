// A centered OSD overlay showing every strip in the active StripStack, each strip left-aligned
// independently (not preserving relative horizontal offset between strips), shown on
// Meta+Left/Meta+Right/Meta+PgUp/Meta+PgDown (docs: 2026-09-01-minimap-design,
// 2026-09-01-minimap-thumbnails-design, 2026-09-02-multi-strip-minimap-design). Built via
// `Qt.createQmlObject`, the same pattern as `debug-console.ts`.

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
    property var strips: []
    property var viewportBox: ({ x: 0, y: 0, width: 0 })
    property real panelWidth: ${PANEL_WIDTH}
    property real panelHeight: ${MAX_MINIMAP_HEIGHT}
    property real stripHeight: ${MAX_MINIMAP_HEIGHT}
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
                model: dialog.strips
                delegate: Item {
                    x: 0
                    y: modelData.y
                    width: parent.width
                    height: dialog.stripHeight
                    Repeater {
                        model: modelData.columns
                        delegate: Item {
                            id: columnItem
                            x: modelData.x
                            width: Math.max(modelData.width, 2)
                            height: dialog.stripHeight
                            Rectangle {
                                // Clips every stacked tile to one rounded outer shape, mirroring
                                // a single-tile column's look (docs: 2026-09-03-vertical-tiling-design).
                                anchors.fill: parent
                                radius: 4
                                color: "transparent"
                                clip: true
                                Repeater {
                                    id: tileRepeater
                                    model: modelData.tiles
                                    delegate: Rectangle {
                                        y: modelData.y
                                        width: columnItem.width
                                        height: modelData.height
                                        color: modelData.focused ? "#3daee9" : "#5c5c5c"
                                        clip: true
                                        // Separates stacked tiles from each other; the last tile has
                                        // no neighbor below it to separate from.
                                        Rectangle {
                                            anchors {
                                                left: parent.left
                                                right: parent.right
                                                bottom: parent.bottom
                                            }
                                            height: 1
                                            color: Qt.rgba(0, 0, 0, 0.5)
                                            visible: index < tileRepeater.count - 1
                                        }
                                        KWinComponents.WindowThumbnail {
                                            client: modelData.thumbnail
                                            visible: dialog.showThumbnails && modelData.thumbnail !== null
                                            anchors.fill: parent
                                        }
                                        Kirigami.Icon {
                                            anchors.centerIn: parent
                                            width: Math.min(parent.width - 8, Math.min(parent.height - 8, 32))
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
                                        // Painted last so the focus indicator stays on top of the
                                        // window thumbnail, regardless of when its async live content
                                        // arrives.
                                        Item {
                                            id: focusRingSource
                                            anchors.fill: parent
                                            visible: false
                                            Rectangle {
                                                anchors.fill: parent
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
                                            color: "transparent"
                                            border.color: "#3daee9"
                                            border.width: 2
                                            visible: modelData.focused
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Rectangle {
                x: dialog.viewportBox.x
                y: dialog.viewportBox.y - 6
                width: Math.max(dialog.viewportBox.width, 2)
                height: dialog.stripHeight + 12
                radius: 4
                color: "transparent"
                border.color: "#ffffff"
                border.width: 2
            }
        }
    }
}`;

interface PanelTile {
    y: number;
    height: number;
    focused: boolean;
    icon: QIcon | null;
    thumbnail: Window | null;
}

interface PanelColumn {
    x: number;
    width: number;
    tiles: PanelTile[];
}

interface PanelStrip {
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
            const { panelWidth, panelHeight, stripHeight } = panelLayout(snapshot);
            dialog.strips = toPanelStrips(snapshot);
            dialog.viewportBox = toPanelViewportBox(snapshot);
            dialog.panelWidth = panelWidth;
            dialog.panelHeight = panelHeight;
            dialog.stripHeight = stripHeight;
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
 * `columnWidth : gridHeight` ratio (docs: 2026-09-01-minimap-thumbnails-design). Each strip is
 * left-aligned independently: `stripLefts` maps every `stripIndex` to that strip's own leftmost
 * edge (its columns' min x, plus the active viewport's own extent for the active strip), so
 * relative horizontal offset between strips is not preserved — only the widest strip's span
 * drives the horizontal scale. Strips are still spaced vertically by their real
 * `stripIndex * stripPitch` position — a strip with no entry between the lowest and highest
 * existing `stripIndex` (pruned or never created) is simply never drawn, leaving real blank
 * space at its position (docs: 2026-09-02-multi-strip-minimap-design). */
function panelLayout(snapshot: StripStackMinimapSnapshot): {
    stripLefts: Map<number, number>;
    top: number;
    scale: number;
    panelWidth: number;
    panelHeight: number;
    stripHeight: number;
} {
    const { viewport } = snapshot;
    const stripLefts = new Map<number, number>();
    let widestStripSpan = 1;
    let minStripIndex = viewport.stripIndex;
    let maxStripIndex = viewport.stripIndex;
    for (const strip of snapshot.strips) {
        minStripIndex = Math.min(minStripIndex, strip.stripIndex);
        maxStripIndex = Math.max(maxStripIndex, strip.stripIndex);
        let left = Infinity;
        let right = -Infinity;
        for (const column of strip.columns) {
            left = Math.min(left, column.x);
            right = Math.max(right, column.x + column.width);
        }
        if (strip.stripIndex === viewport.stripIndex) {
            left = Math.min(left, viewport.contentLeft, viewport.offset);
            right = Math.max(right, viewport.contentLeft + viewport.contentWidth, viewport.offset + viewport.width);
        }
        if (!Number.isFinite(left)) {
            left = 0;
            right = 0;
        }
        stripLefts.set(strip.stripIndex, left);
        widestStripSpan = Math.max(widestStripSpan, right - left);
    }
    const top = minStripIndex * snapshot.stripPitch;
    const bottom = maxStripIndex * snapshot.stripPitch + snapshot.gridHeight;

    const virtualWidth = Math.max(widestStripSpan, 1);
    const virtualHeight = Math.max(bottom - top, 1);
    const scale = Math.min(PANEL_WIDTH / virtualWidth, MAX_MINIMAP_HEIGHT / virtualHeight);
    return {
        stripLefts,
        top,
        scale,
        panelWidth: virtualWidth * scale,
        panelHeight: virtualHeight * scale,
        stripHeight: snapshot.gridHeight * scale,
    };
}

function toPanelStrips(snapshot: StripStackMinimapSnapshot): PanelStrip[] {
    const { stripLefts, top, scale } = panelLayout(snapshot);
    return snapshot.strips.map((strip) => {
        const left = stripLefts.get(strip.stripIndex) ?? 0;
        return {
            y: (strip.stripIndex * snapshot.stripPitch - top) * scale,
            columns: strip.columns.map((column) => ({
                x: (column.x - left) * scale,
                width: column.width * scale,
                tiles: column.tiles.map((tile) => ({
                    y: tile.y * scale,
                    height: tile.height * scale,
                    focused: tile.focused,
                    icon: tile.icon,
                    thumbnail: tile.thumbnail,
                })),
            })),
        };
    });
}

function toPanelViewportBox(snapshot: StripStackMinimapSnapshot): PanelViewportBox {
    const { stripLefts, top, scale } = panelLayout(snapshot);
    const left = stripLefts.get(snapshot.viewport.stripIndex) ?? 0;
    return {
        x: (snapshot.viewport.offset - left) * scale,
        y: (snapshot.viewport.stripIndex * snapshot.stripPitch - top) * scale,
        width: snapshot.viewport.width * scale,
    };
}
