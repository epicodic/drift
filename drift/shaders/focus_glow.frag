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
    float radius;     // corner radius in px, rounds the window-edge box the glow hugs
    float sharpness;  // pow() exponent applied to alpha; >1 concentrates the glow near the core
    float bleed;      // outward falloff distance in px; also how far the item is padded outward
};
// Smooths max(a, b) over a band of width k, filling in the sharp ridge where a and b cross so the
// interior distance field has no crease. A plain max() there makes sdRoundRect's inward glow show a
// diagonal seam (a medial-axis crease) once the falloff reaches past the rounded corner's own arc.
float smax(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return max(a, b) + h * h * k * 0.25;
}
float sdRoundRect(vec2 p, vec2 b, float r, float k) {
    vec2 q = abs(p) - b + r;
    return min(smax(q.x, q.y, k), 0.0) + length(max(q, 0.0)) - r;
}
void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * itemSize;      // centered pixel coords
    vec2 halfBox = itemSize * 0.5 - vec2(bleed);   // window edge, inset from the padded item bounds
    // k tracks glow: the crease only needs smoothing over the region the falloff actually reaches.
    float sd = sdRoundRect(p, halfBox, radius, max(glow, 0.001)); // 0 at the edge; negative inside, positive outside
    float aInside = 1.0 - smoothstep(coreHalf, coreHalf + glow, -sd);
    float aOutside = 1.0 - smoothstep(0.0, bleed, sd);
    float a = sd <= 0.0 ? aInside : aOutside;
    a = pow(a, sharpness);
    fragColor = vec4(glowColor.rgb, 1.0) * (a * glowColor.a * qt_Opacity); // premultiplied
}
