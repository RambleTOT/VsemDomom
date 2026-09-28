/**
 * Лимиты запросов (раздел 11 ТЗ): 60 в минуту на пользователя (без входа — на IP),
 * 10 в минуту на вход с одного IP. Проверка — после разбора авторизации (preHandler).
 * Системные маршруты и webhook MAX не ограничиваются.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from './problem.ts';

/** Запросов в минуту: на пользователя и на вход с одного IP (раздел 11 ТЗ). */
export interface RateLimits {
  userPerMinute: number;
  authPerMinute: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { userPerMinute: 60, authPerMinute: 10 };

const WINDOW = '1 minute';

/** Проверки и статика документации — без лимита. */
const UNLIMITED = /^\/api\/(v1\/(health|version)(\?|$)|docs(\/|$|\?))/;

function keyOf(req: FastifyRequest): string {
  return req.principal ? `${req.principal.kind}:${req.principal.userId}` : `ip:${req.ip}`;
}

export async function registerRateLimit(app: FastifyInstance, limits: RateLimits): Promise<void> {
  await app.register(rateLimit, {
    max: limits.userPerMinute,
    timeWindow: WINDOW,
    hook: 'preHandler',
    keyGenerator: keyOf,
    allowList: (req) => !req.url.startsWith('/api/v1/') || UNLIMITED.test(req.url),
    errorResponseBuilder: (_req, context) =>
      new ApiError(429, 'rate_limited', 'Слишком много запросов', `Повторите через ${context.after}`),
  });
}

/** Для маршрутов входа: ключ — IP, а не пользователь. */
export const ipKey = (req: FastifyRequest): string => `ip:${req.ip}`;

export function authRateLimit(limits: RateLimits) {
  return { max: limits.authPerMinute, timeWindow: WINDOW, keyGenerator: ipKey };
}

/** Ввод кодов (демо-код УК): тот же строгий лимит, но на пользователя — против перебора. */
export function codeRateLimit(limits: RateLimits) {
  return { max: limits.authPerMinute, timeWindow: WINDOW, keyGenerator: keyOf };
}
