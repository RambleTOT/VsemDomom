import type { IncidentDetail, Problem } from '@vsemdomom/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatCard, incident, incidentParticipant, outboundMessage } from '../src/db/schema.ts';
import { QUEUES } from '../src/jobs/queue.ts';
import { CHECKER, createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { button, callbackPayload, dm, fakeChat, lastDm, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const OTHER_CHAT = -1004;
const MIN = 60_000;

type UkDetail = IncidentDetail & {
  grid: { cells: { entrance: number; floor: number; count: number }[]; unknownEntrance: number };
  people: { total: number; confirmed: number; unconfirmed: number };
  allowedActions: string[];
  nextAction: string | null;
  mergeCandidates: { id: string }[];
  cardUpdate: string;
};
type UkList = { items: { id: string; status: string }[]; counts: { open: number; expired: number; closed: number }; houses: { id: string; openCount: number }[] };

describe.skipIf(!url)('экраны и действия УК (A7, PostgreSQL + симулятор)', () => {
  let api: ApiHarness;
  let uk = '';
  let alice = '';
  let bob = '';
  let hot: IncidentDetail;

  const A = 8001;
  const B = 8002;

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT), fakeChat(OTHER_CHAT)] });
    await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    uk = await api.login(STAFF_ID, 'uk');
    alice = await api.resident(A, 'dom1model1', 57);
    bob = await api.resident(B, 'dom1model1', 100);
    // Личка с ботом начата — уведомления можно доставить.
    await api.deliver(updates.botStarted(A));
    await api.deliver(updates.botStarted(B));
    const created = await api.call<IncidentDetail>('POST', '/api/v1/incidents', {
      token: alice,
      body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: '1h' },
    });
    hot = created.body;
    await api.call('POST', `/api/v1/incidents/${hot.id}/join`, { token: bob, body: { entrance: 3, floor: 4 } });
    await api.drain();
  });
  afterAll(async () => {
    await api?.close();
  });

  const card = async (publicId: string) => {
    const [inc] = await api.handle.db.select().from(incident).where(eq(incident.publicId, publicId));
    const [row] = await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, inc!.id));
    return { inc: inc!, row, text: row?.mid ? api.max.messages.get(row.mid)?.message.text : undefined };
  };
  const problem = (res: { body: unknown }) => res.body as Problem;
  const setStatus = (id: string, body: object, version?: number) =>
    api.call<UkDetail>('POST', `/api/v1/uk/incidents/${id}/status`, {
      token: uk,
      body,
      ...(version === undefined ? {} : { headers: { 'if-match': String(version) } }),
    });

  it('список: только сотрудникам; счётчики и дома', async () => {
    expect((await api.call<Problem>('GET', '/api/v1/uk/incidents', { token: alice })).body.code).toBe('not_staff');
    const list = await api.call<UkList>('GET', '/api/v1/uk/incidents', { token: uk });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i) => i.id)).toEqual([hot.id]);
    expect(list.body.counts).toEqual({ open: 1, expired: 0, closed: 3 });
    expect(list.body.houses.find((h) => h.id === 'dom1model1')?.openCount).toBe(1);
    expect(list.body.houses.map((h) => h.id)).not.toContain('dom5sandbx');
    const closed = await api.call<UkList>('GET', '/api/v1/uk/incidents?status=closed', { token: uk });
    expect(closed.body.items.every((i) => i.status === 'closed')).toBe(true);
  });

  it('авария для УК: сетка «подъезд × этаж», жители, действия, карточка', async () => {
    const res = await api.call<UkDetail>('GET', `/api/v1/uk/incidents/${hot.id}`, { token: uk });
    expect(res.status).toBe(200);
    expect(res.body.grid.cells).toEqual([
      { entrance: 2, floor: 6, count: 1 },
      { entrance: 3, floor: 4, count: 1 },
    ]);
    expect(res.body.people).toMatchObject({ total: 2 });
    expect(res.body).toMatchObject({ nextAction: 'accept', cardUpdate: 'queued', me: null, joined: null });
    expect(res.body.allowedActions).toEqual(['accept', 'brigade_on_site', 'localize', 'resolve', 'merge']);
  });

  it('«Принято»: ориентир обязателен и не в прошлом; устаревший If-Match — 409', async () => {
    expect(problem(await setStatus(hot.id, { status: 'accepted' }, hot.version)).code).toBe('eta_required');
    const past = new Date(api.clock.now().getTime() - 10 * MIN).toISOString();
    expect(problem(await setStatus(hot.id, { status: 'accepted', eta: past }, hot.version)).code).toBe('eta_in_past');
    const eta = new Date(api.clock.now().getTime() + 90 * MIN).toISOString();
    const stale = await setStatus(hot.id, { status: 'accepted', eta }, hot.version - 1 + 5);
    expect(stale.status).toBe(409);
    expect(problem(stale)).toMatchObject({ code: 'version_conflict', currentVersion: hot.version });
  });

  it('«Принято»: статус, срок «сообщить сроки» выполнен, карточка правится, присоединившимся — в личку', async () => {
    const eta = new Date(api.clock.now().getTime() + 90 * MIN);
    const res = await setStatus(hot.id, { status: 'accepted', eta: eta.toISOString() }, hot.version);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', version: hot.version + 1, eta: eta.toISOString(), nextAction: 'brigade_on_site' });
    expect(res.body.timeline.slice(0, 2).map((e) => e.type).sort()).toEqual(['deadline_met', 'uk_accepted']);
    expect(res.body.deadlines.find((d) => d.kind === 'answer')?.state).toBe('met');
    await api.drain();
    const { text } = await card(hot.id);
    expect(text?.split('\n')[0]).toBe('**🟠 Нет горячей воды · УК приняла, ориентир 13:30**');
    for (const user of [A, B]) expect(lastDm(api, user).text).toContain('🟠 УК приняла аварию, ориентир 13:30');
    hot = res.body;
  });

  it('недопустимый переход — 409 invalid_transition', async () => {
    const res = await setStatus(hot.id, { status: 'accepted', eta: new Date(api.clock.now().getTime() + MIN * 60).toISOString() });
    expect(res.status).toBe(409);
    expect(problem(res)).toMatchObject({ code: 'invalid_transition', from: 'accepted' });
  });

  it('«Не присылать» в личке выключает уведомления по аварии', async () => {
    const notice = lastDm(api, B);
    await api.deliver(updates.callback(B, callbackPayload(notice, 'Не присылать'), dm(B)));
    const [row] = await api.handle.db
      .select()
      .from(incidentParticipant)
      .where(and(eq(incidentParticipant.incidentId, (await card(hot.id)).inc.id), eq(incidentParticipant.userId, B)));
    expect(row?.notify).toBe(false);
  });

  it('«Устранено» с пропуском шагов: checking, вопрос C03 в чат, карточка и уведомления', async () => {
    const before = api.max.messagesIn({ userId: B }).length;
    const res = await setStatus(hot.id, { status: 'resolved' }, hot.version);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('checking');
    const skipped = res.body.timeline.find((e) => e.type === 'skipped_steps');
    expect(skipped?.payload).toEqual({ steps: ['brigade_on_site', 'localized'] });
    expect(res.body.timeline.map((e) => e.type)).toContain('check_asked');
    expect(res.body.steps.map((s) => s.state)).toEqual(['done', 'done', 'skipped', 'skipped', 'current', 'pending']);
    await api.drain();
    const { row, text } = await card(hot.id);
    expect(text?.split('\n')[0]).toBe('**🔵 Горячая вода · УК отметила устранение в 12:00**');
    const question = api.max.messages.get(row!.checkMid!);
    expect(question?.message.text.split('\n')[0]).toBe('**Горячая вода вернулась?**');
    expect(lastDm(api, A).text).toContain('🔵 УК отметила устранение в 12:00');
    expect(api.max.messagesIn({ userId: B })).toHaveLength(before);
    const kinds = (await api.handle.db.select().from(outboundMessage).where(eq(outboundMessage.incidentId, row!.incidentId))).map((o) => o.kind);
    expect(kinds.filter((k) => k === 'card_create' || k === 'check_question' || k === 'result').sort()).toEqual(['card_create', 'check_question']);
  });

  it('таймеры сроков: «до срока 30 минут» и «срок истёк» — событие, флаг, карточка, личка', async () => {
    const created = await api.call<IncidentDetail>('POST', '/api/v1/incidents', {
      token: alice,
      body: { houseId: 'dom1model1', service: 'heating', scope: 'entrance' },
    });
    expect(created.status).toBe(201);
    const jobs = api.delayed().filter((j) => j.queue === QUEUES.deadline);
    // Ответ и локализация — 30 минут: только «срок истёк»; устранение и лимит — ещё и предупреждение.
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    await api.advance(31 * MIN);
    const view = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${created.body.id}`, { token: alice });
    expect(view.body.overdue).toBe(true);
    expect(view.body.timeline.filter((e) => e.type === 'deadline_breached').map((e) => e.payload.kind).sort()).toEqual(['answer', 'localize']);
    expect((await card(created.body.id)).text?.split('\n')[1]).toBe('Срок ответа по нормативу истёк в 12:30 · телефон АДС в «Подробнее»');
    const dms = api.max.messagesIn({ userId: A }).map((m) => m.message.text);
    expect(dms.some((t) => t.startsWith('Срок по нормативу истёк в 12:30: УК сообщит сроки работ'))).toBe(true);
    expect(dms.some((t) => t.startsWith('Срок по нормативу истёк в 12:30: локализовать аварию'))).toBe(true);
    const list = await api.call<UkList>('GET', '/api/v1/uk/incidents?status=expired', { token: uk });
    expect(list.body.items.map((i) => i.id)).toEqual([created.body.id]);
    const all = await api.call<UkList>('GET', '/api/v1/uk/incidents', { token: uk });
    expect(all.body.items[0]?.id).toBe(created.body.id);
  });

  it('объединение: «только квартира» переносится в общую аварию того же вида', async () => {
    const dave = await api.resident(8004, 'dom1model1', 5);
    const flat = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: dave, body: { houseId: 'dom1model1', service: 'hot_water', scope: 'flat' } });
    expect(flat.status).toBe(201);
    const view = await api.call<UkDetail>('GET', `/api/v1/uk/incidents/${flat.body.id}`, { token: uk });
    expect(view.body.mergeCandidates.map((c) => c.id)).toEqual([hot.id]);
    const merged = await api.call<UkDetail>('POST', `/api/v1/uk/incidents/${flat.body.id}/merge`, {
      token: uk,
      body: { intoId: hot.id },
      headers: { 'if-match': String(flat.body.version) },
    });
    expect(merged.status).toBe(200);
    expect(merged.body.id).toBe(hot.id);
    expect(merged.body.participantsCount).toBe(3);
    expect(merged.body.timeline[0]).toMatchObject({ type: 'merged', payload: { from: flat.body.id, moved: 1 } });
    const src = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${flat.body.id}`, { token: dave });
    expect(src.body).toMatchObject({ status: 'merged', displayStatus: 'merged', mergedInto: hot.id });
    const again = await api.call<Problem>('POST', `/api/v1/uk/incidents/${flat.body.id}/merge`, { token: uk, body: { intoId: hot.id } });
    expect(again.body.code).toBe('invalid_transition');
  });

  it('дома УК: чат и права бота, итог месяца; демо-блок — только демо-роли', async () => {
    const list = await api.call<{ items: { id: string; chat: { botIsAdmin: boolean } | null; activeIncidents: number }[] }>('GET', '/api/v1/uk/houses', { token: uk });
    expect(list.body.items.map((h) => h.id)).toEqual(['dom1model1', 'dom2model2', 'dom3model3', 'dom4model4']);
    expect(list.body.items[0]).toMatchObject({ chat: { botIsAdmin: true }, activeIncidents: 2 });
    const detail = await api.call<{ monthlySummary: { incidents: number } | null; demo: unknown; month: { scope: string } }>('GET', '/api/v1/uk/houses/dom1model1', { token: uk });
    expect(detail.status).toBe(200);
    expect(detail.body.month.scope).toBe('house');
    expect(detail.body.monthlySummary?.incidents).toBeGreaterThanOrEqual(3);
    expect(detail.body.demo).toBeNull();
    const demoUk = await api.login(8300, 'uk');
    const demo = await api.call<{ demo: { activeIncidentId: string | null } | null }>('GET', '/api/v1/uk/houses/dom1model1', { token: demoUk });
    expect(demo.body.demo?.activeIncidentId).toBeTruthy();
    expect((await api.call('GET', '/api/v1/uk/houses/dom1model1', { token: alice })).status).toBe(403);
  });

  it('привязка чата по токену из приглашения: сведения, привязка, повтор — 410', async () => {
    await api.deliver(updates.botAdded(OTHER_CHAT, STAFF_ID));
    const invite = api.max.messagesIn({ chatId: OTHER_CHAT }).at(-1)!.message;
    const b = button(invite, 'Привязать к дому');
    const token = b.type === 'open_app' ? (b.payload ?? '').slice(2) : '';
    const info = await api.call<{ chatTitle: string; status: string }>('GET', `/api/v1/uk/chat-bindings/${token}`, { token: uk });
    expect(info.body).toMatchObject({ chatTitle: 'Чат -1004', status: 'active' });
    const bound = await api.call<{ house: { id: string; chat: { bound: boolean } }; pinned: boolean }>('POST', '/api/v1/uk/chat-bindings', {
      token: uk,
      body: { token, houseId: 'dom4model4' },
    });
    expect(bound.status).toBe(200);
    expect(bound.body).toMatchObject({ house: { id: 'dom4model4', chat: { bound: true } }, pinned: true });
    await api.drain();
    expect(api.max.pins.get(OTHER_CHAT)).toBeTruthy();
    const again = await api.call<Problem>('POST', '/api/v1/uk/chat-bindings', { token: uk, body: { token, houseId: 'dom4model4' } });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('token_used');
  });

  it('песочница: «Устранено» сразу закрывает аварию, сообщений в чаты нет', async () => {
    const created = await api.call<IncidentDetail>('POST', '/api/v1/incidents', {
      token: CHECKER.resident,
      body: { houseId: 'dom5sandbx', service: 'cold_water', scope: 'house' },
    });
    const chatBefore = api.max.messagesIn({ chatId: CHAT }).length;
    const accepted = await api.call<UkDetail>('POST', `/api/v1/uk/incidents/${created.body.id}/status`, {
      token: CHECKER.uk,
      body: { status: 'accepted', eta: new Date(api.clock.now().getTime() + 60 * MIN).toISOString() },
    });
    expect(accepted.body.status).toBe('accepted');
    const resolved = await api.call<UkDetail>('POST', `/api/v1/uk/incidents/${created.body.id}/status`, { token: CHECKER.uk, body: { status: 'resolved' } });
    expect(resolved.body).toMatchObject({ status: 'closed', displayStatus: 'closed' });
    expect(resolved.body.timeline.map((e) => e.type)).toContain('closed');
    await api.drain();
    expect(api.max.messagesIn({ chatId: CHAT })).toHaveLength(chatBefore);
    // Житель проверяющих не может менять статус (403), а УК — видеть чужие дома.
    expect((await api.call('POST', `/api/v1/uk/incidents/${created.body.id}/status`, { token: CHECKER.resident, body: { status: 'resolved' } })).status).toBe(403);
    expect((await api.call('GET', `/api/v1/uk/incidents/${hot.id}`, { token: CHECKER.uk })).status).toBe(404);
  });
});
