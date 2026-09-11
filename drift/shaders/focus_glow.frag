#version 440
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    vec4 glowColor;   // premultiply happens below; pass straight RGBA from QML
    vec2 itemSize;    // effect item size in px, == the window frame (no outward padding)
    float coreHalf;   // half width of the fully-opaque border core in px
    float glow;       // inward falloff distance in px
    float radius;     // corner radius in px (always 0 for now, see design doc "Scope")
    float sharpness;  // pow() exponent applied to alpha; >1 concentrates the glow near the core
};
float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
void main() {
    vec2 p = (qt_TexCoord0 - 0.5) * itemSize;      // centered pixel coords
    vec2 halfBox = itemSize * 0.5;                 // item == window edge, so box == item bounds
    float d = -sdRoundRect(p, halfBox, radius);    // 0 at the edge, grows inward only
    float a = 1.0 - smoothstep(coreHalf, coreHalf + glow, d);
    a = pow(a, sharpness);
    fragColor = vec4(glowColor.rgb, 1.0) * (a * glowColor.a * qt_Opacity); // premultiplied
}
