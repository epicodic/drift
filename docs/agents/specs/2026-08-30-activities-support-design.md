# Activities Support

## Problem

Every window is currently managed by a single global `Grid` inside a single `Strip`.
A window opened on a different Plasma activity is appended to the same grid, so windows from other activities push it to the right.
Layout must be partitioned so windows from different activities (and virtual desktops) never affect each other's positions.

## Decision

Drift maintains one independent `Strip` (hence one `Grid`, `Viewport`, `Animator`, `GeometrySync`, `ColumnRegistry`) per `(activity, virtualDesktop)` pair.
The partition key is the string `` `${activityId}|${desktopId}` ``, mirroring Karousel's `DesktopManager`.
Screen is **not** part of the key: a grid always spans all screens, exactly as today, using the combined screen geometry.
A window is tiled only when it is on **exactly one** activity **and** **exactly one** virtual desktop.
Sticky and multi-assigned windows (`activities === []`, `desktops === []`, or length > 1) are left unmanaged — KWin controls them and Drift never writes their geometry.
This matches Karousel's rule and avoids introducing a floating-window concept that Drift does not have.

## Partition Model

`StripManager` owns `Map<string, Strip>` keyed by `` `${activity}|${desktop}` ``.
`activeStrip()` resolves the strip for the workspace's current `(currentActivity, currentDesktop)`, creating it lazily on first use.
`stripFor(activity, desktop)` returns (creating lazily) the strip for an arbitrary key, used when routing a window that is not on the current activity/desktop.
Each strip keeps its own `Viewport`, so switching back to an activity/desktop restores that grid's previous scroll position.
Background strips are inert: a strip only writes geometry for the windows it owns, so no cross-activity pushing occurs — this is the actual bug fix.

## KWin API Additions

KWin API access stays isolated in the adapter layer; runtime code never touches raw `Window`/`Workspace`.

`types/kwin.d.ts`:

- New `interface KwinDesktop { readonly id: string; readonly name: string; }`.
- `Window`: `readonly activities: string[]` (empty = all activities), `readonly desktops: KwinDesktop[]` (empty = all desktops), and signals `activitiesChanged` and `desktopsChanged: Signal<() => void>`.
- `WorkspaceApi`: `readonly currentActivity: string`, `currentDesktop: KwinDesktop`, `readonly activities: string[]`, `readonly desktops: KwinDesktop[]`, and signals `currentActivityChanged`, `currentDesktopChanged`, `activitiesChanged`, `desktopsChanged`.

`WindowAdapter`:

- `activities(): string[]`, `desktops(): KwinDesktop[]`.
- `singleAssignment(): { activity: string; desktop: string } | null` returning `null` unless the window is on exactly one activity and one desktop.
- `onActivitiesChanged(...)` and `onDesktopsChanged(...)` wrappers, same connect/disconnect shape as `onFrameGeometryChanged`.

`WorkspaceAdapter`:

- `currentActivity(): string`, `currentDesktop(): string` (the desktop id).
- `onCurrentActivityChanged`, `onCurrentDesktopChanged` wrappers, plus `onActivitiesChanged`/`onDesktopsChanged` for lifecycle.

## Routing And Window Lifecycle

`WindowManager` becomes the router, its documented Phase 2 job.

- **addWindow**: if `isTileable()` and `singleAssignment()` returns a key, route to `stripManager.stripFor(activity, desktop)`; if sticky/multi-assigned, leave unmanaged.
- **removeWindow**: look up the owning strip via a reverse index `windowId -> stripKey` in `StripManager` and remove there.
- **activateWindow**: route to the owning strip and focus.
- **reassignment**: when a window's `activitiesChanged` or `desktopsChanged` fires, re-evaluate:
  - was managed, still single-assignment, key changed: move it (remove from old strip, add to new strip);
  - was managed, now sticky/multi: remove from old strip (becomes unmanaged);
  - was unmanaged, now single-assignment: add to the matching strip.

The per-window `activitiesChanged`/`desktopsChanged` subscriptions are registered once when the window is first seen, at the window-manager layer, not inside a single strip — because the window may currently belong to no strip.
Ownership and the reverse index live in `StripManager`; `Strip` stays focused purely on the layout of the windows it is handed.

## Switching And Rendering

`initWorkspaceSignals` adds handlers for `currentActivityChanged` and `currentDesktopChanged`.
On either, `StripManager` recomputes the active key and calls `activeStrip().render()` and `revealFocused()`, so the now-visible grid writes correct geometry.
KWin itself shows and hides windows per activity/desktop; Drift never fights it.
Shortcuts, drag, and the debug snapshot operate on `activeStrip()` only, as they already do.

## Strip Lifecycle And Cleanup

Strips are created lazily via `stripFor` on the first window or first activation of a key.
Strips are destroyed when an activity or desktop is removed (`activitiesChanged`/`desktopsChanged` on the workspace): drop strips whose key references a gone activity or desktop, after disconnecting their signals.
KWin will already have moved or closed those windows, so their `removeWindow` fires normally; the cleanup is defensive.
New strips are constructed with the same `area`, `settings`, `timer`, and `workspaceAdapter` the single strip uses today.

## Testing

- Core `grid`/`column`/`coordinates` tests are unchanged and stay green.
- `StripManager` (new): keying, lazy creation, `activeStrip()` follows the current activity/desktop, reverse-index add/remove, cleanup on activity/desktop removal.
- `WindowManager` (extended): single-assignment routes to the correct strip; sticky/multi stays unmanaged; reassignment moves between strips; unmanaged to single-assignment adds; managed to sticky removes.
- `window-adapter`: `singleAssignment()` truth table across zero/one/many activities and desktops.
- `workspace-adapter`: signal wiring verified with fakes, mirroring existing adapter tests.
- KWin `Window`/`Workspace` fakes are extended with `activities`/`desktops`/current\* fields and their signals.
