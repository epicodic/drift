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
