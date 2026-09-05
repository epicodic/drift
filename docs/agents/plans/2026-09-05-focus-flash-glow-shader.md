# Focus-Flash Glow Shader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `MultiEffect`/`OpacityMask` layered stroke in `src/kwin/focus-flash-overlay.ts`'s `FOCUS_FLASH_QML` with a single custom SDF fragment shader, per [`docs/agents/specs/2026-09-05-focus-flash-glow-shader-design.md`](../specs/2026-09-05-focus-flash-glow-shader-design.md).

**Architecture:** A GLSL fragment shader (`drift/contents/shaders/focus_glow.frag`) computes the signed distance to the rectangle *outline* and turns it into a symmetric, constant-hue glow via `smoothstep` — no blur, no premultiplied-alpha color drift. A new build step compiles it to a `.qsb` with Qt's `qsb` tool (never committed, always regenerated). The QML `mainItem` becomes a single `ShaderEffect` bound to the compiled `.qsb` via a relative `Qt.resolvedUrl`. No other files change: settings, `WindowAdapter.isTileable()`, and the `Controller`/`workspace-signals` wiring from the original focus-flash-highlight plan are already implemented and untouched by this plan.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; optional Python with uv, pytest, Ruff, and ty.

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing

---

## Task 1: SDF glow fragment shader source

**Files:**
- Create: `drift/contents/shaders/focus_glow.frag`

This file isn't TypeScript/JavaScript/QML, so there's no `npm test` coverage for it (same as `drift/contents/config/main.xml`/`drift/contents/ui/config.ui`, which are validated with `xmllint` instead of unit tests). It's validated here by compiling it directly with `qsb`, ahead of Task 2's permanent build wiring.

- [ ] **Step 1: Write the shader source**

Create `drift/contents/shaders/focus_glow.frag`:

```glsl
#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 glowColor;   // premultiply happens below; pass straight RGBA from QML
    vec2 itemSize;    // effect item size in px
    float margin;     // px from item edge to the window-edge line (== blurRadius)
    float coreHalf;   // half width of the fully-opaque border core in px
    float glow;       // falloff distance in px on each side
    float radius;     // corner radius in px (always 0 for now, see design doc "Scope")
};
float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * itemSize;      // centered pixel coords
    vec2 halfBox = itemSize * 0.5 - margin;        // window-edge box half extents
    float d = abs(sdRoundRect(p, halfBox, radius));
    float a = 1.0 - smoothstep(coreHalf, coreHalf + glow, d);
    fragColor = vec4(glowColor.rgb, 1.0) * (a * glowColor.a * qt_Opacity); // premultiplied
}
```

- [ ] **Step 2: Verify it compiles standalone**

`qsb` isn't wired into the build yet (that's Task 2) — compile it directly to a throwaway path to catch GLSL syntax errors immediately:

```sh
qsb --glsl "150,120,100es" --hlsl 50 --msl 12 -b -o /tmp/focus_glow.frag.qsb drift/contents/shaders/focus_glow.frag
```

Expected: no errors, exit code 0. Delete `/tmp/focus_glow.frag.qsb` afterward — it's a scratch file, not the real build output.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read: `docs/coding-conventions.md` (GLSL isn't one of its covered languages; the project-wide 4-space-indent/120-char-line default still applies)
- [ ] Uniform names in the shader (`glowColor`, `itemSize`, `margin`, `coreHalf`, `glow`, `radius`) match the QML property names Task 3 will bind — check back after Task 3
- [ ] Step 2's `qsb` command exits 0
- [ ] Any convention violations fixed before moving to next task

---

## Task 2: `qsb` build wiring

**Files:**
- Create: `scripts/compile-shaders.sh`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `Makefile`

Qt 6 `ShaderEffect.fragmentShader` requires a precompiled `.qsb`, not inline GLSL. This task wires `qsb` into `npm run build` so the `.qsb` is always freshly generated — it's a build artifact, never committed.

- [ ] **Step 1: Write the compile script**

Create `scripts/compile-shaders.sh` (executable, following `bootstrap.sh`'s style):

```sh
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
```

Make it executable:

```sh
chmod +x scripts/compile-shaders.sh
```

- [ ] **Step 2: Wire it into `npm run build`**

In `package.json`, change the `build` script and add a new `build:shaders` script, right after the `"build"` line:

```json
        "build": "rollup -c && npm run build:shaders",
        "build:shaders": "scripts/compile-shaders.sh",
```

(Only these two lines change/are added — every other script in `package.json` stays exactly as-is.)

- [ ] **Step 3: Ignore the compiled `.qsb`**

In `.gitignore`, add a line after the existing `drift/contents/code/main.js` entry:

```gitignore
.serena/
_playground/
node_modules/
drift/contents/code/main.js
drift/contents/shaders/*.qsb
```

(Only the last line is new.)

- [ ] **Step 4: Clean the compiled `.qsb` too**

In `Makefile`, extend the `clean` target:

```makefile
clean:
	rm -f ./drift/contents/code/main.js
	rm -f ./drift/contents/shaders/*.qsb
	rm -f ./drift_*.tar.gz
```

(Only the new `rm -f ./drift/contents/shaders/*.qsb` line is added, between the two existing `rm -f` lines.)

- [ ] **Step 5: Run the build and verify the `.qsb` is produced**

```sh
npm run build
ls drift/contents/shaders/focus_glow.frag.qsb
```

Expected: `npm run build` exits 0, and `ls` shows the freshly-generated `.qsb` file. Then confirm it's actually ignored:

```sh
git status --porcelain drift/contents/shaders/
```

Expected: no output (the `.qsb` doesn't show as untracked).

- [ ] **Step 6: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Language-specific guidelines are followed
- [ ] Step 5's commands executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 3: `ShaderEffect` QML integration

**Files:**
- Modify: `src/kwin/focus-flash-overlay.ts`

`focus-flash-overlay.ts` has no test file — it's untestable without a live compositor, same as `minimap-overlay.ts` (documented in the original focus-flash-highlight plan). This task is verified by `npm run typecheck`/`npm test`/`npm run lint` (structural only) here, and by the live manual check in Task 4.

- [ ] **Step 1: Replace `FOCUS_FLASH_QML`'s `mainItem`**

In `src/kwin/focus-flash-overlay.ts`, replace the whole `FOCUS_FLASH_QML` constant:

```ts
const FOCUS_FLASH_QML = `import QtQuick 6.0
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
PlasmaCore.Dialog {
    id: dialog
    property real borderWidth: 4
    property real blurRadius: 24
    title: "${FOCUS_FLASH_OVERLAY_WINDOW_TITLE}"
    type: PlasmaCore.Dialog.OnScreenDisplay
    backgroundHints: PlasmaCore.Types.NoBackground
    flags: Qt.BypassWindowManagerHint | Qt.FramelessWindowHint | Qt.Popup
    outputOnly: true
    visible: false
    mainItem: ShaderEffect {
        id: root
        width: dialog.width
        height: dialog.height
        implicitWidth: dialog.width
        implicitHeight: dialog.height
        // Solid highlight color; the shader turns it into a symmetric glow around the
        // window edge (see drift/contents/shaders/focus_glow.frag), so the hue can never
        // fringe toward black the way a blurred-then-masked stroke did.
        property color glowColor: Kirigami.Theme.highlightColor
        property vector2d itemSize: Qt.vector2d(width, height)
        property real margin: dialog.blurRadius
        property real coreHalf: dialog.borderWidth * 0.5
        property real glow: dialog.blurRadius
        property real radius: 0
        fragmentShader: Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")
    }
}`;
```

(This removes the `import QtQuick.Effects` / `import Qt5Compat.GraphicalEffects` lines and the whole `colorFill`/`strokeMask`/`OpacityMask`/crisp-border `Rectangle` tree — everything else in the file, from `export const FOCUS_FLASH_OVERLAY_WINDOW_TITLE` down through `createFocusFlashOverlay`, is unchanged.)

- [ ] **Step 2: Run typecheck, tests, and lint**

```sh
npm run typecheck && npm test -- --run && npm run lint
```

Expected: all three pass. These are structural checks only — they cannot see visual output.

- [ ] **Step 3: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Conventions file read for touched language(s): `docs/coding-conventions.md`
- [ ] QML property names (`glowColor`, `itemSize`, `margin`, `coreHalf`, `glow`, `radius`) match Task 1's shader uniforms exactly
- [ ] Naming conventions match project rules for all new/edited symbols
- [ ] Step 2's commands executed and passing
- [ ] Any convention violations fixed before moving to next task

---

## Task 4: Live verification in a KWin session

**Files:** none (manual verification only)

This task has no automated check — `npm run typecheck`/`npm test`/`npm run lint` cannot see rendered output, and the design doc flags shader path resolution as the highest-risk part of this change.

- [ ] **Step 1: Install and reload the addon**

```sh
make install
```

- [ ] **Step 2: Trigger a focus change on a managed window**

Click between two tiled windows (or use one of Drift's own focus shortcuts). Confirm:
- A highlight-colored glow appears around the focused window's border, fading in then out.
- The glow is symmetric — visible both just inside and just outside the window edge — with a fully transparent center.
- The hue stays constant throughout the fade; no black fringe at any point.

- [ ] **Step 3: If nothing renders, check for shader-load errors**

```sh
journalctl --user -b 0 | grep -i kwin | tail -50
```

Also check KWin's support information (`kwin_support_information` or the “Support Information” action in KWin's own settings) for shader-compile or file-not-found warnings.

- [ ] **Step 4: Record the outcome**

If Step 2 confirms a correct symmetric glow: the relative `Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")` path works as-is — no further action needed.

If Step 3 shows a file-not-found/shader-load error: the relative URL resolved wrong. Per the design doc's documented (not yet implemented) fallback, a follow-up task should add a `shaderUrl: string` parameter to `createFocusFlashOverlay(...)`, set as a `dialog` property, with the URL computed in `main.ts` from a known base path and threaded through the `Controller` wiring. Do not implement that fallback speculatively — only if this step actually observes the failure.

- [ ] **Step 5: Coding-guideline follow-up checklist (mandatory before task completion)**

Run this checklist and record PASS/FAIL with file evidence:
- [ ] Step 2's live check performed and outcome recorded (pass, or specific failure mode observed)
- [ ] Step 3 performed if Step 2 showed no glow
- [ ] Any follow-up task filed (not implemented) if the path-resolution fallback is needed
