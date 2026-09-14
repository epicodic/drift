# shellcheck shell=sh
# Idempotent backup primitive shared by disable-incompatible-settings.sh and
# setup-shortcuts.sh: records a setting's original value only once, so re-running
# either script (upgrade, or a second manual run) never overwrites a real prior value
# with whatever Drift itself already applied on an earlier run. uninstall.sh reads
# these files directly (no restore helper here) since restoring a kwinrc key and
# restoring a kglobalaccel shortcut require entirely different commands.
# See docs/agents/specs/2026-09-13-self-contained-installer-design.md.

# Prints the backup directory's path, creating it if needed. Respects $XDG_STATE_HOME
# (falling back to ~/.local/state), matching XDG Base Directory conventions for
# generated runtime state rather than user config.
drift_backup_dir() {
	base="${XDG_STATE_HOME:-${HOME}/.local/state}"
	dir="${base}/drift/settings-backup"
	mkdir -p "$dir"
	printf '%s\n' "$dir"
}

# Appends `line` to backup_file unless it already contains a line starting with
# "dedup_key|" — the first record for a given key/action wins, every later call for
# the same key is a silent no-op. Both kwinrc-windows.env ("KEY|value") and
# shortcuts.backup ("action_name|component|component_friendly|action_text|active_keys")
# use dedup_key as their first field, so this one function serves both.
# Uses literal string comparison, never regex/glob patterns on dedup_key, so keys with
# special characters like . * [ ] ^ \ are matched literally.
backup_if_absent() {
	backup_file="$1"
	dedup_key="$2"
	line="$3"
	if [ -f "$backup_file" ]; then
		while IFS= read -r existing_line; do
			existing_key="${existing_line%%|*}"
			if [ "$existing_key" = "$dedup_key" ]; then
				return 0
			fi
		done < "$backup_file"
	fi
	printf '%s\n' "$line" >> "$backup_file"
}
