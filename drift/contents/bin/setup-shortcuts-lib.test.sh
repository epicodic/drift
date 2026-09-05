#!/bin/sh
# Unit tests for setup-shortcuts-lib.sh's pure functions. No D-Bus session required —
# find_conflicting_actions is tested against a canned `busctl call ...
# allShortcutInfos` reply (captured from a live session, see fixture below) rather
# than a live query, since the parsing/matching logic is what's actually worth
# regression-testing here; the D-Bus call itself can only be verified live.
#
# Run directly: sh setup-shortcuts-lib.test.sh

set -eu

# shellcheck disable=SC1007 # CDPATH= is intentional: suppresses CDPATH's cd output/redirect quirks
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./setup-shortcuts-lib.sh
. "${SCRIPT_DIR}/setup-shortcuts-lib.sh"

tests_run=0
tests_failed=0

assert_eq() {
	description="$1"
	expected="$2"
	actual="$3"
	tests_run=$((tests_run + 1))
	if [ "$expected" != "$actual" ]; then
		tests_failed=$((tests_failed + 1))
		printf 'FAIL: %s\n  expected: %s\n  actual:   %s\n' "$description" "$expected" "$actual" >&2
	fi
}

# Captured via: busctl --user call org.kde.kglobalaccel /component/kwin
# org.kde.kglobalaccel.Component allShortcutInfos
# Five actions: a released KWin default (active=[], default=[285212692]), a Drift
# action holding that same key (active=[285212692]), a KWin action with one active and
# two default keys, a KWin action with an unbound (0) default and no active grant, and
# a KWin action with neither active nor default keys.
FIXTURE_ALL_SHORTCUT_INFOS='a(ssssssaiai) 5 "Window Quick Tile Right" "Quick Tile Window to the Right" "kwin" "KWin" "default" "Default Context" 0 1 285212692 "DriftFocusRight" "Drift: Focus Column Right" "kwin" "KWin" "default" "Default Context" 1 285212692 0 "ExposeClass" "Toggle Present Windows (Window class)" "kwin" "KWin" "default" "Default Context" 1 83886134 2 83886134 285212726 "Switch to Screen 7" "Switch to Screen 7" "kwin" "KWin" "default" "Default Context" 0 1 0 "Walk Through Windows of Current Application Alternative" "Walk Through Windows of Current Application Alternative" "kwin" "KWin" "default" "Default Context" 0 0'

# Captured via: busctl --user call org.kde.kglobalaccel /component/systemsettings_desktop
# org.kde.kglobalaccel.Component allShortcutInfos
# The real-world case this whole fix targets: Meta+I (268435529) is actively held by
# systemsettings.desktop's own "_launch" action, not by anything in the kwin component.
FIXTURE_SYSTEMSETTINGS_SHORTCUT_INFOS='a(ssssssaiai) 1 "_launch" "System Settings" "systemsettings.desktop" "System Settings" "default" "Default Context" 2 16777457 268435529 2 16777457 268435529'

# Captured via: busctl --user call org.kde.kglobalaccel /component/KDE_Keyboard_Layout_Switcher
# org.kde.kglobalaccel.Component allShortcutInfos
# Regression fixture: this action's actionFriendly is a genuinely empty string (""),
# which used to vanish during `set -- $(...)` word splitting and desync every
# fixed-width field read after it for the rest of the struct.
FIXTURE_EMPTY_FRIENDLY_SHORTCUT_INFOS='a(ssssssaiai) 2 "Switch to Next Keyboard Layout" "" "KDE Keyboard Layout Switcher" "Keyboard Layout Switcher" "default" "Default Context" 1 402653259 1 402653259 "Switch to Last-Used Keyboard Layout" "" "KDE Keyboard Layout Switcher" "Keyboard Layout Switcher" "default" "Default Context" 1 402653260 1 402653260'

# Captured via: busctl --user call org.kde.kglobalaccel /component/ActivityManager
# org.kde.kglobalaccel.Component allShortcutInfos (with a synthetic active key added,
# since the real action has no active grant, to exercise the match path too).
# Regression fixture: busctl backslash-escapes a quote embedded in a string value
# (activity names can contain quotes), which used to be mistaken for the end of the
# token, desyncing every fixed-width field read after it for the rest of the struct.
FIXTURE_ESCAPED_QUOTE_SHORTCUT_INFOS='a(ssssssaiai) 1 "switch-to-activity-0fa1616a" "Switch to activity \"Browsing\"" "ActivityManager" "Activity Manager" "default" "Default Context" 1 123 0'

# Captured via: busctl --user call org.kde.kglobalaccel /kglobalaccel
# org.kde.KGlobalAccel allComponents
FIXTURE_ALL_COMPONENTS='ao 3 "/component/kwin" "/component/kaccess" "/component/systemsettings_desktop"'

# keyseq_to_int cross-checked against the fixture: DriftFocusRight's real active grant
# is 285212692, which is exactly Meta (268435456) + Right (16777236).
assert_eq "keyseq_to_int computes Meta+Right" "285212692" "$(keyseq_to_int "Meta+Right")"

# key_code falls back to the ASCII code for any single uppercase letter, since
# Qt::Key_A..Key_Z equal ASCII 'A'..'Z' — cross-checked against qnamespace.h.
assert_eq "key_code falls back to ASCII for D" "68" "$(key_code "D")"
assert_eq "key_code falls back to ASCII for I" "73" "$(key_code "I")"
assert_eq "key_code falls back to ASCII for O" "79" "$(key_code "O")"
assert_eq "key_code falls back to ASCII for A" "65" "$(key_code "A")"
assert_eq "key_code falls back to ASCII for Z" "90" "$(key_code "Z")"

# DriftFocusRight already holds the target key, but it's in the exclude list (it's one
# of Drift's own actions) — must not be reported as a conflict to release.
assert_eq "own action holding the key is not reported as a conflict" "" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "285212692" "DriftFocusRight
DriftFocusLeft")"

# ExposeClass holds an active grant on 83886134 and is not in the exclude list. The
# owning component (kwin/KWin) is reported alongside it, since the caller may need to
# release the shortcut from a component other than kwin.
assert_eq "a KWin action holding the key is reported for release" \
	"ExposeClass|Toggle Present Windows (Window class)|kwin|KWin" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "83886134" "DriftFocusRight
DriftFocusLeft")"

# The kwin component's own reply has no conflict on Meta+I — the conflict here is only
# visible by also checking the systemsettings.desktop component's reply, which is
# exactly the bug this fix addresses (Meta+I was never released because the script
# used to only ever query the kwin component).
assert_eq "kwin component reply alone reports no conflict for Meta+I" "" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "268435529" "")"
assert_eq "a non-kwin component's action holding the key is reported with its own component" \
	"_launch|System Settings|systemsettings.desktop|System Settings" \
	"$(find_conflicting_actions "$FIXTURE_SYSTEMSETTINGS_SHORTCUT_INFOS" "268435529" "")"

# parse_component_paths turns an allComponents reply into one object path per line.
assert_eq "parse_component_paths extracts every component path" \
	"/component/kwin
/component/kaccess
/component/systemsettings_desktop" \
	"$(parse_component_paths "$FIXTURE_ALL_COMPONENTS")"

# An empty actionFriendly ("") must not desync parsing of the fields after it, and
# must be restored to a real empty string, not left as the internal sentinel.
assert_eq "an action with an empty friendly name is parsed correctly" \
	"Switch to Last-Used Keyboard Layout||KDE Keyboard Layout Switcher|Keyboard Layout Switcher" \
	"$(find_conflicting_actions "$FIXTURE_EMPTY_FRIENDLY_SHORTCUT_INFOS" "402653260" "")"

# A friendly-text value with an embedded, backslash-escaped quote must not desync the
# fixed-width fields after it, and the quote must be unescaped in the parsed output.
assert_eq "an action with an embedded escaped quote is parsed correctly" \
	'switch-to-activity-0fa1616a|Switch to activity "Browsing"|ActivityManager|Activity Manager' \
	"$(find_conflicting_actions "$FIXTURE_ESCAPED_QUOTE_SHORTCUT_INFOS" "123" "")"

# 0 only ever appears in a defaultKeys array (Switch to Screen 7), never in any
# activeKeys array — a defaultKeys-only match must not be reported.
assert_eq "a key present only in defaultKeys is not a conflict" "" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "0" "")"

# No action anywhere holds this key.
assert_eq "an unclaimed key reports no conflicts" "" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "999999999" "")"

if [ "$tests_failed" -gt 0 ]; then
	echo "${tests_failed}/${tests_run} tests failed" >&2
	exit 1
fi
echo "${tests_run}/${tests_run} tests passed"
