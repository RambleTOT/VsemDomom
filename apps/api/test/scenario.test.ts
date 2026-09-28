/**
 * Сквозной сценарий плана разработки (10 шагов) на симуляторе MAX с управляемыми часами:
 * житель сообщает об аварии (начало — 6 ч назад, в месяце уже есть перерыв 6 ч), номер АДС, соседи
 * отмечаются кнопками подъездов, УК ведёт статусы, «Нет» → расхождение → «Да» → итог, перерасчёт
 * и заявление в личку без сохранения ФИО и телефона. Прогон — два раза подряд, третий после сброса
 * демо-данных и отдельно с выключенными флагами волн 2–3. Проверки относительные.
 * Запуск: pnpm e2e:scenario (нужен TEST_DATABASE_URL).
 */
import type { IncidentDetail, Me } from '@vsemdomom/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatCard, incident, incidentEvent, incidentParticipant, outboundMessage } from '../src/db/schema.ts';
import { createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { answers, callbackPayload, dmMessages, fakeChat, lastDm, registerResident, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
if (process.env.E2E_SCENARIO && !url) throw new Error('Для pnpm e2e:scenario нужен TEST_DATABASE_URL (база *_test)');

const CHAT = -1001;
const MIN = 60_000;
const HOUR = 60 * MIN;
const A = 7101; // кв. 57, подъезд 2 — сообщает об аварии
const B = 7102; // кв. 60, подъезд 2
const C = 7103; // кв. 81, подъезд 3
const DEMO = 7190; // проверяющий с демо-ролью УК
const FULL_NAME = 'Петров Пётр Петрович';
const PHONE = '+7 911 222-33-44';
const BUDGET_KINDS = ['card_create', 'check_question', 'result'];

type Detail = Omit<IncidentDetail, 'deadlines'> & { timeline: { type: string }[]; deadlines: { kind: string; state: string; dueAt: string }[] };

interface Stand {
  api: ApiHarness;
  tokens: Record<number, string>;
  uk: string;
}

async function prepare(env: Record<string, string>): Promise<Stand> {
  const api = await createApiHarness(url!, { chats: [fakeChat(CHAT)], env: { DEMO_UK_CODE: 'DEMO-E2E', ...env } });
  await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
  const tokens: Record<number, string> = {};
  for (const [user, flat] of [
    [A, 57],
    [B, 60],
    [C, 81],
  ] as const) {
    await registerResident(api, user, flat);
    tokens[user] = await api.login(user);
  }
  return { api, tokens, uk: await api.login(STAFF_ID, 'uk') };
}

/** Все таблицы базы и задачи очереди — без ФИО и телефона из заявления. */
async function assertNoStatementPii(api: ApiHarness): Promise<void> {
  const tables = await api.handle.db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public'`);
  for (const { table_name } of tables.rows) {
    const rows = await api.handle.db.execute(sql.raw(`select * from "${table_name}"`));
    const dump = JSON.stringify(rows.rows);
    expect(dump, table_name).not.toContain('Петров');
    expect(dump, table_name).not.toContain('222-33-44');
  }
  const jobs = JSON.stringify(api.queue.sent.map((j) => j.data));
  expect(jobs).not.toContain('Петров');
}

/** 10 шагов; возвращает публичный ID аварии. */
async function scenario(stand: Stand, flags: { brigadeConfirm: boolean }): Promise<string> {
  const { api, tokens, uk } = stand;
  const row = async (id: string) => (await api.handle.db.select().from(incident).where(eq(incident.publicId, id)))[0]!;
  const card = async (id: string) => (await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, (await row(id)).id)))[0]!;
  const text = (mid: string | null | undefined) => (mid ? (api.max.messages.get(mid)?.message.text ?? '') : '');
  const pressIn = async (user: number, mid: string, label: string) => {
    const message = api.max.messages.get(mid)!.message;
    await api.deliver(updates.callback(user, callbackPayload(message, label), { chatId: CHAT, chatType: 'chat' }, mid));
  };
  const detail = async (id: string) => (await api.call<Detail>('GET', `/api/v1/incidents/${id}`, { token: tokens[A] })).body;
  const ukStatus = async (id: string, body: object) => {
    const res = await api.call<Detail>('POST', `/api/v1/uk/incidents/${id}/status`, { token: uk, body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await api.drain();
    return res.body;
  };
  const cardEdits = () => api.calls.calls.filter((c) => c.method === 'PUT' && c.path === '/messages').length;

  // 1. Житель A (подъезд 2): горячая вода, начало — 6 ч назад, где — подъезд 2.
  const created = await api.call<Detail>('POST', '/api/v1/incidents', {
    token: tokens[A],
    body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', entrance: 2, startedPreset: 'custom', startedAt: new Date(api.clock.now().getTime() - 6 * HOUR).toISOString() },
  });
  expect(created.status).toBe(201);
  const id = created.body.id;
  expect(created.body.status).toBe('open');
  await api.drain();
  expect((await card(id)).mid).toBeTruthy();
  expect(api.delayed().some((j) => j.queue === 'deadline-tick')).toBe(true);

  // 2. Авария видна УК; панель дома обновлена.
  const list = await api.call<{ items: { id: string }[] }>('GET', '/api/v1/uk/incidents', { token: uk });
  expect(list.body.items.map((i) => i.id)).toContain(id);
  const panel = api.max.messagesIn({ chatId: CHAT }).find((m) => m.message.text.includes('Активн'));
  expect(panel?.message.text).toContain('Активные аварии: 1');

  // 3. Номер заявки АДС и время: событие, сроки пересчитаны от регистрации.
  const before = (await detail(id)).deadlines.find((d) => d.kind === 'answer')!;
  const registeredAt = new Date(api.clock.now().getTime() + 10 * MIN);
  api.clock.set(registeredAt);
  const ads = await api.call('POST', `/api/v1/incidents/${id}/ads-registration`, { token: tokens[A], body: { number: 'А-5123', registeredAt: registeredAt.toISOString() } });
  expect(ads.status).toBe(200);
  const afterAds = await detail(id);
  expect(afterAds.timeline.map((e) => e.type)).toContain('ads_registered');
  expect(new Date(afterAds.deadlines.find((d) => d.kind === 'answer')!.dueAt).getTime()).toBeGreaterThan(new Date(before.dueAt).getTime());

  // 4. Жители B и C жмут «2» и «3»: участников +2, счётчики по подъездам, ответ нажавшему.
  const participantsBefore = (await detail(id)).participantsCount;
  const cardMid = (await card(id)).mid!;
  await pressIn(B, cardMid, '2');
  expect(answers(api).at(-1)).toBe('Вы отметились: подъезд 2. Ответ УК пришлём в личку');
  await pressIn(C, cardMid, '3');
  expect(answers(api).at(-1)).toBe('Вы отметились: подъезд 3. Ответ УК пришлём в личку');
  await api.drain();
  expect((await detail(id)).participantsCount).toBe(participantsBefore + 2);
  expect(text((await card(id)).mid)).toContain('подъезд 2 — 2, подъезд 3 — 1');

  // 5. УК: «Принято, ориентир 18:00» — статус, правка карточки, уведомления, срок «сообщить сроки» выполнен.
  const editsBefore = cardEdits();
  const eta = new Date('2026-09-27T15:00:00Z'); // 18:00 по Москве
  const accepted = await ukStatus(id, { status: 'accepted', eta: eta.toISOString() });
  expect(accepted.status).toBe('accepted');
  expect((await row(id)).etaAt?.getTime()).toBe(eta.getTime());
  expect(cardEdits()).toBeGreaterThan(editsBefore);
  expect(text((await card(id)).mid).split('\n')[0]).toContain('УК приняла, ориентир 18:00');
  for (const user of [B, C]) expect(lastDm(api, user).text).toContain('УК приняла');
  expect((await detail(id)).deadlines.find((d) => d.kind === 'answer')?.state).toBe('met');

  // 6. УК: «Бригада на месте»; жители подтверждают кнопками (при включённом флаге).
  await ukStatus(id, { status: 'brigade_on_site' });
  const cardMessage = api.max.messages.get((await card(id)).mid!)!.message;
  const crewButton = cardMessage.keyboard.flat().some((b) => b.text === 'Подтверждаю');
  expect(crewButton).toBe(flags.brigadeConfirm);
  if (flags.brigadeConfirm) {
    for (const user of [B, C]) await pressIn(user, (await card(id)).mid!, 'Подтверждаю');
    expect((await detail(id)).timeline.map((e) => e.type)).toContain('residents_brigade_confirmed');
  }

  // 7. УК: «Локализовано» → «Устранено»: проверка и вопрос дому (второе новое сообщение).
  await ukStatus(id, { status: 'localized' });
  const checking = await ukStatus(id, { status: 'resolved' });
  expect(checking.status).toBe('checking');
  const checkMid = (await card(id)).checkMid!;
  expect(text(checkMid).split('\n')[0]).toBe('**Горячая вода вернулась?**');

  // 8. B отвечает «Нет»: расхождение, карточка, инструкция в личку.
  await pressIn(B, checkMid, 'Нет');
  expect((await row(id)).status).toBe('discrepancy');
  await api.drain();
  expect(text((await card(id)).mid)).toContain('воды нет');
  expect(lastDm(api, B).text).toContain('Воды нет — что делать');

  // 9. B меняет ответ на «Да»: закрыто по правилу, итог — третьим сообщением ответом на карточку.
  api.clock.advance(20 * MIN);
  await pressIn(B, checkMid, 'Да, есть');
  await api.drain();
  const closed = await row(id);
  expect(closed.status).toBe('closed');
  const c = await card(id);
  expect(text(c.mid).split('\n')[0]).toContain('Закрыта');
  expect(api.max.messages.get(c.resultMid!)?.message.replyToMid).toBe(c.mid);
  const budget = await api.handle.db.select({ kind: outboundMessage.kind }).from(outboundMessage).where(eq(outboundMessage.incidentId, closed.id));
  expect(budget.filter((m) => BUDGET_KINDS.includes(m.kind)).map((m) => m.kind).sort()).toEqual(['card_create', 'check_question', 'result']);
  const [pB] = await api.handle.db.select().from(incidentParticipant).where(eq(incidentParticipant.userId, B));
  expect(pB).toBeTruthy();

  // 10. Перерасчёт (превышение месячной нормы > 0) и заявление в личку без сохранения ПДн.
  const recalc = await api.call<{ excessMinutes: number; amount: number; formula: string; norm: { code: string } | null }>('POST', `/api/v1/incidents/${id}/recalculation`, {
    token: tokens[A],
    body: { monthlyCharge: 1200 },
  });
  expect(recalc.status).toBe(200);
  expect(recalc.body.excessMinutes).toBeGreaterThan(0);
  expect(recalc.body.amount).toBeGreaterThan(0);
  expect(recalc.body.norm?.code).toBe('pr354.app1.p4.monthly');
  const dmBefore = dmMessages(api, A).length;
  const statement = `В УК «Модельная» от ${FULL_NAME}, тел. ${PHONE}\nЗаявление об изменении размера платы: ${recalc.body.formula}`;
  const sent = await api.call<{ sent: boolean }>('POST', `/api/v1/incidents/${id}/application/send-to-dm`, { token: tokens[A], body: { text: statement } });
  expect(sent.body).toEqual({ sent: true });
  expect(dmMessages(api, A)).toHaveLength(dmBefore + 1);
  await assertNoStatementPii(api);

  // Хронология: основные шаги — в событиях.
  const types = new Set((await api.handle.db.select({ type: incidentEvent.type }).from(incidentEvent).where(eq(incidentEvent.incidentId, closed.id))).map((e) => e.type));
  for (const type of ['reported', 'ads_registered', 'joined', 'uk_accepted', 'uk_brigade_on_site', 'uk_localized', 'uk_resolved', 'check_asked', 'restored_no', 'discrepancy', 'restored_yes', 'closed']) {
    expect(types.has(type as never), type).toBe(true);
  }
  // Следующий прогон — с новым «сейчас».
  api.clock.advance(HOUR);
  return id;
}

// Прогон сценария — десятки запросов и задач: на нагруженной машине дольше 5 секунд по умолчанию.
const SCENARIO_TIMEOUT_MS = 120_000;

describe.skipIf(!url)('сквозной сценарий: два прогона подряд и третий после сброса демо', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let stand: Stand;

  beforeAll(async () => {
    stand = await prepare({});
  });
  afterAll(async () => {
    await stand?.api.close();
  });

  it('прогон 1', async () => {
    await scenario(stand, { brigadeConfirm: true });
  });

  it('прогон 2 без сброса данных', async () => {
    await scenario(stand, { brigadeConfirm: true });
  });

  it('прогон 3 после сброса демо-данных дома', async () => {
    const { api } = stand;
    const demo = await api.login(DEMO);
    const role = await api.call<Me>('POST', '/api/v1/me/demo-uk-role', { token: demo, body: { code: 'DEMO-E2E' } });
    expect(role.body.staff?.isDemo).toBe(true);
    const reset = await api.call<{ removedIncidents: number }>('POST', '/api/v1/uk/houses/dom1model1/demo/reset', { token: demo, body: {} });
    expect(reset.body.removedIncidents).toBe(2);
    await api.drain();
    // Сессии живут 12 часов: после сдвигов часов входим заново.
    for (const user of [A, B, C]) stand.tokens[user] = await api.login(user);
    stand.uk = await api.login(STAFF_ID, 'uk');
    await scenario(stand, { brigadeConfirm: true });
  });
});

describe.skipIf(!url)('сквозной сценарий с выключенными флагами волн 2–3', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let stand: Stand;

  beforeAll(async () => {
    stand = await prepare({
      FEATURE_KEYWORD_REPLY: 'false',
      FEATURE_BRIGADE_CONFIRM: 'false',
      FEATURE_TRUST_LEVELS: 'false',
      FEATURE_JOIN_CHAT: 'false',
      FEATURE_POLLS: 'false',
      FEATURE_MONTHLY_SUMMARY: 'false',
      FEATURE_ACT_TEMPLATE: 'false',
    });
  });
  afterAll(async () => {
    await stand?.api.close();
  });

  it('проходит без кнопок выключенных функций', async () => {
    await scenario(stand, { brigadeConfirm: false });
  });
});
