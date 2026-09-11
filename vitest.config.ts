import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['drift/src/**/*.test.ts'],
        environment: 'node',
        passWithNoTests: true,
    },
});
