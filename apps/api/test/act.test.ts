import type { IncidentDetail, Problem } from '@vsemdomom/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatCard, incident, incidentEvent } from '../src/db/schema.ts';
import { QUEUES } from '../src/jobs/queue.ts';
import { createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { answers, button, callbackPayload, dm, dmMessages, fakeChat, lastDm, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const MIN = 60_000;
const HOUR = 60 * MIN;
const msk = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);

type Act = NonNullable<IncidentDetail['act']>;

describe.skipIf(!url)('S09: акт без исполнителя (FEATURE_ACT_TEMPLATE)', () => {
  let api: ApiHarness;
  let uk = '';
  const tokens: Record<number, string> = {};
  const A = 8101; // кв. 57
  const B = 8102; // кв. 100
  const C = 8103; // кв. 5, не отметился
  let hot: IncidentDetail;

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT)] });
    await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    uk = await api.login(STAFF_ID, 'uk');
    for (const [user, flat] of [
      [A, 57],
      [B, 100],
      [C, 5],
    ] as const) {
      tokens[user] = await api.resident(user, 'dom1model1', flat);
      await api.deliver(updates.botStarted(user));
    }
  });
  afterAll(async () => {
    await api?.close();
  });

  const row = async () => (await api.handle.db.select().from(incident).where(eq(incident.publicId, hot.id)))[0]!;
  const press = async (user: number, text: string) => {
    const [card] = await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, (await row()).id));
    const question = api.max.messages.get(card!.checkMid!)!.message;
    await api.deliver(updates.callback(user, callbackPayload(question, text), { chatId: CHAT, chatType: 'chat' }, card!.checkMid!));
  };
  const status = async (body: object) => {
    const res = await api.call<IncidentDetail>('POST', `/api/v1/uk/incidents/${hot.id}/status`, { token: uk, body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await api.drain();
  };
  const act = async (user: number) => (await api.call<IncidentDetail>('GET', `/api/v1/incidents/${hot.id}`, { token: tokens[user] })).body.act;
  const rereport = async (user: number, text: string) => {
    await api.deliver(updates.callback(user, callbackPayload(lastDm(api, user), 'Я сообщил в АДС'), dm(user)));
    await api.deliver(updates.dmText(user, text));
  };

  it('«Нет» после «Устранено»: в подсказке — «Как составить акт»; блока act ещё нет', async () => {
    const res = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: tokens[A], body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: '1h' } });
    hot = res.body;
    await api.call('POST', `/api/v1/incidents/${hot.id}/join`, { token: tokens[B], body: {} });
    await status({ status: 'accepted', eta: new Date(api.clock.now().getTime() + 2 * HOUR).toISOString() });
    await status({ status: 'resolved' });
    await press(A, 'Нет');
    await press(B, 'Нет');
    expect((await row()).status).toBe('discrepancy');
    const help = lastDm(api, A);
    expect(button(help, 'Как составить акт')).toMatchObject({ type: 'open_app', payload: `a_${hot.id}` });
    expect(await act(A)).toBeNull();
  });

  it('повторно в АДС в 12:10 — срок проверки 14:10 по п. 108; до срока «Я готов подписать» — 409', async () => {
    api.clock.set(msk('12:15'));
    await rereport(A, '4130 12:10');
    expect(await act(A)).toMatchObject({ available: false, checkDueAt: msk('14:10').toISOString(), requiredConsumers: 2, readyCount: 0, norm: { point: 'п. 110(1)' } });
    expect(api.delayed().filter((j) => j.queue === QUEUES.act)).toEqual([{ queue: QUEUES.act, data: { incidentId: (await row()).id, userId: A }, startAfter: msk('14:10') }]);
    const early = await api.call<Problem>('POST', `/api/v1/incidents/${hot.id}/act/ready`, { token: tokens[A], body: { ready: true } });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('invalid_transition');
  });

  it('в 14:10 проверки нет — предложение акта в личку с основаниями и «Я готов подписать»', async () => {
    const before = dmMessages(api, A).length;
    await api.advance(msk('14:10').getTime() - api.clock.now().getTime());
    const offer = lastDm(api, A);
    expect(dmMessages(api, A)).toHaveLength(before + 1);
    expect(offer.text.split('\n').slice(0, 3)).toEqual([
      '**Акт без исполнителя**',
      'Проверки нет больше 2 ч после повторного сообщения в АДС (Правила № 354, п. 108). Акт о нарушении качества можно составить без исполнителя',
      'Нужны 2 соседа и председатель совета дома (Правила № 354, п. 110(1))',
    ]);
    expect(button(offer, 'Я готов подписать').type).toBe('callback');
    expect(await act(A)).toMatchObject({ available: true, readyCount: 0, myReady: false });
    // Повтор задачи не шлёт второе предложение.
    expect(dmMessages(api, B).some((m) => m.text.includes('Акт без исполнителя'))).toBe(false);
  });

  it('«Я готов подписать» в личке: уведомление со счётчиком и вопрос о знакомстве', async () => {
    tokens[A] = await api.login(A);
    tokens[B] = await api.login(B);
    tokens[C] = await api.login(C);
    await api.deliver(updates.callback(A, callbackPayload(lastDm(api, A), 'Я готов подписать'), dm(A)));
    expect(answers(api).at(-1)).toBe('Вы в списке готовых подписать. Готовы 1 сосед');
    const step = lastDm(api, A);
    expect(step.text).toContain('Вы в списке готовых подписать');
    expect(button(step, 'Познакомить с соседями').type).toBe('callback');
    await api.deliver(updates.callback(A, callbackPayload(step, 'Познакомить с соседями'), dm(A)));
    expect(answers(api).at(-1)).toBe('Когда согласятся двое и больше, бот пришлёт профили в личку');
    expect(await act(A)).toMatchObject({ readyCount: 1, myReady: true, introOptIn: true });
    const events = await api.handle.db.select().from(incidentEvent).where(eq(incidentEvent.type, 'act_ready'));
    expect(events.map((e) => e.payload)).toEqual([
      { ready: true, introOptIn: false },
      { ready: true, introOptIn: true },
    ]);
  });

  it('второй житель через API: готов и согласен на знакомство — оба получают упоминания профилей MAX', async () => {
    const res = await api.call<Act>('POST', `/api/v1/incidents/${hot.id}/act/ready`, { token: tokens[B], body: { ready: true, introOptIn: true } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ available: true, readyCount: 2, myReady: true, introOptIn: true, requiredConsumers: 2 });
    await api.drain();
    expect(lastDm(api, B).text.split('\n').slice(0, 2)).toEqual(['**Готовы подписать акт вместе с вами**', `[сосед 1](max://user/${A})`]);
    expect(lastDm(api, A).text.split('\n').slice(0, 2)).toEqual(['**Готовы подписать акт вместе с вами**', `[сосед 1](max://user/${B})`]);
    // Повтор не шлёт знакомство снова.
    const count = dmMessages(api, A).length;
    await api.call('POST', `/api/v1/incidents/${hot.id}/act/ready`, { token: tokens[B], body: { ready: true, introOptIn: true } });
    await api.drain();
    expect(dmMessages(api, A)).toHaveLength(count);
  });

  it('не отметившийся житель — 403; отказ снимает и согласие на знакомство', async () => {
    const stranger = await api.call<Problem>('POST', `/api/v1/incidents/${hot.id}/act/ready`, { token: tokens[C], body: { ready: true } });
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe('not_participant');
    const off = await api.call<Act>('POST', `/api/v1/incidents/${hot.id}/act/ready`, { token: tokens[B], body: { ready: false, introOptIn: true } });
    expect(off.body).toMatchObject({ readyCount: 1, myReady: false, introOptIn: false });
  });

  it('УК снова отметила «Устранено» — проверка пришла, акт недоступен', async () => {
    uk = await api.login(STAFF_ID, 'uk');
    await status({ status: 'resolved' });
    expect((await row()).status).toBe('checking');
    const info = await act(A);
    expect(info === null || info.available === false).toBe(true);
    const res = await api.call<Problem>('POST', `/api/v1/incidents/${hot.id}/act/ready`, { token: tokens[A], body: { ready: true } });
    expect(res.status).toBe(409);
  });
});
