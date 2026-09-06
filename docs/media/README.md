# Media shot list

This directory holds the demo GIFs/videos embedded in the main [README](../../README.md) and in
[docs/features.md](../features.md).
None of these files exist yet — the README and features doc already reference the paths below via `<img>`
tags, so dropping a correctly-named file here makes it appear with no further edits.

See [storyboard.md](storyboard.md) for a shot-by-shot plan to record all of these in one continuous screencast
and cut them apart afterward.

Keep clips short (5-15s), loop-friendly, and cropped to the relevant window(s) rather than the whole desktop
where possible. GIF is the safest format for GitHub-hosted Markdown; an `.mp4` at the same path works too if
re-encoded as a GIF is too large, but note that GitHub only inline-plays `<video>` for files it hosts itself
(issue/PR drag-and-drop attachments), not arbitrary repo-relative paths — a repo-relative `.mp4` renders as a
download link, not a player, in most Markdown viewers. GIF is the one format guaranteed to just work.

| File | Feature | What to capture |
|---|---|---|
| `hero-demo.gif` | README hero | A short whole-workflow reel: open a few windows, scroll the strip, resize a column (neighbor push), drag-reorder two columns, absorb/expel a tile, page to another strip. This is the first thing a visitor sees — make it count. |
| `scrollable-columns.gif` | Scrollable columns | Open 4-5 windows, focus left/right across them, showing the viewport scroll rather than a grid reflow. |
| `neighbor-push.gif` | Neighbor push | Drag a column's border wider/narrower, showing the columns to its right shove over live. |
| `drag-reorder.gif` | Drag-to-reorder | Grab a window and drag it past a neighbor's center, showing the swap and the displaced column's slide. |
| `align-cycle.gif` | Column align-cycle | Press `Meta+Shift+Left`/`Meta+Shift+Right` repeatedly on one column, showing it step left edge → center → right edge. |
| `viewport-pan.gif` | Manual viewport panning | Press `Meta+Alt+Left`/`Right` to glance at a neighboring column without moving focus/highlight. |
| `strip-navigation.gif` | Strip navigation | Page with `Meta+Page_Up`/`Page_Down` between two strips, then move a window across with `Meta+Ctrl+Page_Up`/`Down`. |
| `vertical-tiling.gif` | Vertical tiling (absorb/expel) | `Meta+I` to absorb a neighboring column into a stack, `Meta+O` to expel a tile back out; show `Meta+Up`/`Down` moving focus within the stack. |
| `drag-to-stack.gif` | Drag-to-stack | Drag a standalone column into the middle (stack zone) of another column, showing the live stack preview, vs. dragging into the outer quarter (reorder zone). |
| `minimap.gif` | Minimap | Step through columns with `Meta+Left`/`Right` fast enough to keep the overlay visible, showing the strip-wide overview with thumbnails and the viewport rectangle. |
| `focus-flash.gif` | Focus-flash highlight | Alt-tab or focus-shortcut between two windows, showing the glow pulse hug the newly-focused window's edge. |
| `undock-redock.gif` | Undock / redock | `Meta+Space` on a tiled window to pop it out floating-above, then `Meta+Space` again to redock it back into the strip. |
| `settings-dialog.gif` | Settings dialog | Open System Settings → Window Management → KWin Scripts → Drift → Configure..., showing the tabbed settings. |
| `debug-console.gif` | Live debug console | `Meta+Shift+D` toggling the on-screen layout/camera overlay while windows move. |
| `multi-monitor.gif` | Multi-monitor | Focus-cycle across the boundary between two screens, showing the strip scroll continuously from one screen's columns into the other's. Needs two real or virtual outputs — optional/lowest priority if you don't have one handy. |

Referenced sizes in the docs assume a max width of ~800px for the hero clip and ~720px for per-feature clips —
recording at a higher resolution and letting Markdown scale down looks fine; recording much smaller than that
will look blurry once embedded.
