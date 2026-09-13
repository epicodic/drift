# Popup/dialog pinning to parent window — design

## Purpose

Drift excludes transient windows (dialogs, popups) from tiling entirely (`WindowAdapter.isTileable()`
returns `false` for anything with `window.transient === true`), so they're left to KWin's default
placement and never touched again. That's fine while their parent stays put, but Drift's strip model
moves tiled windows constantly and for reasons that have nothing to do with the user manually
repositioning them — scrolling the strip, a column resize pushing a neighbor, parking a column
off-screen when its strip goes inactive. None of that carries the popup along, so a dialog visibly
detaches from its parent and is left floating over whatever the strip scrolled to next.

Karousel solves this (`_playground/karousel/src/lib/world/ClientWrapper.ts`,
`_playground/karousel/src/lib/world/ClientManager.ts`, `_playground/karousel/src/lib/world/clientState/Tiled.ts`):
it tracks the native `transientFor` parent/child relationship as an in-memory graph and, whenever a
tiled parent's `frameGeometryChanged` fires, replays the same positional delta onto its transient
children, recursively. This design ports that mechanism onto Drift's existing signal wiring.

## Behavior

- A dialog/popup opened from a window Drift is tiling keeps its position relative to that window,
  regardless of why the parent moved: strip scroll, column resize, a neighbor's resize pushing it,
  or the column being parked off-screen when its strip goes inactive.
- Nested transients (a dialog's own dialog) follow too — the delta cascades down the whole chain, not
  just one level.
- A popup the user is actively dragging or resizing themselves is left alone for that gesture; Drift's
  follow-delta doesn't fight the user's own input.
- When a parent's column is parked off-screen (inactive strip), its popups park off-screen right along
  with it via the same delta-follow, and reappear in sync when the column is shown again — no separate
  hide/minimize step.
- A parent that isn't tiled (a floating/undocked window) is unaffected: this only engages for windows
  Drift is actively placing in a column, matching Karousel's tiled-only wiring and leaving ordinary
  floating-window/popup behavior exactly as KWin already handles it.
- Gated behind a new `popupPinningEnabled` setting (default `true`); disabling it fully restores
  today's behavior (popups never touched).

## Architecture

### `src/types/kwin.d.ts`

Add one field to `Window`, next to the existing `transient: boolean`:

```ts
readonly transientFor: Window | null;
```

The real KWin scripting API already exposes this (confirmed by Karousel's own `kwin.ts`, which uses the
same capitalized-`Workspace` declarativescript API family as Drift) — it simply hasn't been declared
here yet because nothing needed it.

### `src/kwin/window-adapter.ts`

Two small accessors on `WindowAdapter`, following the file's existing wrap-a-raw-property pattern:

```ts
isTransient(): boolean {
    return this.window.transient;
}

transientFor(): WindowAdapter | null {
    return this.window.transientFor === null ? null : new WindowAdapter(this.window.transientFor);
}
```

### `src/runtime/transient-links.ts` (new)

A small registry mirroring the parent/child graph Karousel keeps on `ClientWrapper`, but keyed by
window id rather than held as object references, since Drift constructs a fresh `WindowAdapter` per
signal instead of keeping one persistent wrapper per window:

```ts
export class TransientLinks {
    private readonly handles = new Map<string, WindowAdapter>();
    private readonly childrenOf = new Map<string, string[]>();
    private readonly parentOf = new Map<string, string>();

    link(win: WindowAdapter): void {
        if (!win.isTransient()) {
            return;
        }
        const parent = win.transientFor();
        if (parent === null) {
            return;
        }
        this.handles.set(win.id, win);
        this.handles.set(parent.id, parent);
        this.parentOf.set(win.id, parent.id);
        const siblings = this.childrenOf.get(parent.id) ?? [];
        siblings.push(win.id);
        this.childrenOf.set(parent.id, siblings);
    }

    unlink(win: WindowAdapter): void {
        const parentId = this.parentOf.get(win.id);
        if (parentId !== undefined) {
            const siblings = this.childrenOf.get(parentId);
            if (siblings !== undefined) {
                this.childrenOf.set(parentId, siblings.filter((id) => id !== win.id));
            }
            this.parentOf.delete(win.id);
        }
        // Orphan (not reparent) any of its own children, same as Karousel's destroy().
        for (const childId of this.childrenOf.get(win.id) ?? []) {
            this.parentOf.delete(childId);
        }
        this.childrenOf.delete(win.id);
        this.handles.delete(win.id);
    }

    moveChildren(parentId: string, dx: number, dy: number): void {
        for (const childId of this.childrenOf.get(parentId) ?? []) {
            const child = this.handles.get(childId);
            if (child === undefined) {
                continue;
            }
            if (!child.isInteractiveMove() && !child.isInteractiveResize()) {
                const frame = child.frameGeometry();
                child.setFrameGeometry({ x: frame.x + dx, y: frame.y + dy, width: frame.width, height: frame.height });
            }
            this.moveChildren(childId, dx, dy);
        }
    }
}
```

`link`/`unlink` build the graph for *every* transient relationship regardless of whether the parent is
tiled — matching Karousel, and what makes nested-dialog recursion work without needing a signal on the
popup itself: `moveChildren` cascades the same delta down the whole chain in one call, driven entirely
by the top parent's own geometry change.

`moveChildren`'s per-child interactive-move/resize check happens on the child being moved, not the
top-level parent that triggered the walk — a grandchild dialog being dragged by the user is skipped
even if its own parent (itself a popup) is mid-cascade.

### `src/runtime/workspace-signals.ts`

`initWorkspaceSignals` gains a `transientLinks: TransientLinks` parameter and two calls alongside the
existing `windowManager.addWindow`/`removeWindow`:

```ts
workspaceAdapter.onWindowAdded((win) => {
    windowManager.addWindow(win);
    transientLinks.link(win);
});
workspaceAdapter.onWindowRemoved((win) => {
    windowManager.removeWindow(win);
    transientLinks.unlink(win);
});
```

This runs independently of `WindowManager.addWindow`'s own early return for non-tileable windows
(`window-manager.ts:39`) — `TransientLinks` tracks popups `WindowManager` itself never touches.

### `src/runtime/window-events.ts`

`WindowEventDeps` gains one method:

```ts
moveTransients(windowId: string, dx: number, dy: number): void;
```

`onWindowGeometryChanged` computes `dx`/`dy` from `oldReal`/`newReal` and calls it unconditionally,
*before* the existing echo/pure-move early-returns (`window-events.ts:56-65`) — an echoed strip-scroll
move (same size, different position) still needs to drag the popup along, and that's exactly the case
those early-returns otherwise treat as a no-op for Drift's own column-layout purposes:

```ts
export function onWindowGeometryChanged(win: WindowAdapter, oldReal: Rect, deps: WindowEventDeps): void {
    if (win.isFullScreen()) {
        return;
    }
    const columnId = deps.columnOf(win.id);
    if (columnId === null || deps.isHidden(columnId)) {
        return;
    }
    const newReal = win.frameGeometry();
    if (rectsEqualRounded(oldReal, newReal)) {
        return;
    }
    deps.moveTransients(win.id, Math.round(newReal.x - oldReal.x), Math.round(newReal.y - oldReal.y));
    if (deps.isEcho(win.id, newReal)) {
        return;
    }
    // ...unchanged from here
```

`Strip` (the concrete `WindowEventDeps` implementation wired at `strip.ts:435`) implements
`moveTransients` as a thin passthrough to `TransientLinks.moveChildren`. Because the subscription at
`strip.ts:435` only exists for windows currently placed in a column, this naturally reproduces
Karousel's tiled-only wiring (`Tiled.ts`) with no extra gating: a floating/undocked parent was never
subscribed to `onFrameGeometryChanged` through this path in the first place.

The `deps.columnOf(win.id) === null` early-return above it means a parent that's just been undocked
(no longer in a column) stops moving its transients through this path too — consistent with "only
tiled parents are followed."

### Settings (`src/config/settings.ts`, `settings-definitions.ts`)

New boolean, following the existing `dragPanEnabled`/`focusFlashEnabled` pattern:

- `popupPinningEnabled` (`Bool`, default `true`).

`workspace-signals.ts`'s wiring becomes conditional on it: when `false`, `transientLinks.link`/`unlink`
are simply never called (nothing gets registered), so `moveChildren` never has anything to move —
fully inert, same as today, with no separate runtime branch needed in `window-events.ts` itself.

### KConfigXT / KCM

- `drift/contents/config/main.xml`: add a `popupPinningEnabled` `<entry>` next to `dragPanEnabled`.
- `drift/contents/ui/config.ui`: add a `kcfg_popupPinningEnabled` checkbox in the existing behavior tab.

## Edge Cases

- **Parent removed while it has live transient children**: `TransientLinks.unlink` orphans them
  (`parentOf` entry cleared) rather than reparenting to a grandparent — matches Karousel's `destroy()`.
  The now-orphaned popup is left wherever it last was; KWin's own default behavior (typically closing
  alongside a modal parent, or being left as an ordinary floating window otherwise) takes over from
  there, same as it does today for any transient whose parent closes.
- **Popup opened before its parent is known to `TransientLinks`**: not possible in practice —
  `windowAdded` fires for the parent (an existing window) well before any dialog spawned from it can
  exist, and `link` resolves `transientFor` live off the KWin object at the moment the popup itself is
  added.
- **Popup dragged by the user while its parent is mid-scroll**: the per-child interactive-move/resize
  check in `moveChildren` skips that specific child for that tick; siblings/other descendants still
  follow normally.
- **`popupPinningEnabled` toggled at runtime**: only affects windows added after the change — already-
  linked popups from before a toggle-to-`false` keep following until removed/reopened. Acceptable per
  this project's no-back-compat convention for experimental toggles (mirrors `dragPanEnabled`'s
  existing behavior, which has the same characteristic).
- **Rounding drift across many small moves**: each `moveChildren` call uses `Math.round`ed deltas off
  real (already-rounded) geometry, same rounding discipline `onWindowGeometryChanged` already applies
  elsewhere in this file — no new drift source beyond what the rest of the file already tolerates.

## Out of Scope

- No `ensureVisible`/clamp-to-screen behavior for popups pushed toward a screen edge — Karousel has
  this (`ClientWrapper.ensureVisible`/`ensureTransientsVisible`) but it's a separate concern (keeping a
  floating window on-screen at all) from position-following, and Drift has no existing equivalent to
  extend. A future addition if it proves needed in practice.
- No handling for a transient reparented to a *different* window after creation — KWin's `transientFor`
  is treated as fixed for the transient's lifetime, matching Karousel's own assumption (`transientFor`
  is only read once, at `ClientWrapper` construction).
- No special handling for popups of floating (undocked) parents — left to KWin's existing default
  behavior, unchanged by this work.

## Testing

- `src/runtime/transient-links.test.ts` (new): `link`/`unlink` build and tear down the graph correctly;
  `unlink` orphans grandchildren rather than reparenting; `moveChildren` cascades a delta through a
  three-level chain; `moveChildren` skips a child mid-interactive-move/resize but still recurses past
  it to further descendants.
- `src/runtime/window-events.test.ts`: `onWindowGeometryChanged` calls `deps.moveTransients` with the
  correct rounded delta, including for the pure-move case that's otherwise a no-op for the rest of the
  function, and including when `deps.isEcho` would otherwise short-circuit.
- Manual/live testing (KWin scripting has no fixture for real transient windows): open a dialog from a
  tiled app, scroll the strip, resize a neighboring column, and switch to another strip and back —
  confirm the dialog tracks its parent in each case, that dragging the dialog itself isn't fought by
  the follow-logic, and that `popupPinningEnabled: false` reproduces today's detach behavior exactly.
