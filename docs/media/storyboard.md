# Screencast storyboard

A shot-by-shot plan for recording one continuous screencast that demonstrates every feature in
[docs/media/README.md](README.md), in an order where each shot's starting layout falls naturally out of the one
before it. Record it once as a single take (plus two short separate takes for the settings dialog and, if you
have the hardware, multi-monitor), then cut each scene into its own file with `ffmpeg` using the in/out cues
below — no re-recording needed if a single edit runs long, because every scene's IN point is a clean, static
layout state you can also just re-cut from a slightly different offset.

## Setup

- Fresh Plasma session. Nothing else on screen — close notifications, hide the panel's notification popups, no
  wallpaper clutter behind the strip.
- **Five apps**, opened in this order and never closed until Scene L: **Konsole** (terminal), **Dolphin** (file
  manager), **Kate** (editor), **Falkon or Firefox** (browser), **Gwenview** (image viewer). Distinct colors and
  icons make it easy to tell columns apart across cuts, and each one's chrome (title bar, icon) reads clearly at
  GIF resolution.
- Give each app enough content to not look empty (a file listing in Dolphin, a text file open in Kate, a page
  loaded in the browser, an image in Gwenview) — an empty window looks like a loading glitch in a GIF.
- Set `animationDurationMs` to something a little slower than default while recording (~350-400ms) so viewers can
  actually see the slide/push/swap motions frame-by-frame; the default (200ms) reads as an instant cut on a
  15fps GIF. Put it back afterward.
- **Turn on a keypress overlay** so viewers can see which shortcut triggered each action —
  [`screenkey`](https://gitlab.com/screenkey/screenkey) on X11, `wshowkeys` on Wayland, or any KRunner/Latte
  "show pressed keys" widget. This matters more here than in a typical screencast, since half the point is
  "press this key to get this effect."
- Keep the mouse cursor visible in the recording (default in most tools) — several scenes are drag gestures and
  are meaningless without it.
- Record at 1920×1080 or higher and at least 30fps; you're downsampling to ~720px-wide 15fps GIFs afterward, and
  recording small/low-fps up front bakes in blur you can't undo later.

Suggested recorder (Wayland/KWin): `wf-recorder -f screencast.mp4` (stop with the same command's `SIGINT`, i.e.
`Ctrl+C` in its terminal, not by closing the terminal). OBS Studio works identically if you prefer a GUI and a
scene with a visible cursor + the keypress overlay window captured too.

## Scenes

Each scene names its **IN cue** (the exact moment to start the cut) and **OUT cue** (the exact moment to end
it) as visual/state events, not timestamps — find them by scrubbing after the fact. Target length is what the
final GIF should end up trimmed to; record a couple of seconds of padding on each side and trim in the `ffmpeg`
step, don't try to hit the cue live.

### Scene A — `scrollable-columns.gif`

**Setup:** empty strip. **Action:** open Konsole, Dolphin, Kate, Falkon, Gwenview in sequence, ~1s apart, letting
each one's open-animation settle before the next. Once all five are open, press `Meta+Right` four times (landing
on Gwenview), then `Meta+Left` four times (back to Konsole).
**IN:** the first `Meta+Right` press after Gwenview settles. **OUT:** the moment focus lands back on Konsole.
**Target length:** 8-10s.

### Scene B — `neighbor-push.gif`

**Setup:** continue directly from Scene A (5-column strip, Konsole focused). Focus Kate (`Meta+Right` `Meta+Right`).
**Action:** grab Kate's right border and drag it noticeably wider, hold a beat, then drag it back narrower than
its original width.
**IN:** mouse-down on the border. **OUT:** mouse-up after the narrowing drag.
**Target length:** 6-8s.

### Scene C — `drag-reorder.gif`

**Setup:** continue from Scene B. Kate is still focused, back at roughly its original width.
**Action:** grab the Dolphin window (now to Kate's left) and drag it right, past Kate's center, so they swap;
pause a beat on the swapped layout, then drag Dolphin back left past Kate's center to restore the original order.
**IN:** mouse-down on Dolphin. **OUT:** mouse-up after the second swap (order restored).
**Target length:** 6-8s.

### Scene D — `align-cycle.gif`

**Setup:** continue from Scene C (original 5-column order restored). Focus Falkon.
**Action:** press `Meta+Shift+Right` three times (center → flush right, then a no-op press to show it stops),
then `Meta+Shift+Left` twice (back through center to flush left).
**IN:** the first `Meta+Shift+Right`. **OUT:** settling at flush-left.
**Target length:** 6-8s.

### Scene E — `viewport-pan.gif`

**Setup:** continue from Scene D. Whatever is focused stays focused — this scene is about the camera moving
*without* the focus highlight moving.
**Action:** press `Meta+Alt+Left` twice, `Meta+Alt+Right` twice (small pans), then `Meta+Alt+End` (jump to the
strip's end) and `Meta+Alt+Home` (jump back to the start).
**IN:** the first `Meta+Alt+Left`. **OUT:** settling back at the start after `Meta+Alt+Home`.
**Target length:** 8-10s.

### Scene F — `vertical-tiling.gif`

**Setup:** continue from Scene E. Focus Konsole (first column).
**Action:** `Meta+I` (absorb Dolphin into Konsole's column as tile 2), `Meta+I` again (absorb Kate as tile 3);
`Meta+Down` `Meta+Down` `Meta+Up` to show tile focus moving within the stack; `Meta+O` `Meta+O` to expel back
down to two standalone columns (Dolphin, Kate) plus Konsole.
**IN:** the first `Meta+I`. **OUT:** the second `Meta+O` settling.
**Target length:** 10-12s.

### Scene G — `drag-to-stack.gif`

**Setup:** continue from Scene F. Konsole, Dolphin, Kate, Falkon, Gwenview are all standalone columns again
(re-run Scene F's absorbs once more if the order drifted, or just re-derive: five standalone columns, any order).
**Action:** grab Gwenview and drag it toward Konsole — first hover near Konsole's outer edge (reorder-zone
preview: a swap position, not a stack), then move to the middle of Konsole (stack-zone preview: a tile slot
inside Konsole's stack), and drop there. Then grab Gwenview again from inside the stack and drag it back out to
the side to make it standalone again (expel-by-drag).
**IN:** mouse-down on Gwenview. **OUT:** mouse-up after it's standalone again.
**Target length:** 10-12s.

### Scene H — `strip-navigation.gif`

**Setup:** continue from Scene G (back to five standalone columns). Focus Kate.
**Action:** `Meta+Page_Down` (page down to a fresh, empty strip), `Meta+Page_Up` (back up — Kate's strip, still
focused). Then `Meta+Ctrl+Down` (move just the focused *window* to the strip below and follow it), and once
there, `Meta+Ctrl+Page_Up` (move the *whole column* back up).
**IN:** the first `Meta+Page_Down`. **OUT:** settling back on the original strip after the column move.
**Target length:** 10-12s.

### Scene I — `minimap.gif`

**Setup:** continue from Scene H, five columns on the original strip.
**Action:** press `Meta+Right`/`Meta+Left` repeatedly and briskly (roughly one press every 400-600ms) for several
seconds, staying inside `minimapAutoHideMs` between presses so the overlay never hides mid-shot.
**IN:** the first press. **OUT:** two presses before you stop (leave the auto-hide fade-out just outside the cut,
or include it deliberately if you want the GIF to show the hide behavior too — your call).
**Target length:** 6-10s.

### Scene J — `focus-flash.gif`

**Setup:** two columns is enough — frame the shot tighter than the others (crop to just the two windows in the
`ffmpeg` step) so the glow reads clearly at GIF size. Any two adjacent columns from the existing strip work.
**Action:** `Meta+Right`, pause a beat for the flash to fully fade, `Meta+Left`, pause again. Repeat once more.
**IN:** just before the first `Meta+Right`. **OUT:** just after the second flash finishes fading.
**Target length:** 4-6s — this one should be short and tight, it's a single visual effect, not a workflow.

### Scene K — `debug-console.gif`

**Setup:** continue from any prior state, five columns. Enable `debugConsoleEnabled` in the settings dialog's
Debug tab beforehand and restart the script, so the console overlay is already showing when the scene starts.
**Action:** `Meta+Right` a couple of times so the console's live values visibly update.
**IN:** just before the first `Meta+Right`. **OUT:** just after the last value update settles.
**Target length:** 6-8s.

### Scene L — `undock-redock.gif`

**Setup:** continue from prior state. Focus Gwenview.
**Action:** `Meta+Space` (Gwenview undocks, pops out floating-above, the strip closes the gap), drag the now-
floating Gwenview window a short distance aside with the mouse to make the "it's really floating now" visual
obvious, then `Meta+Space` again (redocks next to whatever is currently focused).
**IN:** the first `Meta+Space`. **OUT:** the strip settling after the redock.
**Target length:** 8-10s. This is also a natural closing shot for the main take.

### Scene M — `settings-dialog.gif` (separate recording)

Record this on its own — it's a System Settings window, not the tiled desktop, so it doesn't chain from the
scenes above.
**Setup:** System Settings → Window Management → KWin Scripts → Drift → **Configure...**.
**Action:** the dialog has five tabs — **Layout** (gaps, default width, margins, undock-keep-above),
**Behavior** (Scrolling: animation duration and viewport shift step; Resizing: column-width and window-height
steps; Dragging: drag-dwell timings), **Visual Feedback** (a Minimap group, and a checkable Focus Flash group
whose border/blur/duration/opacity fields gray out when unchecked), **Shortcuts** (an informational label plus
the path to `setup-shortcuts.sh`, not editable), and **Window Rules** (a JSON editor). Open on Layout, drag the
horizontal-gap spinbox up/down once so a visible number changes, switch to Visual Feedback and toggle the Focus
Flash checkbox off/on to show its fields gray out, switch to Shortcuts to show the info label, then close.
**IN:** the dialog finishing its open-animation. **OUT:** just before it closes.
**Target length:** 10-15s.

### Scene N — `multi-monitor.gif` (optional, needs two outputs)

Only attempt this if you have two physical monitors, or can add a virtual/dummy one (System Settings → Display
& Monitor → "Add virtual output", or `kscreen-doctor` if your Plasma version supports it from the CLI). It's the
one scene that can't be convincingly faked with a single screen.
**Setup:** a strip with enough columns to overflow one screen's width, positioned so 1-2 columns sit visibly on
each monitor.
**Action:** focus-cycle (`Meta+Right`/`Meta+Left`) across the boundary between monitors, showing the strip
scrolling continuously from one screen's columns into the other's rather than stopping at the screen edge.
**IN:** the press that crosses the boundary. **OUT:** a couple of presses past it.
**Target length:** 6-8s.

If this one isn't feasible right now, ship without it — `docs/features.md`'s multi-monitor section reads fine
with the placeholder left unfilled a while longer; it's the lowest-priority clip of the set.

## Assembling `hero-demo.gif` (do this last)

The README's hero clip isn't its own scene — it's a ~10-15s highlight reel cut from 1-2 second fragments of the
scenes above, in this order: a couple of seconds of Scene A's column-cycling, the swap moment from Scene C, the
absorb moment from Scene F, a couple of presses from Scene I's minimap, and the undock pop from Scene L. Concatenate
the trimmed fragments with `ffmpeg`'s `concat` demuxer once the individual scene cuts already exist — don't
re-derive it from the raw take, it's much easier to cut a highlight reel out of clips you've already trimmed and
verified than to re-find five separate cue points in the untrimmed recording.

## Cutting scenes out of the raw recording

```sh
# 1. Cut the scene from the raw take (re-encoding, not -c copy, so the cut lands exactly on your cue
#    rather than the nearest keyframe):
ffmpeg -i screencast.mp4 -ss <in> -to <out> scene-x.mp4

# 2. Build a palette for good GIF color quality, then encode using it:
ffmpeg -i scene-x.mp4 -vf "fps=15,scale=720:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i scene-x.mp4 -i palette.png \
    -filter_complex "fps=15,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse" \
    docs/media/<name-from-the-table-below>.gif

# 3. Optional final size trim:
gifsicle -O3 docs/media/<name>.gif -o docs/media/<name>.gif
```

Use `scale=800:-1` instead of `720` only for `hero-demo.gif`, matching the width the README embeds it at (see
[docs/media/README.md](README.md)).

## Scene → file quick reference

| Scene | File | Width |
|---|---|---|
| A | `scrollable-columns.gif` | 720 |
| B | `neighbor-push.gif` | 720 |
| C | `drag-reorder.gif` | 720 |
| D | `align-cycle.gif` | 720 |
| E | `viewport-pan.gif` | 720 |
| F | `vertical-tiling.gif` | 720 |
| G | `drag-to-stack.gif` | 720 |
| H | `strip-navigation.gif` | 720 |
| I | `minimap.gif` | 720 |
| J | `focus-flash.gif` | 720 |
| K | `debug-console.gif` | 720 |
| L | `undock-redock.gif` | 720 |
| M | `settings-dialog.gif` | 720 |
| N | `multi-monitor.gif` | 720 |
| (post) | `hero-demo.gif` | 800 |
