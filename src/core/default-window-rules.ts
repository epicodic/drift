// Karousel's own bundled default window rules (`_playground/karousel/src/lib/config/definition.ts`),
// translated to Drift's schema: Karousel's `tile: false` entries become Drift's `float: true`.
// The two `tile: true` overrides (kfind, JetBrains' "Unstash Changes" dialog) have no Drift
// equivalent — Drift's rules are opt-out only (`float`), there's no "force tile" concept to
// translate them to — so those two are omitted. Every matcher below is written as a real
// regex (`/pattern/`, deliberately with no `i` flag) rather than Drift's plain-substring
// shortcut, since Karousel's own patterns are regexes, not literal substrings, and Karousel
// matches case-sensitively (docs: 2026-09-06-window-rules-design). Kept in sync with
// `drift/contents/config/main.xml`'s `windowRules` kcfg default by
// `src/core/default-window-rules.test.ts`.
export const DEFAULT_WINDOW_RULES: string = JSON.stringify([
    { class: '/^(org\\.kde\\.)?plasmashell$/', float: true },
    { class: '/^(org\\.kde\\.)?polkit-kde-authentication-agent-1$/', float: true },
    { class: '/^(org\\.kde\\.)?kded6$/', float: true },
    { class: '/^(org\\.kde\\.)?kcalc$/', float: true },
    { class: '/^(org\\.kde\\.)?kruler$/', float: true },
    { class: '/^(org\\.kde\\.)?krunner$/', float: true },
    { class: '/^(org\\.kde\\.)?yakuake$/', float: true },
    { class: '/^(wl-copy|wl-paste)$/', caption: '/^wl-clipboard$/', float: true },
    { class: '/^steam$/', caption: '/^Steam Big Picture Mode$/', float: true },
    { class: '/^zoom$/', caption: '/^(Zoom Cloud Meetings|zoom|zoom <2>)$/', float: true },
    { class: '/^jetbrains-.*$/', caption: '/^splash$/', float: true },
]);
