/**
 * Лимиты запросов (раздел 11 ТЗ): 60 в минуту на пользователя (без входа — на IP), вход с одного IP —
 * 60 в минуту (по ТЗ 10: подняли, жюри может открывать приложение из одной сети), ввод кода — 10 в минуту
 * на пользователя. Проверка — после разбора авторизации (preHandler). Системные маршруты и webhook MAX
 * не ограничиваются.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from './problem.ts';

/** Запросов в минуту: на пользователя, на вход с одного IP и на ввод кода пользователем. */
export interface RateLimits {
  userPerMinute: number;
  authPerMinute: number;
  /** Ввод кодов (демо-код УК) на пользователя; не задан — как вход. */
  codePerMinute?: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { userPerMinute: 60, authPerMinute: 60, codePerMinute: 10 };

const WINDOW = '1 minute';
const MS_PER_SECOND = 1000;

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
    // context.after — английская строка («1 minute»): в ответ пишем секунды по-русски.
    errorResponseBuilder: (_req, context) =>
      new ApiError(429, 'rate_limited', 'Слишком много запросов', `Повторите через ${Math.max(1, Math.ceil(context.ttl / MS_PER_SECOND))} с`),
  });
}

/** Для маршрутов входа: ключ — IP, а не пользователь. */
export const ipKey = (req: FastifyRequest): string => `ip:${req.ip}`;

export function authRateLimit(limits: RateLimits) {
  return { max: limits.authPerMinute, timeWindow: WINDOW, keyGenerator: ipKey };
}

/** Ввод кодов (демо-код УК): строгий лимит на пользователя — против перебора. */
export function codeRateLimit(limits: RateLimits) {
  return { max: limits.codePerMinute ?? limits.authPerMinute, timeWindow: WINDOW, keyGenerator: keyOf };
}
