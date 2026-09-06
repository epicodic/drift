# Manual undock/redock — design

## Purpose

Let the user pull a single window out of its strip into normal, free-floating KWin behavior, and put it back later, via one keyboard shortcut.
This is the "toggle floating" action already named as a target in `docs/comparison-keybindings.md` (`Meta+Space`) and the roadmap's "Undock/redock" item.
It is deliberately scoped to *manual, per-window* toggling only — automatic float-by-window-class ("Window rules", also on the roadmap) is a separate, later design that this one lays groundwork for, but does not implement.

## Behavior

- One shortcut, `Meta+Space` by default, toggles floating for **the currently active KWin window** — not "the focused column of the active strip". Once a window is undocked it has no column, so the action must resolve its target the same way `WindowManager.activateWindow` already does (via `Workspace.activeWindow`), not through `StripStack`.
- **Undock** (currently docked → floating): the window is removed from its strip exactly as if it had been closed — same gap-fill, re-render, and reveal-focused behavior `Strip.removeWindow` already provides for a real close. `keepAbove` is then set to `true` on the window, if `undockKeepAbove` is enabled (default `true`), so it stays visually on top of the still-tiled windows, per the project's own long-standing intent (`docs/archive/requirements-and-architecture.md` #9).
- **Redock** (currently floating → docked): the window is re-added to whichever strip its *current* activity/desktop assignment resolves to, using the exact same path a brand-new window takes (`WindowManager`'s existing `singleAssignment()` → `StripManager.addTo()` → `Strip.addWindow()`). It lands next to the currently-focused column and becomes focused, like any newly-opened window. `keepAbove` is cleared (set back to `false`) if it was set.
- Redock does **not** attempt to restore the column position/index the window had before it was undocked. There is no "remembered position" state anywhere in this design — undocking and redocking a window is symmetric with closing and reopening one, by design (see [Rejected alternatives](#rejected-alternatives)).
- Toggling on a window Drift doesn't manage — not currently docked to any strip, and not previously undocked by this feature — is a no-op (e.g. dialogs, the debug console/minimap/focus-flash overlay windows, or `Workspace.activeWindow === null`).
- If the window's activity/desktop assignment changes while it is floating (either by the user dragging it to another activity, or any other means), Drift does not react to that — it stays floating; it only gets (re-)evaluated against its current assignment the next time the user explicitly redocks it.
- A real window close while floating is treated exactly like a real close of any docked window: cleanup, no special-casing.

## Architecture

### `src/types/kwin.d.ts`

`Window` gains one new writable field, mirroring the existing `skipTaskbar: boolean`:

```ts
keepAbove: boolean;
```

### `src/kwin/window-adapter.ts`

New method, next to `setSkipTaskbar`:

```ts
/** Sets whether the window stays above other (non-keepAbove) windows — used while a window
 * is undocked, so it stays visible above the still-tiled windows behind it (docs:
 * 2026-09-06-manual-undock-redock-design). */
setKeepAbove(keepAbove: boolean): void {
    this.window.keepAbove = keepAbove;
}
```

### `src/runtime/window-manager.ts`

Gains one new piece of state and one new public method:

```ts
private readonly undocked = new Set<string>();

toggleFloating(win: WindowAdapter | null): void {
    if (win === null) {
        return;
    }
    if (this.undocked.has(win.id)) {
        this.undocked.delete(win.id);
        win.setKeepAbove(false);
        this.place(win);
        return;
    }
    if (this.stripManager.ownerOf(win.id) === null) {
        return; // not Drift-managed at all — no-op
    }
    this.stripManager.remove(win);
    this.undocked.add(win.id);
    if (this.settings.undockKeepAbove) {
        win.setKeepAbove(true);
    }
}
```

- `removeWindow()` (the real-close path) additionally does `this.undocked.delete(win.id)`, so a window closed while floating doesn't leak an entry.
- `reassign()` gains a guard at its top: `if (this.undocked.has(win.id)) return;` — an activity/desktop change on a floating window must not silently re-dock it into a different strip.
- `WindowManager`'s constructor takes `settings: Settings` as an additional parameter (it currently only takes `stripManager`), so `toggleFloating` can read `undockKeepAbove`.

### `Controller` wiring

```ts
this.windowManager = new WindowManager(this.stripManager, settings);
// ...
registerShortcuts(this.root, this.settings, {
    // ...
    toggleFloating: () => this.windowManager.toggleFloating(this.workspaceAdapter.activeWindow()),
});
```

No `focusAndShowMinimap` wrapping — unlike the other shortcuts, this one doesn't necessarily end with a strip-relative focus change worth revealing (redock does trigger `Strip`'s own `revealFocused()` internally, same as any `addWindow`; undock triggers the strip's own gap-fill reveal internally too — both already handled inside `Strip`, nothing extra needed at the `Controller` level).

### Settings

`src/config/settings.ts` gains:

```ts
undockKeepAbove: boolean; // in Settings + DEFAULT_SETTINGS (default: true)
shortcutToggleFloating: string; // in Settings + DEFAULT_SETTINGS (default: 'Meta+Space')
```

Loaded in `loadSettings` the same way as `focusFlashEnabled`/`shortcutFocusFirst` (`readBooleanConfig`/`readStringConfig`).

### KConfigXT

- `drift/contents/config/main.xml` gains `<entry name="undockKeepAbove" type="Bool">` (default `true`) and `<entry name="shortcutToggleFloating" type="String">` (default `Meta+Space`).
- `drift/contents/ui/config.ui` gains a `kcfg_undockKeepAbove` checkbox in the existing **Animation** tab's `formLayout_animation` (row 11, column 1), the same tab that already holds the other two checkboxes (`kcfg_minimapShowThumbnails`, `kcfg_focusFlashEnabled`) despite not being animation-specific either — there is no dedicated "behavior" tab today. `shortcutToggleFloating` needs no `config.ui` widget: no shortcut has one today (the **Shortcuts** tab is just a static label pointing at System Settings), so this one follows the same precedent.

### `src/input/shortcuts.ts`

`ShortcutActions` gains `toggleFloating(): void`; `registerShortcuts` gains one more `createShortcut(...)` call, following the existing pattern exactly (`'DriftToggleFloating'`, `'Drift: Toggle Floating'`, `settings.shortcutToggleFloating`, `actions.toggleFloating`).

## Data flow

```mermaid
sequenceDiagram
    participant User
    participant WA as kwin/WorkspaceAdapter
    participant WM as runtime/WindowManager
    participant SM as runtime/StripManager
    participant Strip as runtime/Strip

    User->>WA: Meta+Space
    WA-->>WM: activeWindow()
    alt window is in `undocked` set
        WM->>WM: undocked.delete(id); win.setKeepAbove(false)
        WM->>SM: addTo(activity, desktop, win)  (via singleAssignment())
        SM->>Strip: addWindow(win)
    else window is owned by a strip (SM.ownerOf(id) != null)
        WM->>SM: remove(win)
        SM->>Strip: removeWindow(win)
        WM->>WM: undocked.add(id); win.setKeepAbove(true) if undockKeepAbove
    else
        WM-->>WM: no-op (not Drift-managed)
    end
```

## Testing

- `src/runtime/window-manager.test.ts`: `toggleFloating` — dock→undock (calls `stripManager.remove`, sets `keepAbove` per `undockKeepAbove`, adds to internal set), undock→dock (calls `stripManager.addTo` via `singleAssignment()`, clears `keepAbove`, removes from internal set, lands next to focus like a new window), no-op on `null` and on a window with no strip owner, `removeWindow` clearing a leftover `undocked` entry, `reassign` no-op while a window is in the `undocked` set.
- `src/kwin/window-adapter.test.ts`: `setKeepAbove` writes `keepAbove` on the underlying window, mirroring the existing `setSkipTaskbar` test.
- `src/config/settings.test.ts`: `loadSettings` round-trip for `undockKeepAbove`/`shortcutToggleFloating`, following the existing pattern.
- No test for the `registerShortcuts`/`createShortcut` wiring itself — there is no `shortcuts.test.ts` today; `createShortcut` is KWin/QML glue (`Qt.createQmlObject`), untestable without a live compositor, same as `focus-flash-overlay.ts`/`minimap-overlay.ts`.
- No changes needed to `strip.test.ts`, `grid.test.ts`, or `column-registry.test.ts` — undock/redock reuse `removeWindow`/`addWindow` exactly as they exist today; this design adds no new `Strip`/`Grid`/`ColumnRegistry` behavior.

## Rejected alternatives

- **Using `keepAbove` itself as the floating/docked signal** (i.e. no internal `undocked` set; "is floating" := "is `keepAbove` true"). Rejected: conflates two orthogonal concerns (always-on-top z-order vs. tiling membership), can be flipped involuntarily by an app or by the user via the window's own titlebar menu with no relation to Drift, and Karousel — the closest prior art in this repository — deliberately does not do this either (it tracks floating as its own `ClientState`, applying `keepAbove` only as a config-gated cosmetic side effect).
- **Remembering the exact column/index a window was undocked from, to restore it on redock.** Rejected for now: adds new state and an invalidation policy (what if that neighbor column closed, or the columns were reordered, while floating?) for a benefit that neither Karousel nor Drift's own existing reinsertion paths (cross-strip moves, reassign) provide today. Redock behaves like opening a new window instead — simpler, and consistent with existing precedent.

## Explicitly out of scope

- Window rules (auto-float specific applications by class/caption on open) — separate, later design; this one's `undocked` set and `toggleFloating` mechanics are meant to be reusable by it, but no window-rule config format or matching logic is defined here.
- Any visual indication (e.g. in the minimap) that a window is currently floating — it simply stops appearing in the strip/minimap, same as any other unmanaged window.
- Debug console / snapshot changes to list currently-floating windows.
