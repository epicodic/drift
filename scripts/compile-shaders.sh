#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shader_dir="${script_dir}/drift/contents/shaders"

# Known Qt6 install locations are checked BEFORE bare `qsb` on PATH: on Debian/Ubuntu-family
# systems `qsb` on PATH is a qtchooser wrapper that can silently resolve to a missing Qt5
# binary (confirmed on a dev machine: `qsb` resolves to a nonexistent /usr/lib/qt5/bin/qsb
# and fails at exec time, even though `command -v qsb` reports it as found).
find_qsb() {
    for candidate in /usr/lib/qt6/bin/qsb /usr/lib/x86_64-linux-gnu/qt6/bin/qsb; do
        if [[ -x "${candidate}" ]]; then
            echo "${candidate}"
            return 0
        fi
    done
    if command -v qsb >/dev/null 2>&1; then
        command -v qsb
        return 0
    fi
    return 1
}

if ! qsb_bin="$(find_qsb)"; then
    echo "error: qsb (Qt Shader Baker) not found on PATH or in known Qt6 install locations" >&2
    exit 1
fi

"${qsb_bin}" --glsl "150,120,100es" --hlsl 50 --msl 12 -b -o \
    "${shader_dir}/focus_glow.frag.qsb" \
    "${shader_dir}/focus_glow.frag"
