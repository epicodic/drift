#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 glowColor;   // premultiply happens below; pass straight RGBA from QML
    vec2 itemSize;    // effect item size in px, == the window frame plus 2*bleed padding
    float coreHalf;   // half width of the fully-opaque border core in px
    float glow;       // inward falloff distance in px
    float sharpness;  // pow() exponent applied to alpha; >1 concentrates the glow near the core
    float bleed;      // outward falloff distance in px; also how far the item is padded outward
};
// Inward falloff along one axis, ignoring the other axis entirely.
float ringInside(float q) {
    return 1.0 - smoothstep(coreHalf, coreHalf + glow, -q);
}
void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * itemSize;      // centered pixel coords
    vec2 halfBox = itemSize * 0.5 - vec2(bleed);   // window edge, inset from the padded item bounds
    vec2 q = abs(p) - halfBox;
    // Inside: combining the two axes as a true 2D distance field (via max/min) leaves a
    // medial-axis crease at each corner where the nearest edge switches from one axis to the
    // other; no smoothing of that combine step is both seam-free and bump-free (see git
    // history). Instead treat each axis as its own independent border glow and screen-blend
    // them (smooth OR): a pixel glows if it's near EITHER edge pair, with no position where the
    // formula switches which axis "wins," so there's no crease to begin with.
    float aInside = 1.0 - (1.0 - ringInside(q.x)) * (1.0 - ringInside(q.y));
    // Outside: unlike the inside, this was never the source of a crease — length(max(q, 0)) is
    // the exact (and, away from the single corner point, smooth) distance to an unrounded box
    // corner, so it needs no blending trick. It also happens to fall off as a true quarter-circle
    // arc near each corner, which the screen-blend above can't reproduce.
    float aOutside = 1.0 - smoothstep(0.0, bleed, length(max(q, 0.0)));
    bool inside = q.x <= 0.0 && q.y <= 0.0;
    float a = inside ? aInside : aOutside;
    a = pow(a, sharpness);
    fragColor = vec4(glowColor.rgb, 1.0) * (a * glowColor.a * qt_Opacity); // premultiplied
}
