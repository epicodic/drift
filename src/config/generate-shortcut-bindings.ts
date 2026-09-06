import { buildShortcutBindingsScript } from './shortcut-bindings';
import { SETTINGS_DEFINITIONS } from './settings-definitions';

process.stdout.write(buildShortcutBindingsScript(SETTINGS_DEFINITIONS));
