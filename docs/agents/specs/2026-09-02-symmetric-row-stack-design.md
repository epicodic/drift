# Symmetric Row Stack

## Problem

[Row navigation](2026-09-01-row-navigation-design.md) added a vertical stack of rows (`StripStack`), but made row `0` a fixed floor: `rowUp()` and `moveWindowToRowAbove()` both no-op there, and `pruneIfEmpty()` hard-codes row `0` as permanent.
The horizontal axis has no such limit — columns extend left/right from a strip without bound.
That asymmetry means a user can build an unbounded stack downward but never insert a row above wherever they started, which is a workspace-shape restriction Drift doesn't need: `StripStack.rows` is already a sparse `Map<number, Strip>`, not a fixed-size array, and the vertical layout math (`restingOffset = cameraY - rowIndex * area.height` in `restingOffset()`, feeding `toRealRect`) is already relative to whichever row is active, not to index `0` specifically.

## Decision

Remove the three places that special-case row `0`, making the stack symmetric in both directions:

- `rowUp()` (`strip-stack.ts:120-125`): drop the `activeRowIndex === 0` guard. Paging up at row `0` pages into row `-1`, lazily created exactly as `rowDown()` already creates rows below.
- `moveFocusedWindowToRow()` (`strip-stack.ts:213-219`): drop the `targetIndex < 0` guard. This is the shared machinery behind `moveWindowToRowAbove()` and the mouse edge-dwell drag-to-row flip (`onEdgeDwellFired`), so removing it fixes both keyboard and drag symmetrically in one place.
- `pruneIfEmpty()` (`strip-stack.ts:310-313`): drop the `index === 0` special case, leaving only `index === this.activeRowIndex`. Row `0` becomes prunable like any other row once empty and inactive.

No other file needs to change. Geometry (`geometry-sync.ts`, `toRealRect`), `StripManager`, `Strip`, and the minimap all address rows only through whatever index `StripStack` hands them; none assume `0` is the topmost or a fixed anchor. There is no persisted row-index state to migrate.

## Row `0` Is No Longer Special

Today row `0` is created eagerly in the constructor and is the only row that's never pruned, acting as a permanent "home." Once pruning drops that special case, row `0` becomes an ordinary row: created eagerly (as the stack's starting position) but prunable like any other once empty and inactive.

This is safe because `pruneIfEmpty()`'s other guard — never prune the currently-active row — already guarantees the stack can't go fully empty. If a user navigates away from an empty row `0`, it's pruned; navigating back to index `0` recreates it fresh via `row()`'s existing lazy-creation path, identical to how row `1`, `2`, etc. already behave. No new failure mode is introduced; this only extends an existing, already-tested behavior to one more index.

## Out of Scope

- Any bound on how far up or down the stack can grow — none exists today for "down," and none is being added for "up." Both directions stay unbounded.
- Minimap or other UI indication of row position — unaffected, as noted in the original row-navigation design's Out of Scope.
- Persisting row assignment across restart — unaffected; still not implemented, same as before.

## Testing

- `rowUp is a no-op at row 0` → rewritten to assert paging into row `-1`.
- `moveWindowToRowAbove is a no-op at row 0` → rewritten to assert the window moves into row `-1`.
- New: row `0` is pruned once empty and inactive, then recreated fresh on return, mirroring existing row `1`+ prune/recreate coverage.
- New: `rowUp`/`rowDown` and `moveWindowToRowAbove`/`Below` crossing zero into negative indices and back, symmetric with existing positive-index coverage.
