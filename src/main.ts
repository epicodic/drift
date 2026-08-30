// Drift entry point. `init` is the single exported boot function the QML host calls
// (docs §6.2), receiving the QML root as the parent for runtime QML objects. All
// orchestration now lives in runtime/ — this file only boots the Controller.

import { loadSettings } from './config/settings';
import { Controller } from './runtime/controller';

export function init(root: QmlObject): void {
    new Controller(root, loadSettings()).start();
}
