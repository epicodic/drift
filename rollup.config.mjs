import typescript from '@rollup/plugin-typescript';

// The QML host (contents/ui/main.qml) imports this bundle and calls
// `Drift.init(root)` (docs §6.2). Rollup wraps the src/ module tree in
// an IIFE assigned to `DriftBundle`; the footer re-exposes `init` as a top-level
// function declaration, which is the form QML reliably exposes to `import "..." as
// Drift` (matches the working Karousel build). The footer's own parameter list must be
// kept in sync with `main.ts`'s `init` signature — extra call-site arguments are
// silently dropped otherwise.
export default {
    input: 'src/main.ts',
    output: {
        file: 'drift/contents/code/main.js',
        format: 'iife',
        name: 'DriftBundle',
        footer: 'function init(root) { return DriftBundle.init(root); }',
    },
    plugins: [
        typescript({
            tsconfig: './tsconfig.json',
            noEmitOnError: true,
        }),
    ],
};
