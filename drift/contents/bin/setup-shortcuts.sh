#!/bin/sh
# Sets up Drift's global shortcuts end to end: frees the KWin default shortcuts that
# collide with Drift's bindings, then explicitly registers each Drift binding with
# kglobalaccel. Replaces release-shortcuts.sh, which only did the release half.
#
# Table-driven: DRIFT_BINDINGS below is the single source of truth. Each line is
#   drift_action_name|drift_action_text|sequence|colliding_kwin_action_name|colliding_kwin_action_text
# The last two fields are only needed when the target sequence collides with a KWin
# default global shortcut; leave them empty otherwise. To add or rebind a Drift
# shortcut, add or edit one line here — no other part of this script needs to change
# unless the sequence uses a key or modifier not already known to key_code()/
# modifier_bit() below.
#
# This intentionally duplicates each shortcut's default sequence, which also lives in
# src/config/settings.ts (DEFAULT_SETTINGS) — that duplication is unavoidable: this
# script runs standalone, outside the KWin script process, before Drift has a chance to
# self-register anything.
#
# Registering here does not replace Drift's own QML `ShortcutHandler` elements
# (src/input/shortcuts.ts) — those remain required, since they are what actually
# receives KWin's "shortcut activated" signal and calls into Drift's logic. This script
# only ensures kglobalaccel's declared/active shortcut for each Drift action already
# matches Drift's default before Drift's own registration runs, and frees the KWin
# defaults that would otherwise block it.
#
# Uses busctl (part of systemd) rather than qdbus6: qdbus6's own argument-type
# inference can't guess the type of an empty array literal (needed for the "clear the
# keys" `ai` argument when releasing), confirmed live — busctl's explicit type
# signature sidesteps that entirely (see the retired release-shortcuts.sh history for
# where this was first confirmed).
#
# Freeing a KWin core action's shortcut only clears the *declared* assignment in
# kglobalaccel; if that action's process already holds a live grab on the key (as KWin
# does for its own compiled-in core actions), the grab itself is only released after a
# logout/login. If a shortcut still doesn't respond after running this script, log out
# and back in.

set -eu

DRIFT_BINDINGS='
DriftFocusLeft|Drift: Focus Column Left|Meta+Left|Window Quick Tile Left|Quick Tile Window to the Left
DriftFocusRight|Drift: Focus Column Right|Meta+Right|Window Quick Tile Right|Quick Tile Window to the Right
DriftToggleDebugConsole|Drift: Toggle Debug Console|Meta+Shift+D||
DriftCycleAlignLeft|Drift: Cycle Column Align Left|Meta+Shift+Left|Window to Previous Screen|Move Window to Previous Screen
DriftCycleAlignRight|Drift: Cycle Column Align Right|Meta+Shift+Right|Window to Next Screen|Move Window to Next Screen
DriftViewportShiftLeft|Drift: Shift Viewport Left|Meta+Alt+Left||
DriftViewportShiftRight|Drift: Shift Viewport Right|Meta+Alt+Right||
DriftRowUp|Drift: Page Row Up|Meta+Page_Up|Window Maximize|Maximize Window
DriftRowDown|Drift: Page Row Down|Meta+Page_Down|Window Minimize|Minimize Window
DriftMoveWindowToRowAbove|Drift: Move Window To Row Above|Meta+Shift+Page_Up||
DriftMoveWindowToRowBelow|Drift: Move Window To Row Below|Meta+Shift+Page_Down||
'

if ! command -v busctl >/dev/null 2>&1; then
	echo "setup-shortcuts.sh: busctl not found (part of systemd) — cannot continue" >&2
	exit 1
fi

release() {
	action_name="$1"
	action_text="$2"
	echo "Releasing \"${action_text}\"..."
	busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
		4 kwin "${action_name}" KWin "${action_text}" 0 4 >/dev/null
}

# Qt::Key values (qnamespace.h) for the keys Drift's bindings use. Stable public API.
key_code() {
	case "$1" in
		Left) echo 16777234 ;;
		Right) echo 16777236 ;;
		Page_Up) echo 16777238 ;;
		Page_Down) echo 16777239 ;;
		D) echo 68 ;;
		*)
			echo "setup-shortcuts.sh: unknown key \"$1\" — add it to key_code() in this script" >&2
			exit 1
			;;
	esac
}

# Qt::KeyboardModifier bit values (qnamespace.h). Stable public API.
modifier_bit() {
	case "$1" in
		Shift) echo 33554432 ;;
		Ctrl) echo 67108864 ;;
		Alt) echo 134217728 ;;
		Meta) echo 268435456 ;;
		*)
			echo "setup-shortcuts.sh: unknown modifier \"$1\" — add it to modifier_bit() in this script" >&2
			exit 1
			;;
	esac
}

# Converts a "Meta+Shift+Left"-style sequence into the packed Qt key+modifier int
# kglobalaccel's setShortcut expects for a single-key-press shortcut.
keyseq_to_int() {
	total=0
	old_ifs="$IFS"
	IFS='+'
	# shellcheck disable=SC2086 # word-splitting on IFS='+' is the point here
	set -- $1
	IFS="$old_ifs"
	last_index=$#
	i=0
	for token in "$@"; do
		i=$((i + 1))
		if [ "$i" -eq "$last_index" ]; then
			total=$((total + $(key_code "$token")))
		else
			total=$((total + $(modifier_bit "$token")))
		fi
	done
	echo "$total"
}

register() {
	action_name="$1"
	action_text="$2"
	sequence="$3"
	code="$(keyseq_to_int "$sequence")"
	echo "Registering \"${action_text}\" as ${sequence}..."
	busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
		4 kwin "${action_name}" KWin "${action_text}" 1 "${code}" 4 >/dev/null
}

printf '%s\n' "$DRIFT_BINDINGS" | while IFS='|' read -r row_action_name row_action_text row_sequence row_kwin_name row_kwin_text; do
	[ -z "$row_action_name" ] && continue
	if [ -n "$row_kwin_name" ]; then
		release "$row_kwin_name" "$row_kwin_text"
	fi
	register "$row_action_name" "$row_action_text" "$row_sequence"
done

echo "Done. If a shortcut still doesn't respond, log out and back in."
