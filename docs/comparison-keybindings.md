# Keybinding Comparison: Niri, PaperWM, Karousel, Drift

This is a research note, not user-facing documentation.
It exists to give Drift a basis for choosing a consistent default keybinding set, not to market Drift — see [`comparison-paperwm.md`](comparison-paperwm.md) for the feature-level PaperWM comparison and [`README.md`](../README.md) for the pitch.

The four projects are all scrollable-tiling window managers or extensions, but they default to different modifiers and different key families (arrows vs. WASD-style letters vs. Tab).
This note lists their default bindings side by side, grouped by action, so a future keybinding decision can pick one convention deliberately instead of accreting one shortcut at a time.

## Modifier conventions

| Project | Primary modifier | Notes |
|---|---|---|
| Niri | `Mod` | `Super` on a TTY session, `Alt` when niri runs nested in a window (e.g. for development) |
| PaperWM | `Super` | A few bindings also accept `Alt` as a `Tab`-cycling fallback |
| Karousel | `Meta` | Adds `Ctrl` and/or `Shift` and/or `Alt` as secondary modifiers per action family |
| Drift | `Meta` | Adds `Shift` as the sole secondary modifier |

## Key-family conventions

- **Niri**: `HJKL` (vim-style) or arrow keys, interchangeably, for all directional actions.
- **PaperWM**: Arrow keys for directional actions; `,`/`.` as a secondary left/right pair; `Tab` for recency-based cycling.
- **Karousel**: `WASD` for all directional actions (focus, move window, move column, scroll); `Home`/`End` for start/end.
- **Drift**: Arrow keys for the two directional actions it has (`cycleAlign`, `shiftViewport`); `Tab` for column focus; `Page_Up`/`Page_Down` for row paging.

Drift is the only one of the four that doesn't commit to a single key family — it mixes arrows, `Tab`, and `Page_Up`/`Page_Down` across its 11 shortcuts.

## Action-by-action

Empty cells mean the project has no equivalent (by design, or not yet built).

| Action | Niri | PaperWM | Karousel | Drift | Drift Target |
|---|---|---|---|---|---|
| Focus column/window left | `Mod+H` / `Mod+←` | `Super+Left` | `Meta+A` | `Meta+Left` | Meta+Left |
| Focus column/window right | `Mod+L` / `Mod+→` | `Super+Right` | `Meta+D` | `Meta+Right` | Meta+Right |
| Focus window above (in-column) | `Mod+K` / `Mod+↑` | `Super+Up` | `Meta+W` | — (no vertical stacking yet) | Meta+Up |
| Focus window below (in-column) | `Mod+J` / `Mod+↓` | `Super+Down` | `Meta+S` | — (no vertical stacking yet) | Meta+Down |
| Focus first/last column | — | `Super+Home` / `Super+End` | `Meta+Home` / `Meta+End` | — | Meta+Home / Meta+End |
| Cycle recently-focused windows | — | `Super+Tab` / `Alt+Tab` (+`Shift` reverse) | — | — |  |
| Move column left | `Mod+Ctrl+H` / `Mod+Ctrl+←` | `Super+Ctrl+Left` (or `Shift+Super+,`) | `Meta+Ctrl+Shift+A` | — (drag-to-reorder by mouse only) | Meta+Ctrl+Left |
| Move column right | `Mod+Ctrl+L` / `Mod+Ctrl+→` | `Super+Ctrl+Right` (or `Shift+Super+.`) | `Meta+Ctrl+Shift+D` | — (drag-to-reorder by mouse only) | Meta+Ctrl+Right |
| Move window up/down (in-column) | `Mod+Ctrl+K` / `Mod+Ctrl+J` | `Super+Ctrl+Up` / `Super+Ctrl+Down` | `Meta+Shift+W` / `Meta+Shift+S` | — (no vertical stacking yet) | Meta+Ctrl+Up / Meta+Ctrl+Down |
| Move column/window to start/end | — | — | `Meta+Ctrl+Shift+Home` / `End` (column), `Meta+Shift+Home` / `End` (window) | — | Meta+Ctrl+Home / Meta+Ctrl+End |
| Cycle column width presets | `Mod+R` (+`Shift` reverse) | `Super+R` (+`Alt` reverse) | `Meta+R` (+`Shift` reverse) | — | `Meta+R` (+`Shift` reverse) |
| Increase/decrease column width | `Mod+=` / `Mod+-` | `Super++` / `Super+-` | `Meta+Ctrl++` / `Meta+Ctrl+-` | — | Meta++` / `Meta+- |
| Increase/decrease window height | `Mod+Shift+=` / `Mod+Shift+-` | `Shift+Super++` / `Shift+Super+-` | — | — | Meta+Shift++ / Meta+Shift-- |
| Maximize column width | `Mod+M` | `Super+F` | — | — |  |
| Center focused column | `Mod+C` | `Super+C` | `Meta+Alt+Return` | — |  |
| Cycle column align (left/center/right) | — | — | — | `Meta+Shift+Left` / `Meta+Shift+Right` | Meta+Shift+Left / Meta+Shift+Right |
| Equalize / squeeze column widths | — | — | `Meta+Ctrl+X` (equalize), `Meta+Ctrl+A` / `D` (squeeze) | — |  |
| Scroll viewport without changing focus | — | — | `Meta+Alt+A` / `D` (one column), `Meta+Alt+PgUp` / `PgDown` (page) | `Meta+Alt+Left` / `Meta+Alt+Right` | `Meta+Alt+Left` / `Meta+Alt+Right` |
| Scroll viewport to start/end | — | — | `Meta+Alt+Home` / `End` | — | `Meta+Alt+Home` / `End` |
| Absorb/expel window (vertical stacking) | `Mod+[` / `Mod+]` (consume/expel) | `Super+I` (absorb) / `Super+O` (expel) | — | — (no vertical stacking yet, see roadmap) | Meta+I  (absorb)/ Meta+O (expel) |
| Toggle stacked layout for column | — | — | `Meta+X` | — |  |
| Toggle floating | `Mod+V` | `Shift+Super+Escape` (scratch layer) | `Meta+Space` | — (no float/undock yet, see roadmap) | Meta+Space |
| Toggle fullscreen | `Mod+Shift+F` | `Shift+Super+F` | — | — |  |
| Close focused window | `Mod+Q` | `Super+Backspace` | — | — |  |
| Switch workspace/row up | `Mod+I` / `Mod+PageUp` | `Super+PageUp` | — (no workspace concept) | `Meta+Page_Up` | `Meta+Page_Up` |
| Switch workspace/row down | `Mod+U` / `Mod+PageDown` | `Super+PageDown` | — (no workspace concept) | `Meta+Page_Down` | `Meta+Page_Down` |
| Move column to workspace/row above | `Mod+Ctrl+I` / `Mod+Ctrl+PageUp` | `Ctrl+Super+PageUp` | — | `Meta+Shift+Page_Up` | `Meta+Shift+Page_Up` |
| Move column to workspace/row below | `Mod+Ctrl+U` / `Mod+Ctrl+PageDown` | `Ctrl+Super+PageDown` | — | `Meta+Shift+Page_Down` | `Meta+Shift+Page_Down` |
| Move whole workspace up/down | `Mod+Shift+I` / `Mod+Shift+PageUp` etc. | — | — | — |  |
| Focus monitor left/right/up/down | `Mod+Shift+H/J/K/L` | `Super+Shift+Left/Right/Up/Down` | — | — |  |
| Move column to monitor left/right/up/down | `Mod+Ctrl+Shift+H/J/K/L` | `Shift+Ctrl+Super+Left/Right/Up/Down` | — | — |  |
| Swap/move workspace to monitor | — | `Super+Alt+←/→/↑/↓` (swap), `Shift+Ctrl+Alt+←/→/↑/↓` (move) | — | — |  |
| Take/drop window (grab, then navigate, then drop) | — | `Super+T` | — | — |  |
| Toggle scratch/floating layer visibility | — | `Ctrl+Super+Escape` (attach/detach), `Super+Escape` (toggle recent) | — | — |  |
| Show hotkey list | `Mod+Shift+/` | — | — | — |  |
| Toggle debug console (Drift dev tool) | — | — | — | `Meta+Shift+D` | `Meta+Shift+D` |

## Observations for a future keybinding decision

- **Drift is the outlier on key family.** All three prior-art projects settle on one directional family (Niri: HJKL/arrows, PaperWM: arrows, Karousel: WASD) and reuse it across every directional action. Drift mixes `Tab` (focus), arrows (align-cycle, viewport shift), and `Page_Up`/`Page_Down` (row paging) — a future pass could pick one family and apply it consistently, the way all three peers do.
- **`Tab` for focus is unique to Drift** and diverges from every peer's directional-key convention; peers reserve `Tab` (where used at all, e.g. PaperWM) for MRU/recency cycling, a different action Drift doesn't have.
- **Drift's secondary-modifier budget is the smallest of the four** — only `Shift`. Karousel in particular layers `Ctrl`, `Shift`, and `Alt` independently to fit ~25 distinct actions into one letter-based grid; Drift's 11 actions haven't needed that yet, but the roadmap items below will add more.
- **Column/window reordering by keyboard is a gap.** Every peer binds it (Niri `Mod+Ctrl+H/L`, PaperWM `Super+Ctrl+Left/Right`, Karousel `Meta+Shift+A/D`); Drift only supports it by mouse drag today.
- **Column width control is a gap.** All three peers bind both a "cycle preset widths" action and an "increment/decrement width" action; Drift has neither yet (no per-column width model currently exists — see roadmap).
- **Vertical stacking bindings are a gap by design, not oversight** — Drift doesn't yet support more than one window per column, so absorb/expel and in-column focus/move have no Drift equivalent. When that roadmap item lands, PaperWM's `Super+I`/`Super+O` (absorb/expel) and Niri's `Mod+[`/`Mod+]` (consume/expel) are the two existing naming conventions to choose between.
- **Drift's row paging already lines up conceptually** with Niri's and PaperWM's workspace-up/down bindings (`Mod+I`/`Mod+U`, `Super+PageUp`/`PageDown`) even though the underlying model differs (see [`comparison-paperwm.md`](comparison-paperwm.md#where-drift-already-differs-by-design-not-by-gap)); Drift already uses `Page_Up`/`Page_Down` for this, matching one of Niri's two accepted key choices and PaperWM's only one.
- **Cycle-align has no direct peer equivalent** — it's closer to Niri's/Karousel's "center column" (`Mod+C` / `Meta+Alt+Return`) than to their width-cycling actions, but Drift's version cycles between three screen-relative positions (left/center/right) rather than jumping straight to center.

## Sources

- [Niri "Getting Started" default hotkeys](https://github.com/YaLTeR/niri/wiki/Getting-Started) (fetched 2026-09-02) — default keybindings section.
- [PaperWM README, Usage section](https://github.com/paperwm/PaperWM#usage) (fetched 2026-09-02) — default keybindings table.
- [Karousel README, Key bindings section](https://github.com/peterfajdiga/karousel#key-bindings) (fetched 2026-09-02) — default keybindings table.
- Drift's own defaults: [`src/config/settings.ts`](../src/config/settings.ts), [`src/input/shortcuts.ts`](../src/input/shortcuts.ts).
