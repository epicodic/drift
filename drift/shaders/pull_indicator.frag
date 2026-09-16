#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 glowColor;  // accent color; only .rgb is read, straight (non-premultiplied)
    vec2 itemSize;   // effect item size in px — the item's own top edge (y=0) is always the
                      // window's top edge (the segment's chord), since the overlay dialog is
                      // positioned there every tick (see pull-indicator-overlay.ts)
    vec2 center;     // circumcircle center, item-local px (see pull-indicator.ts:pullIndicatorCircle)
    float radius;    // circumcircle radius, px
    float alpha;     // pullIndicatorAlpha(dyTotal, triggerPx) * pullIndicatorOpacity, computed
                      // on the TS side
};
// Filled circular segment: the region below the chord (item-local y >= 0) and within radius of
// center — every point on that region's curved boundary (the arc) sits at exactly `radius` from
// `center` by construction (docs: 2026-09-16-drag-pull-threshold-indicator-design), so a plain
// radial mix from 0 at the center to `alpha` at the radius reads as a uniform band along the
// whole arc, fading toward the chord.
void main() {
    vec2 p = qt_TexCoord0 * itemSize;
    float dist = distance(p, center);
    bool inSegment = p.y >= 0.0 && dist <= radius;
    float a = inSegment ? (dist / radius) * alpha * qt_Opacity : 0.0;
    fragColor = vec4(glowColor.rgb, 1.0) * a; // premultiplied
}
