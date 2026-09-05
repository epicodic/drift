#!/bin/sh
# Sets up Drift's global shortcuts end to end: frees any KWin action currently holding
# an active grant on one of Drift's target keys, then explicitly registers each Drift
# binding with kglobalaccel. Replaces release-shortcuts.sh, which only did the release
# half.
#
# Table-driven: DRIFT_BINDINGS below is the single source of truth. Each line is
#   drift_action_name|drift_action_text|sequence
# To add or rebind a Drift shortcut, add or edit one line here — no other part of this
# script needs to change unless the sequence uses a key or modifier not already known
# to key_code()/modifier_bit() in setup-shortcuts-lib.sh. Which KWin action (if any)
# currently collides with a given sequence is discovered at run time via
# kglobalaccel's allShortcutInfos, rather than hardcoded here — see
# find_conflicting_actions() in setup-shortcuts-lib.sh.
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
# matches Drift's default before Drift's own registration runs, and frees whatever KWin
# default would otherwise block it.
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

# shellcheck disable=SC1007 # CDPATH= is intentional: suppresses CDPATH's cd output/redirect quirks
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./setup-shortcuts-lib.sh
. "${SCRIPT_DIR}/setup-shortcuts-lib.sh"

DRIFT_BINDINGS='
DriftFocusLeft|Drift: Focus Column Left|Meta+Left
DriftFocusRight|Drift: Focus Column Right|Meta+Right
DriftToggleDebugConsole|Drift: Toggle Debug Console|Meta+Shift+D
DriftCycleAlignLeft|Drift: Cycle Column Align Left|Meta+Shift+Left
DriftCycleAlignRight|Drift: Cycle Column Align Right|Meta+Shift+Right
DriftViewportShiftLeft|Drift: Shift Viewport Left|Meta+Alt+Left
DriftViewportShiftRight|Drift: Shift Viewport Right|Meta+Alt+Right
DriftNavigateUp|Drift: Navigate Up|Meta+Up
DriftNavigateDown|Drift: Navigate Down|Meta+Down
DriftMoveWindowToStripAbove|Drift: Move Window To Strip Above|Meta+Ctrl+Up
DriftMoveWindowToStripBelow|Drift: Move Window To Strip Below|Meta+Ctrl+Down
DriftAbsorbRight|Drift: Absorb Column Right|Meta+I
DriftExpel|Drift: Expel Focused Tile|Meta+O
DriftMoveWindowLeft|Drift: Move Window Left|Meta+Ctrl+Left
DriftMoveWindowRight|Drift: Move Window Right|Meta+Ctrl+Right
DriftStripUp|Drift: Strip Up|Meta+Page_Up
DriftStripDown|Drift: Strip Down|Meta+Page_Down
DriftMoveColumnToStripAbove|Drift: Move Column To Strip Above|Meta+Ctrl+Page_Up
DriftMoveColumnToStripBelow|Drift: Move Column To Strip Below|Meta+Ctrl+Page_Down
DriftFocusFirst|Drift: Focus First Column|Meta+Home
DriftFocusLast|Drift: Focus Last Column|Meta+End
DriftMoveWindowToStart|Drift: Move Window To Start|Meta+Ctrl+Home
DriftMoveWindowToEnd|Drift: Move Window To End|Meta+Ctrl+End
DriftViewportShiftToStart|Drift: Shift Viewport To Start|Meta+Alt+Home
DriftViewportShiftToEnd|Drift: Shift Viewport To End|Meta+Alt+End
DriftIncreaseColumnWidth|Drift: Increase Column Width|Meta+Plus
DriftDecreaseColumnWidth|Drift: Decrease Column Width|Meta+Minus
DriftIncreaseWindowHeight|Drift: Increase Window Height|Meta+Shift+Plus
DriftDecreaseWindowHeight|Drift: Decrease Window Height|Meta+Shift+Minus
'

if ! command -v busctl >/dev/null 2>&1; then
	echo "setup-shortcuts.sh: busctl not found (part of systemd) — cannot continue" >&2
	exit 1
fi

# All of Drift's own action names, newline-separated — passed to
# find_conflicting_actions() so it never reports one of Drift's own actions as a
# conflict with itself (e.g. on a second run, after Drift already holds the key).
DRIFT_ACTION_NAMES="$(printf '%s\n' "$DRIFT_BINDINGS" | awk -F'|' 'NF > 1 { print $1 }')"

# Color codes for output
CYAN='\033[36m'
YELLOW='\033[33m'
GREEN='\033[32m'
RESET='\033[0m'

# Snapshot of every kwin-component shortcut and its current active/default keys, taken
# once up front so every binding below is checked against the same pre-run state.
ALL_SHORTCUT_INFOS="$(busctl --user call org.kde.kglobalaccel /component/kwin org.kde.kglobalaccel.Component allShortcutInfos)"

printf '%s\n' "$DRIFT_BINDINGS" | while IFS='|' read -r row_action_name row_action_text row_sequence; do
	[ -z "$row_action_name" ] && continue

	printf "${CYAN}%s${RESET}\n" "$row_sequence"

	target_code="$(keyseq_to_int "$row_sequence")"
	conflicts="$(find_conflicting_actions "$ALL_SHORTCUT_INFOS" "$target_code" "$DRIFT_ACTION_NAMES")"
	if [ -n "$conflicts" ]; then
		printf '%s\n' "$conflicts" | while IFS='|' read -r conflict_name conflict_text; do
			printf "  ${YELLOW}⎯${RESET} Releasing \"${conflict_text}\"...\n"
			busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
				4 kwin "${conflict_name}" KWin "${conflict_text}" 0 4 >/dev/null
		done
	fi

	code="$(keyseq_to_int "$row_sequence")"
	printf "  ${GREEN}✓${RESET} Setting up \"${row_action_text}\"...\n"
	busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
		4 kwin "${row_action_name}" KWin "${row_action_text}" 1 "${code}" 4 >/dev/null
done

printf "\n${GREEN}Done.${RESET} If a shortcut still doesn't respond, log out and back in.\n"
