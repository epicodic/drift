// SPDX-License-Identifier: MIT
// Minimal QML host for Drift. Under declarativescript this is the entry point KWin
// loads (docs §6.2). It imports the bundled logic and boots it, passing itself as the
// parent for the runtime QML objects the bundle creates (the animation Timer and the
// shortcut handlers), plus this file's own resolved directory (so the bundle can find
// its shipped sibling files, e.g. contents/bin/setup-shortcuts.sh, on disk). All
// window management lives in the TypeScript; this stays thin.

import QtQuick 6.0
import org.kde.kwin 3.0
import "../code/main.js" as Drift

Item {
    id: qmlBase

    Component.onCompleted: {
        Drift.init(qmlBase, Qt.resolvedUrl("."));
    }
}
