import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from '../../src/index.ts';

/** Словарь из packages/shared/i18n/ru.json — рендеры проверяются на настоящих текстах. */
export const t = createTranslator(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../shared/i18n/ru.json'), 'utf8')) as Record<string, unknown>,
);
