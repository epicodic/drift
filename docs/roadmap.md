# Roadmap

Not yet implemented, in no particular priority order:

- **Window rules** — auto-placement/auto-float for specific applications (e.g. always-float a dialog like Pavucontrol). No config format decided yet.
- **Minimap** — an overlay showing the user's position within the overall grid. No rendering approach decided yet.
- **Persistence** — layout (column positions/widths) does not survive a KWin/session restart.
- **Multi-monitor slot alignment** — monitors already form one continuous strip (`WorkspaceAdapter.combinedGeometry`), but the viewport does not yet snap to monitor boundaries during focus-scroll, so a column can end up visually split across a bezel.
- **Vertical tiling** — stacking more than one window within a single column. `Column` currently models one window per column only.
- **Undock/redock** — detaching a window from the strip to normal floating behavior (staying always-on-top) and re-docking it later.
- **Configurable navigation feel** — mouse wheel sensitivity and edge-hover thresholds; navigation is entirely shortcut-driven (focus, align-cycle, viewport-shift) or click-to-activate today, with no pointer-driven scrolling.
