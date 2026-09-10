import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.join(ROOT, 'packages', 'core', 'src'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'apps/*/src/**'],
    },
  },
});
