# Features

Detail on everything listed in the [README](../README.md#features), one section per feature: what it does, how
to trigger it, and the settings that shape it.
This is user-facing reference documentation.
For how a feature is built internally, see [architecture.md](architecture.md) and [algorithms.md](algorithms.md)
(developer docs) — each section below links to the relevant part of those where useful.

Demo clips referenced here don't exist yet; see [docs/media/README.md](media/README.md) for the shot list.

## Layout & Navigation

### Scrollable columns

<!-- MEDIA: docs/media/scrollable-columns.gif -->
<p align="center"><img src="media/scrollable-columns.gif" alt="Scrolling across columns" width="720"></p>

Every window gets its own column at the width you gave it. Opening or closing a window never resizes any other
column — it only ever changes the strip's total length. New windows append to the end of the strip; focusing one
scrolls the viewport ("camera") to bring it into view rather than reflowing anything.
Implementation: [architecture.md § Virtual Coordinate System](architecture.md#virtual-coordinate-system).

### Neighbor push

<!-- MEDIA: docs/media/neighbor-push.gif -->
<p align="center"><img src="media/neighbor-push.gif" alt="Resizing a column pushes its neighbors" width="720"></p>

Drag a window's left or right border and Drift resizes that column *and* shifts every column to one side to keep
the strip gapless — neighbors are shifted, never resized. Resizing from the left edge also shifts the strip's
origin so the window's right edge visually stays put; resizing from the right edge leaves the origin alone.
Implementation: [algorithms.md § Resize-Edge Detection](algorithms.md#resize-edge-detection).

### Drag-to-reorder

<!-- MEDIA: docs/media/drag-reorder.gif -->
<p align="center"><img src="media/drag-reorder.gif" alt="Dragging a window past a neighbor to swap places" width="720"></p>

Grab a window and drag it — once its own leading edge crosses a neighbor's center, the two swap places live, and
the displaced column slides smoothly into its new slot. The swap is judged by the dragged window's own edges, not
the cursor position, so it doesn't matter where in the window you grabbed it.
Implementation: [algorithms.md § Drag-Reorder Insertion Index](algorithms.md#drag-reorder-insertion-index).

### Column align-cycle

<!-- MEDIA: docs/media/align-cycle.gif -->
<p align="center"><img src="media/align-cycle.gif" alt="Cycling a column between left, center, and right" width="720"></p>

`Meta+Shift+Left` / `Meta+Shift+Right` step the *already-focused* column between flush-left, centered, and
flush-right in the viewport, without changing which column is focused. Each key drives toward its own edge and
stops there instead of looping past it.
Implementation: [algorithms.md § Align-Cycle Phase Stepping](algorithms.md#align-cycle-phase-stepping).

### Manual viewport panning

<!-- MEDIA: docs/media/viewport-pan.gif -->
<p align="center"><img src="media/viewport-pan.gif" alt="Panning the viewport without changing focus" width="720"></p>

`Meta+Alt+Left` / `Meta+Alt+Right` pan the camera by a fixed step (`viewportShiftStep`, default 400px) without
touching focus — useful for glancing at a neighboring column without disturbing what you're working on.
`Meta+Alt+Home` / `Meta+Alt+End` pan straight to either end of the strip. Unlike focus-driven reveals, panning is
deliberately unclamped — you can keep going past either end of the content.
Implementation: [algorithms.md § Viewport Shift](algorithms.md#viewport-shift).

## Vertical Tiling

### Absorb / expel

<!-- MEDIA: docs/media/vertical-tiling.gif -->
<p align="center"><img src="media/vertical-tiling.gif" alt="Absorbing and expelling a tile" width="720"></p>

A column can hold more than one window stacked vertically. `Meta+I` absorbs the column to the right into the
focused column as a new tile at the bottom of the stack, splitting height evenly; `Meta+O` expels the focused
tile back out into its own standalone column, redistributing its height proportionally to what remains — matching
PaperWM's absorb/expel model. `Meta+Up` / `Meta+Down` move focus between tiles in a stack (falling back to
strip-paging once there's no adjacent tile left), and `Meta+Shift+Plus` / `Meta+Shift+Minus` resize the focused
tile's height within its stack.
Implementation: [`2026-09-03-vertical-tiling-design.md`](agents/specs/2026-09-03-vertical-tiling-design.md).

### Drag-to-stack

<!-- MEDIA: docs/media/drag-to-stack.gif -->
<p align="center"><img src="media/drag-to-stack.gif" alt="Dragging a window into a column to stack it" width="720"></p>

Absorb/expel is keyboard-only; drag-to-stack is the mouse equivalent. Each target column is split into zones: the
outer quarter on either side keeps triggering ordinary drag-to-reorder, while the middle half is a **stack
zone** — hovering it live-previews the dragged window landing at a specific vertical slot in that column's stack,
resolved from where you're hovering. Releasing commits whatever is currently previewed. The same hover-resolution
logic covers all four directions: standalone → stack, stack → standalone (expel-by-drag), stack → a *different*
stack, and reordering within one stack.
Implementation: [algorithms.md § Drag-to-Stack Hover Resolution](algorithms.md#drag-to-stack-hover-resolution) and
[`2026-09-03-drag-to-stack-design.md`](agents/specs/2026-09-03-drag-to-stack-design.md).

## Multi-Monitor & Workspaces

### Multi-monitor aware

<!-- MEDIA: docs/media/multi-monitor.gif -->
<p align="center"><img src="media/multi-monitor.gif" alt="One strip spanning multiple monitors" width="720"></p>

Your screens form one continuous strip rather than each getting its own independent layout — scrolling the
viewport can bring a column into view on whichever screen it currently belongs to.

### Plasma Activities & virtual desktops

Each `(activity, virtual desktop)` pair gets its own independent strip, so unrelated workspaces never affect each
other's column order, widths, or focus. A window that spans multiple activities/desktops (or none) is left
unmanaged rather than guessed at.
Implementation: [architecture.md § Activities and Virtual Desktops](architecture.md#activities-and-virtual-desktops).

### Strip navigation

<!-- MEDIA: docs/media/strip-navigation.gif -->
<p align="center"><img src="media/strip-navigation.gif" alt="Paging between strips and moving a window across" width="720"></p>

Beyond the horizontal strip itself, each activity/desktop can hold more than one strip, addressed by an integer
index and paged through as a second, vertical axis. `Meta+Page_Up` / `Meta+Page_Down` page to the strip above/below;
`Meta+Ctrl+Up` / `Meta+Ctrl+Down` move just the focused window there and follow it; `Meta+Ctrl+Page_Up` /
`Meta+Ctrl+Page_Down` move the whole focused column (its entire tile stack) there instead. A window parked in an
inactive strip is moved off-screen rather than minimized, so the transition has something to animate.
Implementation: [architecture.md § Strips](architecture.md#strips).

## Visual Feedback

### Minimap

<!-- MEDIA: docs/media/minimap.gif -->
<p align="center"><img src="media/minimap.gif" alt="The minimap overlay showing columns, thumbnails, and the viewport" width="720"></p>

Stepping between columns (`Meta+Left`/`Right`, or any focus/move/strip shortcut) briefly shows a centered overlay
of the active strip: every visible column sized proportionally to its virtual width, the focused one highlighted,
each window's icon or a live thumbnail drawn inside, and a second rectangle showing the current viewport's extent
against the whole strip. It auto-hides after `minimapAutoHideMs` (default ~1200ms) once presses stop.
`minimapShowThumbnails` (default on) switches between live window-content thumbnails and icon-only.
Implementation: [`2026-09-01-minimap-design.md`](agents/specs/2026-09-01-minimap-design.md) and
[`2026-09-01-minimap-thumbnails-design.md`](agents/specs/2026-09-01-minimap-thumbnails-design.md).

### Focus-flash highlight

<!-- MEDIA: docs/media/focus-flash.gif -->
<p align="center"><img src="media/focus-flash.gif" alt="A glow highlight pulsing around the newly-focused window" width="720"></p>

Every time focus moves to a different window, a soft glow briefly hugs its edge from the inside and fades back
out — a sinusoidal fade-in/fade-out envelope over `focusFlashDurationMs` (default 300ms). The glow is rendered by
a custom signed-distance-field fragment shader rather than a blurred/clipped effect stack, so its hue can never
fringe toward black at low opacity. `focusFlashEnabled`, `focusFlashBorderWidth` (default 4px), and
`focusFlashBlurRadius` (default 24px) control whether it shows and how it looks.
Implementation: [algorithms.md § Focus-Flash Opacity Envelope](algorithms.md#focus-flash-opacity-envelope) and
[`2026-09-05-focus-flash-glow-shader-design.md`](agents/specs/2026-09-05-focus-flash-glow-shader-design.md).

### Live debug console

<!-- MEDIA: docs/media/debug-console.gif -->
<p align="center"><img src="media/debug-console.gif" alt="The on-screen debug console overlay" width="720"></p>

`Meta+Shift+D` toggles an on-screen overlay showing exactly what Drift's model currently thinks the layout and
camera state are — column order, widths, tile stacks, viewport offset — scoped to the active strip. Useful for
understanding a surprising layout decision or for bug reports.

## Floating

### Undock / redock

<!-- MEDIA: docs/media/undock-redock.gif -->
<p align="center"><img src="media/undock-redock.gif" alt="Undocking a window to float, then redocking it" width="720"></p>

`Meta+Space` toggles the active window between docked (tiled in its strip) and floating. Undocking removes the
window from its strip exactly as a close would (gap-filled, neighbors re-animate) and, if `undockKeepAbove` is
enabled (default on), keeps it visually above the still-tiled windows behind it. Redocking re-adds it next to the
currently-focused column using the same path a brand-new window takes — there's no "remembered position": undock
and redock are deliberately symmetric with close and reopen. Toggling a window Drift doesn't manage is a no-op.
Implementation: [`2026-09-06-manual-undock-redock-design.md`](agents/specs/2026-09-06-manual-undock-redock-design.md).

## Configuration

### Settings dialog

<!-- MEDIA: docs/media/settings-dialog.gif -->
<p align="center"><img src="media/settings-dialog.gif" alt="Drift's Configure... settings dialog" width="720"></p>

System Settings → Window Management → KWin Scripts → Drift → **Configure...** exposes every behavioral knob:
column gap, default column width, animation duration, viewport shift step, bottom margin, minimap auto-hide
timing and thumbnails, and the focus-flash appearance/timing settings. Shortcuts are deliberately excluded from
this dialog — they're real KGlobalAccel global shortcuts, rebound from System Settings → Shortcuts instead, the
same convention Karousel uses.
Implementation: [`2026-08-31-settings-dialog-design.md`](agents/specs/2026-08-31-settings-dialog-design.md).
