#!/bin/sh
# Disables the KWin settings documented as conflicting with Drift's own window
# drag/pan handling (docs/known_bugs.md #2): edge/border window snapping and the
# electric-border quick-maximize/quick-tile behavior. Backs up each key's current
# value (once, via settings-backup-lib.sh) before changing it, so uninstall.sh can
# restore the user's original configuration later.
# Non-interactive and safe to run more than once — see
# docs/agents/specs/2026-09-13-self-contained-installer-design.md.

set -eu

# shellcheck disable=SC1007 # CDPATH= is intentional: suppresses CDPATH's cd output/redirect quirks
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./settings-backup-lib.sh
. "${SCRIPT_DIR}/settings-backup-lib.sh"

if ! command -v kwriteconfig6 >/dev/null 2>&1 \
	|| ! command -v kreadconfig6 >/dev/null 2>&1 \
	|| ! command -v qdbus6 >/dev/null 2>&1; then
	echo "disable-incompatible-settings.sh: kwriteconfig6/kreadconfig6/qdbus6 not found — cannot continue" >&2
	exit 1
fi

BACKUP_FILE="$(drift_backup_dir)/kwinrc-windows.env"

# Backs up a kwinrc [Windows] key's current value (or KWin's compiled-in default, if
# the key has never been written to kwinrc) before overwriting it.
backup_and_set() {
	key="$1"
	default_value="$2"
	new_value="$3"
	current_value="$(kreadconfig6 --file kwinrc --group Windows --key "$key" --default "$default_value")"
	backup_if_absent "$BACKUP_FILE" "$key" "${key}|${current_value}"
	kwriteconfig6 --file kwinrc --group Windows --key "$key" "$new_value"
}

# Defaults below are KWin's compiled-in factory defaults for these keys (confirmed via
# a fresh user profile's System Settings -> Window Behavior), used as the fallback
# when a key has never been written to kwinrc. See KWin's source in kwin/windowsettings.cpp.
# A partial failure mid-way through these four settings is safe: re-running the script is idempotent.
backup_and_set WindowSnapZone 10 0
backup_and_set BorderSnapZone 10 0
backup_and_set ElectricBorderMaximize true false
backup_and_set ElectricBorderTiling true false

qdbus6 org.kde.KWin /KWin reconfigure

echo "Incompatible KWin settings disabled (backup: ${BACKUP_FILE})."
