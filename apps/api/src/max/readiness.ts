import type { ReadinessCheck } from '../http/types.ts';
import type { MaxApi } from './types.ts';

const CACHE_MS = 60_000;

/**
 * Готовность MAX: GET /me (проверяет токен и сертификаты Минцифры), результат кэшируется
 * на минуту, чтобы /ready не нагружал Bot API. В симуляторе — всегда готов.
 */
export function maxCheck(max: MaxApi, now: () => number = Date.now): ReadinessCheck {
  let cached: { at: number; ok: boolean; detail?: string } | null = null;
  return {
    name: 'max',
    async check() {
      if (max.kind === 'fake') return { ok: true };
      const t = now();
      if (cached && t - cached.at < CACHE_MS) return cached.detail === undefined ? { ok: cached.ok } : { ok: cached.ok, detail: cached.detail };
      try {
        await max.getMe();
        cached = { at: t, ok: true };
      } catch (err) {
        cached = { at: t, ok: false, detail: err instanceof Error ? err.message : 'MAX недоступен' };
      }
      return cached.detail === undefined ? { ok: cached.ok } : { ok: cached.ok, detail: cached.detail };
    },
  };
}
