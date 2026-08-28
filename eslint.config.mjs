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
        files: ['*.config.{mjs,ts}', 'rollup.config.mjs', 'vitest.config.ts', 'eslint.config.mjs'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
    prettier,
);
