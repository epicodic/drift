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
