import { flatLocation } from '@vsemdomom/core';
import type { IncidentDetail, Problem } from '@vsemdomom/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { houseByPublicId } from '../src/db/queries.ts';
import { chatCard, incident, poll, pollAnswer } from '../src/db/schema.ts';
import { QUEUES } from '../src/jobs/queue.ts';
import { createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { answers, callbackPayload, fakeChat, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const MIN = 60_000;
const HOUR = 60 * MIN;
const msk = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);

type HeatMap = {
  poll: { startedAt: string; closedAt: string | null } | null;
  entrances: number;
  floors: number;
  cells: { entrance: number; floor: number; warm: number; luke: number; cold: number }[];
  answered: number;
  totalFlats: number;
  norm: { point: string } | null;
};

describe.skipIf(!url)('F14: опросы в чате дома и тепловая карта', () => {
  let api: ApiHarness;
  let uk = '';
  const tokens: Record<number, string> = {};
  const A = 8201; // кв. 57
  const U = 8299; // не зарегистрирован

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT)], env: { DEMO_UK_CODE: 'DEMO-POLLS' } });
    await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    uk = await api.login(STAFF_ID, 'uk');
    tokens[A] = await api.resident(A, 'dom1model1', 57);
  });
  afterAll(async () => {
    await api?.close();
  });

  const pollRows = () => api.handle.db.select().from(poll);
  const pollMessage = async (type: 'water_quality' | 'heating') => {
    const [p] = (await pollRows()).filter((r) => r.type === type);
    return { row: p!, message: api.max.messages.get(p!.mid!)!.message };
  };
  const pressPoll = async (user: number, type: 'water_quality' | 'heating', text: string) => {
    const { row, message } = await pollMessage(type);
    await api.deliver(updates.callback(user, callbackPayload(message, text), { chatId: CHAT, chatType: 'chat' }, row.mid!));
  };

  it('авария с водой закрыта — «Как вода сейчас?» через 3 ч (WATER_QUALITY_POLL_DELAY_HOURS)', async () => {
    const res = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: tokens[A], body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: '1h' } });
    const id = res.body.id;
    const status = async (body: object) => expect((await api.call('POST', `/api/v1/uk/incidents/${id}/status`, { token: uk, body })).status).toBe(200);
    await status({ status: 'accepted', eta: new Date(api.clock.now().getTime() + 2 * HOUR).toISOString() });
    await status({ status: 'resolved' });
    await api.drain();
    const [inc] = await api.handle.db.select().from(incident).where(eq(incident.publicId, id));
    const [card] = await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, inc!.id));
    const question = api.max.messages.get(card!.checkMid!)!.message;
    await api.deliver(updates.callback(A, callbackPayload(question, 'Да, есть'), { chatId: CHAT, chatType: 'chat' }, card!.checkMid!));
    expect((await api.handle.db.select().from(incident).where(eq(incident.publicId, id)))[0]?.status).toBe('closed');
    expect(api.delayed().filter((j) => j.queue === QUEUES.poll)).toEqual([{ queue: QUEUES.poll, data: { kind: 'water', incidentId: inc!.id }, startAfter: msk('15:00') }]);
    expect(await pollRows()).toEqual([]);

    await api.advance(3 * HOUR);
    const { row, message } = await pollMessage('water_quality');
    expect(row).toMatchObject({ incidentId: inc!.id, isModel: true, closedAt: null });
    expect(message.text.split('\n')[0]).toBe('**Как вода сейчас?**');
    expect(message.notify).toBe(false);
    expect(message.keyboard[0]?.map((b) => b.text)).toEqual(['Нормально', 'Ржавая', 'Слабый напор']);
  });

  it('ответы: последний действует, в чате — только общий счётчик; подъезд и этаж — по квартире', async () => {
    await pressPoll(A, 'water_quality', 'Нормально');
    await pressPoll(A, 'water_quality', 'Ржавая');
    expect(answers(api).at(-1)).toBe('Ответ сохранён. Его видит только УК');
    await pressPoll(U, 'water_quality', 'Слабый напор');
    const h = (await houseByPublicId(api.handle.db, 'dom1model1'))!;
    const loc = flatLocation(h, 57)!;
    const rows = await api.handle.db.select().from(pollAnswer);
    expect(rows.map((r) => [r.userId, r.value, r.entrance, r.floor]).sort()).toEqual([
      [A, 'rust', loc.entrance, loc.floor],
      [U, 'low', null, null],
    ].sort());
    const { message } = await pollMessage('water_quality');
    expect(message.text).toContain('Ответили: 2');
    expect(message.text).not.toContain('кв.');
  });

  it('через 24 ч опрос завершается: кнопки сняты, поздний ответ не принимается', async () => {
    await api.advance(24 * HOUR);
    const { row, message } = await pollMessage('water_quality');
    expect(row.closedAt).not.toBeNull();
    expect(message.keyboard).toEqual([]);
    expect(message.text).toContain('Опрос завершён');
    const payload = `v1:poll:${(await api.handle.db.select().from(incident).where(eq(incident.id, row.incidentId!)))[0]!.publicId}:ok`;
    await api.deliver(updates.callback(A, payload, { chatId: CHAT, chatType: 'chat' }, row.mid!));
    expect(answers(api).at(-1)).toBe('Опрос уже завершён');
  });

  it('«Тепло ли у вас?» запускает УК: 202, раз за сезон; житель — 403', async () => {
    uk = await api.login(STAFF_ID, 'uk');
    tokens[A] = await api.login(A);
    const denied = await api.call<Problem>('POST', '/api/v1/uk/houses/dom1model1/polls/heating', { token: tokens[A] });
    expect(denied.status).toBe(403);
    const res = await api.call<{ startedAt: string }>('POST', '/api/v1/uk/houses/dom1model1/polls/heating', { token: uk });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.startedAt).toBe(api.clock.now().toISOString());
    await api.drain();
    const { message } = await pollMessage('heating');
    expect(message.text.split('\n')[0]).toBe('**Тепло ли у вас?**');
    expect(message.keyboard.map((r) => r.map((b) => b.text))).toEqual([['Тепло', 'Чуть тёплые', 'Холодные'], ['1', '2', '3', '4']]);
    const again = await api.call<Problem>('POST', '/api/v1/uk/houses/dom1model1/polls/heating', { token: uk });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invalid_transition');
  });

  it('ответы на отопление: без квартиры бот просит подъезд; подъезд до ответа — подсказка', async () => {
    await pressPoll(A, 'heating', 'Холодные');
    expect(answers(api).at(-1)).toBe('Ответ сохранён. Его видит только УК');
    await pressPoll(U, 'heating', '2');
    expect(answers(api).at(-1)).toBe('Сначала ответьте, тепло ли у вас');
    await pressPoll(U, 'heating', 'Тепло');
    expect(answers(api).at(-1)).toBe('Ответ сохранён. Нажмите номер своего подъезда — так УК увидит, какой стояк затронут');
    await pressPoll(U, 'heating', '3');
    expect(answers(api).at(-1)).toBe('Подъезд 3 сохранён');
  });

  it('тепловая карта U05: сетка «подъезд × этаж» по жителям с квартирой, основание — прил. 1, п. 15', async () => {
    const h = (await houseByPublicId(api.handle.db, 'dom1model1'))!;
    const loc = flatLocation(h, 57)!;
    const res = await api.call<HeatMap>('GET', '/api/v1/uk/houses/dom1model1/heatmap', { token: uk });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ entrances: h.entrances, floors: h.floors, answered: 2, totalFlats: h.flatTo - h.flatFrom + 1, norm: { point: 'прил. 1, п. 15' } });
    expect(res.body.poll?.closedAt).toBeNull();
    expect(res.body.cells).toEqual([{ entrance: loc.entrance, floor: loc.floor, warm: 0, luke: 0, cold: 1 }]);
    expect((await api.call('GET', '/api/v1/uk/houses/dom1model1/heatmap', { token: tokens[A] })).status).toBe(403);
  });

  it('сброс демо удаляет опросы дома — «Тепло ли у вас?» можно запустить снова', async () => {
    const demo = await api.login(8250);
    expect((await api.call('POST', '/api/v1/me/demo-uk-role', { token: demo, body: { code: 'DEMO-POLLS' } })).status).toBe(200);
    expect((await api.call('POST', '/api/v1/uk/houses/dom1model1/demo/reset', { token: demo, body: {} })).status).toBe(200);
    expect(await pollRows()).toEqual([]);
    expect(await api.handle.db.select().from(pollAnswer)).toEqual([]);
    expect((await api.call('POST', '/api/v1/uk/houses/dom1model1/polls/heating', { token: demo })).status).toBe(202);
  });
});
