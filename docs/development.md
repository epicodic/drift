# Development

## Build

`npm run build` bundles [`src/main.ts`](../src/main.ts) and everything it imports into a single IIFE at [`drift/contents/code/main.js`](../drift/contents/code/main.js), using Rollup ([`rollup.config.mjs`](../rollup.config.mjs)) with the TypeScript plugin.
The KWin package (`X-Plasma-API: declarativescript` in [`drift/metadata.json`](../drift/metadata.json)) loads [`drift/contents/ui/main.qml`](../drift/contents/ui/main.qml) as its entry point, which imports the bundle and calls `Drift.init(qmlBase)`.
Rollup's `footer` option re-exposes the bundle's `init` as a top-level function so QML's `import "../code/main.js" as Drift` can call it — this matches the working Karousel build, not a documented QML/Rollup contract.

The QML host exists because `declarativescript` KWin scripts have no built-in JavaScript timer primitive; [`src/kwin/qml-timer.ts`](../src/kwin/qml-timer.ts) creates a QML `Timer` element at runtime via `Qt.createQmlObject`, parented to the QML root passed into `init`.
Global shortcuts ([`src/input/shortcuts.ts`](../src/input/shortcuts.ts)) are wired the same way, via QML `ShortcutHandler` elements.

`make build` runs lint and test before `npm run build`; `make package` additionally tars up `drift/` into a versioned archive for distribution.

## Test

`npm test` runs Vitest against every `*.test.ts` file in `src/`.
Coverage follows the module map in [`docs/architecture.md`](architecture.md#module-map): `core/` and `viewport/` are fully unit-tested because they are pure and KWin-free.
`kwin/` is mostly untestable without a live compositor and is kept deliberately thin; only its pure helper functions are tested — `toRealRect`/`toVirtualX` in [`geometry-sync.test.ts`](../src/kwin/geometry-sync.test.ts), and `WindowAdapter.isTileable` against a hand-built fake `Window` object in [`window-adapter.test.ts`](../src/kwin/window-adapter.test.ts).
`input/` and `main.ts` have no tests — they are integration wiring with no logic of their own.

## Lint

`npm run lint` runs ESLint and Prettier over `src/`, plus `qmllint` against [`drift/contents/ui/main.qml`](../drift/contents/ui/main.qml).
`npm run lint:fix` applies ESLint's and Prettier's autofixes.
Naming and formatting conventions are in [`docs/coding-conventions.md`](coding-conventions.md).

## Dev / Reload Workflow

1. `make install` (or `npm run package:install`) builds and installs/upgrades the script via `kpackagetool6 --type=KWin/Script`.
2. Enable "Drift" under System Settings → Window Management → KWin Scripts, if not already enabled (or run `make enable`).
3. **KWin only reloads a script's QML/JS on a full KWin restart.**
   There is no hot-reload; `qdbus6 org.kde.KWin /KWin reconfigure` (used by `make enable`/`make disable`) does **not** re-run the QML host.
   `make restart-kwin` replaces the running compositor in place (`kwin_wayland --replace` / `kwin_x11 --replace`), which is faster to iterate with than logging out and back in — verify it actually reloads Drift before relying on it exclusively.
4. `console.log` output from `src/main.ts` and the adapters appears in KWin's debug output (`journalctl --user -f -u plasma-kwin_wayland` or equivalent, depending on session type) — debug logging for `kwin_scripting`/`js` must be enabled first (e.g. `QT_LOGGING_RULES=kwin_*.debug=true;js.debug=true`).
5. `make uninstall` (or `npm run package:remove`) removes the installed script.
