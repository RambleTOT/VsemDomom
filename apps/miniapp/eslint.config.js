// ESLint мини-приложения (поток B): React 19 + MAX UI, браузер.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Возможности MAX Bridge, которые не работают в веб-версии MAX: в основном пути не используем.
const WEB_UNSUPPORTED = ['DeviceStorage', 'SecureStorage', 'BiometricManager', 'HapticFeedback', 'shareContent', 'downloadFile'];
const WEB_MESSAGE = 'Не работает в веб-версии MAX — сценарий должен работать и там.';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      // onClick={async () => …} в JSX допустим: промис обработан внутри.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-restricted-properties': ['error', ...WEB_UNSUPPORTED.map((property) => ({ property, message: WEB_MESSAGE }))],
      'no-restricted-syntax': ['error', { selector: `Identifier[name=/^(${WEB_UNSUPPORTED.join('|')})$/]`, message: WEB_MESSAGE }],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            // Корень shared тянет zod-схемы и таблицу маршрутов: из него — только типы.
            { name: '@vsemdomom/shared', allowTypeImports: true, message: 'Значения — из @vsemdomom/shared/browser, из корня — только типы.' },
          ],
          patterns: [
            { group: ['@vsemdomom/core', '@vsemdomom/core/*', '@vsemdomom/api', '@vsemdomom/api/*'], message: 'Мини-приложение импортирует только @vsemdomom/shared.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);
