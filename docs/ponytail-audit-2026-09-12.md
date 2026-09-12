# Ponytail audit — 2026-09-12

Repo-wide over-engineering scan of `drift/src` (~6600 lines across config, core, debug, input,
kwin, runtime, types, ui, utils, viewport).
Scope is complexity only — no correctness, security, or performance findings.

## Findings (ranked by impact)

- `shrink` `AxisMotion` keeps 4 parallel `Map<K,...>` fields (`targets`, `resting`, `animations`,
  `startedAt`) for one entity per id. Collapse into one `Map<K, {target, resting, animation,
  startedAt}>`. [drift/src/viewport/axis-motion.ts](../drift/src/viewport/axis-motion.ts)
- `native` `StripStackFactory`/`StripFactory` constructor-injected factory params exist solely so
  tests can swap in `FakeStripStack`/`FakeStrip`; production never varies them (`new
  StripStack(...)`/`new Strip(...)` is the only real caller). Vitest's `vi.mock()` on the module
  already does this substitution — drop both factory types/params and mock the class import in
  tests instead. [drift/src/runtime/strip-manager.ts](../drift/src/runtime/strip-manager.ts),
  [drift/src/runtime/strip-stack.ts](../drift/src/runtime/strip-stack.ts)
- `shrink` `Grid.columns()`/`Column.tiles()` clone with `.slice()` on every call, even though they
  already return a TS `readonly` array (callers can't mutate through it — `.push()`/`.sort()`
  etc. don't typecheck). Return the backing array directly.
  [drift/src/core/grid.ts](../drift/src/core/grid.ts),
  [drift/src/core/column.ts](../drift/src/core/column.ts)
- `shrink` `drag-pan.ts` is a single 9-line pure function (`dragPanShouldPan`) with one caller,
  plus its own test file. Inline into [drift/src/input/drag.ts](../drift/src/input/drag.ts).
  [drift/src/input/drag-pan.ts](../drift/src/input/drag-pan.ts)
- `yagni` `createShortcut` is `export`ed but only ever called from within its own file (confirmed:
  no other file imports it). Drop the `export`.
  [drift/src/input/shortcuts.ts](../drift/src/input/shortcuts.ts)

## Discarded (failed verification)

- "Delete `StripManager.stripStackFor()`" — wrong. It's called internally by `activeStripStack()`
  in production, not test-only.
- "Inline `Animator.finish()`/`tick()`" and "simplify `EdgeDwell.awaitingRelease`" — style
  opinions, not genuine bloat. Both are already minimal and the dwell logic is deliberately
  commented/justified.

## Net

-25 lines, -0 deps possible.
