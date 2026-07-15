/**
 * Vitest configuration for pure domain, application, compiler, and HTML tests.
 * VS Code-host integration tests are intentionally kept out of this fast unit-test suite.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    mockReset: true,
    restoreMocks: true,
  },
});
