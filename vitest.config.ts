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
    /**
     * Compiler integration cases intentionally construct broad module graphs.
     * File-level workers can contend for CPU during the full suite even when an isolated compile
     * finishes in under a second, so the timeout guards deadlocks without treating contention as
     * a product regression.
     */
    testTimeout: 15_000,
  },
});
