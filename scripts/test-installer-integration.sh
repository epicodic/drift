#!/usr/bin/env bash
# Integration test for the actual self-contained installer (installer/drift-install.sh.tmpl,
# built as .build/drift-install.sh), run against the real kwriteconfig6/kreadconfig6/
# kpackagetool6/kglobalaccel tools — no mocking of KConfig or D-Bus behavior, only the
# one genuine live-KWin dependency (`qdbus6 ... reconfigure`) is stubbed. This drives
# drift-install.sh itself end to end (install, disable-incompatible-settings.sh,
# setup-shortcuts.sh, each run from the *installed* location it uses in real life),
# not the contents/bin scripts directly.
# See docs/agents/notes/2026-09-13-ci-testing-installer-scripts.md.
#
# MUST run under `dbus-run-session`, which gives this test its own private session
# bus so the kglobalacceld this script starts — and every shortcut it registers,
# releases, and restores — never touches a real desktop session:
#
#   make installer
#   dbus-run-session -- scripts/test-installer-integration.sh
#
# Requires kwriteconfig6, kreadconfig6, qdbus6 (stubbed for the reconfigure call),
# kpackagetool6, busctl, and kglobalacceld on PATH or in a well-known libexec dir.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER_SCRIPT="${REPO_ROOT}/.build/drift-install.sh"

if [[ ! -x "${INSTALLER_SCRIPT}" ]]; then
    echo "test-installer-integration.sh: ${INSTALLER_SCRIPT} not found — run 'make installer' first" >&2
    exit 1
fi

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
    echo "test-installer-integration.sh: no DBUS_SESSION_BUS_ADDRESS — run under 'dbus-run-session --'" >&2
    exit 1
fi

if busctl --user list 2>/dev/null | grep -q org.kde.kglobalaccel; then
    echo "test-installer-integration.sh: org.kde.kglobalaccel is already registered on this bus" >&2
    echo "This must run under 'dbus-run-session --' on a fresh private bus, never a real session." >&2
    exit 1
fi

# shellcheck source=../drift/bin/setup-shortcuts-lib.sh
. "${REPO_ROOT}/drift/bin/setup-shortcuts-lib.sh"

tests_run=0
tests_failed=0

assert_eq() {
    local description="$1"
    local expected="$2"
    local actual="$3"
    tests_run=$((tests_run + 1))
    if [[ "${expected}" != "${actual}" ]]; then
        tests_failed=$((tests_failed + 1))
        printf 'FAIL: %s\n  expected: %s\n  actual:   %s\n' "${description}" "${expected}" "${actual}" >&2
    fi
}

assert_contains() {
    local description="$1"
    local haystack="$2"
    local needle="$3"
    tests_run=$((tests_run + 1))
    if [[ "${haystack}" != *"${needle}"* ]]; then
        tests_failed=$((tests_failed + 1))
        printf 'FAIL: %s\n  expected to contain: %s\n  actual:               %s\n' \
            "${description}" "${needle}" "${haystack}" >&2
    fi
}

TMP_HOME="$(mktemp -d)"
STUB_BIN="$(mktemp -d)"
cleanup() {
    if [[ -n "${KGLOBALACCELD_PID:-}" ]]; then
        kill "${KGLOBALACCELD_PID}" 2>/dev/null || true
    fi
    rm -rf "${TMP_HOME}" "${STUB_BIN}"
}
trap cleanup EXIT

export HOME="${TMP_HOME}"
export XDG_CONFIG_HOME="${TMP_HOME}/.config"
export XDG_DATA_HOME="${TMP_HOME}/.local/share"
export XDG_STATE_HOME="${TMP_HOME}/.local/state"
export XDG_CACHE_HOME="${TMP_HOME}/.cache"
mkdir -p "${XDG_CONFIG_HOME}" "${XDG_DATA_HOME}" "${XDG_STATE_HOME}" "${XDG_CACHE_HOME}"

# kglobalacceld (and kpackagetool6) are Qt GUI applications with no real use for a
# display; "offscreen" lets them start with no X11/Wayland session at all. Confirmed
# against a real Ubuntu 26.04 build: without it, kglobalacceld aborts immediately
# (missing xcb-cursor0/no display); the neon-packaged build on some dev machines
# exits silently even earlier regardless of this variable — if that happens here,
# this script's own kglobalacceld startup check below will fail loudly rather than
# silently proceeding against a stale/real session.
export QT_QPA_PLATFORM=offscreen

cat > "${STUB_BIN}/qdbus6" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "${STUB_BIN}/qdbus6"
export PATH="${STUB_BIN}:${PATH}"

KGLOBALACCELD_BIN="$(command -v kglobalacceld || true)"
if [[ -z "${KGLOBALACCELD_BIN}" ]]; then
    KGLOBALACCELD_BIN="$(find /usr/lib /usr/libexec -maxdepth 6 -type f -name kglobalacceld 2>/dev/null | head -1)"
fi
if [[ -z "${KGLOBALACCELD_BIN}" ]]; then
    echo "test-installer-integration.sh: kglobalacceld binary not found" >&2
    exit 1
fi

"${KGLOBALACCELD_BIN}" &
KGLOBALACCELD_PID=$!

for _ in $(seq 1 50); do
    busctl --user list 2>/dev/null | grep -q org.kde.kglobalaccel && break
    sleep 0.2
done
if ! busctl --user list 2>/dev/null | grep -q org.kde.kglobalaccel; then
    echo "test-installer-integration.sh: kglobalacceld never registered org.kde.kglobalaccel" >&2
    exit 1
fi

# Matches drift-install.sh's own INSTALL_DIR computation exactly (it hardcodes
# "${HOME}/.local/share/...", not $XDG_DATA_HOME) — equal here since HOME is TMP_HOME
# and XDG_DATA_HOME is "${TMP_HOME}/.local/share".
INSTALL_DIR="${HOME}/.local/share/kwin/scripts/drift"
meta_i_code="$(keyseq_to_int "Meta+I")"

# Prints "actionUnique|actionFriendly|componentUnique|componentFriendly|activeKeys" for
# whoever currently holds the active grant on target_code, across every registered
# component — the same allComponents+allShortcutInfos+find_conflicting_actions
# sequence setup-shortcuts.sh itself uses, so this doesn't guess at kglobalaccel's
# object-path encoding for a given component name.
find_active_holder() {
    target_code="$1"
    component_paths="$(parse_component_paths "$(
        busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel allComponents
    )")"
    printf '%s\n' "$component_paths" | while IFS= read -r component_path; do
        [ -z "$component_path" ] && continue
        dump="$(busctl --user call org.kde.kglobalaccel "$component_path" org.kde.kglobalaccel.Component allShortcutInfos)"
        find_conflicting_actions "$dump" "$target_code" ""
    done
}

SETTINGS_BACKUP_FILE="${XDG_STATE_HOME}/drift/settings-backup/kwinrc-windows.env"
SHORTCUTS_BACKUP_FILE="${XDG_STATE_HOME}/drift/settings-backup/shortcuts.backup"

echo "== drift-install.sh =="
# No TTY attached (stdin from /dev/null), so every prompt_yes_no in the installer
# takes its non-interactive default: yes. That single run does the kwinscript
# install, then disable-incompatible-settings.sh, then setup-shortcuts.sh — each
# invoked from $INSTALL_DIR/contents/bin, exactly as a real user's run would.
"${INSTALLER_SCRIPT}" < /dev/null

assert_eq "the kwinscript is installed at the real install location" \
    "yes" "$([[ -x "${INSTALL_DIR}/contents/bin/uninstall.sh" ]] && echo yes || echo no)"
assert_eq "driftEnabled is set in kwinrc" \
    "true" "$(kreadconfig6 --file kwinrc --group Plugins --key driftEnabled --default false)"
assert_eq "WindowSnapZone is disabled" \
    "0" "$(kreadconfig6 --file kwinrc --group Windows --key WindowSnapZone --default 10)"
assert_eq "BorderSnapZone is disabled" \
    "0" "$(kreadconfig6 --file kwinrc --group Windows --key BorderSnapZone --default 10)"
assert_eq "ElectricBorderMaximize is disabled" \
    "false" "$(kreadconfig6 --file kwinrc --group Windows --key ElectricBorderMaximize --default true)"
assert_eq "ElectricBorderTiling is disabled" \
    "false" "$(kreadconfig6 --file kwinrc --group Windows --key ElectricBorderTiling --default true)"
assert_eq "kwinrc backup records the pre-install defaults" \
    "WindowSnapZone|10
BorderSnapZone|10
ElectricBorderMaximize|true
ElectricBorderTiling|true" \
    "$(cat "${SETTINGS_BACKUP_FILE}")"

# Meta+I collides with systemsettings.desktop's real, KDE-default "_launch" global
# shortcut — present in every fresh kglobalaccel registry, no fixture needed — which
# is the exact scenario setup-shortcuts.sh's own comments describe (see
# drift/bin/setup-shortcuts.sh's "Conflict detection is dynamic" note).
assert_contains "shortcuts.backup records the displaced systemsettings.desktop action" \
    "$(cat "${SHORTCUTS_BACKUP_FILE}")" \
    "_launch|systemsettings.desktop|"

# Not asserted here: that "kwin"/DriftAbsorbRight now actively holds Meta+I.
# kglobalaccel's setShortcut only ever updates an action under a component it
# already knows about (confirmed empirically: calling it for a component name
# kglobalaccel has never seen returns an empty key list and creates nothing visible
# in allComponents()) — "kwin" only exists as a component once a real KWin process
# has registered its own core shortcuts. Headless CI has no such process, so this
# step's busctl calls under component "kwin" are inert here; only a live KWin (or a
# real KGlobalAccel client registering "kwin"'s actions first) could verify this half.

echo "== uninstall.sh (from the installed location) =="
"${INSTALL_DIR}/contents/bin/uninstall.sh"

assert_eq "kwinrc backup file is removed after uninstall" \
    "no" "$([[ -f "${SETTINGS_BACKUP_FILE}" ]] && echo yes || echo no)"
assert_eq "shortcuts backup file is removed after uninstall" \
    "no" "$([[ -f "${SHORTCUTS_BACKUP_FILE}" ]] && echo yes || echo no)"
assert_eq "WindowSnapZone is restored" \
    "10" "$(kreadconfig6 --file kwinrc --group Windows --key WindowSnapZone --default 10)"
assert_eq "BorderSnapZone is restored" \
    "10" "$(kreadconfig6 --file kwinrc --group Windows --key BorderSnapZone --default 10)"
assert_eq "ElectricBorderMaximize is restored" \
    "true" "$(kreadconfig6 --file kwinrc --group Windows --key ElectricBorderMaximize --default true)"
assert_eq "ElectricBorderTiling is restored" \
    "true" "$(kreadconfig6 --file kwinrc --group Windows --key ElectricBorderTiling --default true)"

post_uninstall_holder="$(find_active_holder "${meta_i_code}")"
assert_contains "systemsettings.desktop's Meta+I grant is restored" \
    "${post_uninstall_holder}" \
    "_launch|"

if ! kpackagetool6 --type=KWin/Script --list 2>/dev/null | grep -q '^drift$'; then
    tests_run=$((tests_run + 1))
else
    tests_run=$((tests_run + 1))
    tests_failed=$((tests_failed + 1))
    echo "FAIL: drift kwinscript is still listed after uninstall" >&2
fi
assert_eq "the installed kwinscript directory is removed" \
    "no" "$([[ -d "${INSTALL_DIR}" ]] && echo yes || echo no)"

echo
echo "${tests_run} assertions, ${tests_failed} failed"
[[ "${tests_failed}" -eq 0 ]]
