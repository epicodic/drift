# Self-Contained Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single self-extracting `drift-install.sh` that installs the Drift kwinscript, disables the KWin settings known to conflict with it, and sets up its default shortcuts — each mutating step backing up what it changes so a bundled `uninstall.sh` can restore everything.

**Architecture:** Two new small shell scripts (`disable-incompatible-settings.sh`, `uninstall.sh`) join the existing `setup-shortcuts.sh` under `drift/bin/`, all sharing one new idempotent backup primitive (`settings-backup-lib.sh`). A new top-level `installer/drift-install.sh.tmpl` provides the interactive, colored orchestration layer; `make installer` concatenates it with the built `.kwinscript` archive into one executable file.

**Tech Stack:** POSIX `sh` for scripts shipped inside the package (`drift/bin/`, matching `setup-shortcuts.sh`'s existing style: tabs, `set -eu`); `bash` for repo-root build-tooling scripts (`scripts/`, matching `scripts/compile-shaders.sh`'s style: 4-space indent, `set -euo pipefail`). GNU Make for orchestration.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing. No shell-specific section exists there; follow the established patterns in `drift/bin/setup-shortcuts.sh`/`setup-shortcuts-lib.sh` (packaged scripts) and `scripts/compile-shaders.sh` (build tooling) exactly, since this plan extends both.

**Reference:** `docs/agents/specs/2026-09-13-self-contained-installer-design.md` — read this first; every decision below traces back to it.

---

### Task 1: `settings-backup-lib.sh` — idempotent backup primitive

**Files:**
- Create: `drift/bin/settings-backup-lib.sh` (mode 644 — sourced only, never executed directly, matching `setup-shortcuts-lib.sh`)
- Create: `drift/bin/settings-backup-lib.test.sh` (mode 755 — run directly, matching `setup-shortcuts-lib.test.sh`)

This is the piece the spec calls out as a hard invariant: a second run of any script that backs something up must never overwrite a real original value with whatever Drift itself already applied. Both `disable-incompatible-settings.sh` (Task 2) and `setup-shortcuts.sh` (Task 4) will depend on it.

- [ ] **Step 1: Write the failing test**

Create `drift/bin/settings-backup-lib.test.sh`:

```sh
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

if [ "$tests_failed" -gt 0 ]; then
	echo "${tests_failed}/${tests_run} tests failed" >&2
	exit 1
fi
echo "${tests_run}/${tests_run} tests passed"
```

Then make it executable:

```bash
chmod +x drift/bin/settings-backup-lib.test.sh
```

- [ ] **Step 2: Run test to verify it fails**

```bash
sh drift/bin/settings-backup-lib.test.sh
```

Expected: FAIL — `settings-backup-lib.sh` doesn't exist yet, so the `.` (source) line aborts the script under `set -eu` with a "No such file or directory" error.

- [ ] **Step 3: Write minimal implementation**

Create `drift/bin/settings-backup-lib.sh`:

```sh
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
backup_if_absent() {
	backup_file="$1"
	dedup_key="$2"
	line="$3"
	if [ -f "$backup_file" ] && grep -q "^${dedup_key}|" "$backup_file"; then
		return 0
	fi
	printf '%s\n' "$line" >> "$backup_file"
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
sh drift/bin/settings-backup-lib.test.sh
```

Expected: `5/5 tests passed`

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming matches project shell conventions (tabs, `set -eu`, `SCRIPT_DIR` sourcing pattern)
- [ ] `shellcheck drift/bin/settings-backup-lib.sh drift/bin/settings-backup-lib.test.sh` run and any real findings fixed
- [ ] `sh drift/bin/settings-backup-lib.test.sh` passing (from Step 4)
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: `disable-incompatible-settings.sh`

**Files:**
- Create: `drift/bin/disable-incompatible-settings.sh` (mode 755)

Implements the settings called out in `docs/known_bugs.md` #2. No automated test is possible here (it shells out to live `kreadconfig6`/`kwriteconfig6`/`qdbus6`) — this follows the same manual-smoke-check convention `setup-shortcuts.sh` already uses for its own D-Bus calls.

- [ ] **Step 1: Write the script**

Create `drift/bin/disable-incompatible-settings.sh`:

```sh
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

if ! command -v kwriteconfig6 >/dev/null 2>&1 || ! command -v kreadconfig6 >/dev/null 2>&1; then
	echo "disable-incompatible-settings.sh: kwriteconfig6/kreadconfig6 not found — cannot continue" >&2
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
# when a key has never been written to kwinrc.
backup_and_set WindowSnapZone 10 0
backup_and_set BorderSnapZone 10 0
backup_and_set ElectricBorderMaximize true false
backup_and_set ElectricBorderTiling true false

qdbus6 org.kde.KWin /KWin reconfigure

echo "Incompatible KWin settings disabled (backup: ${BACKUP_FILE})."
```

```bash
chmod +x drift/bin/disable-incompatible-settings.sh
```

- [ ] **Step 2: Syntax check**

```bash
sh -n drift/bin/disable-incompatible-settings.sh
```

Expected: no output (syntax OK).

- [ ] **Step 3: Manual smoke check (not run in this step, documented for the live-KWin verification pass)**

On a real KWin session:
1. Note current values: `kreadconfig6 --file kwinrc --group Windows --key WindowSnapZone` (and the other three keys).
2. Run `drift/bin/disable-incompatible-settings.sh`.
3. Confirm the four keys now read `0`, `0`, `false`, `false`.
4. Confirm `~/.local/state/drift/settings-backup/kwinrc-windows.env` contains the original values from step 1.
5. Run the script a **second time**; confirm the backup file is byte-identical to after the first run (the write-once guarantee from the spec).

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming/style matches `setup-shortcuts.sh` (tabs, `set -eu`, header comment style)
- [ ] `shellcheck drift/bin/disable-incompatible-settings.sh` run and any real findings fixed
- [ ] `sh -n` check from Step 2 passing
- [ ] Manual smoke check from Step 3 performed and recorded PASS/FAIL

---

### Task 3: Extend `find_conflicting_actions` to report active key codes

**Files:**
- Modify: `drift/bin/setup-shortcuts-lib.sh:124-192` (`find_conflicting_actions`)
- Modify: `drift/bin/setup-shortcuts-lib.test.sh:90-134` (existing assertions)

Restoring a displaced shortcut on uninstall needs its *exact* prior active key(s) — not just the one key that happened to collide with a Drift binding, since an action can hold more than one active key (the `_launch`/Meta+I fixture already covers this: two active keys, `16777457` and `268435529`). `find_conflicting_actions` already parses the active-keys array internally but discards it after checking for a match; this task makes it report the full list as a 5th pipe-delimited field.

- [ ] **Step 1: Update the existing tests to expect the new field (TDD: red first)**

In `drift/bin/setup-shortcuts-lib.test.sh`, replace the four assertions that check `find_conflicting_actions`'s non-empty output:

```sh
# ExposeClass holds an active grant on 83886134 and is not in the exclude list. The
# owning component (kwin/KWin) is reported alongside it, since the caller may need to
# release the shortcut from a component other than kwin. The trailing field is its
# full space-separated list of active key codes, needed to restore the exact prior
# shortcut later.
assert_eq "a KWin action holding the key is reported for release" \
	"ExposeClass|Toggle Present Windows (Window class)|kwin|KWin|83886134" \
	"$(find_conflicting_actions "$FIXTURE_ALL_SHORTCUT_INFOS" "83886134" "DriftFocusRight
DriftFocusLeft")"
```

```sh
assert_eq "a non-kwin component's action holding the key is reported with its own component" \
	"_launch|System Settings|systemsettings.desktop|System Settings|16777457 268435529" \
	"$(find_conflicting_actions "$FIXTURE_SYSTEMSETTINGS_SHORTCUT_INFOS" "268435529" "")"
```

```sh
# An empty actionFriendly ("") must not desync parsing of the fields after it, and
# must be restored to a real empty string, not left as the internal sentinel.
assert_eq "an action with an empty friendly name is parsed correctly" \
	"Switch to Last-Used Keyboard Layout||KDE Keyboard Layout Switcher|Keyboard Layout Switcher|402653260" \
	"$(find_conflicting_actions "$FIXTURE_EMPTY_FRIENDLY_SHORTCUT_INFOS" "402653260" "")"
```

```sh
# A friendly-text value with an embedded, backslash-escaped quote must not desync the
# fixed-width fields after it, and the quote must be unescaped in the parsed output.
assert_eq "an action with an embedded escaped quote is parsed correctly" \
	'switch-to-activity-0fa1616a|Switch to activity "Browsing"|ActivityManager|Activity Manager|123' \
	"$(find_conflicting_actions "$FIXTURE_ESCAPED_QUOTE_SHORTCUT_INFOS" "123" "")"
```

The three empty-output assertions (own action excluded, kwin-only reply has no Meta+I conflict, defaultKeys-only match, unclaimed key) are unchanged — empty output stays empty regardless of the new field.

- [ ] **Step 2: Run test to verify it fails**

```bash
sh drift/bin/setup-shortcuts-lib.test.sh
```

Expected: FAIL on the four assertions just updated — the current implementation still prints only 4 fields.

- [ ] **Step 3: Implement the new field**

In `drift/bin/setup-shortcuts-lib.sh`, update the header comment above `find_conflicting_actions` (replace the first bullet):

```sh
# - Prints "actionUnique|actionFriendly|componentUnique|componentFriendly|activeKeys"
#   for each action, other than ones listed in exclude_actions (newline-separated,
#   exact match), currently holding an *active* grant on target_code. activeKeys is
#   the action's full list of active key codes (space-separated, in their original
#   order) — not just target_code — so a caller can back up and later restore the
#   exact prior shortcut even when it held more than one active key.
```

Then, inside `find_conflicting_actions`, replace the active-keys loop:

```sh
		active_count="$1"
		shift 1
		matched=0
		active_keys=""
		i=0
		while [ "$i" -lt "$active_count" ]; do
			active_keys="${active_keys:+${active_keys} }$1"
			[ "$1" = "$target_code" ] && matched=1
			shift 1
			i=$((i + 1))
		done
```

And the print statement:

```sh
		if [ "$matched" -eq 1 ]; then
			case "${nl}${exclude_actions}${nl}" in
				*"${nl}${action_unique}${nl}"*) : ;;
				*) printf '%s|%s|%s|%s|%s\n' "$action_unique" "$action_friendly" "$component_unique" "$component_friendly" "$active_keys" ;;
			esac
		fi
```

- [ ] **Step 4: Run test to verify it passes**

```bash
sh drift/bin/setup-shortcuts-lib.test.sh
```

Expected: `11/11 tests passed`

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming/style unchanged from surrounding code (tabs, existing variable naming)
- [ ] `shellcheck drift/bin/setup-shortcuts-lib.sh drift/bin/setup-shortcuts-lib.test.sh` run and any real findings fixed
- [ ] `sh drift/bin/setup-shortcuts-lib.test.sh` passing (from Step 4)
- [ ] Any convention violations fixed before moving to next task

---

### Task 4: Wire shortcut backup into `setup-shortcuts.sh`

**Files:**
- Modify: `drift/bin/setup-shortcuts.sh:1-42` (header comment), `:43-56` (sourcing block), `:108-114` (conflict-release loop)

Depends on Task 1 (`settings-backup-lib.sh`) and Task 3 (5-field `find_conflicting_actions` output). No automated test — this is the live-`busctl`-mutation path `setup-shortcuts.sh` already documents as manual-check-only.

- [ ] **Step 1: Add the new header bullet**

In `drift/bin/setup-shortcuts.sh`, insert a new bullet into the top comment block, right before the final "Freeing a KWin core action's shortcut..." bullet (around line 37):

```sh
# - Before releasing another action's shortcut, its current active key(s) are recorded
#   via settings-backup-lib.sh's backup_if_absent() into shortcuts.backup (under
#   drift_backup_dir(), only the very first time each action is displaced), so
#   uninstall.sh can restore the exact prior binding later. See
#   docs/agents/specs/2026-09-13-self-contained-installer-design.md.
```

- [ ] **Step 2: Source the backup lib and compute the backup file path**

Right after the existing `. "${SCRIPT_DIR}/setup-shortcuts-lib.sh"` line, add:

```sh
# shellcheck source=./settings-backup-lib.sh
. "${SCRIPT_DIR}/settings-backup-lib.sh"

SHORTCUTS_BACKUP_FILE="$(drift_backup_dir)/shortcuts.backup"
```

- [ ] **Step 3: Record the backup before releasing a conflicting shortcut**

Replace the conflict-release loop:

```sh
	if [ -n "$conflicts" ]; then
		printf '%s\n' "$conflicts" | while IFS='|' read -r conflict_name conflict_text conflict_component conflict_component_friendly conflict_active_keys; do
			printf "  ${YELLOW}⎯${RESET} Releasing \"${conflict_text}\" (${conflict_component_friendly})...\n"
			backup_if_absent "$SHORTCUTS_BACKUP_FILE" "$conflict_name" \
				"${conflict_name}|${conflict_component}|${conflict_component_friendly}|${conflict_text}|${conflict_active_keys}"
			busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
				4 "${conflict_component}" "${conflict_name}" "${conflict_component_friendly}" "${conflict_text}" 0 4 >/dev/null
		done
	fi
```

- [ ] **Step 4: Syntax check**

```bash
sh -n drift/bin/setup-shortcuts.sh
```

Expected: no output (syntax OK).

- [ ] **Step 5: Manual smoke check (documented for the live-KWin verification pass)**

1. Pick an action known to collide with a Drift default (e.g. `systemsettings.desktop`'s Meta+I, per the header comment).
2. Run `drift/bin/setup-shortcuts.sh` and confirm it reports releasing that action.
3. Confirm `~/.local/state/drift/settings-backup/shortcuts.backup` gained a line for that action's `actionUnique`, with all of its original active key codes (space-separated) in the last field.
4. Run the script a **second time**; confirm the backup file is unchanged (Drift now holds the key, so no conflict is found on this run — the write-once guarantee holds trivially).

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming/style unchanged from surrounding code
- [ ] `shellcheck drift/bin/setup-shortcuts.sh` run and any real findings fixed
- [ ] `sh -n` check from Step 4 passing
- [ ] Manual smoke check from Step 5 performed and recorded PASS/FAIL

---

### Task 5: `uninstall.sh`

**Files:**
- Create: `drift/bin/uninstall.sh` (mode 755)

Depends on Task 1 (backup file locations/format) and Task 4 (shortcut backup's 5-field line format). Ships inside the package itself, per the spec's decision, so it's reachable at `~/.local/share/kwin/scripts/drift/contents/bin/uninstall.sh` even without the original installer file — no Makefile change is needed to package it: `BIN_SRCS := $(shell find drift/bin -type f -not -name '*.test.*')` already picks up every non-test file under `drift/bin/`, including this one and the two created in Tasks 1 and 2.

- [ ] **Step 1: Write the script**

Create `drift/bin/uninstall.sh`:

```sh
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
```

```bash
chmod +x drift/bin/uninstall.sh
```

- [ ] **Step 2: Syntax check**

```bash
sh -n drift/bin/uninstall.sh
```

Expected: no output (syntax OK).

- [ ] **Step 3: Manual smoke check (documented for the live-KWin verification pass)**

Run this after Tasks 2 and 4's smoke checks have populated both backup files:
1. Run `~/.local/share/kwin/scripts/drift/contents/bin/uninstall.sh` (after a full `make install` + both settings scripts have run at least once).
2. Confirm the previously-displaced shortcut (e.g. Meta+I) is active again for its original owner.
3. Confirm the four `kwinrc [Windows]` keys are back to their pre-install values.
4. Confirm both backup files under `~/.local/state/drift/settings-backup/` are gone.
5. Confirm `kpackagetool6 --type=KWin/Script --list` no longer lists `drift`.
6. Run the script again with no backups present; confirm it prints both "skipping" notices and still removes the package cleanly (exit 0), rather than erroring.

- [ ] **Step 4: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming/style matches `setup-shortcuts.sh`/`disable-incompatible-settings.sh`
- [ ] `shellcheck drift/bin/uninstall.sh` run and any real findings fixed
- [ ] `sh -n` check from Step 2 passing
- [ ] Manual smoke check from Step 3 performed and recorded PASS/FAIL

---

### Task 6: Self-extracting `drift-install.sh` and `make installer`

**Files:**
- Create: `installer/drift-install.sh.tmpl` (mode 644 — never executed directly; `make installer` builds the real executable from it)
- Create: `scripts/verify-installer-payload.sh` (mode 755)
- Modify: `Makefile` (new variables, `.PHONY` list, `package`/`installer` targets, `help` text)

Depends on Task 2 and Task 4/5's scripts already existing under `drift/bin/` (the installer calls them by their installed path). No automated end-to-end test (needs live `kpackagetool6`/D-Bus); the payload-integrity check is automated at build time instead, wired directly into the `installer` target's own recipe rather than into `test`/`lint`/`build` — those three already form a cycle (`build` depends on both `lint` and `test`), and `installer` depends on `build` via `package`, so making `test` or `lint` depend on `installer` would be circular.

- [ ] **Step 1: Write the installer template**

Create `installer/drift-install.sh.tmpl`:

```sh
#!/bin/sh
# Self-contained Drift installer: this file is a POSIX shell script with the built
# .kwinscript archive appended to it as raw bytes after the __DRIFT_PAYLOAD__ marker
# below (see `make installer` / Makefile). Must be saved to a real file and executed
# directly (`sh ./drift-install.sh` or `./drift-install.sh`) — piping it through a
# shell (`curl ... | sh`) does not work, since the payload is read back out of the
# script's own file via `$0`, which isn't a real file when read from a pipe.
#
# Installs the Drift kwinscript, then optionally disables the KWin settings known to
# conflict with it (docs/known_bugs.md #2) and sets up its default shortcuts — each of
# those two steps backs up what it changes so `uninstall.sh` (shipped inside the
# installed package at contents/bin/uninstall.sh) can restore it later.
# See docs/agents/specs/2026-09-13-self-contained-installer-design.md.

set -u

CYAN='\033[36m'
YELLOW='\033[33m'
GREEN='\033[32m'
BOLD='\033[1m'
RESET='\033[0m'

INSTALL_DIR="${HOME}/.local/share/kwin/scripts/drift"

print_step() {
	printf "${BOLD}==> %s${RESET}\n" "$1"
}

print_success() {
	printf "${GREEN}✓ %s${RESET}\n" "$1"
}

print_skipped() {
	printf "${YELLOW}⎯ Skipped.${RESET}\n"
}

print_warning() {
	printf "${YELLOW}%s${RESET}\n" "$1"
}

# Reads a yes/no answer from the terminal, defaulting to "yes" on an empty reply or
# when stdin isn't a terminal (e.g. this script's own extraction ran non-interactively).
prompt_yes_no() {
	printf "${CYAN}%s${RESET} [Y/n] " "$1"
	if [ -t 0 ]; then
		read -r reply
	else
		reply=""
	fi
	case "$reply" in
		[Nn]*) return 1 ;;
		*) return 0 ;;
	esac
}

if [ ! -f "$0" ]; then
	echo "drift-install.sh: must be run from a real file, not piped through a shell (e.g. 'curl ... | sh')." >&2
	exit 1
fi

marker_line="$(grep -an -m1 -n '^__DRIFT_PAYLOAD__$' "$0" | cut -d: -f1)"
if [ -z "$marker_line" ]; then
	echo "drift-install.sh: no payload found — this file was not built by 'make installer'." >&2
	exit 1
fi

TMP_KWINSCRIPT="$(mktemp --suffix=.kwinscript)"
trap 'rm -f "$TMP_KWINSCRIPT"' EXIT
tail -n "+$((marker_line + 1))" "$0" > "$TMP_KWINSCRIPT"

if prompt_yes_no "Install/upgrade the Drift kwinscript?"; then
	print_step "Installing Drift kwinscript..."
	if kpackagetool6 --type=KWin/Script --install="$TMP_KWINSCRIPT" \
		|| kpackagetool6 --type=KWin/Script --upgrade="$TMP_KWINSCRIPT"; then
		kwriteconfig6 --file kwinrc --group Plugins --key DriftEnabled true
		qdbus6 org.kde.KWin /KWin reconfigure
		print_success "Drift installed and enabled."
	else
		echo "drift-install.sh: failed to install the Drift kwinscript." >&2
		exit 1
	fi
else
	print_skipped
fi

if prompt_yes_no "Disable KWin settings known to conflict with Drift (edge snapping/tiling)?"; then
	SETTINGS_SCRIPT="${INSTALL_DIR}/contents/bin/disable-incompatible-settings.sh"
	if [ -x "$SETTINGS_SCRIPT" ]; then
		print_step "Disabling incompatible KWin settings..."
		if "$SETTINGS_SCRIPT"; then
			print_success "Incompatible KWin settings disabled."
		else
			print_warning "drift-install.sh: disable-incompatible-settings.sh failed; continuing."
		fi
	else
		print_warning "drift-install.sh: Drift isn't installed yet, skipping settings step."
	fi
else
	print_skipped
fi

if prompt_yes_no "Set up Drift's default keyboard shortcuts?"; then
	SHORTCUTS_SCRIPT="${INSTALL_DIR}/contents/bin/setup-shortcuts.sh"
	if [ -x "$SHORTCUTS_SCRIPT" ]; then
		print_step "Setting up shortcuts..."
		if "$SHORTCUTS_SCRIPT"; then
			print_success "Shortcuts set up."
		else
			print_warning "drift-install.sh: setup-shortcuts.sh failed; continuing."
		fi
	else
		print_warning "drift-install.sh: Drift isn't installed yet, skipping shortcuts step."
	fi
else
	print_skipped
fi

echo
echo "Done. Run ${INSTALL_DIR}/contents/bin/uninstall.sh to remove Drift and restore any changed settings."

exit 0

__DRIFT_PAYLOAD__
```

- [ ] **Step 2: Write the payload-integrity checker**

Create `scripts/verify-installer-payload.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $(basename "$0") <drift-install.sh> <kwinscript-archive>" >&2
    exit 1
fi

installer="$1"
archive="$2"

marker_line="$(grep -an -m1 -n '^__DRIFT_PAYLOAD__$' "${installer}" | cut -d: -f1)"
if [[ -z "${marker_line}" ]]; then
    echo "verify-installer-payload.sh: no __DRIFT_PAYLOAD__ marker found in ${installer}" >&2
    exit 1
fi

extracted="$(mktemp)"
trap 'rm -f "${extracted}"' EXIT
tail -n "+$((marker_line + 1))" "${installer}" > "${extracted}"

if ! cmp -s "${extracted}" "${archive}"; then
    echo "verify-installer-payload.sh: payload in ${installer} does not match ${archive} byte-for-byte" >&2
    exit 1
fi

echo "verify-installer-payload.sh: payload matches ${archive} byte-for-byte"
```

```bash
chmod +x scripts/verify-installer-payload.sh
```

- [ ] **Step 3: Wire both into the Makefile**

In `Makefile`, add two new path variables right after the existing `METADATA` variable definition:

```make
KWINSCRIPT_ARCHIVE := $(BUILD_DIR)/$(SCRIPT_NAME)_$(subst .,_,$(VERSION)).kwinscript
INSTALLER_TEMPLATE := installer/drift-install.sh.tmpl
INSTALLER_SCRIPT := $(BUILD_DIR)/drift-install.sh
```

Add `installer` to the `.PHONY` line:

```make
.PHONY: build npm-install compile ui bin-scripts shaders lint lint-fix test install uninstall package installer clean enable disable restart-kwin help
```

Replace the existing `package` target with a real file rule plus a thin phony wrapper:

```make
$(KWINSCRIPT_ARCHIVE): build
	cd $(BUILD_DIR) && zip -r $(notdir $(KWINSCRIPT_ARCHIVE)) ./drift

package: $(KWINSCRIPT_ARCHIVE)

installer: $(INSTALLER_SCRIPT)

$(INSTALLER_SCRIPT): $(INSTALLER_TEMPLATE) $(KWINSCRIPT_ARCHIVE) scripts/verify-installer-payload.sh
	sh -n $(INSTALLER_TEMPLATE)
	cat $(INSTALLER_TEMPLATE) $(KWINSCRIPT_ARCHIVE) > $@
	chmod +x $@
	scripts/verify-installer-payload.sh $@ $(KWINSCRIPT_ARCHIVE)
```

Add an `installer` line to `help`, right after the existing `package` line:

```make
	@echo "  installer      - Build the self-extracting drift-install.sh (kwinscript + installer in one file)"
```

- [ ] **Step 4: Build and verify**

```bash
make installer
```

Expected: builds through `lint`/`test`/`compile`/etc. (via `build`), zips the archive, then prints `verify-installer-payload.sh: payload matches .build/drift_<version>.kwinscript byte-for-byte`. Confirm `.build/drift-install.sh` exists and is executable (`ls -l .build/drift-install.sh` shows the `x` bit).

- [ ] **Step 5: Manual smoke check (documented for the live-KWin verification pass)**

1. On a machine with Drift not currently installed, run `.build/drift-install.sh`.
2. Answer "yes" to all three prompts; confirm the colored `==>`/`✓` output appears for each step in order, and that KWin scripts list now includes Drift, enabled.
3. Confirm the shortcut and settings backups exist as in Tasks 2/4/5's smoke checks.
4. Re-run `.build/drift-install.sh`, this time answering "no" to the second and third prompts; confirm both print the skipped message and step 1 still upgrades cleanly.
5. Run `~/.local/share/kwin/scripts/drift/contents/bin/uninstall.sh` and confirm full restoration, as in Task 5's smoke check.

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

- [ ] `docs/coding-conventions.md` read
- [ ] `installer/drift-install.sh.tmpl` follows `drift/bin/` style (tabs, `set -u` with explicit error checks as documented in the design)
- [ ] `scripts/verify-installer-payload.sh` follows `scripts/` style (4-space indent, `set -euo pipefail`)
- [ ] `shellcheck installer/drift-install.sh.tmpl scripts/verify-installer-payload.sh` run and any real findings fixed
- [ ] Step 4's build output and Step 5's manual smoke check performed and recorded PASS/FAIL
- [ ] `make help` output reviewed to confirm the new `installer` line reads correctly

---

## Final verification

After all six tasks:

```bash
make build
make installer
```

Both must succeed with no errors, ending in the payload-match confirmation from Task 6. Then run the full manual smoke-check sequence end to end once more (install → both settings applied with backups → uninstall → both settings restored, package removed) as the final acceptance check before considering this plan complete.
