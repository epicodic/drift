# Multi-monitor Reveal Alignment

Date: 2026-09-01

## Problem

Drift's reveal logic runs whenever the focused column changes ([`Strip.revealFocused()`](../../../src/runtime/strip.ts)).
It scrolls the viewport just enough to bring the focused column fully into `[offsetX, offsetX + width]`, via [`Viewport.offsetToReveal()`](../../../src/viewport/viewport.ts).
The viewport's `width` is the combined virtual-screen geometry across every output ([`WorkspaceAdapter.combinedGeometry()`](../../../src/kwin/workspace-adapter.ts)), because one `Strip` covers all screens for a given activity/desktop.
On a single (including ultrawide) monitor this is exactly right: the combined geometry equals the one physical screen.
On a multi-monitor setup, "fully visible in the combined area" is too weak a guarantee — a column can sit fully inside `[offsetX, offsetX + width]` while still being rendered straddling the bezel between two monitors, because nothing in the reveal calculation is aware of individual output boundaries.

## Decision

`revealFocused()` aligns the focused column to be entirely visible within a single physical screen whenever the column is narrow enough to fit in one, choosing whichever screen requires the least additional scroll from the current offset.
When the column is too wide to fit entirely within any single screen, behavior is unchanged: reveal targets the combined area exactly as it does today.

"Least scroll" is measured directly as viewport-offset delta, not as a separate geometric closest-screen heuristic — see Algorithm.
This means a column already fully on one screen never moves (delta 0 always wins), so single-monitor and ultrawide behavior is unchanged whenever the reveal starts from a valid, in-bounds offset.
That guarantee is not unconditional: because per-screen candidates skip the combined-content `clamp()` (see "Empty space" below), a reveal starting from a stale offset left by an unclamped pan (`shiftViewportLeft`/`shiftViewportRight`) can settle on a position `offsetToReveal()` would have re-clamped instead — reachable on a single monitor too, since the sole screen goes through the same per-screen candidate path.

## Algorithm

For each screen, compute the minimal-movement offset that would place `[rectX, rectX + rectWidth]` fully inside that screen's own bounds, using the same clamp-into-view math `offsetToReveal` already uses today, just re-scoped from the combined area to one screen's slice of it.
Only screens with `screen.width >= rectWidth` are eligible — a column can never be fully contained in a narrower screen.
Among eligible screens' candidate offsets, pick the one closest to the current offset (`Math.abs(candidate - offsetX)` minimized).
On an exact tie, the first eligible screen (in `WorkspaceAdapter.screens()` order) wins — ties require an exact equidistant placement, an edge case not worth a dedicated rule.
If no screen is eligible (the column is wider than every screen), fall back to today's `offsetToReveal()` against the combined area, unchanged.

**Empty space.** Per-screen candidates are not run through the combined-content `clamp()` at all — the "never show empty space" rule is dropped for this path entirely, not just relaxed. Each candidate is the exact minimal-movement position that fully contains the window on that screen, full stop, computed once.
This is what makes alignment work even when total window content is narrower than the combined desktop (few windows open) — a case where the combined-content clamp would otherwise pin the offset to a single point and silently prevent alignment from ever firing.
It also means a screen adjacent to the aligned one may show empty desktop background — accepted as normal, expected behavior for a tiling WM with few windows open, not something the algorithm tries to avoid.
This is a deliberate, narrow exception to the clamp: `offsetToReveal()` and the combined-area fallback keep clamping exactly as before, and nothing else in `Viewport` changes.

Implementation shape in [`viewport.ts`](../../../src/viewport/viewport.ts):

```ts
export interface ScreenBounds {
    left: number;  // screen's left edge, in the same coordinate space as offsetX
    width: number;
}

// Existing clamp-into-view logic (lines 80-86 of today's offsetToReveal), factored out
// so it can be reused against an arbitrary view window, not just the full viewport. Always
// returns a viewLeft that fully contains [rectX, rectX + rectWidth] within [viewLeft, viewLeft + viewWidth),
// regardless of how far the starting viewLeft is from doing so already.
private viewLeftToReveal(rectX: number, rectWidth: number, viewLeft: number, viewWidth: number): number {
    const viewRight = viewLeft + viewWidth;
    const rectRight = rectX + rectWidth;
    if (rectX < viewLeft) return rectX;
    if (rectRight > viewRight) return rectRight - viewWidth;
    return viewLeft;
}

offsetToRevealOnScreen(rectX: number, rectWidth: number, screens: ScreenBounds[]): number {
    const candidates = screens
        .filter((s) => rectWidth <= s.width)
        .map((s) => this.viewLeftToReveal(rectX, rectWidth, this.offsetX + s.left, s.width) - s.left);
    if (candidates.length === 0) {
        return this.offsetToReveal(rectX, rectWidth);
    }
    return candidates.reduce((best, c) => (Math.abs(c - this.offsetX) < Math.abs(best - this.offsetX) ? c : best));
}
```

`offsetToReveal()` itself is left completely unchanged — its "already visible" branch deliberately returns the current offset **unclamped** (an existing, intentional behavior an existing test depends on), which a shared clamped helper would silently break. `viewLeftToReveal()` is a new, separate private helper used only by `offsetToRevealOnScreen()`'s per-screen candidates.

`revealColumn()`/`revealFocused()` call `offsetToRevealOnScreen()` instead of `offsetToReveal()`.

## Data flow

[`Strip`](../../../src/runtime/strip.ts) already holds a `WorkspaceAdapter` reference (used today by `isFullScreenGeometry`), and `WorkspaceAdapter.screens()` already exists but is unused.
`revealFocused()` calls `this.workspaceAdapter.screens()`, converts each screen's absolute geometry into the viewport's coordinate space (`left = geometry.x - this.area.x`, `width = geometry.width` — mirroring the same `area.x` subtraction [`GeometrySync.toRealRect`](../../../src/kwin/geometry-sync.ts) already does in the other direction), and passes the resulting `ScreenBounds[]` into `viewport.offsetToRevealOnScreen()`.

Screens are read fresh on every `revealFocused()` call, not cached — consistent with how `isFullScreenGeometry` already re-reads live workspace state on every call.
No changes are needed to `controller.ts`, `strip-manager.ts`, or any constructor signature — `Strip` already has everything it needs.

## Non-goals

- No vertical/2-D reveal. Drift's layout is horizontal-only (columns already span the strip's full height regardless of monitor arrangement); this feature only reasons about screens' horizontal (`x`, `width`) extents.
- No live re-render on monitor hot-plug beyond what already happens today — `screensChanged` wiring is out of scope; screens are simply read fresh each time reveal runs.
- No change to `cycleAlign`, `shiftViewport`, or drag-reorder — only `revealFocused`'s target calculation changes.

## Testing

`offsetToRevealOnScreen` is a pure function on `Viewport`, tested the same way as today's `offsetToReveal` in [`viewport.test.ts`](../../../src/viewport/viewport.test.ts): synthetic `ScreenBounds[]`, no KWin involved.
Cases to cover:
- Column already fully on one screen: delta 0, no movement.
- Column straddling a bezel with plenty of content on both sides: snaps to whichever screen needs less movement.
- Column straddling a bezel with content narrower than the combined desktop (few windows open): alignment still fires, accepting empty space at the far outer edge rather than being pinned by the combined-content clamp.
- Column wider than every screen: falls back to combined-area `offsetToReveal`, matching existing oversized-column tests.
- Column exactly matching one screen's width.
- Single full-width screen with a stale offset (e.g. left over from an unclamped `shiftViewport` pan): unlike `offsetToReveal`, this deliberately does *not* re-clamp — it targets the exact minimal-movement position even if that leaves part of the screen showing empty desktop space, documenting the accepted behavior difference from the combined-area path.

`WorkspaceAdapter.screens()` itself stays untested, consistent with `WorkspaceAdapter` being untestable without a live compositor — only the new consumption of its output is unit-tested.
