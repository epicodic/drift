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
| Vertical (in-column) stacking | Yes — `Meta+I`/`Meta+O` absorb/expel, resizable tile heights | Yes — absorb/expel windows into a column, resize stacked heights |
| Strip / stacked navigation | Yes — `StripStack` strips nested inside each activity/desktop strip, paged with `Meta+Page_Up`/`Meta+Page_Down` (`Meta+Ctrl+Up`/`Down` moves the focused window along, `Meta+Ctrl+Page_Up`/`Down` moves the whole column) | Yes — a "workspace stack" you page through (`Super+PageUp/PageDown`, `Super+`` `) |
| Window rules | Not yet — design drafted, see [roadmap](roadmap.md) | Yes — "winprops": per `wm_class`/`title` rules (`preferredWidth`, force-floating via `scratch_layer`) |
| Minimap / position indicator | Yes — a spatial overlay (columns, thumbnails, viewport rect), auto-shown on column-step and auto-hidden after `minimapAutoHideMs` | Yes — both a `minimap.js` overlay and a persistent "window position bar" in the top bar |
| Floating escape hatch (Drift's "undock/redock") | Yes — `Meta+Space` toggles docked/floating, with optional `keepAbove` | Yes — the "scratch layer": toggle a window between tiled and always-on-top floating |
| Mouse/touch navigation | Click-to-activate only | Click-to-activate, mouse wheel on the top bar, and 3-finger touchpad swipes (Wayland) |
| Column/window reordering | Live mouse drag-to-reorder | Primarily keybindings (`Super+Ctrl+Left/Right`, take/drop mode); no continuous drag-to-reorder |
| Focus-scroll behavior | One fixed "reveal" behavior | Switchable "focus modes" (`DEFAULT` free-scroll, `CENTER` always-centered, `EDGE` snap-to-edge) |
| Animation | Built in | Built in |
| Settings | KWin Scripts "Configure..." dialog (KConfigXT) | Full settings UI (GSettings) + `dconf-editor` for the rest |
| Layout persistence across restart | Not yet, see [roadmap](roadmap.md) | Backed by GNOME Shell's own session/workspace state |

## Ideas worth reconsidering for Drift's roadmap

A few PaperWM features suggest additional roadmap items or refinements of the existing ones — not commitments, just leads for a future brainstorming pass:

- **Window rules** (already on the roadmap, design drafted in [`docs/agents/specs/2026-09-06-window-rules-design.md`](agents/specs/2026-09-06-window-rules-design.md)) could still take a look at PaperWM's `winprops` shape — match by window class/title, set a preferred width and/or force-floating, with a wildcard `*` fallback rule — when implementation starts.
- **Minimap** — done. Drift went with the full spatial overlay (`minimap.js` precedent) rather than PaperWM's lightweight position bar; a position-bar-style always-visible variant remains a possible future refinement, not a gap.
- **Undock/redock** — done, and maps closely to PaperWM's scratch layer as anticipated: a dedicated `Meta+Space` toggle between tiled and floating-always-on-top (`keepAbove`), rather than a one-off drag-out gesture.
- **Focus modes** — not currently on Drift's roadmap at all. PaperWM's switchable `CENTER`/`EDGE`/free-scroll focus behavior is a different axis from Drift's one-shot `cycleAlign` shortcut (a persistent mode vs. a manual step) and might be worth a dedicated roadmap entry rather than folding into "configurable navigation feel."

## Where Drift already differs by design, not by gap

- Drift's multi-monitor model (one strip spanning every screen) and PaperWM's (one strip per monitor, shared workspace stack) are genuinely different designs, not one being a superset of the other — worth an explicit decision if multi-monitor behavior is ever revisited, rather than assuming PaperWM's model is strictly better.
- Strip navigation is also a different design, not a gap: PaperWM's "workspace stack" pages through workspaces themselves, while Drift's `StripStack` strips are a separate axis nested inside each activity/desktop's own strip, keeping the desktop dimension's existing meaning intact (see [`docs/architecture.md`](architecture.md#strips)).
- Live mouse drag-to-reorder is something PaperWM does not have and Drift does; no action needed here, just noted so it isn't accidentally regressed toward PaperWM's keybinding-only model.

## Sources

- [PaperWM README](https://github.com/paperwm/PaperWM) (fetched 2026-09-01) — usage, keybindings, workspace stack, scratch layer, winprops, focus modes, settings.
