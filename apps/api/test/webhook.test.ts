import { ManualClock } from '@vsemdomom/core';
import { ruTranslator } from '@vsemdomom/shared';
import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_SESSION_SECRET, loadConfig } from '../src/config/env.ts';
import type { DbHandle } from '../src/db/client.ts';
import { inboundUpdate, maxUser } from '../src/db/schema.ts';
import { buildApp } from '../src/http/app.ts';
import type { JobContext } from '../src/jobs/context.ts';
import { baseHandlers, processUpdate } from '../src/jobs/process-update.ts';
import { MemoryJobQueue, QUEUES } from '../src/jobs/queue.ts';
import { FakeMaxApi } from '../src/max/fake.ts';
import type { UpdateJob } from '../src/webhook/ingest.ts';
import { freshDb, testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const SECRET = 'test_webhook_secret_123';

describe.skipIf(!url)('webhook /webhook/max (PostgreSQL)', () => {
  let handle: DbHandle;
  const queue = new MemoryJobQueue();
  const config = loadConfig({ DATABASE_URL: url ?? 'x', SESSION_SECRET: LOCAL_SESSION_SECRET, MAX_WEBHOOK_SECRET: SECRET });
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    handle = await freshDb(url!);
    app = await buildApp({ config, log: pino({ level: 'silent' }), readiness: [], webhook: { db: handle.db, queue, keywordMatcher: null } });
  });
  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  const started = { update_type: 'bot_started', timestamp: 1790000000003, chat_id: 555, user: { user_id: 1001, first_name: 'Анна', is_bot: false }, payload: 'h_dom1model1' };
  const post = (body: unknown, secret?: string) =>
    app.inject({ method: 'POST', url: '/webhook/max', payload: body as object, headers: secret === undefined ? {} : { 'x-max-bot-api-secret': secret } });

  it('неверный или отсутствующий секрет → 401, событие не сохраняется', async () => {
    expect((await post(started)).statusCode).toBe(401);
    expect((await post(started, 'wrong_secret_value')).statusCode).toBe(401);
    const rows = await handle.db.select().from(inboundUpdate);
    expect(rows).toHaveLength(0);
  });

  it('верный секрет → 200, событие сохранено и поставлено в очередь', async () => {
    const res = await post(started, SECRET);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const rows = await handle.db.select().from(inboundUpdate);
    expect(rows.map((r) => r.dedupeKey)).toEqual(['bot_started:555:1001:1790000000003']);
    const jobs = queue.take(QUEUES.update) as UpdateJob[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.update).toMatchObject({ type: 'bot_started', userId: 1001, payload: 'h_dom1model1' });
    expect(JSON.stringify(jobs)).not.toContain('Анна');
  });

  it('повтор события от MAX: 200, но вторая задача не ставится', async () => {
    expect((await post(started, SECRET)).statusCode).toBe(200);
    expect(queue.take(QUEUES.update)).toHaveLength(0);
  });

  it('нажатие кнопки — с приоритетом', async () => {
    const cb = {
      update_type: 'message_callback',
      timestamp: 1790000000100,
      callback: { callback_id: 'cb.777', payload: 'v1:join:K3f9QpZ2aB:2', user: { user_id: 1002, first_name: 'Борис' } },
      message: { recipient: { chat_id: -1001, chat_type: 'chat' }, timestamp: 1, body: { mid: 'mid.card', seq: 1 } },
    };
    expect((await post(cb, SECRET)).statusCode).toBe(200);
    const sent = queue.sent.filter((s) => s.queue === QUEUES.update);
    expect(sent.at(-1)?.options?.priority).toBe(10);
    queue.take(QUEUES.update);
  });

  it('неверный формат → 400', async () => {
    expect((await post({ hello: 'world' }, SECRET)).statusCode).toBe(400);
  });

  it('обработка: bot_started включает личку, bot_stopped — выключает; событие отмечено обработанным', async () => {
    const ctx = {
      config,
      db: handle.db,
      queue,
      max: new FakeMaxApi({ clock: new ManualClock(new Date()), botUsername: 'bot' }),
      log: pino({ level: 'silent' }),
      clock: new ManualClock(new Date('2026-09-27T12:00:00Z')),
      i18n: ruTranslator,
    } satisfies JobContext;
    const key = 'bot_started:555:1001:1790000000003';
    await processUpdate({ dedupeKey: key, update: { type: 'bot_started', timestamp: 1, chatId: 555, userId: 1001, chatType: 'dialog', locale: 'ru' } }, baseHandlers, ctx);
    let user = await handle.db.select().from(maxUser).where(eq(maxUser.id, 1001));
    expect(user[0]).toMatchObject({ dialogActive: true, locale: 'ru' });
    const processed = await handle.db.execute<{ processed: boolean }>(sql`select processed_at is not null as processed from inbound_update where dedupe_key = ${key}`);
    expect(processed.rows[0]?.processed).toBe(true);
    await processUpdate({ dedupeKey: 'x', update: { type: 'bot_stopped', timestamp: 2, chatId: 555, userId: 1001, chatType: 'dialog' } }, baseHandlers, ctx);
    user = await handle.db.select().from(maxUser).where(eq(maxUser.id, 1001));
    expect(user[0]?.dialogActive).toBe(false);
  });
});

describe('webhook в режиме симулятора без секрета', () => {
  it('принимает события без заголовка только в simulator', () => {
    const sim = loadConfig({ DATABASE_URL: 'x', SESSION_SECRET: LOCAL_SESSION_SECRET });
    expect(sim.max.mode).toBe('simulator');
    expect(sim.max.webhookSecret).toBeUndefined();
  });
});
