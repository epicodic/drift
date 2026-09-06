# Roadmap

Not yet implemented, in no particular priority order:

- **Window rules** — auto-placement/auto-float for specific applications (e.g. always-float a dialog like Pavucontrol), matched by `resourceClass`/`caption` with an optional regex escape hatch. Design drafted, not yet implemented — see [`docs/agents/specs/2026-09-06-window-rules-design.md`](agents/specs/2026-09-06-window-rules-design.md).
- **Layout persistence across restart** — Drift's layout currently lives only in memory; it does not survive a KWin restart or logout the way niri's or PaperWM's session/workspace state does.


