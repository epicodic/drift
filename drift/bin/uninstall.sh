#!/bin/sh
# Removes the Drift kwinscript and restores every setting Drift's install-time scripts
# changed: kglobalaccel shortcuts displaced by setup-shortcuts.sh, and the kwinrc
# [Windows] keys disabled by disable-incompatible-settings.sh. Safe to run even if one
# or both backups are missing (e.g. a partial prior install) — that restore step is
# skipped with a notice instead of failing.
# See docs/agents/specs/2026-09-13-self-contained-installer-design.md.

set -eu

# shellcheck disable=SC1007 # CDPATH= is intentional: suppresses CDPATH's cd output/redirect quirks
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./settings-backup-lib.sh
. "${SCRIPT_DIR}/settings-backup-lib.sh"

BACKUP_DIR="$(drift_backup_dir)"
SHORTCUTS_BACKUP_FILE="${BACKUP_DIR}/shortcuts.backup"
KWINRC_BACKUP_FILE="${BACKUP_DIR}/kwinrc-windows.env"

GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

restored_anything=0

if [ -f "$SHORTCUTS_BACKUP_FILE" ]; then
	echo "Restoring displaced keyboard shortcuts..."
	while IFS='|' read -r action_name component component_friendly action_text active_keys; do
		[ -z "$action_name" ] && continue
		# shellcheck disable=SC2086 # word-splitting active_keys into separate ai arguments is the point here
		set -- $active_keys
		key_count=$#
		printf "  ${GREEN}✓${RESET} Restoring \"%s\" (%s)...\n" "$action_text" "$component_friendly"
		# shellcheck disable=SC2068
		busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
			4 "$component" "$action_name" "$component_friendly" "$action_text" "$key_count" $@ 4 >/dev/null
	done < "$SHORTCUTS_BACKUP_FILE"
	rm -f "$SHORTCUTS_BACKUP_FILE"
	restored_anything=1
else
	printf "${YELLOW}⎯${RESET} No shortcut backup found, skipping shortcut restore.\n"
fi

if [ -f "$KWINRC_BACKUP_FILE" ]; then
	echo "Restoring KWin window settings..."
	while IFS='|' read -r key value; do
		[ -z "$key" ] && continue
		printf "  ${GREEN}✓${RESET} Restoring %s=%s...\n" "$key" "$value"
		kwriteconfig6 --file kwinrc --group Windows --key "$key" "$value"
	done < "$KWINRC_BACKUP_FILE"
	rm -f "$KWINRC_BACKUP_FILE"
	restored_anything=1
else
	printf "${YELLOW}⎯${RESET} No KWin settings backup found, skipping settings restore.\n"
fi

if [ "$restored_anything" -eq 1 ]; then
	qdbus6 org.kde.KWin /KWin reconfigure
fi

echo "Removing Drift kwinscript..."
kpackagetool6 --type=KWin/Script --remove=drift

printf "\n${GREEN}Done.${RESET} Drift has been uninstalled and prior settings restored.\n"
