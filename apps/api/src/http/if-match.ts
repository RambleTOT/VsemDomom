/**
 * Оптимистичная блокировка УК: If-Match: <version> (необязательный). Передан и устарел → 409
 * version_conflict с currentVersion; не передан — последнее изменение выигрывает.
 */
import { ApiError } from './problem.ts';

const VERSION = /^(?:W\/)?"?(\d{1,9})"?$/;

export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined || header.trim() === '' || header.trim() === '*') return null;
  const m = VERSION.exec(header.trim());
  if (!m) throw new ApiError(400, 'validation_error', 'Неверный формат запроса', 'If-Match: ожидается номер версии');
  return Number(m[1]);
}

export function assertVersion(expected: number | null, current: number): void {
  if (expected !== null && expected !== current) {
    throw new ApiError(409, 'version_conflict', 'Авария изменилась', 'Обновите экран и повторите', { currentVersion: current });
  }
}
