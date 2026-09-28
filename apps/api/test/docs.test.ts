import { apiRoutes } from '@vsemdomom/shared';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOCS_PREFIX, registerDocs } from '../src/http/docs.ts';

describe('Swagger UI (/api/docs)', () => {
  const app = Fastify();

  beforeAll(async () => {
    expect(await registerDocs(app, { openapiFile: undefined })).toBe(true);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('отдаёт контракт 1.0.0 со всеми операциями и схемой авторизации', async () => {
    const res = await app.inject({ method: 'GET', url: `${DOCS_PREFIX}/json` });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; info: { version: string }; paths: Record<string, Record<string, { operationId?: string }>>; components: { securitySchemes: Record<string, unknown> } }>();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('1.0.0');
    const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods).map((op) => op.operationId));
    for (const route of apiRoutes) expect(operations, route.operationId).toContain(route.operationId);
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
  });

  it('страница Swagger UI со своей CSP; статика подключается', async () => {
    const res = await app.inject({ method: 'GET', url: DOCS_PREFIX });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('swagger-ui');
    expect(res.headers['content-security-policy']).toBeTruthy();
    const scripts = [...res.body.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) expect((await app.inject({ method: 'GET', url: src })).statusCode, src).toBe(200);
  });
});
