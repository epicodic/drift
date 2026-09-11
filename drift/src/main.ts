// Drift entry point. `init` is the single exported boot function the QML host calls
// (docs §6.2), receiving the QML root as the parent for runtime QML objects, and the
// resolved URL of `ui/main.qml`'s own directory (used to locate shipped sibling files
// like contents/bin/setup-shortcuts.sh). All orchestration now lives in runtime/ —
// this file only boots the Controller.

import { loadSettings } from './config/settings';
import { Controller } from './runtime/controller';

export function init(root: QmlObject, scriptUiDirUrl: unknown): void {
    // Qt.resolvedUrl() returns a QUrl value, not a plain string (confirmed live) — coerce
    // once here so downstream code can treat it as an ordinary string.
    new Controller(root, loadSettings(), String(scriptUiDirUrl)).start();
}
