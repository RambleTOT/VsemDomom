import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Problem } from '@vsemdomom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { auditLog, house, incident } from '../src/db/schema.ts';
import { parseBody, runDataApi, schemaProblems, type DataApiDoc, type Transport } from '../src/scripts/data-api-runner.ts';
import { resolveDataDir } from '../src/util/paths.ts';
import { CHECKER, createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { STAFF_ID } from './helpers/bot-harness.ts';
import { seedsDir, testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const apiDocs = resolveDataDir(undefined, 'docs/api');
const doc = parse(readFileSync(join(apiDocs, 'DATA-API.yaml'), 'utf8')) as DataApiDoc;
const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const testData = (name: string) => json(join(apiDocs, 'test-data', name));
const tokens = { resident: CHECKER.resident, resident2: CHECKER.resident2, uk: CHECKER.uk };

describe('DATA-API: файл и тестовые данные', () => {
  it('тела запросов DATA-API совпадают с docs/api/test-data', () => {
    const body = (id: string) => doc.checks.find((c) => c.id === id)?.request?.body;
    expect(body('incident-create')).toEqual(testData('incident-create.json'));
    expect(body('incident-create-unauthorized')).toEqual(testData('incident-create.json'));
    expect(body('incident-join')).toEqual(testData('incident-join.json'));
    expect(body('uk-accept')).toEqual(testData('uk-accept.json'));
    expect(body('uk-status-by-resident')).toEqual(testData('uk-accept.json'));
    expect(body('uk-resolve')).toEqual(testData('uk-resolve.json'));
    expect(body('recalculation')).toEqual(testData('recalculation.json'));
  });

  it('дом-песочница и роли в test-data — как в сидах', () => {
    const sandbox = testData('sandbox.json') as { house: Record<string, unknown>; roles: Record<string, Record<string, unknown>> };
    const houses = json(join(seedsDir, 'houses.json')) as { houses: Record<string, unknown>[] };
    const checker = json(join(seedsDir, 'checker.json')) as { sandboxHousePublicId: string; users: Record<string, unknown>[] };
    const seeded = houses.houses.find((h) => h.publicId === checker.sandboxHousePublicId)!;
    expect(seeded.isSandbox).toBe(true);
    expect(seeded).toMatchObject(sandbox.house);
    for (const [name, role] of Object.entries(sandbox.roles)) expect(checker.users.find((u) => u.name === name)).toMatchObject(role);
    const roles = new Set([...doc.checks, ...(doc.cleanup ?? [])].map((c) => c.role));
    expect([...roles].filter((r) => r !== 'public').sort()).toEqual(Object.keys(sandbox.roles).sort());
    expect(doc.checks.find((c) => c.id === 'incident-create')?.request?.body).toMatchObject({ houseId: checker.sandboxHousePublicId });
  });

  it('прогон проверяет все ключевые слова bodySchema, незнакомое — ошибка', () => {
    expect(schemaProblems({ type: 'array', contains: { const: 1 } }, [2, 1])).toEqual([]);
    expect(schemaProblems({ type: 'object', properties: { n: { type: 'integer', minimum: 2 } } }, { n: 1 })).toEqual(['$.n: 1 < 2']);
    expect(schemaProblems({ pattern: '^a' }, 'b')).toEqual(['$: ключевое слово «pattern» не поддерживается прогоном']);
  });
});

describe.skipIf(!url)('DATA-API: цепочка на доме-песочнице против API (A12)', () => {
  let api: ApiHarness;

  const send: Transport = async (req) => {
    const res = await api.app.inject({
      method: req.method as 'GET' | 'POST',
      url: req.url,
      headers: req.headers,
      ...(req.body === undefined ? {} : { payload: req.body as object }),
    });
    const contentType = res.headers['content-type'];
    return { status: res.statusCode, contentType: typeof contentType === 'string' ? contentType : null, body: parseBody(res.body) };
  };

  beforeAll(async () => {
    api = await createApiHarness(url!);
  });
  afterAll(async () => {
    await api?.close();
  });

  const sandboxIncidents = async () => {
    const [sandbox] = await api.handle.db.select({ id: house.id }).from(house).where(eq(house.isSandbox, true));
    return api.handle.db.select({ id: incident.id, status: incident.status }).from(incident).where(inArray(incident.houseId, [sandbox!.id]));
  };

  it('проходит целиком и повторяется: после cleanup песочница пуста, сообщений в MAX нет', async () => {
    for (const run of [1, 2]) {
      const result = await runDataApi(doc, send, tokens);
      const failed = [...result.checks, ...result.cleanup].filter((s) => s.problems.length > 0);
      expect(failed, `прогон ${run}`).toEqual([]);
      expect(result.checks.map((c) => c.id)).toEqual(doc.checks.map((c) => c.id));
      await api.drain();
      expect(await sandboxIncidents()).toEqual([]);
    }
    expect(api.max.messages.size).toBe(0);
  });

  it('прогон замечает непрошедшую проверку', async () => {
    const broken = structuredClone(doc);
    broken.checks.find((c) => c.id === 'health')!.expected!.statusCodes = [418];
    const result = await runDataApi(broken, send, tokens);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'health')?.problems).toEqual(['код 200, ожидался 418']);
    expect(result.cleanup.every((c) => c.problems.length === 0)).toBe(true);
  });

  it('сброс песочницы: только тестовый токен УК; при выключенном CHECKER_API_ENABLED — 404', async () => {
    const reset = (token?: string) => api.call<Problem>('POST', '/api/v1/sandbox/reset', token ? { token } : {});
    await api.call('POST', '/api/v1/incidents', { token: CHECKER.resident, body: testData('incident-create.json') });
    expect(await sandboxIncidents()).toHaveLength(1);
    const staff = await api.login(STAFF_ID, 'uk');
    expect((await reset()).status).toBe(401);
    expect((await reset(CHECKER.resident)).body.code).toBe('forbidden');
    expect((await reset(staff)).status).toBe(403);
    expect((await reset(CHECKER.uk)).status).toBe(204);
    expect(await sandboxIncidents()).toEqual([]);
    const log = await api.handle.db.select().from(auditLog).where(eq(auditLog.action, 'sandbox_reset'));
    expect(log.at(-1)).toMatchObject({ actor: 'staff:-1003', entity: 'house', entityId: 'dom5sandbx' });
    api.ctx.config.checker.enabled = false;
    try {
      expect((await reset(staff)).status).toBe(404);
      expect((await reset(CHECKER.uk)).status).toBe(401);
    } finally {
      api.ctx.config.checker.enabled = true;
    }
  });
});
