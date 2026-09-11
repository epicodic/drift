# Makefile Build Orchestration and Source Layout Reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skills:subagent-driven-development (recommended) or skills:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Makefile the single owner of build/test/lint orchestration with real file-based dependency tracking (no duplicate rollup/tsc invocations, no implicit assumptions about `package.json` script internals), and separate source from build output by moving all hand-authored files into a unified `drift/` source tree while the assembled installable KWin package is generated fresh into `.build/drift/`.

**Architecture:** `package.json` keeps only metadata/`devDependencies` and an optional `test:watch` convenience script — the Makefile calls `./node_modules/.bin/<tool>` and `node` directly. Real GNU Make file targets (main.js/main.xml/shortcut-bindings/shader/UI copies/metadata copy) each declare their actual source-file prerequisites, so Make's own DAG dedups shared work (e.g. the TypeScript compile) across `lint`/`test`/`build` regardless of invocation order, and skips work entirely across separate `make` invocations when nothing changed. `drift/` becomes pure source (`drift/src/**/*.ts`, `drift/ui/`, `drift/shaders/`, `drift/bin/`, `drift/metadata.json`); `.build/drift/` is the fully generated, installable/zippable package tree with the KWin-mandated `contents/{code,ui,config,shaders,bin}/` layout.

**Tech Stack:** TypeScript, JavaScript, and QML with npm; GNU Make 4.3 (grouped targets); optional Python with uv, pytest, Ruff, and ty (unused by this plan).

**Coding Conventions:** `docs/coding-conventions.md` — read before implementing.

**Do not touch:** anything under `docs/agents/plans/` (other than this file) or `docs/agents/specs/` or `docs/archive/` — those are historical records of past work and are not updated when the codebase they describe later changes, same as `AGENTS.md`'s stated policy for `docs/archive/`. Do not touch `.claude/worktrees/cheeky-riding-candy/` — an unrelated worktree from a different session.

**Context this plan already established (do not re-derive):**
- KWin's KPackage format requires the installed script directory to contain `metadata.json` at its root and a `contents/` subfolder with `code/main.js`, `ui/main.qml` (referenced by `metadata.json`'s `X-Plasma-MainScript`), `config/main.xml`, `config/ui` conventions, etc. This is dictated by KWin/KPackage, not by this repo, and only constrains the *final assembled package* (`.build/drift/...`), never the source tree layout.
- `drift/contents/ui/main.qml`'s own header comment ("its shipped sibling files, e.g. `contents/bin/setup-shortcuts.sh`") and its `import "../code/main.js" as Drift` both describe the **final package's** relative layout, which is unchanged by this plan — do not edit `drift/ui/main.qml`'s content, only its location.
- `scripts/compile-shaders.sh`'s shader-baking step only produces `focus_glow.frag.qsb`; the raw `.frag` source is never read at runtime (`Qt.resolvedUrl("../shaders/focus_glow.frag.qsb")` in `focus-flash-overlay.ts`), so it will no longer be copied into `.build/drift/contents/shaders/`.
- `src/core/default-window-rules.test.ts:25` does `readFileSync(path.join(REPO_ROOT, 'drift/contents/config/main.xml'), 'utf8')` — a **real filesystem dependency on the generated `main.xml`**, not just a comment. This means `make test` must depend on `main.xml` having been generated first (confirmed by moving `main.xml` aside and re-running: the test fails with `ENOENT`). Earlier in this conversation it was stated that `test` needs none of the generated artifacts — that was wrong for `main.xml` specifically (right for `main.js`). The new Makefile's `test` target must list the (relocated) `main.xml` as a prerequisite.
- qmllint must run against the **copied** `drift/ui/main.qml` inside `.build/drift/contents/ui/` (not the source-tree `drift/ui/main.qml`), because its `import "../code/main.js"` only resolves correctly once `main.qml` sits next to a real `code/main.js` sibling — which only exists in the assembled package, not in the flat source tree.

---

### Task 1: Move source directories into the unified `drift/` tree

**Files:**
- Move: `src/` → `drift/src/`
- Move: `drift/contents/ui/` → `drift/ui/`
- Move: `drift/contents/shaders/` → `drift/shaders/` (source `.frag` only — the generated `.qsb` gets deleted, not kept)
- Move: `drift/contents/bin/` → `drift/bin/` (source scripts only — the generated `shortcut-bindings.generated.sh` gets deleted, not kept)
- Delete: `drift/contents/config/.gitkeep`, and whatever remains of `drift/contents/` once empty
- Modify: `drift/src/kwin/focus-flash-overlay.ts:32`, `drift/src/config/kcfg-xml.ts:1`, `drift/src/config/settings-definitions.ts:2-4`, `drift/src/config/settings.ts:4`, `drift/src/core/default-window-rules.test.ts:11-17`, `drift/bin/setup-shortcuts.sh:6,8,10,15,16,28`

- [ ] **Step 1: Move the TypeScript source tree**

```sh
git mv src drift/src
```

- [ ] **Step 2: Move the QML/UI source files**

```sh
git mv drift/contents/ui drift/ui
```

- [ ] **Step 3: Move the shader source, drop the stale compiled `.qsb`**

```sh
git mv drift/contents/shaders drift/shaders
rm -f drift/shaders/focus_glow.frag.qsb
```

(`git mv` moves the whole directory including the untracked, gitignored `.qsb` sitting on disk; it will be regenerated into `.build/drift/contents/shaders/` by Task 5's Makefile, so delete the stray copy that just moved with it.)

- [ ] **Step 4: Move the bin scripts, drop the stale generated shortcut-bindings file**

```sh
git mv drift/contents/bin drift/bin
rm -f drift/bin/shortcut-bindings.generated.sh
```

- [ ] **Step 5: Remove the now-empty `contents/` directory**

```sh
git rm drift/contents/config/.gitkeep
rm -f drift/contents/config/main.xml
rmdir drift/contents/config drift/contents/code drift/contents 2>/dev/null || true
git status --short drift/
```

Expected: `drift/contents/` no longer exists; `drift/` now contains only `src/`, `ui/`, `shaders/`, `bin/`, `metadata.json`.

- [ ] **Step 6: Fix source-tree path references in moved files**

`drift/src/kwin/focus-flash-overlay.ts:32` — old:
```
        // window edge (see drift/contents/shaders/focus_glow.frag), so the hue can never
```
new:
```
        // window edge (see drift/shaders/focus_glow.frag), so the hue can never
```

`drift/src/config/kcfg-xml.ts:1` — old:
```
// Builds drift/contents/config/main.xml's content from SETTINGS_DEFINITIONS. Pure and
```
new:
```
// Builds .build/drift/contents/config/main.xml's content from SETTINGS_DEFINITIONS. Pure and
```

`drift/src/config/settings-definitions.ts:2-4` — old:
```
// generated build output (drift/contents/config/main.xml via generate-main-xml.ts,
// drift/contents/bin/shortcut-bindings.generated.sh via generate-shortcut-bindings.ts) and
// src/config/settings.ts's DEFAULT_SETTINGS/loadSettings() are all derived from this array
```
new:
```
// generated build output (.build/drift/contents/config/main.xml via generate-main-xml.ts,
// .build/drift/contents/bin/shortcut-bindings.generated.sh via generate-shortcut-bindings.ts) and
// drift/src/config/settings.ts's DEFAULT_SETTINGS/loadSettings() are all derived from this array
```

`drift/src/config/settings.ts:4` — old:
```
// the generated drift/contents/config/main.xml (KConfigXT schema).
```
new:
```
// the generated .build/drift/contents/config/main.xml (KConfigXT schema).
```

`drift/src/core/default-window-rules.test.ts:11-17` — old:
```
// different contexts: drift/contents/config/main.xml (read by KConfigDialogManager to
// populate the config dialog's textbox the first time it's opened) and
// src/core/default-window-rules.ts (bundled into the running KWin script as the
// readConfig() fallback, and as DEFAULT_SETTINGS.windowRules). Rather than generating
// main.xml from the TypeScript source (this project's config.ui/main.xml are hand-maintained
// by convention), this test catches drift between them directly — same approach as
// src/config/shortcuts-consistency.test.ts uses for shortcut defaults.
```
new:
```
// different contexts: .build/drift/contents/config/main.xml (read by KConfigDialogManager to
// populate the config dialog's textbox the first time it's opened) and
// drift/src/core/default-window-rules.ts (bundled into the running KWin script as the
// readConfig() fallback, and as DEFAULT_SETTINGS.windowRules). This test catches drift
// between them directly.
```

(The `src/config/shortcuts-consistency.test.ts` reference is dropped — that file doesn't exist in this repo; leaving it in was already stale before this plan and is out of scope to investigate further here.)

`drift/bin/setup-shortcuts.sh` — six separate line edits:

Line 6, old: `# - Table-driven: DRIFT_BINDINGS is generated from src/config/settings-definitions.ts`
new: `# - Table-driven: DRIFT_BINDINGS is generated from drift/src/config/settings-definitions.ts`

Line 8, old: `#   drift/contents/bin/shortcut-bindings.generated.sh below — see`
new: `#   contents/bin/shortcut-bindings.generated.sh below — see`

Line 10, old: `#   shortcut, edit settings-definitions.ts and run \`npm run build\`; nothing else needs`
new: `#   shortcut, edit settings-definitions.ts and run \`make build\`; nothing else needs`

Line 15, old: `#   alongside the main-keyboard one. It has no counterpart in src/config/settings.ts:`
new: `#   alongside the main-keyboard one. It has no counterpart in drift/src/config/settings.ts:`

Line 16, old: `#   Drift's own QML \`ShortcutHandler\` (src/input/shortcuts.ts) can only hold one`
new: `#   Drift's own QML \`ShortcutHandler\` (drift/src/input/shortcuts.ts) can only hold one`

Line 28, old: `#   (src/input/shortcuts.ts) — those remain required, since they actually receive`
new: `#   (drift/src/input/shortcuts.ts) — those remain required, since they actually receive`

- [ ] **Step 7: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Naming/comment conventions preserved (only path text changed, no code semantics touched)
- [ ] `git status` shows only the expected moves/edits, no accidental deletions of tracked files
- [ ] Any convention violations fixed before moving to next task

---

### Task 2: Update build-tool configs for the new source paths

**Files:**
- Modify: `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `rollup.config.mjs`, `.gitignore`, `.prettierignore`

- [ ] **Step 1: `tsconfig.json`**

Old:
```json
    "include": ["src/**/*"]
```
New:
```json
    "include": ["drift/src/**/*"]
```

- [ ] **Step 2: `vitest.config.ts`**

Old:
```ts
        include: ['src/**/*.test.ts'],
```
New:
```ts
        include: ['drift/src/**/*.test.ts'],
```

- [ ] **Step 3: `eslint.config.mjs`**

Old:
```js
        ignores: [
            'drift/contents/code/main.js',
            '.build/**',
```
New (the specific `main.js` entry is now redundant — the blanket `.build/**` ignore already covers its new location):
```js
        ignores: [
            '.build/**',
```

Old (appears 3 times — the `files:` array in each of the three rule blocks):
```js
        files: ['src/**/*.ts'],
```
New (all three occurrences):
```js
        files: ['drift/src/**/*.ts'],
```

The fourth occurrence, `ignores: ['src/**/*.test.ts']` inside the "no spread/optional-catch" block, becomes:
```js
        ignores: ['drift/src/**/*.test.ts'],
```

- [ ] **Step 4: `rollup.config.mjs`**

Full new content:
```js
import typescript from '@rollup/plugin-typescript';

// A fresh plugin instance per build target — @rollup/plugin-typescript keeps internal
// program state that must not be shared across the multiple inputs built from this one
// config file.
function typescriptPlugin() {
    return typescript({
        tsconfig: './tsconfig.json',
        noEmitOnError: true,
    });
}

// The QML host (.build/drift/contents/ui/main.qml) imports this bundle and calls
// `Drift.init(root, scriptUiDirUrl)` (docs §6.2). Rollup wraps the src/ module tree in
// an IIFE assigned to `DriftBundle`; the footer re-exposes `init` as a top-level
// function declaration, which is the form QML reliably exposes to `import "..." as
// Drift` (matches the working Karousel build). The footer's own parameter list must be
// kept in sync with `main.ts`'s `init` signature — extra call-site arguments are
// silently dropped otherwise (confirmed live: this shim previously only declared
// `root`, silently discarding `scriptUiDirUrl`).
const mainBundle = {
    input: 'drift/src/main.ts',
    output: {
        file: '.build/drift/contents/code/main.js',
        format: 'iife',
        name: 'DriftBundle',
        footer: 'function init(root, scriptUiDirUrl) { return DriftBundle.init(root, scriptUiDirUrl); }',
    },
    plugins: [typescriptPlugin()],
};

// Prints .build/drift/contents/config/main.xml's content to stdout when run with `node`;
// the Makefile's main.xml rule redirects it into the file (docs/agents/specs/2026-09-06-settings-consolidation-design.md).
const generateMainXmlBundle = {
    input: 'drift/src/config/generate-main-xml.ts',
    output: {
        file: '.build/generate-main-xml.cjs',
        format: 'cjs',
    },
    plugins: [typescriptPlugin()],
};

// Prints the DRIFT_BINDINGS data block to stdout when run with `node`; the Makefile's
// shortcut-bindings rule redirects it into .build/drift/contents/bin/shortcut-bindings.generated.sh,
// which setup-shortcuts.sh sources.
const generateShortcutBindingsBundle = {
    input: 'drift/src/config/generate-shortcut-bindings.ts',
    output: {
        file: '.build/generate-shortcut-bindings.cjs',
        format: 'cjs',
    },
    plugins: [typescriptPlugin()],
};

export default [mainBundle, generateMainXmlBundle, generateShortcutBindingsBundle];
```

- [ ] **Step 5: `.gitignore`**

Full new content:
```
.serena/
_playground/
node_modules/
.build/
```

(All four specific generated-file entries are dropped — every generated file now lives under `.build/`, already covered by the one `.build/` entry.)

- [ ] **Step 6: `.prettierignore`**

Full new content:
```
_playground/
node_modules/
.build/
.agents/
.serena/
.github/
.vscode/
docs/
*.md
```

(`drift/contents/` replaced with `.build/` — `drift/` is pure source now and should be checked by Prettier like any other source directory.)

- [ ] **Step 7: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Run `grep -rn "'src/\|\"src/\|drift/contents" tsconfig.json vitest.config.ts eslint.config.mjs rollup.config.mjs .gitignore .prettierignore` — expect no matches
- [ ] Any convention violations fixed before moving to next task

---

### Task 3: Fix the test that reads the generated `main.xml`

**Files:**
- Modify: `drift/src/core/default-window-rules.test.ts:25`

- [ ] **Step 1: Update the hardcoded path to the new generated-file location**

Old:
```ts
    const xml = readFileSync(path.join(REPO_ROOT, 'drift/contents/config/main.xml'), 'utf8');
```
New:
```ts
    const xml = readFileSync(path.join(REPO_ROOT, '.build/drift/contents/config/main.xml'), 'utf8');
```

- [ ] **Step 2: Verify the test fails cleanly without a prior build (sanity-check the dependency, not the fix)**

```sh
rm -rf .build
./node_modules/.bin/vitest run drift/src/core/default-window-rules.test.ts
```
Expected: FAIL — `ENOENT`, `.build/drift/contents/config/main.xml` doesn't exist. This confirms the test genuinely needs `main.xml` generated first; Task 5's Makefile `test` target must depend on it.

- [ ] **Step 3: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] TypeScript naming/conventions unaffected (single string literal changed)
- [ ] Step 2's expected failure observed and recorded

---

### Task 4: Make `compile-shaders.sh` take explicit input/output paths

**Files:**
- Modify: `scripts/compile-shaders.sh`

- [ ] **Step 1: Replace hardcoded shared directory with two positional arguments**

Full new content:
```sh
#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "usage: $(basename "$0") <input.frag> <output.frag.qsb>" >&2
    exit 1
fi

frag_in="$1"
qsb_out="$2"

# Known Qt6 install locations are checked BEFORE bare `qsb` on PATH: on Debian/Ubuntu-family
# systems `qsb` on PATH is a qtchooser wrapper that can silently resolve to a missing Qt5
# binary (confirmed on a dev machine: `qsb` resolves to a nonexistent /usr/lib/qt5/bin/qsb
# and fails at exec time, even though `command -v qsb` reports it as found).
find_qsb() {
    for candidate in /usr/lib/qt6/bin/qsb /usr/lib/x86_64-linux-gnu/qt6/bin/qsb; do
        if [[ -x "${candidate}" ]]; then
            echo "${candidate}"
            return 0
        fi
    done
    if command -v qsb >/dev/null 2>&1; then
        command -v qsb
        return 0
    fi
    return 1
}

if ! qsb_bin="$(find_qsb)"; then
    echo "error: qsb (Qt Shader Baker) not found on PATH or in known Qt6 install locations" >&2
    exit 1
fi

mkdir -p "$(dirname "${qsb_out}")"

"${qsb_bin}" --glsl "150,120,100es" --hlsl 50 --msl 12 -b -o "${qsb_out}" "${frag_in}"
```

- [ ] **Step 2: Verify it works standalone against the new source/output locations**

```sh
mkdir -p .build/drift/contents/shaders
scripts/compile-shaders.sh drift/shaders/focus_glow.frag .build/drift/contents/shaders/focus_glow.frag.qsb
ls -la .build/drift/contents/shaders/focus_glow.frag.qsb
```
Expected: the `.qsb` file is created.

- [ ] **Step 3: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Shell script conventions (4-space indent, `set -euo pipefail`) preserved
- [ ] Step 2's command executed and file confirmed present

---

### Task 5: Rewrite the Makefile as the real dependency-graph owner

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Replace the full file**

```makefile
SCRIPT_NAME := drift
VERSION = $(shell grep '"Version"' ./drift/metadata.json | grep -o '[0-9][0-9.]*')

NPM_BIN := ./node_modules/.bin
NPM_INSTALL_STAMP := node_modules/.install-stamp

BUILD_DIR := .build
PKG_DIR := $(BUILD_DIR)/drift
CONTENTS_DIR := $(PKG_DIR)/contents

TS_SOURCES := $(shell find drift/src -type f -name '*.ts') rollup.config.mjs tsconfig.json

MAIN_JS := $(CONTENTS_DIR)/code/main.js
GEN_MAIN_XML_JS := $(BUILD_DIR)/generate-main-xml.cjs
GEN_SHORTCUTS_JS := $(BUILD_DIR)/generate-shortcut-bindings.cjs

MAIN_XML := $(CONTENTS_DIR)/config/main.xml
SHORTCUT_BINDINGS := $(CONTENTS_DIR)/bin/shortcut-bindings.generated.sh

SHADER_SRC := drift/shaders/focus_glow.frag
SHADER_QSB := $(CONTENTS_DIR)/shaders/focus_glow.frag.qsb

UI_SRCS := $(shell find drift/ui -type f -not -name '*.test.*')
UI_OUTS := $(patsubst drift/ui/%,$(CONTENTS_DIR)/ui/%,$(UI_SRCS))

BIN_SRCS := $(shell find drift/bin -type f -not -name '*.test.*')
BIN_OUTS := $(patsubst drift/bin/%,$(CONTENTS_DIR)/bin/%,$(BIN_SRCS))

METADATA := $(PKG_DIR)/metadata.json

.PHONY: build npm-install compile ui bin-scripts shaders lint lint-fix test install uninstall package clean enable disable restart-kwin help

npm-install: $(NPM_INSTALL_STAMP)

$(NPM_INSTALL_STAMP): package.json package-lock.json
	npm install --no-audit --no-fund
	@touch $(NPM_INSTALL_STAMP)

$(MAIN_JS) $(GEN_MAIN_XML_JS) $(GEN_SHORTCUTS_JS) &: $(TS_SOURCES) | npm-install
	$(NPM_BIN)/rollup -c

$(MAIN_XML): $(GEN_MAIN_XML_JS)
	@mkdir -p $(dir $@)
	node $(GEN_MAIN_XML_JS) > $@

$(SHORTCUT_BINDINGS): $(GEN_SHORTCUTS_JS)
	@mkdir -p $(dir $@)
	node $(GEN_SHORTCUTS_JS) > $@

compile: $(MAIN_JS) $(MAIN_XML) $(SHORTCUT_BINDINGS)

$(CONTENTS_DIR)/ui/%: drift/ui/%
	@mkdir -p $(dir $@)
	cp $< $@

$(CONTENTS_DIR)/bin/%: drift/bin/%
	@mkdir -p $(dir $@)
	cp $< $@

ui: $(UI_OUTS)

bin-scripts: $(BIN_OUTS)

$(SHADER_QSB): $(SHADER_SRC) scripts/compile-shaders.sh
	scripts/compile-shaders.sh $(SHADER_SRC) $(SHADER_QSB)

shaders: $(SHADER_QSB)

$(METADATA): drift/metadata.json
	@mkdir -p $(dir $@)
	cp $< $@

lint: npm-install compile ui
	$(NPM_BIN)/eslint .
	$(NPM_BIN)/prettier --check .
	qmllint $(CONTENTS_DIR)/ui/main.qml

lint-fix: npm-install
	$(NPM_BIN)/eslint . --fix
	$(NPM_BIN)/prettier --write .

test: npm-install $(MAIN_XML)
	$(NPM_BIN)/vitest run

build: lint test compile ui bin-scripts shaders $(METADATA)

install: build
	kpackagetool6 --type=KWin/Script --install=./$(PKG_DIR) || kpackagetool6 --type=KWin/Script --upgrade=./$(PKG_DIR)

uninstall:
	kpackagetool6 --type=KWin/Script --remove=$(SCRIPT_NAME)

package: build
	cd $(BUILD_DIR) && zip -r ../$(SCRIPT_NAME)_$(subst .,_,$(VERSION)).kwinscript ./drift

clean:
	rm -rf $(BUILD_DIR)
	rm -f ./drift_*.kwinscript
	rm -f $(NPM_INSTALL_STAMP)

enable:
	@echo "Enabling $(SCRIPT_NAME)..."
	@kwriteconfig6 --file kwinrc --group Plugins --key $(SCRIPT_NAME)Enabled true
	@qdbus6 org.kde.KWin /KWin reconfigure

disable:
	@echo "Disabling $(SCRIPT_NAME)..."
	@kwriteconfig6 --file kwinrc --group Plugins --key $(SCRIPT_NAME)Enabled false
	@qdbus6 org.kde.KWin /KWin reconfigure

restart-kwin:
	@if [ "$$XDG_SESSION_TYPE" = "x11" ]; then \
		kwin_x11 --replace & \
	elif [ "$$XDG_SESSION_TYPE" = "wayland" ]; then \
		kwin_wayland --replace & \
	else \
		echo "Unknown session type"; \
	fi

help:
	@echo "Makefile commands:"
	@echo "  build          - Lint, test, and assemble the addon package in .build/drift (default)"
	@echo "  npm-install    - Install npm dependencies"
	@echo "  compile        - Compile TypeScript and generate config/shortcut files"
	@echo "  ui             - Copy QML/UI source files into the package"
	@echo "  bin-scripts    - Copy shell scripts into the package"
	@echo "  shaders        - Compile shader sources"
	@echo "  lint           - Run lint checks"
	@echo "  lint-fix       - Apply lint autofixes"
	@echo "  test           - Run tests"
	@echo "  install        - Build and install the script via kpackagetool6"
	@echo "  uninstall      - Uninstall the script"
	@echo "  package        - Build a KWin script archive for distribution"
	@echo "  clean          - Remove build artifacts"
	@echo "  enable         - Enable the script in KWin"
	@echo "  disable        - Disable the script in KWin"
	@echo "  restart-kwin   - Restart KWin to apply changes"
	@echo "  help           - Show this help message"
```

- [ ] **Step 2: Verify a clean build from scratch**

```sh
make clean
make build
```
Expected: exits 0; eslint/prettier/qmllint pass; all tests pass; `.build/drift/contents/{code/main.js,config/main.xml,ui/main.qml,ui/config.ui,shaders/focus_glow.frag.qsb,bin/setup-shortcuts.sh,bin/setup-shortcuts-lib.sh,bin/shortcut-bindings.generated.sh}` and `.build/drift/metadata.json` all exist; `.build/drift/contents/shaders/focus_glow.frag` (raw source) does **not** exist; `.build/drift/contents/bin/setup-shortcuts-lib.test.sh` does **not** exist.

- [ ] **Step 3: Verify no duplicate compilation and correct incremental behavior**

```sh
make build 2>&1 | grep -c "rollup -c\|\.bin/rollup"
```
Run once right after Step 2 (nothing changed) — expected: rollup does not run again (0 matches), since Make sees all outputs are newer than their sources. Then touch a source file and re-run:
```sh
touch drift/src/main.ts
make build 2>&1 | grep -c "\.bin/rollup"
```
Expected: exactly 1 (single recompile, shared by `lint` and `compile`/`build`, not tripled).

- [ ] **Step 4: Verify packaging**

```sh
make package
unzip -l drift_*.kwinscript
```
Expected: archive contains `drift/metadata.json` and `drift/contents/{code,ui,config,shaders,bin}/...` with the same exclusions as Step 2 (no raw `.frag`, no `*.test.sh`).

- [ ] **Step 5: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] Makefile indentation uses tabs for recipes (GNU Make requirement, not the repo's 4-space convention — recipes must stay tab-indented or Make errors)
- [ ] Steps 2-4 executed and their expectations confirmed with actual command output, not assumed

---

### Task 6: Strip `package.json` scripts to the bare minimum

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace the `scripts` block**

Old:
```json
    "scripts": {
        "build": "npm run compile && npm run build:shaders",
        "compile": "rollup -c && npm run generate:config",
        "generate:config": "node .build/generate-main-xml.cjs > drift/contents/config/main.xml && node .build/generate-shortcut-bindings.cjs > drift/contents/bin/shortcut-bindings.generated.sh",
        "build:shaders": "scripts/compile-shaders.sh",
        "typecheck": "tsc --noEmit",
        "test": "vitest run",
        "test:watch": "vitest",
        "lint": "eslint . && prettier --check . && npm run compile && qmllint drift/contents/ui/main.qml",
        "lint:fix": "eslint . --fix && prettier --write .",
        "package:install": "npm run build && (kpackagetool6 --type=KWin/Script --install=./drift || kpackagetool6 --type=KWin/Script --upgrade=./drift)",
        "package:remove": "kpackagetool6 --type=KWin/Script --remove=drift"
    },
```
New:
```json
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest"
    },
```

(`package:install`/`package:remove` are dropped — `make install`/`make uninstall` already do the same thing and now correctly point at `.build/drift`. Everything else is invoked directly from the Makefile via `$(NPM_BIN)/<tool>` or `node`, per Task 5. `test`/`test:watch` are kept even though the Makefile calls `$(NPM_BIN)/vitest` directly rather than `npm run test` — there's no downside, since the Makefile doesn't depend on this script's internals, and it keeps the standard `npm test` convention working for anyone who types it out of habit.)

- [ ] **Step 2: Verify nothing outside the Makefile still calls a removed script**

```sh
grep -rn "npm run \(build\|compile\|lint\|generate:config\|build:shaders\|typecheck\|package:install\|package:remove\)\b" --include="*.md" --include="*.sh" --include="*.ts" --include="*.mjs" --include="*.json" . 2>/dev/null | grep -v node_modules | grep -v '/docs/agents/\|/docs/archive/'
```
Expected: no matches outside this plan file itself and the docs Task 7 is about to fix.

- [ ] **Step 3: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read
- [ ] `package.json` remains valid JSON (`node -e "require('./package.json')"` exits 0)
- [ ] Step 2's grep executed and any real hits (outside plans/archive) routed to Task 7

---

### Task 7: Update documentation

**Files:**
- Modify: `README.md`, `AGENTS.md`, `docs/development.md`, `docs/coding-conventions.md`, `docs/architecture.md`, `docs/algorithms.md`, `docs/comparison-keybindings.md`, `docs/glossary.md`

- [ ] **Step 1: `README.md` Contributing section**

Old:
```
npm run build      # bundle the addon
npm test           # run the TypeScript/JavaScript test suite
npm run lint       # ESLint + Prettier + qmllint
```
New:
```
make build         # lint, test, and assemble the addon package
make test          # run the TypeScript/JavaScript test suite
make lint          # ESLint + Prettier + qmllint
```

- [ ] **Step 2: `AGENTS.md` Build & Test section**

Old:
```
This repository targets a KDE Plasma 6 / KWin addon.
Use npm for the TypeScript, JavaScript, and QML package.
Use `npm run build` to build the addon package.
Use `npm test` to run the JavaScript and TypeScript tests.
Use `npm run lint` to run JavaScript, TypeScript, and QML checks, including `qmllint`.
```
New:
```
This repository targets a KDE Plasma 6 / KWin addon.
Use Make for the TypeScript, JavaScript, and QML package — it owns build orchestration with
real file-based dependency tracking; `package.json` holds only metadata and devDependencies.
Use `make build` to lint, test, and assemble the addon package into `.build/drift`.
Use `make test` to run the JavaScript and TypeScript tests.
Use `make lint` to run JavaScript, TypeScript, and QML checks, including `qmllint`.
Source lives entirely under `drift/` (`drift/src` for TypeScript, `drift/ui`, `drift/shaders`,
`drift/bin` for QML/shader/shell sources); `.build/` holds only generated output and is never
committed.
```

(Note: since `.github/copilot-instructions.md` and `CLAUDE.md` are symlinks to `AGENTS.md`, editing `AGENTS.md` updates all three.)

- [ ] **Step 3: `docs/development.md`**

Read the file first (it's short, ~35 lines) and rewrite the Build/Test/Lint/Dev-Reload sections to:
- Reference `drift/src/main.ts` instead of `src/main.ts`, and `.build/drift/contents/code/main.js` instead of `drift/contents/code/main.js`.
- Replace `` `npm run build` bundles... `` with `` `make build` compiles, lints, tests, and assembles the package into `.build/drift`... ``.
- Replace `` `make build` runs lint and test before `npm run build`; `` with `` `make build` runs `lint`, `test`, and the packaging steps together, all sharing one TypeScript compile via Make's own file-based dependency tracking; ``.
- Replace `` `npm test` runs Vitest... `` with `` `make test` runs Vitest... ``.
- Replace `` `npm run lint` runs ESLint and Prettier over `src/`... `` with `` `make lint` runs ESLint and Prettier over `drift/src/`... ``.
- Replace `` `npm run lint:fix` `` with `` `make lint-fix` ``.
- Replace `` `make install` (or `npm run package:install`) `` with `` `make install` ``.
- Replace `` `make uninstall` (or `npm run package:remove`) `` with `` `make uninstall` ``.

- [ ] **Step 4: `docs/coding-conventions.md:56-58`**

Old:
```
Use `npm run build` to build the TypeScript, JavaScript, and QML addon package.
Use `npm test` to run the JavaScript and TypeScript test suite.
Use `npm run lint` to run JavaScript, TypeScript, and QML quality checks, including `qmllint`.
```
New:
```
Use `make build` to build the TypeScript, JavaScript, and QML addon package.
Use `make test` to run the JavaScript and TypeScript test suite.
Use `make lint` to run JavaScript, TypeScript, and QML quality checks, including `qmllint`.
```

- [ ] **Step 5: Fix `src/` and `drift/contents/shaders/` links across the remaining docs**

```sh
sed -i 's#\.\./src/#../drift/src/#g' docs/architecture.md docs/algorithms.md docs/comparison-keybindings.md docs/glossary.md
sed -i 's#drift/contents/shaders/focus_glow\.frag#drift/shaders/focus_glow.frag#g' docs/algorithms.md docs/glossary.md
```

- [ ] **Step 6: Verify no stale references remain in current (non-historical) docs**

```sh
grep -rln "npm run build\|npm run lint\|npm test\b\|(\.\./src/\|drift/contents" README.md AGENTS.md docs/development.md docs/coding-conventions.md docs/architecture.md docs/algorithms.md docs/comparison-keybindings.md docs/glossary.md 2>/dev/null
```
Expected: no output.

- [ ] **Step 7: Coding-guideline follow-up checklist**

- [ ] `docs/coding-conventions.md` read (and is itself one of the edited files — re-check its own "one sentence per line" rule was preserved in edited lines)
- [ ] One sentence per line preserved in all edited doc prose
- [ ] Step 6's grep executed and clean

---

### Task 8: Full end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build from scratch**

```sh
make clean
make build
```
Expected: exit 0.

- [ ] **Step 2: Lint and test independently**

```sh
make lint
make test
```
Expected: both exit 0 independently (not just as part of `build`).

- [ ] **Step 3: Package and inspect contents**

```sh
make package
unzip -l drift_*.kwinscript
rm -f drift_*.kwinscript
```
Expected: contains exactly `drift/metadata.json` and `drift/contents/{code/main.js, config/main.xml, ui/main.qml, ui/config.ui, shaders/focus_glow.frag.qsb, bin/setup-shortcuts.sh, bin/setup-shortcuts-lib.sh, bin/shortcut-bindings.generated.sh}` — no `.frag`, no `*.test.sh`.

- [ ] **Step 4: Confirm `git status` is clean of anything unexpected**

```sh
git status --short
```
Expected: only the intended moves/edits from Tasks 1-7 (plus this plan file); no stray `.build/` or `node_modules/.install-stamp` entries (both gitignored), no leftover `drift/contents/`.

- [ ] **Step 5: Note for the user — not run automatically**

`make install`, `make uninstall`, `make enable`, `make disable`, and `make restart-kwin` all mutate the live KDE session (installing the script, restarting KWin) and are **not** run as part of this verification — the user should smoke-test `make install` manually afterward.

- [ ] **Step 6: Coding-guideline follow-up checklist**

- [ ] All of Steps 1-4 executed with real command output recorded, not assumed
- [ ] Any failure traced to its root cause and fixed in the relevant earlier task, not patched over here
