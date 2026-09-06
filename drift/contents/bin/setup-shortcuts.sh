#!/bin/sh
# Sets up Drift's global shortcuts end to end: frees any kglobalaccel action currently
# holding an active grant on one of Drift's target keys, then explicitly registers each
# Drift binding with kglobalaccel.
#
# - Table-driven: DRIFT_BINDINGS is generated from src/config/settings-definitions.ts
#   (the single source of truth) by generate-shortcut-bindings.ts, and sourced from
#   drift/contents/bin/shortcut-bindings.generated.sh below — see
#   docs/agents/specs/2026-09-06-settings-consolidation-design.md. To add or rebind a
#   shortcut, edit settings-definitions.ts and run `npm run build`; nothing else needs
#   to change unless the sequence uses a key/modifier not already known to key_code()/
#   modifier_bit() in setup-shortcuts-lib.sh.
# - alt_sequence is optional and
#   registers a second key sequence for the same action, e.g. a numpad Plus/Minus
#   alongside the main-keyboard one. It has no counterpart in src/config/settings.ts:
#   Drift's own QML `ShortcutHandler` (src/input/shortcuts.ts) can only hold one
#   sequence per action, so alt_sequence only ever reaches kglobalaccel through this
#   script. It survives later runs of Drift's own registration because that
#   registration relies on kglobalaccel's default Autoloading behavior, which restores
#   whatever is already persisted instead of overwriting it with the QML side's single
#   sequence.
# - Conflict detection is dynamic: which action (if any) collides with a given sequence
#   is discovered at run time via kglobalaccel's allShortcutInfos, queried across
#   *every* registered component (not just kwin) — e.g. Meta+I's default conflict is
#   systemsettings.desktop's "launch application" shortcut, a separate component. See
#   find_conflicting_actions() in setup-shortcuts-lib.sh.
# - This script doesn't replace Drift's own QML `ShortcutHandler` elements
#   (src/input/shortcuts.ts) — those remain required, since they actually receive
#   KWin's "shortcut activated" signal and call into Drift's logic. This script only
#   ensures kglobalaccel's declared/active shortcut for each action already matches
#   Drift's default before Drift's own registration runs, freeing whatever KWin
#   default would otherwise block it.
# - Uses busctl (part of systemd) rather than qdbus6: qdbus6 can't infer the type of an
#   empty array literal (needed for the "clear the keys" `ai` argument when releasing),
#   confirmed live — busctl's explicit type signature sidesteps that entirely (see the
#   retired release-shortcuts.sh history for where this was first confirmed).
# - Freeing a KWin core action's shortcut only clears the *declared* assignment in
#   kglobalaccel; if that action's process already holds a live grab on the key (as
#   KWin does for its own compiled-in core actions), the grab is only released after a
#   logout/login. If a shortcut still doesn't respond after running this script, log
#   out and back in.

set -eu

# shellcheck disable=SC1007 # CDPATH= is intentional: suppresses CDPATH's cd output/redirect quirks
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./setup-shortcuts-lib.sh
. "${SCRIPT_DIR}/setup-shortcuts-lib.sh"

if [ ! -f "${SCRIPT_DIR}/shortcut-bindings.generated.sh" ]; then
	echo "setup-shortcuts.sh: shortcut-bindings.generated.sh not found — run 'npm run build' first" >&2
	exit 1
fi
# shellcheck source=./shortcut-bindings.generated.sh
. "${SCRIPT_DIR}/shortcut-bindings.generated.sh"

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

# Every registered kglobalaccel component (kwin, systemsettings.desktop, kaccess,
# etc.) — a conflicting shortcut can be owned by any of these, not only kwin.
COMPONENT_PATHS="$(parse_component_paths "$(busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel allComponents)")"

# Snapshot of every component's shortcuts and their current active/default keys, taken
# once up front so every binding below is checked against the same pre-run state. One
# allShortcutInfos reply per line, since each reply is itself a self-contained struct
# array that find_conflicting_actions parses independently.
ALL_SHORTCUT_INFOS="$(printf '%s\n' "$COMPONENT_PATHS" | while IFS= read -r component_path; do
	[ -z "$component_path" ] && continue
	busctl --user call org.kde.kglobalaccel "$component_path" org.kde.kglobalaccel.Component allShortcutInfos
done)"

printf '%s\n' "$DRIFT_BINDINGS" | while IFS='|' read -r row_action_name row_action_text row_sequence row_alt_sequence; do
	[ -z "$row_action_name" ] && continue

	if [ -n "$row_alt_sequence" ]; then
		printf "${CYAN}%s${RESET} (alt: ${CYAN}%s${RESET})\n" "$row_sequence" "$row_alt_sequence"
	else
		printf "${CYAN}%s${RESET}\n" "$row_sequence"
	fi

	primary_code="$(keyseq_to_int "$row_sequence")"
	alt_code=""
	[ -n "$row_alt_sequence" ] && alt_code="$(keyseq_to_int "$row_alt_sequence")"

	conflicts="$(printf '%s\n' "$ALL_SHORTCUT_INFOS" | while IFS= read -r component_dump; do
		[ -z "$component_dump" ] && continue
		find_conflicting_actions "$component_dump" "$primary_code" "$DRIFT_ACTION_NAMES"
		# Not "[ -n ... ] && find...": as the last statement in this loop body, a false
		# guard's own exit status would become the loop's exit status under set -e.
		if [ -n "$alt_code" ]; then
			find_conflicting_actions "$component_dump" "$alt_code" "$DRIFT_ACTION_NAMES"
		fi
	done)"
	if [ -n "$conflicts" ]; then
		printf '%s\n' "$conflicts" | while IFS='|' read -r conflict_name conflict_text conflict_component conflict_component_friendly; do
			printf "  ${YELLOW}⎯${RESET} Releasing \"${conflict_text}\" (${conflict_component_friendly})...\n"
			busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
				4 "${conflict_component}" "${conflict_name}" "${conflict_component_friendly}" "${conflict_text}" 0 4 >/dev/null
		done
	fi

	printf "  ${GREEN}✓${RESET} Setting up \"${row_action_text}\"...\n"
	if [ -n "$alt_code" ]; then
		busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
			4 kwin "${row_action_name}" KWin "${row_action_text}" 2 "${primary_code}" "${alt_code}" 4 >/dev/null
	else
		busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
			4 kwin "${row_action_name}" KWin "${row_action_text}" 1 "${primary_code}" 4 >/dev/null
	fi
done

printf "\n${GREEN}Done.${RESET} If a shortcut still doesn't respond, log out and back in.\n"
