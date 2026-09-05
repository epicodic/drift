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
		Up) echo 16777235 ;;
		Right) echo 16777236 ;;
		Down) echo 16777237 ;;
		Page_Up) echo 16777238 ;;
		Page_Down) echo 16777239 ;;
		Home) echo 16777232 ;;
		End) echo 16777233 ;;
		Plus) echo 43 ;;
		Minus) echo 45 ;;
		[A-Z])
			# Qt::Key_A..Key_Z (qnamespace.h) equal the ASCII codes of the
			# uppercase letters themselves, so no per-letter case is needed.
			printf '%d\n' "'$1"
			;;
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

# Tokenizes one `busctl call ...` reply line (any signature, e.g. allShortcutInfos'
# a(ssssssaiai) or allComponents' ao) into one token per output line: a quoted segment
# becomes its unquoted content (which may itself contain spaces), everything else
# splits on runs of spaces. This mirrors POSIX shell word-splitting closely enough
# that `set -- $(tokenize... )` under IFS=newline turns the reply into positional
# parameters without needing `eval` on D-Bus-sourced text.
#
# busctl backslash-escapes any quote embedded in a string value (confirmed live, e.g.
# ActivityManager's action friendly text `Switch to activity \"Browsing\"`) — such an
# escaped quote must not be treated as ending the token, or every field after it
# desyncs from its expected fixed-width position.
#
# A quoted segment that is genuinely empty (e.g. some actions have an empty
# actionFriendly, confirmed live for KDE_Keyboard_Layout_Switcher's actions) is
# emitted as EMPTY_FIELD_SENTINEL rather than a blank line: `set -- $(...)` under
# IFS=newline treats newline as an IFS whitespace character, so consecutive
# delimiters collapse and a truly-blank line vanishes instead of becoming an empty
# positional parameter — silently desyncing every fixed-width field read after it.
# Callers must restore the sentinel back to "" after capturing each field (see
# find_conflicting_actions).
EMPTY_FIELD_SENTINEL='@@DRIFT_EMPTY_FIELD@@'

tokenize_busctl_reply() {
	awk -v empty_sentinel="$EMPTY_FIELD_SENTINEL" '
	{
		n = length($0)
		token = ""
		inq = 0
		for (i = 1; i <= n; i++) {
			c = substr($0, i, 1)
			if (inq) {
				if (c == "\\" && substr($0, i + 1, 1) == "\"") {
					token = token "\""
					i++
					continue
				}
				if (c == "\"") {
					print (token == "" ? empty_sentinel : token)
					token = ""
					inq = 0
				}
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
# "actionUnique|actionFriendly|componentUnique|componentFriendly" for each action,
# other than one listed in exclude_actions (newline-separated, exact match), currently
# holding an *active* grant on target_code. A key appearing only in an action's
# defaultKeys (already released, or never granted) is not a conflict. componentUnique
# and componentFriendly are included because the conflict may not belong to the
# component whose reply this is (see find_conflicting_actions callers, which run this
# once per component) — the caller needs them to release the shortcut from its actual
# owning component rather than assuming kwin.
find_conflicting_actions() {
	raw_output="$1"
	target_code="$2"
	exclude_actions="$3"
	nl='
'

	old_ifs="$IFS"
	IFS="$nl"
	# shellcheck disable=SC2046 # tokenize_busctl_reply emits one token per line
	set -- $(printf '%s\n' "$raw_output" | tokenize_busctl_reply)
	IFS="$old_ifs"

	shift 1 # signature token, e.g. "a(ssssssaiai)"
	struct_count="$1"
	shift 1

	count=0
	while [ "$count" -lt "$struct_count" ]; do
		action_unique="$1"
		action_friendly="$2"
		component_unique="$3"
		component_friendly="$4"
		shift 6 # the 6 string fields
		[ "$action_unique" = "$EMPTY_FIELD_SENTINEL" ] && action_unique=""
		[ "$action_friendly" = "$EMPTY_FIELD_SENTINEL" ] && action_friendly=""
		[ "$component_unique" = "$EMPTY_FIELD_SENTINEL" ] && component_unique=""
		[ "$component_friendly" = "$EMPTY_FIELD_SENTINEL" ] && component_friendly=""

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
				*) printf '%s|%s|%s|%s\n' "$action_unique" "$action_friendly" "$component_unique" "$component_friendly" ;;
			esac
		fi

		count=$((count + 1))
	done
}

# Parses a raw allComponents reply (ao: an array of "/component/<id>" object paths)
# and prints one object path per line. Used to discover every kglobalaccel component
# up front, since a conflicting shortcut is not necessarily owned by the "kwin"
# component (e.g. a global "launch application" shortcut owned by a desktop file's own
# component) — see setup-shortcuts.sh, which queries allShortcutInfos on each path
# this returns rather than assuming kwin is the only component worth checking.
parse_component_paths() {
	raw_output="$1"
	nl='
'

	old_ifs="$IFS"
	IFS="$nl"
	# shellcheck disable=SC2046 # tokenize_busctl_reply emits one token per line
	set -- $(printf '%s\n' "$raw_output" | tokenize_busctl_reply)
	IFS="$old_ifs"

	shift 2 # signature token "ao", then the element count
	for path in "$@"; do
		printf '%s\n' "$path"
	done
}
