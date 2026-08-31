# Settings dialog — design

Date: 2026-08-31

## Problem

Drift's config dialog (`drift/contents/ui/config.ui`) currently exposes exactly one setting: the bottom margin.
Every other user-tunable value — column gap, default column width, animation duration, viewport shift step — is a hardcoded default in `src/config/settings.ts`, readable only by hand-editing `kwinrc`.
KZones and Karousel (reference projects under `_playground/`) both ship a tabbed KCM-style config UI covering all of their behavioral knobs.
Drift should do the same for its (much smaller) set of settings.

## Decisions (confirmed with user)

- Expose all currently-hardcoded numeric knobs: `columnGap`, `defaultColumnWidth`, `animationDurationMs`, `viewportShiftStep`, alongside the existing `bottomMargin`.
- `animationTickMs` stays an internal constant, not exposed.
  It is an implementation detail of the ~60fps ticker, not a behavior a user tunes.
- Shortcuts are excluded from the dialog entirely.
  Drift's shortcuts are real KGlobalAccel-backed global shortcuts (registered via QML `ShortcutHandler`, see [`src/input/shortcuts.ts`](../../../src/input/shortcuts.ts)), the same mechanism Karousel uses.
  Karousel's own README documents rebinding them through System Settings → Shortcuts, not through its own config UI.
  Drift's dialog follows the same convention: a single explanatory label, no editable shortcut fields.
- The dialog uses a tabbed `QTabWidget` layout (matching KZones/Karousel), even though Drift's current setting count is small — this leaves room to grow without a later restructure.
- The existing `marginBottom` kcfg entry is renamed to `bottomMargin`, matching the `Settings` field name.
  This mismatch was called out as a known issue in a prior spec ([`2026-08-30-column-align-cycle-design.md`](2026-08-30-column-align-cycle-design.md)) but left unfixed at the time.
  No release has shipped yet, so renaming now carries no migration cost.

## Config schema — `drift/contents/config/main.xml`

Rename the existing entry and add four new ones, all `type="UInt"`, alongside the existing `shortcut*`
`String` entries (which are unchanged):

| Entry | Default |
|---|---|
| `bottomMargin` (renamed from `marginBottom`) | `0` |
| `columnGap` | `8` |
| `defaultColumnWidth` | `800` |
| `animationDurationMs` | `200` |
| `viewportShiftStep` | `400` |

## Settings — `src/config/settings.ts`

- `loadSettings()`'s `bottomMargin` read switches its config key from `'marginBottom'` to `'bottomMargin'`.
- Add four more `readNumberConfig` calls, one per new field above, each keyed by its own field name (same convention the shortcut fields already use — config key equals `Settings` field name).
- No changes to the `Settings` interface itself — all five fields already exist there.

## Config UI — `drift/contents/ui/config.ui`

Rebuild as a `QTabWidget` with three tabs, replacing the current single `QFormLayout`.
Class name (`KWin::DriftConfigForm`) and window title (`Drift`) stay the same.
A single `QLabel` sits above the tabs, visible regardless of which tab is open: *"Changes take effect after restarting KWin, or disabling and re-enabling Drift under KWin Scripts."*
This was added after implementation, once manual testing showed settings changes don't take effect live — neither KZones nor Karousel achieve live-apply either (KZones' own README instructs the same disable/re-enable workaround, and its one attempt at an `Options.configChanged` hook is dead code the author marked "still not working"); this is a KWin `declarativescript` platform limitation, not something fixable in Drift's code.

**Tab: Layout**

A `QFormLayout` with three `QSpinBox` fields:

| Field | kcfg name | Suffix | Min | Max |
|---|---|---|---|---|
| Column gap | `kcfg_columnGap` | ` px` | 0 | 999 |
| Default column width | `kcfg_defaultColumnWidth` | ` px` | 100 | 9999 |
| Bottom margin | `kcfg_bottomMargin` | ` px` | 0 | 999 |

Each field keeps a short `toolTip` describing its effect, following the existing `bottomMargin` field's style (e.g. "Space reserved at the bottom of the screen, e.g. to keep a taskbar visible").

**Tab: Animation**

A `QFormLayout` with two `QSpinBox` fields:

| Field | kcfg name | Suffix | Min | Max |
|---|---|---|---|---|
| Animation duration | `kcfg_animationDurationMs` | ` ms` | 0 | 5000 |
| Viewport shift step | `kcfg_viewportShiftStep` | ` px` | 1 | 9999 |

**Tab: Shortcuts**

A single `QLabel` (word-wrapped, centered), no `kcfg_`-bound widgets:

> "Configure Drift's keyboard shortcuts in System Settings → Shortcuts (search for \"Drift\")."

No tab icons — the reference projects' icon references point at what look like stale Qt Designer placeholder paths (`.designer/backup`), not meaningful icon assets, so Drift's tabs use plain text titles only.

## Testing

- `settings.ts`'s config-reading path (`loadSettings`, `readNumberConfig`) is already untestable glue per project convention (docs §8) — no dedicated unit test exists for it today (`settings.test.ts` only covers `DEFAULT_SETTINGS` literal values), and this change doesn't alter that. No new unit tests are added for the rename or the new reads.
- `config.ui` and `main.xml` are glue per project convention (docs §8) — not unit-tested, verified manually via `make install` and opening the KWin Scripts config dialog in System Settings.
- Verification for this whole change is `npm run typecheck`, `npm run lint`, `npm run build`, and the manual System Settings check above — same verification shape as the existing `bottomMargin` field.

## Out of scope

- Any editable shortcut UI.
- Exposing `animationTickMs` or any other internal/implementation-detail constant.
- Any KCM mechanism beyond the existing `kcm_kwin4_genericscripted` (`X-KDE-ConfigModule` in `drift/metadata.json`).
- Reordering or renaming any setting not listed above.
