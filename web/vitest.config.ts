import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Browser-driven LF specs are Playwright fixtures, not Vitest unit tests.
    exclude: [...configDefaults.exclude, '**/e2e/**/*.spec.ts', '**/e2e-lf/**/*.spec.ts', '**/e2e-cloud/**/*.spec.ts'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    testTimeout: 10000,
  },
});
