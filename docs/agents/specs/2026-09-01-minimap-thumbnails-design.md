# Minimap live window-content thumbnails — design

Addendum to [`2026-09-01-minimap-design.md`](2026-09-01-minimap-design.md).
That spec drew each column as a flat-colored rectangle with the window's icon centered inside.
This adds a live preview of the window's actual on-screen content to each rectangle, sourced from the compositor.

## Purpose

Icons alone don't distinguish two windows of the same app (e.g. two terminal tabs, two browser windows).
A live content preview makes the minimap identify columns the way a real taskbar/alt-tab preview does.

## Feasibility

KWin registers `WindowThumbnailItem` (QML type `WindowThumbnail`, `import org.kde.kwin 3.0`) on the same `QQmlEngine`
that runs `declarativescript` packages — the package type this addon already is (`KWin/Script`, see
[`package/metadata.json`](../../../package/metadata.json)).
No effect or window-switcher package is required.
The item takes a `client` property (a `KWin::Window*`) and renders the compositor's live GPU texture for that window,
updated frame-by-frame.
Source: `src/scripting/scripting.cpp` and `src/scripting/windowthumbnailitem.h` in the KWin 6 tree
(`KWin::Scripting::init()` registers the type on `m_qmlEngine`, the engine shared by `DeclarativeScript` instances).

## Privacy

A live preview can reveal on-screen content (message text, form fields) whenever `Meta+Tab` is pressed, including
during screen shares/recordings.
This is gated by a setting, default on (see [Settings](#settings)).

## Behavior

- Every column's rectangle shows a live preview of that window's content, layered under the existing focus-highlight
  border/color.
- The window's icon remains visible, but shrinks to a small badge anchored to the rectangle's bottom-right corner
  (instead of centered) so identity stays legible even if the preview is blank or hard to read.
- Previews are true-aspect-ratio crops, never stretched — see [Sizing](#sizing-no-distortion).
- Governed by `minimapShowThumbnails` (default `true`); when `false`, rendering is unchanged from the original spec
  (centered icon only, no `WindowThumbnail`).

## Sizing: no distortion

Every window in Drift's grid spans the same real height — `Grid` uses one constant `height` for every column's rect
(`columnRect(offset, column.width, this.height)`, [`src/core/grid.ts:122`](../../../src/core/grid.ts#L122)).
So a column's true aspect ratio is `columnWidth : gridHeight`, with `gridHeight` constant across the whole strip.

The minimap panel is a fixed, compact OSD strip (`PANEL_WIDTH` × `PANEL_HEIGHT`, currently 900×90) — intentionally not
sized to real window height (`2026-09-01-minimap-design.md` explicitly rules out "a persistent HUD").
`panelScale()` already scales column width to fit `PANEL_WIDTH`; height is a separate fixed constant, so a live
texture stretched with `anchors.fill: parent` into a rectangle would visibly distort (the two axes use unrelated
scale factors).

Fix: apply the *same* width scale factor to `gridHeight` to get the column's true rendered height at that scale, then
clip it to the fixed `PANEL_HEIGHT` band instead of stretching:

```
trueHeight = scale × gridHeight   // scale from panelScale(), same one used for column x/width
```

Each `WindowThumbnail` is sized `width: <column's scaled width>, height: trueHeight`, vertically centered within its
column `Rectangle`, which has `clip: true`.
Since `trueHeight` is normally taller than `PANEL_HEIGHT` (a real screen is much taller than a 90px strip), this
center-crops vertically — full window width shown, a vertical center slice of the content, no squish.

## Architecture

### `src/core/grid.ts`

`Grid` gains a `screenHeight(): number` getter returning the existing private `height` field — the only architecture
change to `core`, needed because `buildMinimapSnapshot` currently has no way to read this constant (every other
consumer reads it indirectly via a column's `Rect.height`, which requires an existing column and is awkward for an
empty grid).

### `src/ui/minimap.ts`

- `MinimapColumn` gains `thumbnail: Window | null`, from `registry.get(column.id)?.windowHandle() ?? null`.
- `MinimapSnapshot` gains `gridHeight: number`, from `grid.screenHeight()`.
- `buildMinimapSnapshot` stays settings-unaware — it always includes `thumbnail`/`gridHeight` when available;
  whether to *render* the preview is a `minimap-overlay.ts`/QML decision (see below), keeping the builder's existing
  pure/fully-unit-tested role unchanged.

### `src/kwin/window-adapter.ts`

`WindowAdapter` gains `windowHandle(): Window { return this.window; }`, mirroring the existing `icon()` accessor —
the only way to hand the underlying `Window` object to a `WindowThumbnail`'s `client` property, since `WindowAdapter`
otherwise keeps `this.window` private.

### `src/kwin/minimap-overlay.ts`

- `MINIMAP_QML` adds `import org.kde.kwin 3.0 as KWinComponents`.
- Dialog gains a `showThumbnails: bool` property, set once at construction from `createMinimapOverlay`'s new
  `showThumbnails` parameter (Controller reads `settings.minimapShowThumbnails` and passes it through — same
  construction site as `debugConsole`/`minimapOverlay` today).
- `show()` additionally computes `thumbnailHeight = scale × snapshot.gridHeight` (reusing `panelScale()`) and sets it
  as a dialog property alongside the existing `columns`/`viewportBox` assignment.
- Each column delegate:
  - Rectangle gains `clip: true`.
  - Gains a `KWinComponents.WindowThumbnail { client: modelData.thumbnail; visible: dialog.showThumbnails &&
    modelData.thumbnail !== null; width: parent.width; height: dialog.thumbnailHeight; anchors.verticalCenter:
    parent.verticalCenter }`, layered below the icon.
  - The `Kirigami.Icon` delegate moves from centered to a small corner badge (`anchors { right; bottom; margins: 2
    }`, roughly half its current size), keeping its existing `parent.width > 12` visibility guard.

### `Controller` / `Settings`

- `Settings`/`DEFAULT_SETTINGS`/`loadSettings` ([`src/config/settings.ts`](../../../src/config/settings.ts)) gain
  `minimapShowThumbnails: boolean`, default `true`, following the exact pattern of `animationDurationMs`.
- `Controller` reads it once and passes it to `createMinimapOverlay(parent, autoHideMs, showThumbnails)`.

## Data flow

Unchanged from the original spec's sequence diagram, except `buildMinimapSnapshot` now also carries `gridHeight` and
each column's `thumbnail`, and `Overlay.show()` additionally computes `thumbnailHeight` before repainting.

## Testing

- `src/ui/minimap.test.ts`: extends existing fixtures to assert `MinimapSnapshot.gridHeight` matches
  `grid.screenHeight()` and each `MinimapColumn.thumbnail` matches the corresponding registry entry's
  `windowHandle()`.
- `windowHandle()` and all of `minimap-overlay.ts` remain untestable outside a live compositor, as in the original
  spec.
- Per the original spec's own caution about `IconItem` bindings: verifying `WindowThumbnail.client` actually renders
  live content in this session is the first implementation step, before wiring the rest — if it doesn't render as
  expected, the fallback is shipping icon-badge-only (i.e. `minimapShowThumbnails` has no visible effect) rather than
  blocking the whole feature.

## Explicitly out of scope

- Any UI for toggling `minimapShowThumbnails` beyond the existing `kwinrc`-override settings mechanism (no new KCM
  control).
- Horizontal cropping or letterboxing — only vertical center-crop is needed, since column width already matches the
  window's real proportional width.
- Static/cached fallback thumbnails for windows that don't render live content (e.g. a captured last-good-frame) —
  if `WindowThumbnail` renders blank for a given window, the icon badge is the only fallback.
