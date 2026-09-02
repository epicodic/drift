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

# keyseq_to_int cross-checked against the fixture: DriftFocusRight's real active grant
# is 285212692, which is exactly Meta (268435456) + Right (16777236).
assert_eq "keyseq_to_int computes Meta+Right" "285212692" "$(keyseq_to_int "Meta+Right")"

# DriftFocusRight already holds the target key, but it's in the exclude list (it's one
# of Drift's own actions) — must not be reported as a conflict to release.
assert_eq "own action holding the key is not reported as a conflict" "" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "285212692" "DriftFocusRight
DriftFocusLeft")"

# ExposeClass holds an active grant on 83886134 and is not in the exclude list.
assert_eq "a KWin action holding the key is reported for release" \
	"ExposeClass|Toggle Present Windows (Window class)" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "83886134" "DriftFocusRight
DriftFocusLeft")"

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
