# shellcheck shell=sh
# Pure helper functions for setup-shortcuts.sh: turning a "Meta+Shift+Left"-style
# sequence into the packed Qt key+modifier int kglobalaccel expects, and finding which
# currently-active KWin shortcuts collide with a target key so they can be released.
# No D-Bus calls happen here — this file is meant to be sourced both by
# setup-shortcuts.sh (which supplies the live `busctl` reply) and by
# setup-shortcuts-lib.test.sh (which supplies a canned one), so the parsing/matching
# logic can be regression-tested without a live KWin session.

# Qt::Key values (qnamespace.h) for the keys Drift's bindings use. Stable public API.
key_code() {
	case "$1" in
		Left) echo 16777234 ;;
		Right) echo 16777236 ;;
		Page_Up) echo 16777238 ;;
		Page_Down) echo 16777239 ;;
		D) echo 68 ;;
		*)
			echo "setup-shortcuts-lib.sh: unknown key \"$1\" — add it to key_code()" >&2
			exit 1
			;;
	esac
}

# Qt::KeyboardModifier bit values (qnamespace.h). Stable public API.
modifier_bit() {
	case "$1" in
		Shift) echo 33554432 ;;
		Ctrl) echo 67108864 ;;
		Alt) echo 134217728 ;;
		Meta) echo 268435456 ;;
		*)
			echo "setup-shortcuts-lib.sh: unknown modifier \"$1\" — add it to modifier_bit()" >&2
			exit 1
			;;
	esac
}

# Converts a "Meta+Shift+Left"-style sequence into the packed Qt key+modifier int
# kglobalaccel's setShortcut expects for a single-key-press shortcut.
keyseq_to_int() {
	total=0
	old_ifs="$IFS"
	IFS='+'
	# shellcheck disable=SC2086 # word-splitting on IFS='+' is the point here
	set -- $1
	IFS="$old_ifs"
	last_index=$#
	i=0
	for token in "$@"; do
		i=$((i + 1))
		if [ "$i" -eq "$last_index" ]; then
			total=$((total + $(key_code "$token")))
		else
			total=$((total + $(modifier_bit "$token")))
		fi
	done
	echo "$total"
}

# Tokenizes one `busctl call ... allShortcutInfos` reply line (a(ssssssaiai) signature)
# into one token per output line: a quoted segment becomes its unquoted content
# (which may itself contain spaces), everything else splits on runs of spaces. This
# mirrors POSIX shell word-splitting closely enough that `set -- $(tokenize... )` under
# IFS=newline turns the reply into positional parameters without needing `eval` on
# D-Bus-sourced text.
tokenize_shortcut_info() {
	awk '
	{
		n = length($0)
		token = ""
		inq = 0
		for (i = 1; i <= n; i++) {
			c = substr($0, i, 1)
			if (inq) {
				if (c == "\"") { print token; token = ""; inq = 0 }
				else token = token c
			} else if (c == "\"") {
				inq = 1
			} else if (c == " ") {
				if (token != "") { print token; token = "" }
			} else {
				token = token c
			}
		}
		if (token != "") print token
	}'
}

# Parses a raw allShortcutInfos reply (a(ssssssaiai): per action, 6 strings —
# actionUnique, actionFriendly, componentUnique, componentFriendly, contextUnique,
# contextFriendly — then activeKeys (ai) then defaultKeys (ai)) and prints
# "actionUnique|actionFriendly" for each action, other than one listed in
# exclude_actions (newline-separated, exact match), currently holding an *active*
# grant on target_code. A key appearing only in an action's defaultKeys (already
# released, or never granted) is not a conflict.
find_conflicting_actions() {
	raw_output="$1"
	target_code="$2"
	exclude_actions="$3"
	nl='
'

	old_ifs="$IFS"
	IFS="$nl"
	# shellcheck disable=SC2046 # tokenize_shortcut_info emits one token per line
	set -- $(printf '%s\n' "$raw_output" | tokenize_shortcut_info)
	IFS="$old_ifs"

	shift 1 # signature token, e.g. "a(ssssssaiai)"
	struct_count="$1"
	shift 1

	count=0
	while [ "$count" -lt "$struct_count" ]; do
		action_unique="$1"
		action_friendly="$2"
		shift 6 # the 6 string fields

		active_count="$1"
		shift 1
		matched=0
		i=0
		while [ "$i" -lt "$active_count" ]; do
			[ "$1" = "$target_code" ] && matched=1
			shift 1
			i=$((i + 1))
		done

		default_count="$1"
		shift 1
		i=0
		while [ "$i" -lt "$default_count" ]; do
			shift 1
			i=$((i + 1))
		done

		if [ "$matched" -eq 1 ]; then
			case "${nl}${exclude_actions}${nl}" in
				*"${nl}${action_unique}${nl}"*) : ;;
				*) printf '%s|%s\n' "$action_unique" "$action_friendly" ;;
			esac
		fi

		count=$((count + 1))
	done
}
