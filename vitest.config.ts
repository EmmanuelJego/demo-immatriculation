import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    // Loaded by Nest at runtime; decorators of isolated units need it too.
    setupFiles: ['reflect-metadata'],
  },
});
