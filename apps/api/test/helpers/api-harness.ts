/**
 * Стенд REST API: тот же стенд бота (тестовая БД с сидами, симулятор MAX, очередь в памяти, ручные часы)
 * плюс приложение Fastify с /api/v1. Запросы — через app.inject, без сети.
 */
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { signInitData } from '../../src/auth/init-data.ts';
import { LOCAL_CHECKER_TOKENS } from '../../src/config/env.ts';
import { PARAMS } from '../../src/config/params.ts';
import { buildApp } from '../../src/http/app.ts';
import type { RateLimits } from '../../src/http/rate-limit.ts';
import type { FakeChat } from '../../src/max/fake.ts';
import { createHarness, type Harness } from './bot-harness.ts';

/** Тестовый токен бота — не секрет: им подписываются тестовые initData. */
export const TEST_BOT_TOKEN = 'local-only-test-bot-token';
export const CHECKER = { resident: LOCAL_CHECKER_TOKENS[0]!, resident2: LOCAL_CHECKER_TOKENS[1]!, uk: LOCAL_CHECKER_TOKENS[2]! };

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

export interface ApiHarness extends Harness {
  app: FastifyInstance;
  call<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, options?: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<ApiResponse<T>>;
  /** Dev-вход: сессия пользователя (DEV_AUTH=true в стенде). */
  login(userId: number, role?: 'resident' | 'uk'): Promise<string>;
  /** Житель: вход, согласие, проживание. */
  resident(userId: number, house: string, flatNo: number): Promise<string>;
  initData(fields: Record<string, string>): string;
}

const NO_LIMITS: RateLimits = { userPerMinute: 100_000, authPerMinute: 100_000 };

export async function createApiHarness(
  url: string,
  options: { env?: Record<string, string>; chats?: FakeChat[]; rateLimits?: RateLimits; dbJournal?: boolean } = {},
): Promise<ApiHarness> {
  const h = await createHarness(url, {
    env: {
      DEV_AUTH: 'true',
      MAX_BOT_TOKEN: TEST_BOT_TOKEN,
      CHECKER_API_ENABLED: 'true',
      CHECKER_TOKEN_RESIDENT: CHECKER.resident,
      CHECKER_TOKEN_RESIDENT_2: CHECKER.resident2,
      CHECKER_TOKEN_UK: CHECKER.uk,
      ...options.env,
    },
    ...(options.chats ? { chats: options.chats } : {}),
    ...(options.dbJournal ? { dbJournal: true } : {}),
  });
  const app = await buildApp({
    config: h.ctx.config,
    log: pino({ level: 'silent' }),
    readiness: [],
    webhook: { db: h.handle.db, queue: h.queue, keywordMatcher: null },
    api: h.ctx,
    rateLimits: options.rateLimits ?? NO_LIMITS,
  });

  const call: ApiHarness['call'] = async (method, path, opts = {}) => {
    const res = await app.inject({
      method,
      url: path,
      ...(opts.body === undefined ? {} : { payload: opts.body as object }),
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    });
    return { status: res.statusCode, body: res.body ? res.json() : (undefined as never), headers: res.headers };
  };

  const login: ApiHarness['login'] = async (userId, role = 'resident') => {
    const res = await call<{ token: string }>('POST', '/api/v1/auth/dev', { body: { userId, role } });
    if (res.status !== 200) throw new Error(`dev-вход не удался: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.token;
  };

  return {
    ...h,
    app,
    call,
    login,
    async resident(userId, house, flatNo) {
      const token = await login(userId);
      await call('POST', '/api/v1/me/consent', { token, body: { version: PARAMS.consentVersion } });
      const res = await call('PUT', '/api/v1/me/residency', { token, body: { houseId: house, flatNo, role: 'owner' } });
      if (res.status !== 200) throw new Error(`проживание не сохранено: ${res.status} ${JSON.stringify(res.body)}`);
      return token;
    },
    initData(fields) {
      const hash = signInitData(new Map(Object.entries(fields)), TEST_BOT_TOKEN);
      return [...Object.entries(fields), ['hash', hash]].map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
    },
    close: async () => {
      await app.close();
      await h.close();
    },
  };
}
