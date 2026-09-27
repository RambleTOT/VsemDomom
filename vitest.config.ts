import { defineConfig } from 'vitest/config';

// Каждый пакет описывает свой проект (vitest.config.ts в каталоге пакета).
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.gen.ts', '**/index.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: {
        'packages/core/src/**': { lines: 90 },
      },
    },
  },
});
