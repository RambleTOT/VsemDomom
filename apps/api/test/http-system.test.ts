import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_SESSION_SECRET, loadConfig } from '../src/config/env.ts';
import { buildApp } from '../src/http/app.ts';
import type { ReadinessCheck } from '../src/http/types.ts';

let dbOk = true;
const readiness: ReadinessCheck[] = [
  { name: 'db', check: async () => (dbOk ? { ok: true } : { ok: false, detail: 'нет соединения' }) },
];
const config = loadConfig({ DATABASE_URL: 'postgres://x', SESSION_SECRET: LOCAL_SESSION_SECRET, GIT_COMMIT: 'test123' });
const app = await buildApp({ config, log: pino({ level: 'silent' }), readiness });

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('системные эндпоинты', () => {
  it('/health и /api/v1/health → 200 с X-Request-Id', async () => {
    for (const url of ['/health', '/api/v1/health']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
      expect(res.headers['x-request-id']).toBeTruthy();
    }
  });

  it('/ready → 200, а при недоступной зависимости → 503', async () => {
    dbOk = true;
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
    dbOk = false;
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'fail', checks: { db: 'нет соединения' } });
    dbOk = true;
  });

  it('/api/v1/version отдаёт commit и флаги функций', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ commit: string; features: Record<string, boolean>; maxMode: string }>();
    expect(body.commit).toBe('test123');
    expect(body.maxMode).toBe('simulator');
    expect(body.features.keywordReply).toBe(false);
  });

  it('неизвестный путь → 404 application/problem+json с traceId = X-Request-Id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope', headers: { 'x-request-id': 'req-12345678' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.headers['x-request-id']).toBe('req-12345678');
    expect(res.json()).toMatchObject({ status: 404, code: 'not_found', traceId: 'req-12345678' });
  });
});
