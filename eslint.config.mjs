import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['drift/contents/code/main.js', 'node_modules/**', '.agents/**', '.serena/**', '.github/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
            },
        },
    },
    {
        // KWin's declarativescript JS engine rejects spread syntax and optional catch bindings
        // at parse time (SyntaxError, whole script fails to load). Bundled sources must never
        // emit either.
        files: ['src/**/*.ts'],
        ignores: ['src/**/*.test.ts'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'SpreadElement',
                    message:
                        'Spread syntax (...) is not supported by KWin\u2019s JS engine; use Object.assign or an explicit loop instead.',
                },
                {
                    selector: 'CatchClause[param=null]',
                    message:
                        'Optional catch binding (catch {}) is not supported by KWin\u2019s JS engine; use catch (error) instead.',
                },
            ],
        },
    },
    {
        files: ['*.config.{mjs,ts}', 'rollup.config.mjs', 'vitest.config.ts', 'eslint.config.mjs'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
    prettier,
);
