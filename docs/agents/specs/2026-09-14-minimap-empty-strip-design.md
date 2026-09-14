# Minimap overlay on empty strips — design

## Purpose

`focusAndShowMinimap` in [`src/runtime/controller.ts`](../../../drift/src/runtime/controller.ts) currently suppresses the minimap overlay whenever the active strip has no focused tile — which is always true for a strip with no windows in it.
This means navigating onto an empty strip (e.g. via `Meta+Page_Up`/`Meta+Page_Down`, `stripUp`/`stripDown`) shows nothing at all, even though the rest of the stack may have windows in other strips.
The guard was an intentional part of [2026-09-02-multi-strip-minimap-design.md](2026-09-02-multi-strip-minimap-design.md) ("skip showing the overlay when the active strip has no windows at all"), but it hides useful information: where the current (empty) viewport sits relative to the rest of the stack.

## Requirements

- The minimap overlay shows for every navigation/movement action routed through `focusAndShowMinimap`, regardless of whether the active strip — or the whole stack — currently has any windows.
- No other behavior changes. `panelLayout`/`toPanelStrips`/`toPanelViewportBox` in [`src/kwin/minimap-overlay.ts`](../../../drift/src/kwin/minimap-overlay.ts) already render an empty active strip correctly: `StripStack.pruneIfEmpty` never prunes the active strip, so it's already present in `minimapSnapshot()`'s output and already gets its own blank slot in the vertical layout — this is a suppression bug at the call site, not a rendering gap.

## Architecture

### `src/runtime/controller.ts`

`focusAndShowMinimap` drops its guard entirely:

```ts
private focusAndShowMinimap(move: (stack: StripStack) => void): void {
    const stack = this.stripManager.activeStripStack();
    move(stack);
    const snapshot = stack.minimapSnapshot();
    this.minimapOverlay.show(snapshot, this.workspaceAdapter.screenGeometryAtCursor());
}
```

The `activeStrip`/`.some(...)` lookup and early return are deleted; `snapshot` is no longer inspected before being passed to `show()`.

## Testing

No existing test exercises this guard — there is no `controller.test.ts`, and `focusAndShowMinimap` is not referenced anywhere outside `controller.ts` itself. The change is a deletion with no new test surface to cover: `minimap-overlay.ts` stays untested by design (see [2026-09-01-minimap-design.md](2026-09-01-minimap-design.md)), and the underlying rendering behavior for empty strips is already exercised by `panelLayout`/`toPanelStrips` wherever they're currently tested.

## Explicitly out of scope

- Any change to how empty strips are rendered inside the panel (columns, spacing, scale) — already correct.
- Any change to which actions are wrapped by `focusAndShowMinimap`.
- Distinguishing a totally windowless stack from an empty-active-strip-within-a-populated-stack — both now show the overlay uniformly (confirmed as the desired behavior).
