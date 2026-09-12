# Drag pan-default with dwell-to-free — design

## Purpose

`2026-09-10-drag-viewport-pan-design.md` added viewport panning as a fifth drag mode, gated by a hard
threshold on cumulative vertical movement (`dyTotal`): panning while `dyTotal` stayed under
`dragPanVerticalTolerancePx`, today's reorder/stack/cross-strip drag once it crossed. Live-testing showed
the threshold itself works as specified, but the resulting feel is bad: an almost-arbitrary amount of
incidental vertical wobble decides, instantaneously and irrecoverably, whether a drag turns into "look
around" or "rearrange my layout" — with no way to choose one mode over the other on purpose.

This replaces the threshold with an explicit gesture, modeled on picking a fruit from a tree: dragging a
window now **defaults to pan**, full stop. To do anything else — reorder, stack, or move to another strip
— the user has to pull the window vertically and hold it there, past a small trigger distance, for a dwell
period. That dwell is a deliberate, discoverable "I mean it" gesture rather than an accident of hand
tremor. Once it fires, the drag is fully in today's normal reorder/stack/cross-strip mode for the rest of
that gesture — a one-way switch, same as the threshold it replaces.

This was prototyped as a throwaway spike directly in `drag.ts` (not committed) before writing this design;
see the Architecture and Edge Cases sections below for what that spike surfaced.

## Behavior

- **Default (pan) mode:** the dragged window's `y` is pinned to its value at drag start (`startY`) —
  visually, the window only ever moves horizontally, regardless of how the pointer moves vertically. Its
  horizontal movement is redirected 1:1 into `Viewport.setOffset`, exactly as today's pan does: the strip
  slides past the window, which stays anchored under the cursor. No reorder, edge-expel, stack, or
  cross-strip-move logic runs at all while in this mode — not merely canceled out by the pan math (see
  Architecture), but never evaluated.
- **Arming the hold:** once cumulative vertical pull (`dyTotal = |raw.y - startY|`) reaches
  `dragPanVerticalTriggerPx`, a hold starts. The hold is canceled — and must re-cross the trigger to start
  again — if cumulative horizontal drift *since the hold started* exceeds `dragPanHorizontalTolerancePx`,
  or if `dyTotal` drops back under the trigger. The tolerance is measured cumulatively from where the hold
  began, not per-tick: a per-tick zero-tolerance was tried in the spike and made the gesture nearly
  impossible to hold steady, since ordinary hand tremor produces nonzero per-tick horizontal deltas
  constantly.
- **Freeing:** holding past `dragPanFreeDwellMs` sets a `freed` flag, true for the rest of that drag. The
  instant it fires, the window is re-seeded to the pointer's actual current position (see Architecture —
  Grab-offset reseed) and pan/pinning stops permanently. From that tick on, today's unmodified
  reorder/edge-expel/stack/cross-strip logic applies exactly as it does without this feature.
- **`dragPanEnabled: false`:** fully inert, same as today — no pinning, no pan, no dwell; dragging behaves
  exactly as it did before either pan design existed (immediate reorder/stack from the first pixel of
  movement).

## Architecture

### `src/utils/dwell-timer.ts` (renamed from `src/viewport/edge-dwell.ts`)

`EdgeDwell<T>` becomes `DwellTimer<T>` and moves out of `viewport/`: it's already used for two purposes
unrelated to viewport edges (cross-column/cross-row stack-target dwell in `drag.ts`'s `createStackDwell`,
and cross-strip screen-edge dwell in `StripStack.updateEdgeWatch`), and this design adds a third
(pan-hold-to-free) with nothing to do with edges either. Pure rename + move; behavior, generic API
(`update`/`stop`/`onFire`), and existing tests carry over unchanged. All three call sites' imports update
accordingly.

This is also the timer used for the new pan-free dwell, via a `createPanFreeDwell` factory on
`DragReorderDeps`, following the same pattern as `createStackDwell` — a real polling `Timer` under the
hood, not a lazily-evaluated timestamp check, so the dwell fires even if the pointer is genuinely
motionless (the spike's ad hoc `Date.now()` check only re-evaluated on the next `frameGeometryChanged`
event, which never comes if nothing is moving at all).

### `src/input/drag-pan.ts`

`dragPanShouldPan` is replaced by a pure predicate for the new hold gesture, mirroring its role (no
KWin/Grid/Viewport dependency):

```ts
/** Whether this tick's cumulative vertical pull and horizontal drift-since-hold-started still
 * qualify as "holding" for the dwell-to-free gesture: true once dyTotal has crossed triggerPx,
 * as long as drift stays within tolerancePx. driftSincePxHoldStart is 0 for the tick that first
 * arms the hold (there's no prior anchor yet to drift from). */
export function dragPanHolding(
    dyTotal: number,
    driftSinceHoldStartPx: number,
    triggerPx: number,
    tolerancePx: number,
): boolean {
    return dyTotal >= triggerPx && Math.abs(driftSinceHoldStartPx) <= tolerancePx;
}
```

### `src/input/drag.ts` (`registerDragReorder`)

Replaces the existing pan step (the `dragPanEnabled`/`dragPanShouldPan` block) with:

```ts
let holdStartX: number | null = null;
let freed = initiallyFreed;
let applyingPin = false; // re-entrancy guard, see below

// ...inside tickInner, before the existing reorder/stack logic:
if (deps.dragPanEnabled && !freed) {
    const raw = win.frameGeometry();
    const dyTotal = Math.abs(raw.y - startY);
    const driftSinceHoldStartPx = holdStartX === null ? 0 : raw.x - holdStartX;
    if (dragPanHolding(dyTotal, driftSinceHoldStartPx, deps.dragPanVerticalTriggerPx, deps.dragPanHorizontalTolerancePx)) {
        holdStartX ??= raw.x;
        panFreeDwell.update(true);
    } else {
        holdStartX = null;
        panFreeDwell.update(null);
    }

    const dxTick = raw.x - lastX;
    if (dxTick !== 0) {
        deps.viewport.setOffset(deps.viewport.offset() - dxTick);
    }
    lastX = raw.x;

    applyingPin = true;
    win.setFrameGeometry({ x: raw.x, y: startY, width: raw.width, height: raw.height });
    applyingPin = false;
    return; // pan mode: reorder/edge-expel/stack never evaluated, not just canceled by the offset math
}
```

Gating on `deps.dragPanEnabled && !freed` together (not `freed` alone) matters: `freed` never becomes `true`
when the feature is disabled (the dwell is never armed in the first place), so gating on `freed` alone would
wrongly keep reorder/stack blocked forever whenever `dragPanEnabled: false` — the opposite of "fully inert."

`panFreeDwell`'s `onFire` callback (built once per connection, like `stackDwell`'s) does the freeing:

```ts
const panFreeDwell = deps.createPanFreeDwell(() => {
    freed = true;
    const cursor = deps.workspace.cursorPos();
    const raw = win.frameGeometry();
    applyingPin = true;
    win.setFrameGeometry({ x: raw.x, y: cursor.y + grabOffsetY, width: raw.width, height: raw.height });
    applyingPin = false;
});
```

**Grab-offset reseed:** the spike's biggest usability bug — the window never catching up to the pointer
after freeing, needing repeated small nudges — comes from every pinning write discarding real vertical
pointer movement rather than merely hiding it. `grabOffsetY = startY - deps.workspace.cursorPos().y`,
captured once at drag start alongside `startY`, lets the freeing moment place the window at exactly where
an un-pinned drag would have put it (`cursorPos().y + grabOffsetY`), closing the gap in one write instead
of leaving KWin's own tracking to close it incrementally over subsequent ticks.

**Re-entrancy guard:** `win.setFrameGeometry` on the dragged window fires `onFrameGeometryChanged`
synchronously, before the call returns, re-entering `tickInner` mid-tick. Unguarded, this corrupted
`lastX` and the hold state in the spike (a tick's own pin write reset the hold it had just armed) and
double-applied the viewport pan. `applyingPin`, checked as the very first line of `tickInner`, makes our
own writes invisible to the tick handler. This is the reason the existing codebase invariant — the
dragged window's own geometry is never written mid-drag — existed before this feature; it's being broken
deliberately here, with the guard the invariant was implicitly protecting against needing.

**`initiallyFreed`:** `registerDragReorder` gains a fourth parameter, `initiallyFreed = false`, alongside
`initiallyDragging`, seeding `freed` for a connection created mid-drag by a cross-strip reparent. See
"Cross-strip reparent mid-drag" below for why the call site can simply pass `true` unconditionally rather
than needing to track and thread the source drag's actual `freed` value.

### `DragReorderDeps`

- Removes `dragPanVerticalTolerancePx`.
- Adds `dragPanVerticalTriggerPx: number`, `dragPanHorizontalTolerancePx: number`,
  `createPanFreeDwell(onFire: () => void): DwellTimer<true>`, and a `workspace: Pick<WorkspaceAdapter,
  'cursorPos'>` field (cross-strip's `updateEdgeWatch` already depends on `WorkspaceAdapter.cursorPos()`;
  this is the same dependency, now needed in `drag.ts` too).
- `dragPanEnabled` keeps its existing meaning and field.

Gating cross-strip: the outer `onFrameGeometryChanged` handler's unconditional `deps.onDragTick?.(win)`
becomes `if (!deps.dragPanEnabled || freed) deps.onDragTick?.(win);` — same "disabled-or-freed" condition as
the pin block above, for the same reason (gating on `freed` alone would block cross-strip forever when the
feature is disabled). Since `StripStack.updateEdgeWatch` — the only thing wired to `onDragTick` — is the
sole trigger for a cross-strip reparent, this makes cross-strip moves structurally impossible during active
panning, not just unlikely.

### `strip-stack.ts` — cross-strip reparent mid-drag

Because `updateEdgeWatch` can now only ever run when `freed` is already `true` (see gating above), the
`moveFocusedWindowToStrip(targetIndex, { excludeWindowId: this.draggedWindowId, initiallyDragging: true })`
call site is, by construction, only ever reached from an already-freed drag. It passes `initiallyFreed:
true` alongside `initiallyDragging: true` unconditionally — no need to track or thread the source drag's
`freed` state through a getter or extra hook, since there's only one value it could ever be at that call
site. `initiallyFreed` threads through the same `{ excludeWindowId?, initiallyDragging? }` options bag,
`Strip.addWindow`/`addWindowStack`, and `wireTile`, exactly parallel to `initiallyDragging`.

### Settings (`src/config/settings.ts`, `settings-definitions.ts`)

No back-compat: `dragPanVerticalTolerancePx` is removed outright (this addon treats pan/dwell as
experimental; existing configs simply lose the setting, KDE's config system ignores unknown/missing keys).

- `dragPanEnabled` (`Boolean`, default `true`) — unchanged.
- `dragPanVerticalTriggerPx` (`UInt`, default `20`) — replaces the old tolerance's role.
- `dragPanHorizontalTolerancePx` (`UInt`, default `10`) — new.
- `dragPanFreeDwellMs` (`UInt`, default `400`) — new; matches `stripDragDwellMs`/`columnDragDwellMs`'s
  existing default for felt consistency across all three dwell gestures in the codebase.

### KConfigXT / KCM

- `drift/contents/config/main.xml`: replace the `dragPanVerticalTolerancePx` `<entry>` with three entries
  for the settings above, next to `dragPanEnabled`.
- `drift/contents/ui/config.ui`: replace `kcfg_dragPanVerticalTolerancePx` with three spin boxes
  (`kcfg_dragPanVerticalTriggerPx`, `kcfg_dragPanHorizontalTolerancePx` — both `px` suffix —
  `kcfg_dragPanFreeDwellMs`, `ms` suffix) in the existing `tab_behavior` tab.

## Edge Cases

- **`dragPanEnabled: false`**: fully inert, as today — the `deps.dragPanEnabled && !freed` guard means the
  entire pin/dwell block (and thus `dragPanHolding`) is skipped from the first tick, reorder/stack falls
  through immediately every tick, and cross-strip's `onDragTick` forwards immediately too (via the same
  disabled-or-freed condition) — not merely "eventually inert once freed," since `freed` never becomes true
  when disabled.
- **Cross-strip reparent mid-drag**: handled by `initiallyFreed` (see Architecture) rather than accepted as
  a cosmetic gap the way the old design accepted a brief pan-resumption glitch — a real usability
  difference from `2026-09-10`'s equivalent edge case, made possible by cross-strip moves now being
  provably confined to freed drags.
- **Panning past the strip's content bounds**: unchanged from `2026-09-10` — `setOffset` stays unclamped,
  `revealFocused()` on release springs back.
- **Reorder/stack/edge-expel while pinned**: previously relied on the pan-offset math canceling out exactly
  so these never fired during pan; now they're structurally unreachable during pan (`tickInner` returns
  early), which is more robust to future changes to that math and was the user-requested motivation for
  this section.
- **`dragPanVerticalTriggerPx` or `dragPanFreeDwellMs` set to 0**: a trigger of 0 means `dyTotal >= 0` is
  always true, so the hold arms on the very first tick; a dwell of 0 means `DwellTimer` fires as soon as it
  is armed. Both are degenerate-but-safe: dragging still behaves consistently, just with the hold gesture
  trivially easy to trigger. Not a supported way to disable the feature (`dragPanEnabled: false` is).

## Known Issue (tracked separately, not solved by this design)

`docs/known_bugs.md`, entry 1 — a tile in a stacked column is sometimes edge-expelled from its column too early
while panning. Not root-caused; the pan feature's virtual-x offsetting math should hold a dragged window's
virtual position exactly constant during a pure pan, so this shouldn't be possible in theory. First
observed during this feature's live-testing. Deferred per the known-bugs page's own convention.

## Out of Scope

- No modifier-key-gated alternative trigger — consistent with the rest of Drift's drag gestures (the KWin
  script sandbox can't detect modifier keys).
- No hysteresis beyond the hold-tolerance-from-anchor mechanism itself; if that proves flickery in practice,
  revisiting it is a future refinement, not required to ship this.
- No visual indicator of dwell progress (e.g. a growing highlight) — the pin itself (window stops tracking
  the pointer vertically) is the feedback that a hold is in progress at all; a progress indicator remains a
  possible future refinement.
- No attempt to fix `known_bugs.md#1` as part of this work.

## Testing

- `src/input/drag-pan.test.ts`: unit tests for `dragPanHolding` — under/at/over `triggerPx` with zero
  drift; drift under/at/over `tolerancePx` at a fixed `dyTotal` past trigger; `driftSinceHoldStartPx = 0`
  always holds regardless of `tolerancePx` (covers the just-armed tick).
- `src/utils/dwell-timer.test.ts`: existing `EdgeDwell` tests carry over unchanged under the new name/path.
- `drag.ts`'s wiring stays untested glue, consistent with the file's existing convention — verified by
  `npm run build` and manual live-testing: hold-and-free feel at various pull speeds/angles, that
  `dragPanEnabled: false` reproduces pre-feature behavior exactly, that reorder/stack/cross-strip cannot be
  triggered while pinned, and that a cross-strip reparent mid-hold-mode-drag doesn't require a second dwell.
