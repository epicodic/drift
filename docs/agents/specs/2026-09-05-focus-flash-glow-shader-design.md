# Focus-flash glow via a custom SDF shader — design

## Purpose

Replace the rendering internals of the focus-flash overlay ([`src/kwin/focus-flash-overlay.ts`](../../../src/kwin/focus-flash-overlay.ts)) with a custom fragment shader.
This spec is a standalone follow-up to [2026-09-05-focus-flash-highlight-design.md](2026-09-05-focus-flash-highlight-design.md) and supersedes **only** that spec's QML rendering approach (the `MultiEffect` + `OpacityMask` layered stroke).
Everything else from the original spec is unchanged: the four `focusFlash*` settings, the `FocusFlashOverlay` TypeScript interface (`show(win)`), the tick-driven reposition/opacity loop, `WindowAdapter.isTileable()`'s title guard, and the controller/workspace-signals wiring.

## Why a shader

Every effect-based attempt at a symmetric, constant-hue glow has failed in a live KWin session:

- Blurring a colored stroke (`MultiEffect`) drags the hue to black, because `MultiEffect` stores its source premultiplied, so low-alpha pixels collapse to `(0,0,0,0)`.
- `RectangularShadow` and `RectangularGlow` always fill their whole rectangle (confirmed by the default fragment shader in the Qt docs: inside the rounded box the signed distance is negative, so `a = 1`).
- Clipping the fill with `OpacityMask` works for an outward-only ring, but chaining `layer.effect` textures between `QtQuick.Effects` and `Qt5Compat.GraphicalEffects` produces an empty texture, and a thin stroke blurred over 24 px has near-zero peak alpha.

A signed-distance-field (SDF) shader avoids all of this: a single pass over one quad, a handful of math ops per fragment, no overdraw, no per-item binding churn, no banding.

## Scope

- **In scope:** the shader itself, the QML `ShaderEffect` that replaces the current layered `mainItem`, and the build step that compiles the shader.
- **Out of scope:** rounded corners (the `radius` uniform exists but is always `0`, matching current sharp-corner-only behavior); any change to the TS-level API, settings, or controller wiring; an automatic in-code runtime fallback if the shader fails to load (see [Rollback](#rollback)).

## The SDF shader

`drift/contents/shaders/focus_glow.frag` computes the distance to the rectangle **outline**, not the filled box.
`abs(sdRoundRect(...))` is `0` on the border line and grows in both directions.
Alpha is a smooth falloff of that distance, so the glow is symmetric and the deep interior is fully transparent.
The shader always emits `glowColor.rgb` directly, premultiplied by the computed alpha — it never blurs pixel colors, so hue can never fringe toward black.

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
    float radius;     // corner radius in px (always 0 for now, see Scope)
    float sharpness;  // pow() exponent applied to alpha; >1 concentrates the glow near the core
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
    a = pow(a, sharpness);
    fragColor = vec4(glowColor.rgb, 1.0) * (a * glowColor.a * qt_Opacity); // premultiplied
}
```

Uniform values, set from QML:

- `glowColor` — `Kirigami.Theme.highlightColor` (unchanged: not user-configurable).
- `margin` — `dialog.blurRadius` (places the SDF box exactly on the window edge, since the dialog is already padded outward by `blurRadius` on every side).
- `coreHalf` — `dialog.borderWidth * 0.5`.
- `glow` — `dialog.blurRadius`.
- `radius` — `0`.
- `sharpness` — `2.0` (hardcoded, not user-configurable; matches the perceptual falloff of the original `RectangularGlow`'s `spreadMultiplier * spreadMultiplier`, see [comparison note below](#tuning-knobs)).

## QML integration

Replace the whole `mainItem` content of `FOCUS_FLASH_QML` with a single `ShaderEffect`:

```qml
mainItem: ShaderEffect {
    id: glow
    width: dialog.width
    height: dialog.height
    implicitWidth: dialog.width
    implicitHeight: dialog.height
    property color glowColor: Kirigami.Theme.highlightColor
    property vector2d itemSize: Qt.vector2d(width, height)
    property real margin: dialog.blurRadius
    property real coreHalf: dialog.borderWidth * 0.5
    property real glow: dialog.blurRadius
    property real radius: 0
    property real sharpness: 2.0
    fragmentShader: Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")
}
```

This drops the `colorFill`/`strokeMask`/`OpacityMask`/crisp-border `Rectangle` layers and the `import QtQuick.Effects` / `import Qt5Compat.GraphicalEffects` lines entirely — the shader is the whole visual.
`dialog`'s outer sizing (frame geometry padded outward by `blurRadius` on every side) is unchanged, so `margin = blurRadius` continues to place the outline exactly on the window edge.

## Build wiring

Qt 6 `ShaderEffect.fragmentShader` requires a precompiled `.qsb`, not inline GLSL.

- New npm script `build:shaders`, wired into the existing build: `"build": "rollup -c && npm run build:shaders"`.
- It resolves the `qsb` binary by checking `PATH` first, then falling back to known Qt6 install locations (e.g. `/usr/lib/qt6/bin/qsb`), and **fails the build loudly** if none is found — no silent skip.
- Compile command:

  ```sh
  qsb --glsl "150,120,100es" --hlsl 50 --msl 12 -b -o \
      drift/contents/shaders/focus_glow.frag.qsb \
      drift/contents/shaders/focus_glow.frag
  ```

- `qsb` ships with Qt 6. KWin renders through the RHI, so the GLSL profiles above cover the OpenGL and Vulkan backends.
- The `.frag` source is committed to git. The compiled `.frag.qsb` is **never committed** — it's a build artifact only, regenerated by every `npm run build` / `make build` / `make package`, the same way `drift/contents/code/main.js` is. `drift/contents/shaders/*.qsb` is added to `.gitignore`, and `make clean` additionally removes the compiled `.qsb`.

## Path resolution (verify this first — highest risk)

The QML is built from a string via `Qt.createQmlObject(FOCUS_FLASH_QML, parent)`, so `Qt.resolvedUrl` resolves against the creating context's base URL.
The compiled script runs from `drift/contents/code/main.js`, so the first thing to verify live is:

```qml
fragmentShader: Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")
```

Install, trigger a focus change, and confirm the shader actually loads before tuning anything else — check for a blank/invisible overlay or a shader-load warning in KWin's support information / `journalctl`.
If the relative URL resolves wrong, the fix is a follow-up task, not designed up front here: add a `shaderUrl: string` parameter to `createFocusFlashOverlay(...)`, set it as a `dialog` property, and compute the URL in `main.ts` from a known base (e.g. the plugin install location) threaded through the controller wiring.

## Tuning knobs

- `coreHalf` — half the solid border thickness before the falloff starts.
- `glow` — how far the glow reaches on each side (bounded by `margin`, so raise `blurRadius`/the overlay margin if it clips).
- `radius` — reserved for rounded corners; always `0` per [Scope](#scope).
- `sharpness` — `pow()` exponent applied to alpha after the `smoothstep`; `1.0` is a linear falloff, `2.0` (the default) concentrates the glow near the core, matching how `Qt5Compat.GraphicalEffects`' `RectangularGlow` squares its `spreadMultiplier`.

## Testing

- `flashOpacity` and the TS-level tick/reposition logic in `focus-flash-overlay.ts` are already covered by the original spec's test plan and are untouched by this change.
- The shader and QML are inherently untestable outside a live compositor, same as the rest of `focus-flash-overlay.ts` and `minimap-overlay.ts` — no unit tests planned for the shader itself.
- `npm run typecheck && npm test -- --run && npm run lint` stay structural only; they additionally confirm the new `build:shaders` step succeeds (or fails loudly if `qsb` is missing), but cannot see visual output.
- Real verification is a live KWin session: install, trigger a focus change, and confirm a symmetric highlight-colored glow with a transparent center and no black fringe. Check the KWin log for shader-compile or file-not-found errors if nothing renders.

## Rollback

The current `OpacityMask` + blurred-stroke version (this branch's earlier commits) is the starting point and is kept in git history.
If the `.qsb` path cannot be resolved inside KWin, or the shader approach otherwise doesn't pan out, the rollback is a plain git revert of this spec's commits — no automatic in-code runtime fallback is built.

## Explicitly out of scope

- Rounded corners (`radius` uniform always `0`).
- Any change to `flashOpacity`, the tick/reposition loop, settings, `WindowAdapter.isTileable()`, or controller/workspace-signals wiring — all unchanged from the original spec.
- An automatic runtime fallback if the shader fails to load; the fallback is a git revert.
