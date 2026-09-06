# Window rules — design

Date: 2026-09-06

## Problem

Drift has no way to apply a per-application override when a window first opens.
Karousel and PaperWM (reference projects) both support this: match a window by class/title, then force it to float, set a starting width, and so on.
Drift should gain the same for four properties: whether the window floats, its starting column width, its starting alignment, and (as a forward-looking stub) which screen it opens on.
Float, width, and alignment already have working implementations elsewhere in Drift (manual undock, `defaultColumnWidth`, the align-cycle shortcuts) — this feature is about triggering them automatically from a match instead of only from a keypress.
Screen placement has no underlying implementation at all yet; the rule field is added now so the schema doesn't need to change again once that lands.

## Decisions (confirmed with user)

- Rules are authored as a single JSON array, stored in one `windowRules` config entry, edited as raw text in a `QPlainTextEdit` — the same mechanism Karousel uses for its own Window Rules tab.
  Two alternatives were considered and rejected for now: a `KEditListWidget`-based row editor (real Add/Remove/Move buttons, but the widget's availability inside Drift's generic-scripted KCM is unverified — no sibling project in this codebase uses any non-stock-`QtWidgets` class in a `config.ui`, so this carries real risk of failing to load at runtime) and a fully custom KCM plugin (true per-field form widgets, but requires abandoning the generic-scripted KCM entirely — far more engineering than the feature itself).
- One rule can set multiple properties at once (PaperWM's per-app model), not one property per rule (Karousel's model).
- Every field is optional except that a rule needs at least one matcher (`class` and/or `caption`) to be meaningful; a rule with neither matches every window and doubles as a default/catch-all, with no dedicated wildcard syntax needed.
- Matching is case-insensitive substring by default, with an explicit `/pattern/flags` form for real regex — chosen over full-regex-always (Karousel, PaperWM's default) to keep the common case (`"class": "firefox"`) trivial.
- When both `class` and `caption` are set on one rule, both must match (AND).
  This is a deliberate divergence from PaperWM, which ORs the two; AND is the less surprising default (a rule for `class: "zoom"` + `caption: "Meeting"` should not match every window merely titled "Meeting").
- Rules are evaluated top-to-bottom; the first match wins in full — no per-field merging across multiple matching rules.
- `align` has three values (`"left" | "center" | "right"`); there is no `"none"` value, since omitting the field is already "leave alignment untouched".
- A rule applies once, when the window is first added.
  Karousel additionally re-evaluates float/tile on caption change (its `followCaption` mechanism); that live re-evaluation is explicitly out of scope for this round.
- A malformed `windowRules` string (not valid JSON, or not an array) falls back to `[]` and logs via `debug()` — no desktop `Notification` popup like Karousel's, since Drift has no existing precedent for that UI and the debug console is its established error-surfacing convention.
- A single malformed rule entry (wrong-typed field, bad regex) is skipped individually, logged, and does not invalidate the rest of the array.

## Rule schema

```jsonc
[
  { "class": "firefox", "float": true },
  { "class": "slack", "caption": "Huddle", "width": "30%" },
  { "class": "code", "align": "left", "width": 900 },
  { "caption": "Picture-in-Picture", "float": true }
]
```

| Field | Type | Meaning |
|---|---|---|
| `class` | string | Matches `resourceClass`. |
| `caption` | string | Matches the window title. |
| `float` | boolean | Open undocked instead of tiled. |
| `width` | number \| string | Column width in px (`900`), or `"NN%"` of the screen the window opens on. |
| `align` | `"left"` \| `"center"` \| `"right"` | One-shot placement when the column is created. |
| `screen` | number | Output index (0-based, matches `Workspace.screens`). Stored and matched, but a no-op today — nothing in Drift moves a window cross-monitor yet. |

A plain string value for `class`/`caption` is a case-insensitive substring match.
A string of the form `/pattern/flags` is compiled as a real `RegExp` and tested against the field.

## Config schema — `drift/contents/config/main.xml`

One new entry, alongside the existing ones:

| Entry | Type | Default |
|---|---|---|
| `windowRules` | `String` | `[]` |

## Settings — `src/config/settings.ts`

- `windowRules: string` added to `Settings` and `DEFAULT_SETTINGS` (default `'[]'`), read via the existing `readStringConfig`.
- `settings.ts` stays a thin config-read layer; it does not parse the JSON itself.

## Rule matching — `src/core/window-rules.ts` (new)

A new KWin-free module, per `docs/coding-conventions.md`'s "keep KWin API access in adapter modules" rule:

- `parseWindowRules(json: string): WindowRule[]` — parses and validates the raw config string, applying the two-tier error handling described above (whole-string fallback to `[]`; per-entry skip-and-log). Compiles any `/pattern/flags` matcher strings into `RegExp` instances once, at parse time, not per-window.
- `matchRule(rules: WindowRule[], resourceClass: string, caption: string): WindowRule | null` — first-match-wins lookup over pure strings, with no dependency on `Window`/`WindowAdapter` types.
- `resolveWidth(width: number | string | undefined, screenWidth: number): number | undefined` — resolves a `"NN%"` string against the given screen width; passes a plain number through unchanged.

`src/kwin/window-adapter.ts` gains a `resourceClass` getter (mirroring the existing `caption` getter) and a `screenWidth()` method (for resolving a rule's `"NN%"` width), so `WindowManager` can call `matchRule`/`resolveWidth` without touching the raw KWin `Window`/`Output` types directly.

## Runtime integration

All wiring happens at the single point every new tileable window already passes through: `WindowManager.addWindow` (`src/runtime/window-manager.ts:19`).

- **`float`**: if the matched rule sets `float: true`, `addWindow` skips `this.place(win)` and adds the window straight to `this.undocked` — the same set `toggleFloating` already uses. No new float code path.
  If the same rule also sets `width` or `align`, both are silently ignored — a floating window has no column for either to apply to.
- **`width`**: threaded through to `Strip.addWindow` (`src/runtime/strip.ts:260-263`), which today computes `width = win.frameGeometry().width || settings.defaultColumnWidth`. A rule-supplied width becomes a third, higher-priority source ahead of both: `rule.width ?? frameGeometry().width ?? defaultColumnWidth`, resolving any `"NN%"` value against `win.output()`'s width first.
- **`align`**: applied once, right after the column is placed, by computing the target offset via the existing `alignOffsets()` (`src/viewport/align-cycle.ts`) for that column and screen, then animating the viewport to it the same way `Strip.cycleAlign` already does for the manual shortcut — jumping directly to the `left`/`center`/`right` candidate instead of stepping through Strip's 3-phase cycle.
  Known limitation, inherited from the existing manual shortcut: the viewport offset is shared by the whole strip, so this pans every column on that screen, not just the new window's — identical to what `Meta+Shift+Left/Right` already does today, just triggered automatically instead of by keypress.
- **`screen`**: matched and carried on the resolved rule, but not acted on.
  Whenever a matched rule sets `screen` at all, `addWindow` logs a `debug()` line noting cross-monitor placement isn't implemented, so the gap is visible without changing behavior. (Comparing against the window's actual current output would need a `WorkspaceAdapter` reference `WindowManager` doesn't otherwise need — not worth adding for a field with zero behavioral effect either way.)

## Config UI — `drift/contents/ui/config.ui`

A new tab, "Window Rules", containing a `QPlainTextEdit` bound to `kcfg_windowRules`: monospace font, no line wrap, `tabChangesFocus` enabled — the same widget configuration Karousel uses for its own Window Rules tab.

## Testing

- `src/core/window-rules.ts` (parsing, matching, width resolution) gets full unit coverage — pure functions, no KWin, no adapter types.
- The `WindowManager.addWindow` wiring (float/width/align dispatch) is covered the way `toggleFloating`/`place` already are in `window-manager.test.ts`, using the existing fake `WindowAdapter`/`StripManager` test doubles.
- `config.ui` and `main.xml` stay manual-verify-only, per this project's existing convention (docs §8, same as the settings-dialog work): verified via `make install`/`npm run package:install` and opening the KWin Scripts config dialog in System Settings.
- Verification for the whole change: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, plus the manual System Settings check above.

## Out of scope

- Live re-evaluation of a rule on caption change (Karousel's `followCaption`).
- Actual cross-monitor window placement for `screen` — only the schema, matching, and a debug-log stub land now.
- Any UI beyond the JSON textarea (a `KEditListWidget` row editor or a custom KCM plugin), unless the JSON editor proves unacceptable in practice.
