# Multi-monitor align-cycle

Date: 2026-09-01

## Problem

`Meta+Left`/`Meta+Right` (`Strip.cycleAlignLeft`/`cycleAlignRight`) cycle the focused column through left-aligned, centered, right-aligned positions of the viewport.
The viewport's width is the *combined* geometry across every output ([`WorkspaceAdapter.combinedGeometry()`](../../../src/kwin/workspace-adapter.ts)), because one [`Strip`](../../../src/runtime/strip.ts) covers all screens for a given activity/desktop.
This was designed for a single (including ultrawide) monitor, where the combined geometry equals the one physical screen.
On a multi-monitor setup it means the three positions are relative to the whole monitor arrangement, not to whichever physical screen the column is actually on — not what a multi-monitor user wants from "align left/center/right".

[`revealFocused()`](../../../src/runtime/strip.ts) already solved the analogous problem for auto-scroll-into-view
(`docs/agents/specs/2026-09-01-multimonitor-reveal-design.md`), which explicitly listed `cycleAlign` as a non-goal at the time.
This spec is that follow-up.

## Decisions (confirmed with user)

- Align-cycle becomes per-screen: left/center/right are relative to whichever physical screen the focused column is on, not the combined desktop.
- At the edge of a screen (already right-aligned with no further press possible on that screen, or already left-aligned), a further press in the same direction moves the column onto the neighboring physical screen, landing at that screen's entering edge — the left edge when crossing rightward, the right edge when crossing leftward.
- At the outermost screen (no neighbor in that direction), a further press **wraps around** to the opposite end of the monitor arrangement (last screen's right edge ↔ first screen's left edge).
- If the column doesn't fit on the screen it would cross onto, the press is a **no-op** — it does not skip further to find a screen that does fit, and does not fall back to whole-desktop alignment for that press.
- If the column doesn't fit on *any* single screen, behavior is unchanged from today: cycle against the combined desktop area, exactly as before this change (mirrors `revealFocused`'s existing fallback).
- Single-monitor (including ultrawide) behavior is unchanged: the one screen's bounds equal the combined area, so the per-screen and whole-desktop cycles compute identically, and wraparound with only one screen is a no-op (see Algorithm).
- No stored "which screen is this column on" state — mirrors the existing align-cycle design's rejection of stored phase state: everything is derived from the focused column's current rect and the viewport's current offset, so it self-corrects if anything else (drag, resize, monitor hotplug) moved things between presses.

## Algorithm

### Screen bounds

Reuse exactly the conversion `revealFocused()` already does — `WorkspaceAdapter.screens()` mapped into strip-relative coordinates (`left = screen.geometry.x - area.x`, `width = screen.geometry.width`) — factored into a shared `Strip.screenBounds()` used by both `revealFocused()` and `cycleAlign()`. Sorted ascending by `left` (physical left-to-right order), which `revealFocused()` doesn't currently need but `cycleAlign()`'s crossing step does, for the notion of "the neighboring screen".

### Per-screen `alignOffsets`

Generalize the existing pure function from a bare `viewportWidth` to a `screen: {left, width}`:

```ts
export interface ScreenBounds {
    left: number;
    width: number;
}

export function alignOffsets(rectX: number, rectWidth: number, screen: ScreenBounds): AlignOffsets {
    return {
        left: rectX - screen.left,
        center: rectX + rectWidth / 2 - screen.left - screen.width / 2,
        right: rectX + rectWidth - screen.left - screen.width,
    };
}
```

`screen = {left: 0, width: viewportWidth}` reproduces today's formula exactly — the whole-desktop fallback path (below) is just this function called with that one screen.

### Picking the current screen

New pure helper, `currentScreenIndex(rectX, rectWidth, currentOffset, screens)`: among screens the column actually fits on (`rectWidth <= screen.width`), pick whichever has an align candidate (`left`/`center`/`right`) closest to `currentOffset` — same "least movement wins" idea `offsetToRevealOnScreen` already uses for reveal. An exact match (the common case: the column is already sitting flush against one of its own three candidate positions from a previous press) always wins over a merely-nearby one. Returns `null` if the column fits no screen at all.

```ts
export function currentScreenIndex(
    rectX: number,
    rectWidth: number,
    currentOffset: number,
    screens: ScreenBounds[],
): number | null {
    let best: number | null = null;
    let bestDistance = Infinity;
    screens.forEach((screen, index) => {
        if (rectWidth > screen.width) {
            return;
        }
        const offsets = alignOffsets(rectX, rectWidth, screen);
        const distance = Math.min(
            Math.abs(currentOffset - offsets.left),
            Math.abs(currentOffset - offsets.center),
            Math.abs(currentOffset - offsets.right),
        );
        if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    });
    return best;
}
```

### Crossing to the neighboring screen

`nextAlignStep` (unchanged) already signals "nothing more to do on this screen" the same way it signals the pre-existing degenerate case (column already fits the screen exactly, no room to cycle at all): its returned `targetOffset` equals the current offset. `cycleAlign` treats that as the trigger to attempt crossing. New pure helper:

```ts
export function adjacentScreenIndex(
    direction: AlignDirection,
    currentIndex: number,
    rectWidth: number,
    screens: ScreenBounds[],
): number | null {
    if (screens.length <= 1) {
        return null;
    }
    const delta = direction === 'left' ? -1 : 1;
    const targetIndex = (currentIndex + delta + screens.length) % screens.length;
    if (targetIndex === currentIndex) {
        return null; // only reachable with 1 screen, already excluded above; kept as a safety net
    }
    if (rectWidth > screens[targetIndex].width) {
        return null;
    }
    return targetIndex;
}
```

Wraparound falls straight out of the modulo — no separate "at the edge of the whole arrangement" check needed. A single-screen setup returns `null` unconditionally, so crossing never fires there (correctly: there's no other screen to land on, wraparound-to-self would otherwise incorrectly bounce the column between its own left/right edges instead of staying a true no-op).

When crossing succeeds, the target offset is the neighbor's *entering* edge: `alignOffsets(rectX, rectWidth, screens[targetIndex]).left` when crossing rightward, `.right` when crossing leftward — directly matching "starts at the left edge" from the decisions above.

### Orchestration — `Strip.cycleAlign`

```ts
private cycleAlign(direction: AlignDirection): void {
    const focused = this.grid.focusedColumn();
    if (focused === null || focused.hidden) {
        return; // unchanged guard
    }
    const rect = this.grid.columnRect(focused.id);
    const screens = this.screenBounds();
    const offset = this.viewport.offset();

    const screenIndex = currentScreenIndex(rect.x, rect.width, offset, screens);
    const screen = screenIndex === null ? { left: 0, width: this.viewport.viewportWidth() } : screens[screenIndex];
    const offsets = alignOffsets(rect.x, rect.width, screen);
    const step = nextAlignStep(direction, offset, offsets);

    if (screenIndex !== null && Math.round(step.targetOffset) === Math.round(offset)) {
        const targetIndex = adjacentScreenIndex(direction, screenIndex, rect.width, screens);
        if (targetIndex === null) {
            return; // no-op: no fitting neighbor in this direction
        }
        const targetOffsets = alignOffsets(rect.x, rect.width, screens[targetIndex]);
        const targetOffset = direction === 'left' ? targetOffsets.right : targetOffsets.left;
        this.animator.animate(offset, targetOffset, this.settings.animationDurationMs);
        return;
    }
    this.animator.animate(offset, step.targetOffset, this.settings.animationDurationMs);
}
```

`screenIndex === null` (column fits no screen) takes the existing whole-desktop path unconditionally — crossing is never attempted there, matching "no per-screen alignment possible at all" from the decisions above.

## Data flow

No new fields, no new constructor parameters. `Strip` already holds the `WorkspaceAdapter` reference `revealFocused()` uses. `screenBounds()` is a new private method both `revealFocused()` and `cycleAlign()` call, replacing `revealFocused()`'s inline `.map()` with the shared (now also sorted) version — sorting is a no-op for `revealFocused()`'s own least-movement search, so this is a pure dedup with no behavior change there.

`columnAlignOffsets` (the current private helper wrapping `alignOffsets(rect.x, rect.width, this.viewport.viewportWidth())`) is removed; its one call site is subsumed by the orchestration above.

## Non-goals

- No change to `shiftViewportLeft`/`shiftViewportRight`, `revealFocused`'s own targeting logic (beyond the `screenBounds()` dedup), or drag-reorder.
- No live re-render on monitor hot-plug beyond what already happens today — screens are read fresh on every `cycleAlign()` call, same as `revealFocused()`.
- No change to what counts as "the column's own screen" outside of align-cycle (e.g. minimap, reveal) — this is purely about where `Meta+Left/Right` targets.

## Testing

Pure logic in `align-cycle.test.ts` (no KWin, synthetic `ScreenBounds[]`):
- `alignOffsets` against a non-zero-`left` screen (generalizes the existing viewport-width cases).
- `currentScreenIndex`: exact match on one of several screens' candidates; nearest-by-distance when the column isn't flush anywhere yet; `null` when the column fits no screen; ties break toward the first eligible screen in the given order.
- `adjacentScreenIndex`: normal neighbor in both directions; wraparound at each end; `null` on a single-screen list; `null` when the neighbor is too narrow to fit the column.

Integration in `strip.test.ts`'s existing `cycleAlignLeft / cycleAlignRight` describe block, adding a multi-monitor variant (two/three synthetic screens via `fakeWorkspaceAdapter(screens)`, following the pattern already used by the `revealFocused multi-monitor alignment` block):
- Cycling left/center/right stays within the column's current screen when there's room.
- A further press at a screen's own edge crosses to the neighbor's entering edge (both directions).
- Wraparound at the outermost screen in both directions.
- Crossing is a no-op when the neighbor is narrower than the column.
- Existing (no-screens-configured) `cycleAlignLeft/Right` tests are unaffected — they exercise the `screenIndex === null` whole-desktop path, unchanged from today.
