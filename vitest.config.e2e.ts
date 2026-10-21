import { defineConfig } from 'vitest/config';
import { testEnv } from './test/support/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    env: testEnv,
    globalSetup: ['./test/support/global-setup.ts'],
    // All test files share one database, wiped before each test.
    fileParallelism: false,
  },
});
