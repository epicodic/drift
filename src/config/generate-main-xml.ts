import { buildKcfgXml } from './kcfg-xml';
import { SETTINGS_DEFINITIONS } from './settings-definitions';

process.stdout.write(buildKcfgXml(SETTINGS_DEFINITIONS));
