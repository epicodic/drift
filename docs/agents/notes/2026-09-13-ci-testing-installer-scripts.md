# CI testing for the installer's settings/shortcuts scripts

Date: 2026-09-13

## Context

The `feature/self-contained-installer` branch (uncommitted, all 6 plan tasks done and reviewed) adds:
- `drift/bin/settings-backup-lib.sh` — idempotent backup primitive
- `drift/bin/disable-incompatible-settings.sh` — disables 4 `kwinrc` settings, backs them up first
- `drift/bin/setup-shortcuts.sh` (modified) — backs up displaced kglobalaccel shortcuts before releasing them
- `drift/bin/uninstall.sh` — restores both backups, removes the package
- `installer/drift-install.sh.tmpl` + `scripts/verify-installer-payload.sh` + `make installer`

See `docs/agents/specs/2026-09-13-self-contained-installer-design.md` and `docs/agents/plans/2026-09-13-self-contained-installer.md` for the full design/plan.

Everything so far only has automated unit tests for pure logic (`settings-backup-lib.test.sh`, `setup-shortcuts-lib.test.sh`) plus manual smoke-test checklists for the live D-Bus/kwinrc paths — those manual checks were never actually run against a live KWin session.

## The ask

Get real coverage of "setting setup" (`disable-incompatible-settings.sh`) and "restoration on uninstall" (`uninstall.sh`) running in a GitHub Actions workflow, without needing a full graphical Plasma session.

## Existing CI setup

`.github/workflows/build.yml` runs `./.github/actions/build` on plain `ubuntu-latest`, no display/session bus.
`.github/workflows/release.yml` runs `./.github/actions/build-package` the same way.
`make installer` itself needs no live KWin — only `node`, `qmllint`, `zip` — so it already fits this existing job shape.

## Key finding: no full graphical session is needed

Two of the three external tools these scripts call have no real dependency on KWin or a display at all:

- **`kwriteconfig6` / `kreadconfig6`** (used by `disable-incompatible-settings.sh`) are pure KConfig file I/O.
  No D-Bus, no session, no display required — testable in any container.
- **`kglobalacceld`** (the daemon behind every `busctl org.kde.kglobalaccel ...` call in `setup-shortcuts.sh`/`uninstall.sh`) is a standalone daemon.
  It autostarts independently of KWin, and multiple sources confirm it can be started directly from a shell.
  It only needs a session bus, so `dbus-run-session -- kglobalacceld &` should register the real `org.kde.kglobalaccel` service.
  This means the shortcut backup/restore round trip in `setup-shortcuts.sh`/`uninstall.sh` can be tested for real, with no KWin or display involved.

## The one real KWin dependency

`disable-incompatible-settings.sh`'s closing line, `qdbus6 org.kde.KWin /KWin reconfigure`, genuinely needs a live KWin instance registered as `org.kde.KWin` on the bus.
Two options, in increasing order of realism and complexity:

1. **Stub `qdbus6` for that one call.**
   Put a fake `qdbus6` shell script earlier on `PATH` that just exits 0.
   Simple and stable. Doesn't exercise the real reconfigure, but the thing actually worth testing here — the `kwinrc` values and the backup file — doesn't depend on that call succeeding.
2. **Run a real headless `kwin_wayland --virtual` inside the same `dbus-run-session`.**
   KWin's own `HACKING.md` recommends `dbus-run-session ./kwin_wayland` for testing.
   The `kwin-mcp` project runs `kwin_wayland --virtual` inside `dbus-run-session` for headless CI GUI testing — no Xvfb, no physical display, since the virtual backend is display-less by design.
   Closer to real production behavior, but more moving parts (extra apt packages, Wayland socket handling) and more fragile across runner-image updates.

## Recommendation

Start with option 1 (stubbed `qdbus6`) for `disable-incompatible-settings.sh`, combined with a real `kglobalacceld` under `dbus-run-session` for `setup-shortcuts.sh`/`uninstall.sh`.
This covers exactly what was asked for — settings setup and uninstall restoration — without the extra fragility of a virtual KWin instance.
Treat option 2 (real `kwin_wayland --virtual`) as a later upgrade only if the `reconfigure` call itself ever needs coverage.

## Suggested shape of the new CI job

- New job (or step) in `.github/workflows/build.yml`, `ubuntu-latest`, separate from the existing plain build job.
- `apt-get install` the KDE Frameworks packages providing `kconfig` (for `kwriteconfig6`/`kreadconfig6`) and `kglobalaccel6`/`kglobalacceld`.
- Wrap the test steps in `dbus-run-session -- sh -c '...'`, starting `kglobalacceld &` inside that session before running the scripts.
- Stub `qdbus6` on `PATH` (a two-line script that just exits 0) before running `disable-incompatible-settings.sh`.
- Run `disable-incompatible-settings.sh`, assert the four `kwinrc [Windows]` keys and the `kwinrc-windows.env` backup file have the expected values.
- Run `setup-shortcuts.sh` (needs `shortcut-bindings.generated.sh`, so run `make build` first), assert `shortcuts.backup` gets populated for any real conflicting action.
- Run `uninstall.sh`, assert both backup files are gone and the `kwinrc` keys / kglobalaccel shortcuts are back to their pre-install values.
- `kpackagetool6 --remove` inside `uninstall.sh` will fail if the kwinscript was never actually installed via `kpackagetool6` in this job — either actually `kpackagetool6 --install` a built package first, or stub `kpackagetool6` too if only the settings/shortcut restoration matters for this job.

## Open questions for the next session

- Exact Ubuntu package names for `kglobalacceld`/`kconfig`-cli-tools on `ubuntu-latest`'s current image — verify with `apt-cache search` before writing the workflow.
- Whether `kpackagetool6` needs to be stubbed too, or whether actually installing/removing the package in CI is preferable for a more realistic uninstall test.
- Whether to add this as a new job in `build.yml` or a separate workflow file, given it needs extra `apt-get install` steps the plain build job doesn't.

## Sources

- [KWin HACKING.md — `dbus-run-session ./kwin_wayland`](https://github.com/Yoyo-OS/kwin/blob/master/HACKING.md)
- [kwin-mcp — headless `kwin_wayland --virtual` inside `dbus-run-session` for CI](https://github.com/isac322/kwin-mcp)
- [Arch Linux forums — `kglobalacceld` startable standalone from a shell](https://bbs.archlinux.org/viewtopic.php?id=293520)
- [KGlobalAccel API docs](https://api.kde.org/kglobalaccel-index.html)

## Update (2026-09-14): implemented, with two corrections to the above

`scripts/test-installer-integration.sh` and the `installer-integration` job in the new
`.github/workflows/installer-integration.yml` (`push` to `main` only, not every PR —
it builds and installs a real `.build/drift-install.sh` inside a throwaway container,
heavier than the plain `build.yml` job) now implement this.
The test drives the actual `.build/drift-install.sh` end to end, not the
`contents/bin` scripts directly — running those directly would skip the installer's
own prompt flow and its `${HOME}/.local/share/...` install-location logic entirely.
Two assumptions above turned out to be wrong once actually tested.
Both were found by installing the real packages and running the real binaries, first
on a local KDE neon machine, then in a real `ubuntu:26.04` Docker container.

### `ubuntu-latest` cannot install these tools at all

`kglobalacceld` and `libkf6config-bin` (provides `kwriteconfig6`/`kreadconfig6`) do not
exist in Ubuntu noble (24.04, today's `ubuntu-latest`).
Checked directly against `packages.ubuntu.com` and the Kubuntu Backports PPA's
Launchpad API — zero published binaries for noble.
They only appear starting in questing (25.10) and resolute (26.04).
The `installer-integration` job runs the KDE-tool-dependent steps inside a
`docker run ubuntu:26.04` container instead, with the rest of the job (checkout,
`make installer`) staying on the plain `ubuntu-latest` host.

### `kglobalacceld` needs `QT_QPA_PLATFORM=offscreen`, not just a session bus

The "confirmed... startable standalone from a shell" claim above came from a general
forum post, not this actual binary.
`kglobalacceld` links against `libQt6Widgets`/`libQt6Gui` and constructs a real
`QApplication`.
With no display and no `QT_QPA_PLATFORM` override, it aborts immediately with Qt's
standard "no Qt platform plugin could be initialized" error.
Setting `QT_QPA_PLATFORM=offscreen` (and installing the `qt6-qpa-plugins` package for
the offscreen plugin itself) lets it start and register `org.kde.kglobalaccel` with no
display or X server at all.
A `kglobalacceld` build on one local KDE neon machine exited silently even with this
set — that build behaves differently from the real Ubuntu package for reasons never
fully identified — so this is confirmed against the actual CI-relevant binary, not
that one.

### New known gap: verifying Drift's own shortcuts land under `kwin` isn't possible headless

`setShortcut` on kglobalaccel's D-Bus interface only ever updates an action under a
component it already knows about.
Confirmed empirically: calling it for a component name kglobalaccel has never seen
returns an empty key list and creates nothing visible in `allComponents()`.
The `kwin` component only exists once a real KWin process has registered its own core
shortcuts — headless CI has no such process.
So `setup-shortcuts.sh`'s busctl calls under component `kwin` are inert in this
environment; the test cannot observe whether Drift's own bindings would actually take
effect.
What the test does verify for real: `setup-shortcuts.sh` detecting, releasing, and
backing up a shortcut that collides with one of Drift's bindings, and `uninstall.sh`
restoring it afterward — using `systemsettings.desktop`'s real, always-present default
shortcut on Meta+I as the collision, no fixture needed.
Closing this gap would need a real `kwin_wayland --virtual` (this note's option 2
above) or a full KGlobalAccel-client stand-in that performs the same registration a
real KWin process does — treat as a future upgrade, not attempted here.
