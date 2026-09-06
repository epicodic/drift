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
]);
