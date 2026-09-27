import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Ищет каталог вверх от стартового: seeds/ и db/migrations лежат в корне репозитория,
 * а в образе — рядом с приложением (/app/seeds, /app/db/migrations).
 */
export function findUp(relative: string, from: string = import.meta.dirname): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveDataDir(envValue: string | undefined, relative: string): string {
  if (envValue) return resolve(envValue);
  const found = findUp(relative);
  if (!found) throw new Error(`Не найден каталог ${relative}: задайте путь через переменную окружения`);
  return found;
}
