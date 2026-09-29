import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.ts';
import { house, residency } from '../src/db/schema.ts';
import type { JobQueue } from '../src/jobs/queue.ts';
import { createIncident } from '../src/services/incidents.ts';
import { FailureWindow, TokenBuckets } from '../src/util/limits.ts';
import { ingestUpdate, type IngestDeps } from '../src/webhook/ingest.ts';
import { createHarness, lastDm, registerResident, updates, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

describe('ограничители частоты', () => {
  it('корзина токенов: всплеск, затем одно событие за интервал; первый отказ в серии отмечен', () => {
    const b = new TokenBuckets(3, 1000);
    expect([0, 0, 0].map((t) => b.take(1, t).ok)).toEqual([true, true, true]);
    expect(b.take(1, 10)).toEqual({ ok: false, firstReject: true });
    expect(b.take(1, 20)).toEqual({ ok: false, firstReject: false });
    expect(b.take(1, 1020).ok).toBe(true);
    expect(b.take(2, 1020).ok).toBe(true);
  });

  it('окно неудач: после max неудач — блок до конца окна; успех сбрасывает', () => {
    const w = new FailureWindow(2, 1000);
    w.fail(7, 0);
    expect(w.blocked(7, 5)).toBe(false);
    w.fail(7, 10);
    expect(w.blocked(7, 20)).toBe(true);
    expect(w.blocked(7, 1011)).toBe(false);
    w.fail(7, 1011);
    w.fail(7, 1012);
    w.reset(7);
    expect(w.blocked(7, 1013)).toBe(false);
  });
});

describe('флуд на входе webhook', () => {
  // До очереди доходят только принятые события; база здесь не нужна.
  const db = { transaction: () => Promise.resolve('accepted') } as unknown as Db;
  let now = 0;
  const rejected: number[] = [];
  const deps: IngestDeps = {
    db,
    queue: {} as JobQueue,
    keywordMatcher: null,
    throttle: { buckets: new TokenBuckets(2, 1000), now: () => now, onReject: (id) => rejected.push(id) },
  };

  it('сообщения и нажатия одного пользователя сверх лимита не ставятся в очередь', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await ingestUpdate(deps, updates.dmText(5001, `текст ${i}`)));
    expect(results).toEqual(['accepted', 'accepted', 'throttled', 'throttled']);
    expect(rejected).toEqual([5001]);
    expect(await ingestUpdate(deps, updates.callback(5002, 'x', { chatId: -1, chatType: 'chat' }))).toBe('accepted');
    now += 1000;
    expect(await ingestUpdate(deps, updates.dmText(5001, 'снова'))).toBe('accepted');
  });

  it('массовое добавление бота в группы одним пользователем ограничивается', async () => {
    const results = [];
    for (let i = 0; i < 3; i += 1) results.push(await ingestUpdate(deps, updates.botAdded(-100 - i, 5005)));
    expect(results).toEqual(['accepted', 'accepted', 'throttled']);
  });

  it('служебные события и сообщения ботов не ограничиваются', async () => {
    for (let i = 0; i < 5; i += 1) expect(await ingestUpdate(deps, updates.userAdded(-1, 5003))).toBe('accepted');
    const fromBot = updates.groupText(-1, 5004, 'карточка');
    fromBot.message.sender.is_bot = true;
    for (let i = 0; i < 5; i += 1) expect(await ingestUpdate(deps, { ...fromBot, timestamp: fromBot.timestamp + i })).toBe('accepted');
  });
});

const url = testDatabaseUrl();
const CODE_USER = 8701;
const REPORTER = 8702;

describe.skipIf(!url)('перебор демо-кода и засорение аварий (PostgreSQL)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness(url!, { env: { DEMO_MODE: 'true', DEMO_UK_CODE: 'DEMO-ABUSE-1' } });
    await h.deliver(updates.botStarted(CODE_USER));
    await registerResident(h, REPORTER, 58);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('после пяти неверных кодов ввод закрыт на 15 минут, даже верный код', async () => {
    for (let i = 0; i < 5; i += 1) {
      await h.deliver(updates.dmText(CODE_USER, `/democode WRONG-${i}`));
      expect(lastDm(h, CODE_USER).text).toBe('Код не подошёл. Проверьте код и отправьте /democode <код> ещё раз');
    }
    await h.deliver(updates.dmText(CODE_USER, '/democode DEMO-ABUSE-1'));
    expect(lastDm(h, CODE_USER).text).toBe('Слишком много неверных кодов подряд. Попробуйте через 15 мин');
    await h.advance(16 * 60_000);
    await h.deliver(updates.dmText(CODE_USER, '/democode DEMO-ABUSE-1'));
    expect(lastDm(h, CODE_USER).text).toBe('Готово: у вас демо-роль сотрудника УК «Садовый квартал». Пульт аварий — /uk');
  });

  it('не больше пяти новых аварий от жителя за час; песочница не ограничена', async () => {
    const [model] = await h.handle.db.select().from(house).where(eq(house.publicId, 'dom1model1'));
    const [sandbox] = await h.handle.db.select().from(house).where(eq(house.isSandbox, true));
    const [res] = await h.handle.db.select().from(residency).where(and(eq(residency.userId, REPORTER), eq(residency.houseId, model!.id)));
    const report = (target: typeof model, service: 'cold_water' | 'hot_water' | 'heating' | 'electricity' | 'sewerage' | 'gas') =>
      createIncident(h.ctx, {
        house: target!,
        service,
        scope: 'flat',
        entrance: null,
        startedAt: h.clock.now(),
        startedSource: 'now',
        reporter: { userId: REPORTER, residency: res ?? null },
        source: 'miniapp',
      });
    const statuses = [];
    for (const s of ['cold_water', 'hot_water', 'heating', 'electricity', 'sewerage'] as const) statuses.push((await report(model, s)).status);
    expect(statuses).toEqual(['created', 'created', 'created', 'created', 'created']);
    expect((await report(model, 'gas')).status).toBe('too_many');
    expect((await report(sandbox, 'gas')).status).toBe('created');
    await h.advance(61 * 60_000);
    expect((await report(model, 'gas')).status).toBe('created');
  });
});
