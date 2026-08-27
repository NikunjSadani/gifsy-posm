import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Default lane = deterministic unit/component tests only (no real network/DB/clock).
    // `e2e/**` holds the Playwright harness (a later wave), never run via vitest.
    exclude: [...configDefaults.exclude, '**/*-live.test.ts', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The `server-only` package throws at import time when evaluated outside the
      // Next.js bundler (which is the case under vitest). Alias it to a no-op stub so
      // server-only modules remain testable.
      'server-only': path.resolve(__dirname, './src/test-utils/server-only-stub.ts'),
    },
  },
});
