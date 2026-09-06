# Settings consolidation — design

Date: 2026-09-06

## Problem

Drift's settings are duplicated by hand across multiple files, and nothing keeps them in sync except discipline (and, for shortcuts, one test that catches drift after the fact instead of preventing it).

Every setting's default value lives in `src/config/settings.ts` (`DEFAULT_SETTINGS`, plus a per-field `readNumberConfig`/`readStringConfig`/`readBooleanConfig` call in `loadSettings()`) and again in `drift/contents/config/main.xml` (the KConfigXT schema).
Every shortcut's default sequence lives in those same two places *and* a third: `drift/contents/bin/setup-shortcuts.sh`'s `DRIFT_BINDINGS` table, which also carries the kglobalaccel action text that exists nowhere else.
`drift/contents/ui/config.ui` also has a `value`/`checked` per widget, but these are Qt Designer placeholders only — KDE's `KConfigDialogManager` overwrites them at runtime from the compiled kcfg schema, so they were never a real fourth copy.

Two reference projects in `_playground/` were inspected for prior art.
KZones (`_playground/kzones`) does it the same broken way Drift does: defaults are duplicated inline in its `readConfig()` calls and again in its own `main.xml`.
Karousel (`_playground/karousel`) solves it: `src/lib/config/definition.ts` exports one `configDef` array of `{ name, type, default }`, `main.xml` is generated from it at build time (`src/generators/config/main.ts`, wired into the `Makefile`), and runtime loading is one generic loop over the array instead of per-field code.

Separately, while auditing whether all of Drift's tunable behavior is actually exposed as settings: `animationTickMs` is declared in `Settings`/`DEFAULT_SETTINGS` and actively drives every `SharedTicker` in the codebase (`strip.ts`, `strip-stack.ts`, `controller.ts`), but has no `main.xml` entry and no `readConfig()` call — it's permanently pinned at 16ms no matter what's in `kwinrc`, despite looking configurable.
And `focus-flash-overlay.ts` hardcodes its peak flash opacity (`* 0.5`) even though every sibling focus-flash parameter (border width, blur radius, duration, enabled) is already a real setting.

Finally, the config dialog's tab layout hasn't kept pace with how many settings Drift has grown: the "Animation" tab is a grab-bag of viewport panning, drag dwell timers, minimap, focus flash, and undock-keep-above, with no visual grouping inside it.

## Decisions (confirmed with user)

- Single source of truth for every non-shortcut setting: a `SETTINGS_DEFINITIONS` array of `{ name, type, default }` (explicit KConfigXT `type` per entry, mirroring Karousel — Drift's settings are only ever `UInt`/`String`/`Bool` today, but an explicit type leaves room for `Int`/`Double` later without changing the shape).
  `DEFAULT_SETTINGS` is derived from it; `loadSettings()` becomes a generic loop instead of one hand-written `readXConfig` call per field.
  The `Settings` TypeScript interface (with its existing JSDoc) stays hand-written as the documented type contract — the same relationship Karousel keeps between its `Config` interface and `configDef`.
- `drift/contents/config/main.xml` becomes generated build output (a script mirrors Karousel's XML-printing generator, run via `npm run build:config` using the same `rollup` + `@rollup/plugin-typescript` toolchain already in `devDependencies` — no new tool needed), gitignored, and removed from git tracking, the same way `drift/contents/code/main.js` already is.
- Each `shortcut*` entry in `SETTINGS_DEFINITIONS` gains optional shortcut metadata: a `label` (the kglobalaccel action text, e.g. `"Focus Column Left"`) and an optional `altDefault` (only 4 entries have one, e.g. `Meta+Num+Plus`).
  A new generator prints just the `DRIFT_BINDINGS='...'` data block to a generated, gitignored file (`drift/contents/bin/shortcut-bindings.generated.sh`).
  `setup-shortcuts.sh` keeps its hand-written, heavily-commented conflict-resolution logic as-is (it isn't data, and stays worth keeping diffable), but sources the generated file instead of embedding the table inline.
  `src/config/shortcuts-consistency.test.ts`, which today only catches drift between the three files after the fact, is deleted — generation makes divergence structurally impossible.
- `animationTickMs` is demoted from `Settings`/`DEFAULT_SETTINGS` to a plain exported constant near where it's consumed.
  It's a ~60fps internal render-tick rate, not a behavior a user should tune, and it was never actually reachable through `kwinrc` despite looking like a setting.
- `focusFlashOpacity` is promoted from a hardcoded `0.5` to a real setting, consistent with its already-configurable siblings (`focusFlashBorderWidth`, `focusFlashBlurRadius`, `focusFlashDurationMs`, `focusFlashEnabled`).
- Two other candidates surfaced by the audit (minimap panel styling — radius/color/blur constants in `minimap-overlay.ts`; the debug-console overlay's layout constants) are explicitly left alone: cosmetic/dev-only detail, not user-facing behavior, out of scope.
- `config.ui` stays hand-maintained (it carries UI-only concerns — labels, tooltips, min/max, tab/group layout — that a flat settings list doesn't capture, and its own default values are cosmetic per above), but is reorganized (see below) as a one-time manual edit alongside the refactor.

## Config dialog reorganization

Five tabs, replacing today's four (Layout, Animation, Shortcuts, Window Rules):

```
Layout                      Behavior                    Visual Feedback
------                      --------                    ---------------
┌─ Layout ──────────┐       ┌─ Scrolling ────────┐      ┌─ Minimap ───────────┐
│ columnGap          │       │ viewportShiftStep   │      │ minimapShowThumbs   │
│ defaultColumnWidth │       │ animationDurationMs │      │ minimapAutoHideMs   │
│ bottomMargin       │       └─────────────────────┘      └─────────────────────┘
│ undockKeepAbove    │       ┌─ Resizing ──────────┐      ┌─[x] Flash border ──┐
└────────────────────┘       │ columnWidthStep     │      │ focusFlashBorderW  │
                              │ windowHeightStep    │      │ focusFlashBlurR    │
                              └─────────────────────┘      │ focusFlashDuration │
                              ┌─ Dragging ──────────┐      │ focusFlashOpacity  │
                              │ stripDragDwellMs    │      └────────────────────┘
                              │ stripDragEdgeBorder │
                              │ columnDragDwellMs   │
                              └─────────────────────┘

Shortcuts (unchanged)        Window Rules (unchanged)
```

- "Layout" keeps its current settings, plus `undockKeepAbove` (moved in from the old "Animation" tab — it's a spatial/z-order concern), all in one bordered `QGroupBox`.
  Four items don't warrant further sub-splitting.
- "Animation" is renamed to "Behavior" and gains `columnWidthStep`/`windowHeightStep` (moved in from "Layout" — they're interactive resize-step behavior, not static geometry).
  Its seven settings split into three bordered `QGroupBox`es (Scrolling, Resizing, Dragging) — each a genuine subcluster, avoiding the one-groupbox-per-setting fragmentation that would look worse than no border at all.
- "Visual Feedback" is new, replacing the minimap/focus-flash settings that used to be scattered in "Animation".
  It has a "Minimap" `QGroupBox` and a checkable `QGroupBox` titled by `focusFlashEnabled` itself (KZones' pattern: the checkbox *is* the group's title bar, and its child fields — border width, blur radius, duration, opacity — gray out automatically when unchecked, instead of staying editable while doing nothing).
- "Shortcuts" and "Window Rules" are unchanged, except the "Shortcuts" tab's explanatory label gains a second sentence pointing at `setup-shortcuts.sh`: the default shortcuts can be (re-)applied by running `~/.local/share/kwin/scripts/drift/contents/bin/setup-shortcuts.sh` (the confirmed installed path once packaged via `kpackagetool6`), given as the full path so it can be copy-pasted straight into a terminal.
- A new label at the bottom of the whole dialog (below the tab widget, alongside — not replacing — the existing top-of-dialog restart notice) notes that settings take effect after the next login.

## Build wiring

```json
"build": "npm run build:config && rollup -c && npm run build:shaders",
"build:config": "<bundle + run the two generator scripts, redirecting each to its output file>"
```

Both generators (`main.xml` printer, shortcut-bindings printer) are small TypeScript entry points bundled the same way `src/main.ts` already is, then executed with `node` and redirected to their target files.
Exact bundling mechanics (a second Rollup config vs. reusing the existing one with multiple inputs) are an implementation detail for the plan, not the design.

## Migration

- `git rm --cached drift/contents/config/main.xml drift/contents/bin/shortcut-bindings.generated.sh` (the latter doesn't exist yet, but is added to `.gitignore` alongside `main.xml` from the start, next to the existing `drift/contents/code/main.js` entry).
- `setup-shortcuts.sh`'s header comment about "default sequences are intentionally duplicated from `src/config/settings.ts`" is rewritten — that's no longer true once it sources the generated file.
- `src/config/shortcuts-consistency.test.ts` is deleted.
- `src/config/settings.test.ts` only asserts on `DEFAULT_SETTINGS` values (never `loadSettings()` or `KWin` mocking), so it should need no changes beyond whatever new/removed keys (`focusFlashOpacity` added, `animationTickMs` removed) require.

## Testing

- Existing `settings.test.ts` assertions continue to hold, updated for the `focusFlashOpacity` addition and `animationTickMs` removal.
- New unit tests on the generators' pure output (e.g. "`SETTINGS_DEFINITIONS` produces a `<entry name="columnGap" type="UInt">` with the right default", "a shortcut entry with `altDefault` produces a 4-column `DRIFT_BINDINGS` row") replace the deleted consistency test, following `test-driven-development`.
- `npm run build` (which now runs `build:config` first) regenerates `main.xml` and `shortcut-bindings.generated.sh`; a manual smoke check confirms KWin's config dialog still loads and the shortcut setup script still runs end to end.
