# Comparison to PaperWM

This is a research note, not user-facing documentation.
It exists to inform future Drift development, not to market Drift — see [`README.md`](../README.md) for the pitch and the [Karousel comparison](../README.md#drift-vs-karousel) there.

## What PaperWM is

[PaperWM](https://github.com/paperwm/PaperWM) is a GNOME Shell extension, not a KWin script.
It only runs under GNOME Shell, so it is not a direct alternative for a KDE Plasma user the way Karousel is — the comparison here is about the *model*, not a migration path.
It is the extension that popularized the "scrollable tiling" term itself, and both Karousel's and niri's own READMEs cite it as prior art.

PaperWM's layout unit is a workspace, not the whole screen: each GNOME workspace holds one independent horizontal strip of columns, and each monitor simply shows one workspace from a shared, GNOME-wide workspace stack.
Columns can hold more than one window, stacked vertically (`Super+I` absorbs the window below into the active column, `Super+O` expels it back out).

## Feature-by-feature

| Aspect | Drift | PaperWM |
|---|---|---|
| Host environment | KDE Plasma / KWin script | GNOME Shell extension |
| Multi-monitor model | One strip spans every screen | One workspace (one strip) per monitor, drawn from a shared workspace stack |
| Vertical (in-column) stacking | Not yet, see [roadmap](roadmap.md) | Yes — absorb/expel windows into a column, resize stacked heights |
| Row / stacked navigation | Not yet, see [roadmap](roadmap.md) | Yes — a "workspace stack" you page through (`Super+PageUp/PageDown`, `Super+`` `) |
| Window rules | Not yet, see [roadmap](roadmap.md) | Yes — "winprops": per `wm_class`/`title` rules (`preferredWidth`, force-floating via `scratch_layer`) |
| Minimap / position indicator | Not yet, see [roadmap](roadmap.md) | Yes — both a `minimap.js` overlay and a persistent "window position bar" in the top bar |
| Floating escape hatch (Drift's "undock/redock") | Not yet, see [roadmap](roadmap.md) | Yes — the "scratch layer": toggle a window between tiled and always-on-top floating |
| Mouse/touch navigation | Click-to-activate only | Click-to-activate, mouse wheel on the top bar, and 3-finger touchpad swipes (Wayland) |
| Column/window reordering | Live mouse drag-to-reorder | Primarily keybindings (`Super+Ctrl+Left/Right`, take/drop mode); no continuous drag-to-reorder |
| Focus-scroll behavior | One fixed "reveal" behavior | Switchable "focus modes" (`DEFAULT` free-scroll, `CENTER` always-centered, `EDGE` snap-to-edge) |
| Animation | Built in | Built in |
| Settings | KWin Scripts "Configure..." dialog (KConfigXT) | Full settings UI (GSettings) + `dconf-editor` for the rest |
| Layout persistence across restart | Not yet, see [roadmap](roadmap.md) | Backed by GNOME Shell's own session/workspace state |

## Ideas worth reconsidering for Drift's roadmap

A few PaperWM features suggest additional roadmap items or refinements of the existing ones — not commitments, just leads for a future brainstorming pass:

- **Window rules** (already on the roadmap) could follow PaperWM's `winprops` shape directly: match by window class/title, set a preferred width and/or force-floating, with a wildcard `*` fallback rule.
- **Minimap** (already on the roadmap) has two independent precedents in PaperWM worth choosing between: a full spatial overlay (`minimap.js`) versus a lightweight always-visible position bar. The latter is far cheaper to build and may cover most of the value.
- **Row navigation** (already on the roadmap) — PaperWM's "workspace stack" (page through recently-used workspaces, each with its own strip) is a concrete prior-art shape for what Drift's own "additional rows" idea could look like.
- **Undock/redock** (already on the roadmap) maps closely to PaperWM's scratch layer — a dedicated toggle between tiled and floating-always-on-top, rather than a one-off drag-out gesture.
- **Focus modes** — not currently on Drift's roadmap at all. PaperWM's switchable `CENTER`/`EDGE`/free-scroll focus behavior is a different axis from Drift's one-shot `cycleAlign` shortcut (a persistent mode vs. a manual step) and might be worth a dedicated roadmap entry rather than folding into "configurable navigation feel."
- **Vertical stacking** (already on the roadmap) — PaperWM's absorb/expel keybinding pair (`Super+I`/`Super+O`) is a simple, well-tested interaction model to borrow from once Drift's `Column` supports more than one window.

## Where Drift already differs by design, not by gap

- Drift's multi-monitor model (one strip spanning every screen) and PaperWM's (one strip per monitor, shared workspace stack) are genuinely different designs, not one being a superset of the other — worth an explicit decision if multi-monitor behavior is ever revisited, rather than assuming PaperWM's model is strictly better.
- Live mouse drag-to-reorder is something PaperWM does not have and Drift does; no action needed here, just noted so it isn't accidentally regressed toward PaperWM's keybinding-only model.

## Sources

- [PaperWM README](https://github.com/paperwm/PaperWM) (fetched 2026-09-01) — usage, keybindings, workspace stack, scratch layer, winprops, focus modes, settings.
