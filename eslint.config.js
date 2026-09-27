// ESLint для потока A: packages/* и apps/api.
// apps/miniapp держит собственный eslint.config.js (ESLint 10 ищет конфиг рядом с файлом).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const IO_MODULES = [
  'node:*',
  'fs',
  'fs/*',
  'net',
  'http',
  'https',
  'child_process',
  'pg',
  'pg-boss',
  'fastify',
  '@fastify/*',
  'pino',
  'drizzle-orm',
  'drizzle-orm/*',
  'jose',
  'undici',
];

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.gen.ts',
      'design/**',
      'apps/miniapp/**',
      'db/migrations/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Обработчики Fastify и реализации интерфейсов бывают async без await.
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  // Ядро: без ввода-вывода и без числовых литералов вне файлов констант.
  // Нормативы (сроки, лимиты, ставки) приходят только из таблицы norm.
  {
    files: ['packages/core/src/**/*.ts'],
    // Литералы допустимы только в перечислениях и файлах констант (единицы времени, лимиты платформы).
    ignores: ['packages/core/src/constants/**', 'packages/core/src/domain/enums.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: IO_MODULES, message: 'packages/core — чистая логика без ввода-вывода.' },
            { group: ['@vsemdomom/*'], message: 'packages/core ни от чего не зависит внутри репозитория.' },
          ],
        },
      ],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, '0n', '1n'],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
        },
      ],
    },
  },
  // Общий контракт работает и в браузере (мини-приложение): без модулей Node и ввода-вывода.
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: IO_MODULES, message: 'packages/shared используется мини-приложением: без модулей Node.' },
            { group: ['@vsemdomom/api', '@vsemdomom/miniapp'], message: 'shared не зависит от приложений.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/scripts/**/*.ts', 'scripts/**/*.ts', '**/vitest.config.ts', '**/drizzle.config.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
