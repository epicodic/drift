#!/bin/sh
# Unit tests for settings-backup-lib.sh — the idempotent backup primitive shared by
# disable-incompatible-settings.sh and setup-shortcuts.sh. No KWin/D-Bus session
# required: these functions only ever touch plain files.
#
# Run directly: sh settings-backup-lib.test.sh

set -eu

# shellcheck disable=SC1007 # CDPATH= is intentional: suppresses CDPATH's cd output/redirect quirks
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./settings-backup-lib.sh
. "${SCRIPT_DIR}/settings-backup-lib.sh"

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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BACKUP_FILE="${TMP_DIR}/backup.txt"

backup_if_absent "$BACKUP_FILE" "WindowSnapZone" "WindowSnapZone|10"
assert_eq "first backup_if_absent call appends the line" \
	"WindowSnapZone|10" \
	"$(cat "$BACKUP_FILE")"

backup_if_absent "$BACKUP_FILE" "WindowSnapZone" "WindowSnapZone|0"
assert_eq "second call with the same key is a no-op, keeping the original value" \
	"WindowSnapZone|10" \
	"$(cat "$BACKUP_FILE")"

backup_if_absent "$BACKUP_FILE" "BorderSnapZone" "BorderSnapZone|10"
assert_eq "a different key is appended as its own line" \
	"WindowSnapZone|10
BorderSnapZone|10" \
	"$(cat "$BACKUP_FILE")"

XDG_STATE_HOME="${TMP_DIR}/state"
export XDG_STATE_HOME
resolved_dir="$(drift_backup_dir)"
assert_eq "drift_backup_dir honors XDG_STATE_HOME" \
	"${TMP_DIR}/state/drift/settings-backup" \
	"$resolved_dir"
assert_eq "drift_backup_dir creates the directory" \
	"yes" \
	"$([ -d "$resolved_dir" ] && echo yes || echo no)"
unset XDG_STATE_HOME

# Regression test: old buggy grep-based code would let "a.b" wildcard-match the
# existing "aXb" line via regex "." and wrongly treat it as already backed up.
backup_if_absent "$BACKUP_FILE" "aXb" "aXb|first"
backup_if_absent "$BACKUP_FILE" "a.b" "a.b|second"
assert_eq "a dedup_key with a regex-special character is matched literally" \
	"WindowSnapZone|10
BorderSnapZone|10
aXb|first
a.b|second" \
	"$(cat "$BACKUP_FILE")"

if [ "$tests_failed" -gt 0 ]; then
	echo "${tests_failed}/${tests_run} tests failed" >&2
	exit 1
fi
echo "${tests_run}/${tests_run} tests passed"
