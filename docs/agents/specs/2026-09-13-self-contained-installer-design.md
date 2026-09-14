# Self-contained installer — design

Date: 2026-09-13

## Problem

Installing Drift today is a multi-step manual process.
`bootstrap.sh` installs build dependencies, `make install` builds and installs the kwinscript via `kpackagetool6`, and the user must separately enable Drift in System Settings and copy-paste the path to `setup-shortcuts.sh` from the Shortcuts tab to get default keybindings working.
There is also no equivalent step yet for KWin settings that are known to conflict with Drift's own dragging/panning logic (`docs/known_bugs.md` #2: `kwinrc` `[Windows]` edge-snap and electric-border settings).
Nothing backs up any setting either script changes, so there is no way to cleanly undo them.

This design adds a single self-contained installer that installs the kwinscript, disables the known-incompatible KWin settings, and sets up shortcuts — each step backing up what it changes — plus an uninstaller that reverses all three.

## Decisions (confirmed with user)

- **Incompatible settings scope**: exactly the four `kwinrc` `[Windows]` keys from `known_bugs.md` #2 — `WindowSnapZone` and `BorderSnapZone` set to `0`, `ElectricBorderMaximize` and `ElectricBorderTiling` disabled.
- **Shortcut restoration**: on uninstall, any other kglobalaccel action that `setup-shortcuts.sh` displaced to make room for a Drift binding is restored to its exact prior sequence, not just cleared.
- **Distribution**: `make package` (new `installer` target) produces a single self-extracting `drift-install.sh` with the built `.kwinscript` zip appended as payload — one file to download and run. The plain `.kwinscript` artifact from `make package` is unchanged, for manual `kpackagetool6` installs / KDE Store submission.
- **Uninstall placement**: `uninstall.sh` ships inside the kwinscript package itself (`contents/bin/uninstall.sh`), not as a separate downloaded file, so it's still reachable at `~/.local/share/kwin/scripts/drift/contents/bin/uninstall.sh` even if the original installer file is lost. There is no `--uninstall` mode on `drift-install.sh`.
- **Backup location**: `~/.local/state/drift/settings-backup/` (respecting `$XDG_STATE_HOME` if set) — independent of the installed package directory, so it survives a `kpackagetool6 --upgrade` and is readable regardless of how `uninstall.sh` is invoked.
- **Interactivity**: `drift-install.sh` asks three yes/no questions, one at a time, each immediately followed by that step running (not all three questions upfront). `setup-shortcuts.sh` and the new settings script stay non-interactive, so they still work when run standalone later (matching the existing documented flow for re-running `setup-shortcuts.sh` from the Shortcuts tab).
- **Backups are write-once, not write-every-run**: running the installer a second time (upgrade, reinstall, or re-running a step standalone) must never overwrite an already-recorded backup value with whatever Drift itself set on the first run — that would silently replace the user's true original setting with Drift's own value, making restoration on uninstall a no-op. This is the reason `settings-backup-lib.sh`'s `backup_if_absent` exists as a shared primitive rather than each script backing up inline: both `disable-incompatible-settings.sh` (per `kwinrc` key) and `setup-shortcuts.sh` (per displaced kglobalaccel action) go through it, and it is a hard invariant, not an optimization — a key/action already present in the backup file is never rewritten, only ever restored and removed by `uninstall.sh`.

## Architecture

New files under `drift/bin/` (built into the package under `contents/bin/`, same as `setup-shortcuts.sh` today):

- `settings-backup-lib.sh` — shared shell functions for idempotent backup/restore, used by both settings-mutating scripts:
  - `backup_if_absent <backup_file> <key> <value>` — appends `key=value` only if `backup_file` doesn't already exist or doesn't already contain `key`, so a second install run never overwrites a real original value with Drift's already-applied one.
  - `restore_from_backup <backup_file>` — sources/replays the recorded values and removes the file.
- `disable-incompatible-settings.sh` — backs up (via the lib) then sets the four `kwinrc` `[Windows]` keys via `kwriteconfig6`, then `qdbus6 org.kde.KWin /KWin reconfigure`. Non-interactive; safe to run standalone or multiple times.
- `uninstall.sh` — restores both backups (shortcuts, then kwinrc settings) if present, then `kpackagetool6 --type=KWin/Script --remove=drift`. Safe to run even if a backup file is missing (skips that restore step with a notice).

At the repo root: a self-extracting installer template, assembled by a new `installer` Makefile target that depends on `package`:

- Template script (e.g. `installer/drift-install.sh.tmpl`) containing all the shell logic below, ending in an `exit` and a `__DRIFT_PAYLOAD__` marker line.
- `make installer` appends the built `.build/drift_<version>.kwinscript` bytes after the marker into `.build/drift-install_<version>.sh`, `chmod +x`.

`setup-shortcuts.sh`/`setup-shortcuts-lib.sh` gain backup support: before `find_conflicting_actions` frees a colliding action's shortcut, its current sequence is recorded via `backup_if_absent` into `shortcuts.tsv` before being overwritten.

## Components & data flow

**`drift-install.sh` (self-extracting):**

1. Locate its own payload (`grep -an -m1 -n '^__DRIFT_PAYLOAD__$' "$0"`, `tail -n +N` the remainder to a temp `.kwinscript` file). Always runs, no prompt.
2. Prompt `Install/upgrade the Drift kwinscript? [Y/n]` (default yes).
   - Yes → print `==> Installing Drift kwinscript...`, run `kpackagetool6 --install=<tmp> || kpackagetool6 --upgrade=<tmp>`, then enable it (`kwriteconfig6 --file kwinrc --group Plugins --key DriftEnabled true` + `qdbus6 ... reconfigure`, mirroring the Makefile's existing `enable` target) so it's active without a separate manual step in System Settings. Print `✓ Drift installed and enabled.` in green.
   - No → print a dim `⎯ Skipped.`
3. Prompt `Disable KWin settings known to conflict with Drift (edge snapping/tiling)? [Y/n]` (default yes).
   - Guard: if `~/.local/share/kwin/scripts/drift/contents/bin/disable-incompatible-settings.sh` doesn't exist (Drift was never installed and step 2 was skipped), print a yellow warning and skip instead of erroring.
   - Yes → print `==> Disabling incompatible KWin settings...`, run the installed script, print a green summary line.
4. Prompt `Set up Drift's default keyboard shortcuts? [Y/n]` (default yes).
   - Same existence guard as step 3, against `setup-shortcuts.sh`.
   - Yes → print `==> Setting up shortcuts...`, run the installed script (it already prints its own per-binding output in the same color scheme).

Each step that changes KWin state already triggers its own `qdbus6 org.kde.KWin /KWin reconfigure` (step 2's enable, and internally within `disable-incompatible-settings.sh` and `setup-shortcuts.sh`), so `drift-install.sh` itself doesn't need a separate final reconfigure call.

Color scheme matches `setup-shortcuts.sh`'s existing `CYAN`/`YELLOW`/`GREEN`/`RESET` constants, plus a bold step-header style for the four `==>` lines above.

**Backup files**, both under `~/.local/state/drift/settings-backup/`:

- `kwinrc-windows.env` — `KEY=value` lines, one per affected `kwinrc [Windows]` key, written only for keys not already present in the file.
- `shortcuts.tsv` — `action_name<TAB>component_path<TAB>prior_sequence` per kglobalaccel action displaced by Drift's shortcut setup, appended only for actions not already recorded.

**`uninstall.sh`:**

1. If `shortcuts.tsv` exists: for each recorded action, `busctl --user call ... setShortcut` restores its prior sequence; delete the file.
2. If `kwinrc-windows.env` exists: `kwriteconfig6` each key back to its recorded value, `qdbus6 ... reconfigure`; delete the file.
3. `kpackagetool6 --type=KWin/Script --remove=drift`.

## Error handling

- All new/modified scripts use `set -eu` (matching existing style): a failure partway through stops before further state changes, and anything already backed up stays intact for a later `uninstall.sh` run.
- `drift-install.sh` treats a failure in steps 3/4 as non-fatal to the overall run: it reports which step failed and that Drift is still installed and usable with default KWin settings/shortcuts, rather than rolling back step 2.
- `uninstall.sh` never errors out over a missing backup file — it skips that restore step with a notice, since a partial prior install may not have created it.

## Testing

- `settings-backup-lib.sh`'s `backup_if_absent`/`restore_from_backup` get unit tests in the existing `*.test.sh` style (see `setup-shortcuts-lib.test.sh`), covering: first-write, repeat-write-is-a-no-op, and restore-then-file-removed.
- `make test` gains a check that `sh -n` parses `drift-install.sh.tmpl` and, for a built `.build/drift-install.sh`, that extracting the payload after the marker reproduces the `.kwinscript` zip byte-for-byte.
- Actual `kpackagetool6`/`busctl`/live-KWin behavior (install, disable-settings, shortcut setup, and full uninstall/restore) stays a manual smoke check, consistent with `setup-shortcuts.sh`'s existing manual-check convention (`docs/agents/plans/2026-09-06-settings-consolidation.md`). This manual check explicitly includes running the installer **twice** in a row before ever uninstalling, and confirming `kwinrc-windows.env`/`shortcuts.tsv` are byte-identical after the second run — the case a unit test on the lib alone can't fully cover, since it's the two calling scripts' real values that must not overwrite a real backup.
