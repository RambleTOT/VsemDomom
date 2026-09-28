/**
 * Отказы и нагрузка (раздел 17 ТЗ) на настоящей очереди pg-boss и настоящем HTTP-клиенте MAX.
 * Поддельный сервер MAX держит лимит 2 запроса в секунду на отправку, правку и ответ нажавшему
 * (как MAX в одном чате) и отвечает 429 при превышении.
 * Нагрузка (30 нажатий за 5 секунд) — отдельно: pnpm e2e:load (E2E_LOAD=1), это около 30 секунд.
 */
import { encodeCallback, type IncidentScope } from '@vsemdomom/core';
import { ruTranslator } from '@vsemdomom/shared';
import { eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botJobHandlers, botUpdateHandlers } from '../src/bot/index.ts';
import { LOCAL_SESSION_SECRET, loadConfig } from '../src/config/env.ts';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { houseByPublicId } from '../src/db/queries.ts';
import { chatCard, houseChat, inboundUpdate, incidentParticipant } from '../src/db/schema.ts';
import { runSeeds } from '../src/db/seed.ts';
import { buildApp } from '../src/http/app.ts';
import type { JobContext } from '../src/jobs/context.ts';
import { BOSS_SCHEMA, createBoss, ensureQueues, MemoryJobQueue, PgBossQueue } from '../src/jobs/queue.ts';
import { startWorkers } from '../src/jobs/runtime.ts';
import { HttpMaxApi } from '../src/max/http.ts';
import { RateLimiter } from '../src/max/rate-limiter.ts';
import { createIncident } from '../src/services/incidents.ts';
import { systemClock } from '../src/util/clock.ts';
import { ingestUpdate } from '../src/webhook/ingest.ts';
import { BOT_USERNAME, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { freshDb, seedsDir, testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const LIMIT_PER_SECOND = 2;
const log = pino({ level: 'silent' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ServerCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: { text?: string } | undefined;
  status: number;
  at: number;
}

/** Поддельный MAX: ответы в формате Bot API, лимит частоты на операцию, журнал вызовов. */
function fakeMaxServer() {
  const calls: ServerCall[] = [];
  const hits = new Map<string, number[]>();
  let mid = 0;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as ServerCall['body']) : undefined;
    const key = `${method} ${u.pathname}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 1000);
    const limited = ['POST /messages', 'PUT /messages', 'POST /answers'].includes(key) && recent.length >= LIMIT_PER_SECOND;
    if (!limited) recent.push(now);
    hits.set(key, recent);
    calls.push({ method, path: u.pathname, query: u.searchParams, body, status: limited ? 429 : 200, at: now });
    if (limited) return json(429, { code: 'too.many.requests', message: 'Too many requests' }, { 'retry-after': '1' });
    if (key === 'POST /messages') {
      mid += 1;
      return json(200, { message: { recipient: { chat_id: CHAT, chat_type: 'chat' }, timestamp: now, body: { mid: `mid.load.${mid}`, seq: mid, text: body?.text ?? null } } });
    }
    if (method === 'GET' && /^\/chats\/-?\d+\/members\/me$/.test(u.pathname)) {
      return json(200, { user_id: 1, first_name: 'Бот', is_bot: true, last_access_time: now, is_owner: false, is_admin: true, join_time: now, permissions: ['read_all_messages', 'pin_message', 'write'] });
    }
    if (method === 'GET' && /^\/chats\/-?\d+\/members$/.test(u.pathname)) {
      const ids = (u.searchParams.get('user_ids') ?? '').split(',').filter(Boolean).map(Number);
      return json(200, { members: ids.map((id) => ({ user_id: id, first_name: 'Участник', is_bot: false, last_access_time: now, is_owner: false, is_admin: false, join_time: now })), marker: null });
    }
    if (method === 'GET' && /^\/chats\/-?\d+$/.test(u.pathname)) {
      return json(200, { chat_id: CHAT, type: 'chat', status: 'active', title: 'Дом 1', last_event_time: now, participants_count: 312, is_public: false, link: 'https://max.ru/join/load' });
    }
    return json(200, { success: true });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

interface Stand {
  handle: DbHandle;
  boss: PgBoss;
  ctx: JobContext;
  server: ReturnType<typeof fakeMaxServer>;
  deliver(raw: object): Promise<unknown>;
  startWorker(): Promise<void>;
  stopWorker(): Promise<void>;
  close(): Promise<void>;
}

/** Мини-стенд в процессе теста: БД с сидами, pg-boss, HTTP-клиент MAX с поддельным сервером. */
async function createStand(): Promise<Stand> {
  const handle = await freshDb(url!);
  await handle.db.execute(sql.raw(`drop schema if exists ${BOSS_SCHEMA} cascade`));
  const config = loadConfig({ DATABASE_URL: url!, SESSION_SECRET: LOCAL_SESSION_SECRET, MAX_BOT_USERNAME: BOT_USERNAME, PUBLIC_BASE_URL: 'https://vsemdomom.test' });
  await runSeeds(handle.db, { seedsDir, staffMaxIds: [STAFF_ID], now: new Date(), log });
  const server = fakeMaxServer();
  const max = new HttpMaxApi({
    baseUrl: 'https://platform-api2.max.ru',
    token: 'load-test-token',
    log,
    limiter: new RateLimiter({ globalRps: config.max.rate.globalRps }),
    rate: { perChat: config.max.rate.perChat, answersPerChat: config.max.rate.answersPerChat },
    fetch: server.fetch,
  });
  let boss = createBoss({ databaseUrl: url!, sendOnly: false, log, applicationName: 'vsemdomom-test-worker' });
  await boss.start();
  await ensureQueues(boss);
  const ctx: JobContext = { config, db: handle.db, queue: new PgBossQueue(boss), max, log, clock: systemClock, i18n: ruTranslator };
  const stand: Stand = {
    handle,
    get boss() {
      return boss;
    },
    ctx,
    server,
    deliver: (raw) => ingestUpdate({ db: handle.db, queue: ctx.queue, keywordMatcher: null }, raw),
    startWorker: () => startWorkers(boss, ctx, botUpdateHandlers, botJobHandlers),
    async stopWorker() {
      await boss.stop({ graceful: true, timeout: 5000 });
      boss = createBoss({ databaseUrl: url!, sendOnly: false, log, applicationName: 'vsemdomom-test-worker-2' });
      await boss.start();
      ctx.queue = new PgBossQueue(boss);
    },
    async close() {
      await boss.stop({ graceful: false });
      await handle.close();
    },
  };
  return stand;
}

async function waitFor<T>(label: string, check: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`не дождались: ${label}`);
    await sleep(200);
  }
}

describe.skipIf(!url)('отказы: БД недоступна', () => {
  it('webhook отвечает 503 — MAX повторит доставку', async () => {
    const closed = createDb(url!, { max: 1, applicationName: 'vsemdomom-test-closed' });
    await closed.close();
    const config = loadConfig({ DATABASE_URL: url!, SESSION_SECRET: LOCAL_SESSION_SECRET, MAX_WEBHOOK_SECRET: 'w'.repeat(32) });
    const app = await buildApp({ config, log, readiness: [], webhook: { db: closed.db, queue: new MemoryJobQueue(), keywordMatcher: null } });
    const res = await app.inject({ method: 'POST', url: '/webhook/max', headers: { 'x-max-bot-api-secret': 'w'.repeat(32) }, payload: updates.botStarted(8401) });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ code: string }>().code).toBe('service_unavailable');
    await app.close();
  });
});

describe.skipIf(!url)('отказы: перезапуск worker посреди сценария', () => {
  let stand: Stand;

  beforeAll(async () => {
    stand = await createStand();
  });
  afterAll(async () => {
    await stand?.close();
  });

  it('события, принятые без worker, обрабатываются после его запуска; 429 от MAX — повтор без потерь', async () => {
    // Worker ещё не запущен: события только сохраняются и ставятся в очередь.
    await stand.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    for (const user of [8411, 8412, 8413]) await stand.deliver(updates.botStarted(user, 'h_dom1model1'));
    const pending = await stand.handle.db.select().from(inboundUpdate);
    expect(pending.every((r) => r.processedAt === null)).toBe(true);

    await stand.startWorker();
    await stand.stopWorker();
    await stand.startWorker();
    await waitFor('все события обработаны', async () => (await stand.handle.db.select().from(inboundUpdate)).every((r) => r.processedAt !== null));
    const chat = await waitFor('панель опубликована', async () => (await stand.handle.db.select().from(houseChat).where(eq(houseChat.chatId, CHAT)))[0]?.panelMid);
    expect(chat).toMatch(/^mid\.load\./);
    // Три приветствия в личку ушли, даже если MAX отвечал 429 — повторы, без потерь.
    const dms = stand.server.calls.filter((c) => c.method === 'POST' && c.path === '/messages' && c.query.has('user_id') && c.status === 200);
    expect(new Set(dms.map((c) => c.query.get('user_id')))).toEqual(new Set(['8411', '8412', '8413']));
  });
});

describe.skipIf(!url || !process.env.E2E_LOAD)('нагрузка: 30 нажатий за 5 секунд в одну карточку', () => {
  let stand: Stand;

  beforeAll(async () => {
    stand = await createStand();
    await stand.startWorker();
  });
  afterAll(async () => {
    await stand?.close();
  });

  it('счётчики точные, каждому нажавшему — один ответ, правок карточки не больше трёх за время нажатий', async () => {
    await stand.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    await waitFor('панель', async () => (await stand.handle.db.select().from(houseChat).where(eq(houseChat.chatId, CHAT)))[0]?.panelMid);
    const h = (await houseByPublicId(stand.handle.db, 'dom1model1'))!;
    const created = await createIncident(stand.ctx, {
      house: h,
      service: 'hot_water',
      scope: 'house' satisfies IncidentScope,
      entrance: null,
      startedAt: new Date(Date.now() - 60 * 60_000),
      startedSource: '1h',
      reporter: { userId: 8500, residency: null },
      source: 'bot',
    });
    if (created.status === 'too_many') throw new Error('лимит аварий в тесте нагрузки');
    const inc = created.incident;
    const cardMid = await waitFor('карточка в чате', async () => (await stand.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, inc.id)))[0]?.mid);

    const burstStart = Date.now();
    for (let i = 0; i < 30; i += 1) {
      await stand.deliver(updates.callback(8501 + i, encodeCallback('join', inc.publicId, (i % h.entrances) + 1), { chatId: CHAT, chatType: 'chat' }, cardMid));
      await sleep(5000 / 30);
    }
    const burstEnd = Date.now();

    const participants = async () => stand.handle.db.select().from(incidentParticipant).where(eq(incidentParticipant.incidentId, inc.id));
    await waitFor('все отметки', async () => (await participants()).length === 31, 60_000);
    const answered = () => stand.server.calls.filter((c) => c.method === 'POST' && c.path === '/answers' && c.status === 200);
    await waitFor('ответы всем нажавшим', async () => answered().length >= 30, 60_000);
    await waitFor('карточка догнала', async () => {
      const edits = stand.server.calls.filter((c) => c.method === 'PUT' && c.query.get('message_id') === cardMid && c.status === 200);
      return edits.at(-1)?.body?.text?.includes('отметился 31 житель') ?? false;
    }, 60_000);

    expect(await participants()).toHaveLength(31);
    expect(new Set(answered().map((c) => c.query.get('callback_id'))).size).toBe(30);
    const edits = stand.server.calls.filter((c) => c.method === 'PUT' && c.query.get('message_id') === cardMid && c.status === 200);
    const duringBurst = edits.filter((c) => c.at >= burstStart && c.at <= burstEnd);
    const limited = stand.server.calls.filter((c) => c.status === 429).length;
    const failed = await stand.handle.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${BOSS_SCHEMA}.job where state = 'failed'`));
    console.log(JSON.stringify({ edits: edits.length, duringBurst: duringBurst.length, limited, answeredMs: (answered().at(-1)?.at ?? 0) - burstStart }));
    expect(duringBurst.length).toBeLessThanOrEqual(3);
    // 429 от MAX не роняют задачи: повторы с задержкой, ни одной задачи в failed.
    expect(failed.rows[0]?.n).toBe(0);
    for (let i = 1; i < edits.length; i += 1) expect(edits[i]!.at - edits[i - 1]!.at).toBeGreaterThanOrEqual(2000);
  }, 180_000);
});
