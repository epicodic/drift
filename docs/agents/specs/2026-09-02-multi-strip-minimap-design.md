# Multi-strip minimap overlay — design

## Purpose

Extend the minimap overlay (see [2026-09-01-minimap-design.md](2026-09-01-minimap-design.md)) to show the whole vertical stack of strips at once, not just the active one.
Since [2026-09-01-row-navigation-design.md](2026-09-01-row-navigation-design.md) and [2026-09-02-symmetric-row-stack-design.md](2026-09-02-symmetric-row-stack-design.md) landed, a `StripStack` can hold many independently-scrolling `Strip`s stacked vertically, paged with `Meta+PgUp`/`Meta+PgDown`.
The minimap currently only ever renders `stack.activeStrip()`, so the user has no way to see how rows relate to each other.

## Requirements

- Every currently existing row in the active `StripStack` is drawn, not just the active one.
- All rows share one uniform scale (both axes) — no row is stretched or shrunk relative to another.
- Each row is drawn left-aligned independently: a row's own leftmost column (or, for the active row, its viewport's leftmost extent) starts at the panel's left edge, regardless of any other row's real horizontal offset. Rows are spaced vertically by their real `rowIndex` distance. A pruned/never-created row between two existing rows leaves real blank space rather than being compacted away. (Updated 2026-09-03: relative horizontal offset between rows was previously preserved — see git history — but is no longer drawn.)
- The focused-window blue border is shown only for the truly active window (the active row's focused column) — inactive rows' own remembered focus is not drawn, since it isn't real OS focus.
- The white viewport-position border now also carries a vertical (row) position, so it visibly jumps between rows on `Meta+PgUp`/`Meta+PgDown`, not just left/right within one row.

## Architecture

### `src/ui/minimap.ts`

`buildMinimapSnapshot()` (builds one row's columns + that row's own viewport, from a `Grid`/`Viewport`/`ColumnRegistry`) is unchanged — it remains `Strip`'s own per-row snapshot builder.

New pure aggregation function, added alongside it:

```ts
export interface MinimapRow {
    rowIndex: number;
    columns: MinimapColumn[];
}

/** A stack-level viewport: where the user is actually looking, in both dimensions —
 * which row (`rowIndex`) plus the horizontal scroll/content extent within it. Only the
 * active row ever has a real on-screen viewport, so there is exactly one of these per
 * stack snapshot, not one per row. */
export interface StripStackMinimapViewport {
    rowIndex: number;
    offset: number;
    width: number;
    contentLeft: number;
    contentWidth: number;
}

export interface StripStackMinimapSnapshot {
    rows: MinimapRow[];
    viewport: StripStackMinimapViewport;
    gridHeight: number;
    /** Real-pixel vertical distance between adjacent rows' origins (`StripStack`'s
     * `area.height`) — may exceed `gridHeight` (which excludes `settings.bottomMargin`),
     * leaving a real gap between rows in the rendered map, matching their on-screen look. */
    rowPitch: number;
}

export function combineStripStackSnapshot(
    rows: { rowIndex: number; snapshot: MinimapSnapshot }[],
    activeRowIndex: number,
    rowPitch: number,
): StripStackMinimapSnapshot;
```

- For each entry, copies `snapshot.columns`, forcing `focused: false` on every column when `rowIndex !== activeRowIndex` (a row's own `Grid` always remembers its last-focused column even while inactive — that's not real focus and must not be drawn as such).
- `viewport` comes from the entry whose `rowIndex === activeRowIndex` (its `snapshot.viewport`, plus that `rowIndex`) — the aggregate never carries more than one viewport, since only the active row has a real on-screen camera.
- `gridHeight` also comes from the active entry's `snapshot.gridHeight` (every row shares the same `Grid` height, so any row's value would do).
- Does not fabricate rows for missing/pruned indices — the input `rows` list already only contains what `StripStack` currently holds; gaps are left to whoever renders `rowIndex` positions (see below).

### `src/runtime/strip-stack.ts`

`StripStack.minimapSnapshot()` changes from delegating straight to `activeStrip()` to:

```ts
minimapSnapshot(): StripStackMinimapSnapshot {
    const rows = [...this.rows.entries()]
        .map(([rowIndex, strip]) => ({ rowIndex, snapshot: strip.minimapSnapshot() }))
        .sort((a, b) => a.rowIndex - b.rowIndex);
    return combineStripStackSnapshot(rows, this.activeRowIndex, this.area.height);
}
```

`Strip.minimapSnapshot()` itself is untouched.

### `src/kwin/minimap-overlay.ts`

`MinimapOverlay.show()` now takes a `StripStackMinimapSnapshot` instead of a `MinimapSnapshot`.

`panelLayout()` computes each row's own left edge independently (`rowLefts: Map<rowIndex, number>` — that row's columns' min x, plus the active viewport's own extent for the active row), and gains a vertical pass:

- `minRowIndex`/`maxRowIndex` from `snapshot.rows`.
- `top = minRowIndex * snapshot.rowPitch`, `bottom = maxRowIndex * snapshot.rowPitch + snapshot.gridHeight`.
- `virtualHeight = max(bottom - top, 1)` (replacing today's single-row `gridHeight`).
- `virtualWidth = max` over rows of `(row's right - row's own left)` — the widest row's span, since every row renders left-aligned to its own edge rather than sharing one global left.
- `scale = min(PANEL_WIDTH / virtualWidth, MAX_MINIMAP_HEIGHT / virtualHeight)`, where `MAX_MINIMAP_HEIGHT = 600` (replacing the original single-row `PANEL_MAX_HEIGHT = 250`). A single active row therefore renders close to the original single-row size; more rows grow the panel up to the 600px ceiling, beyond which scale shrinks further to fit — no separate per-row target/clamp needed.
- `toPanelRows()`/`toPanelViewportBox()` subtract each row's own `rowLefts.get(rowIndex)` (not a shared `left`) before scaling, so every row starts at panel x=0.
- A row with no entry in `snapshot.rows` between `minRowIndex` and `maxRowIndex` (pruned or never created) is simply never drawn, leaving real blank vertical space at its `rowIndex * rowPitch` position — gap preservation falls out of this math for free, no special-casing required.

QML changes:

- The single flat `Repeater` over columns becomes a `Repeater` over `dialog.rows`, each delegate an `Item` at `y: modelData.y` containing the existing column `Repeater` (unchanged column delegate — colors, blue focus border, thumbnails, icons all as today) bound to `modelData.columns`.
- The white viewport `Rectangle` gains a `y: dialog.viewportBox.y` binding (computed from `viewport.rowIndex * rowPitch`, scaled the same as everything else) alongside its existing `x`/`width`, so it moves vertically between rows.

### `src/runtime/controller.ts`

`focusAndShowMinimap`'s guard changes from `snapshot.columns.some((c) => c.focused)` to finding the active row and checking within it:

```ts
const activeRow = snapshot.rows.find((row) => row.rowIndex === snapshot.viewport.rowIndex);
if (!activeRow?.columns.some((c) => c.focused)) {
    return;
}
```

(Same intent as today: skip showing the overlay when the active strip has no windows at all.)

## Testing

- `src/ui/minimap.test.ts`: new tests for `combineStripStackSnapshot` — merges multiple rows' columns correctly, suppresses `focused` outside the active row, carries the active row's `viewport` (with its `rowIndex`) and `gridHeight` through untouched, and passes `rowPitch` through unchanged.
- `src/runtime/strip-stack.test.ts`: the existing `'delegates render, focusLeft/Right, cycleAlign, shiftViewport, and minimapSnapshot to the active row'` test's `minimapSnapshot` assertion is rewritten for the new aggregate shape (every current row contributes, not just the active one) — a required change, not purely additive.
- `src/kwin/minimap-overlay.ts` stays untested, consistent with [2026-09-01-minimap-design.md](2026-09-01-minimap-design.md)'s stated approach for that file (untestable without a live compositor, kept thin by design).

## Explicitly out of scope

- Per-row independent viewport indicators — only the active row's real on-screen viewport is ever drawn; inactive rows show their columns but no viewport box.
- Any new keybindings — `Meta+PgUp`/`Meta+PgDown` (`rowUp`/`rowDown`) already call `focusAndShowMinimap`, unchanged.
- Clamping/repositioning the OSD if the combined panel height ever approached a physical screen's height — `MAX_MINIMAP_HEIGHT = 600` already keeps this comfortably within typical screen sizes; not addressed further this iteration.
- Showing every row's own remembered focused column (rejected in favor of active-row-only, see Requirements).
