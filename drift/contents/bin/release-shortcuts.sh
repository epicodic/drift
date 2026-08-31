#!/bin/sh
# Frees the KWin core-action shortcuts that collide with Drift's own defaults, so a
# later logout/login lets Drift claim Meta+Ctrl+Left/Right, Meta+Left/Right, and
# Meta+Shift+Left/Right. Run manually (Drift's OSD notice points here) — this can't be
# triggered from inside the KWin script itself: KWin's QML `DBusCall` element can't
# marshal the QStringList argument `setShortcut` needs (see repo notes). Uses `busctl`
# rather than `qdbus6`: qdbus6's own argument-type inference can't guess the type of an
# empty array literal (needed here for the "clear the keys" `ai` argument), confirmed
# live — `busctl`'s explicit type signature sidesteps that entirely.

set -eu

if ! command -v busctl >/dev/null 2>&1; then
	echo "release-shortcuts.sh: busctl not found (part of systemd) — cannot continue" >&2
	exit 1
fi

release() {
	action_name="$1"
	action_text="$2"
	echo "Releasing \"${action_text}\"..."
	busctl --user call org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel setShortcut asaiu \
		4 kwin "${action_name}" KWin "${action_text}" 0 4 >/dev/null
}

release "Switch One Desktop to the Left" "Switch One Desktop to the Left"
release "Switch One Desktop to the Right" "Switch One Desktop to the Right"
release "Window Quick Tile Left" "Quick Tile Window to the Left"
release "Window Quick Tile Right" "Quick Tile Window to the Right"
release "Window to Previous Screen" "Move Window to Previous Screen"
release "Window to Next Screen" "Move Window to Next Screen"

echo "Done. Log out and back in for Drift to claim its shortcuts."
