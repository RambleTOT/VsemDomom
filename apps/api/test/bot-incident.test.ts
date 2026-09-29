import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { houseByPublicId } from '../src/db/queries.ts';
import { chatCard, deadline, houseChat, incident, incidentEvent, incidentParticipant, outboundMessage, residency } from '../src/db/schema.ts';
import { QUEUES } from '../src/jobs/queue.ts';
import {
  answers,
  BOT_USERNAME,
  button,
  callbackPayload,
  createHarness,
  dm,
  dmMessages,
  fakeChat,
  lastDm,
  registerResident,
  STAFF_ID,
  updates,
  type Harness,
} from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const MIN = 60_000;
// Часы стенда: 27.09.2026 12:00 по Москве.
const msk = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);

const A = 7001; // кв. 57, подъезд 2, в чате
const B = 7002; // не зарегистрирован, бота не запускал
const C = 7003; // кв. 100, подъезд 3, не в чате (уровень 0)
const D = 7004; // кв. 5, подъезд 1, в чате

describe.skipIf(!url)('авария: личка, живая карточка, отметки соседей, АДС (A5, PostgreSQL + симулятор)', () => {
  let h: Harness;
  let hotId = 0;

  beforeAll(async () => {
    h = await createHarness(url!, { chats: [fakeChat(CHAT, { members: new Set([A, B, D, 7005]) })] });
    await h.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    for (const [user, flat] of [
      [A, 57],
      [C, 100],
      [D, 5],
    ] as const) {
      await registerResident(h, user, flat);
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  const cardOf = async (incidentId: number) => {
    const [row] = await h.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, incidentId));
    return { row, message: row?.mid ? h.max.messages.get(row.mid) : undefined };
  };
  const edits = () => h.calls.calls.filter((c) => c.method === 'PUT' && c.path === '/messages').length;
  const pressInCard = async (user: number, incidentId: number, text: string) => {
    const { row, message } = await cardOf(incidentId);
    await h.deliver(updates.callback(user, callbackPayload(message!.message, text), { chatId: CHAT, chatType: 'chat' }, row!.mid!));
  };
  /** Аварии жителей (в сидах есть модельная история тех же услуг). */
  const reported = (service: 'hot_water' | 'heating' | 'electricity') =>
    h.handle.db.select().from(incident).where(and(eq(incident.serviceType, service), eq(incident.isModel, false)));
  const participants = async (incidentId: number) =>
    h.handle.db.select().from(incidentParticipant).where(eq(incidentParticipant.incidentId, incidentId));

  it('житель сообщает в личке: что → когда → где; карточка в чате, сроки, панель, инструкция АДС', async () => {
    await h.deliver(updates.dmText(A, '/report'));
    expect(lastDm(h, A).text).toContain('Что случилось?');
    // Каждый пройденный шаг правится ответом на нажатие: «вопрос — ответ» без кнопок.
    const edited = () => h.max.callbacks.at(-1)?.answer.message;
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Горячая вода'), dm(A)));
    expect(lastDm(h, A).text).toBe('С какого времени нет горячей воды?');
    expect(edited()).toMatchObject({ text: 'Что случилось? — **Горячая вода**', keyboard: [] });
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), '1 ч назад'), dm(A)));
    expect(lastDm(h, A).text).toBe('Где нет горячей воды?');
    expect(edited()?.text).toBe('С какого времени нет горячей воды? — **1 ч назад**');
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Дом'), dm(A)));
    expect(edited()?.text).toBe('Где нет горячей воды? — **Дом**');

    const [inc] = await reported('hot_water');
    expect(inc).toMatchObject({ status: 'open', scope: 'house', startedSource: '1h', createdBy: A, startedAt: msk('11:00') });
    hotId = inc!.id;
    expect(await participants(hotId)).toMatchObject([{ userId: A, entrance: 2, floor: 6, trustLevelAtJoin: 1, affected: true }]);
    const dls = await h.handle.db.select().from(deadline).where(eq(deadline.incidentId, hotId));
    expect(Object.fromEntries(dls.map((d) => [d.kind, d.dueAt.toISOString()]))).toEqual({
      answer: msk('12:30').toISOString(),
      localize: msk('12:30').toISOString(),
      fix: msk('11:00', '2026-09-30').toISOString(),
      single_limit: msk('15:00').toISOString(),
    });

    const { row, message } = await cardOf(hotId);
    expect(row?.mid).toBeTruthy();
    expect(message?.message.text).toBe(
      [
        '**🔴 Нет горячей воды · УК ещё не ответила**',
        'Срок ответа УК по нормативу — до 12:30 (ПП № 416, п. 13)',
        'С 11:00 · отметился 1 житель: подъезд 2 — 1',
        'У вас тоже нет воды? Нажмите свой подъезд:',
        'Обновлено 12:00 · Модельные данные',
      ].join('\n'),
    );
    const [chat] = await h.handle.db.select().from(houseChat).where(eq(houseChat.chatId, CHAT));
    expect(h.max.messages.get(chat!.panelMid!)?.message.text).toContain('Активные аварии: 1 — нет горячей воды с 11:00');

    const done = lastDm(h, A);
    expect(done.text).toContain('Авария отмечена. Соседи видят карточку в чате дома');
    expect(done.text).toContain('Телефон: +7 (000) 000-00-01');
    expect(done.text).toContain('«ул. Модельная, 1, кв. 57»');
    expect(button(done, 'Скопировать номер АДС')).toMatchObject({ type: 'clipboard', payload: '+7 (000) 000-00-01' });
    expect(h.delayed().filter((j) => j.queue === QUEUES.adsReminder)).toEqual([
      { queue: QUEUES.adsReminder, data: { incidentId: hotId, userId: A }, startAfter: msk('12:30') },
    ]);
    // Таймеры сроков (A7): «срок истёк» для каждого срока, «до срока 30 минут» — для сроков длиннее окна.
    const timers = h.delayed().filter((j) => j.queue === QUEUES.deadline);
    expect(timers.filter((j) => (j.data as { kind: string }).kind === 'breach')).toHaveLength(4);
    expect(timers.filter((j) => (j.data as { kind: string }).kind === 'warn')).toHaveLength(2);
  });

  it('незарегистрированный сосед жмёт подъезд: участие с уровнем «не подтверждён», ссылка на бота, карточка правится', async () => {
    const before = edits();
    await pressInCard(B, hotId, '3');
    expect(answers(h).at(-1)).toBe(`Вы отметились: подъезд 3. Чтобы получать ответ УК и итог, откройте бота https://max.ru/${BOT_USERNAME}`);
    expect(edits()).toBe(before + 1);
    const text = (await cardOf(hotId)).message?.message.text ?? '';
    expect(text).toContain('С 11:00 · отметились 2 жителя: подъезд 2 — 1, подъезд 3 — 1');
    expect(text).toContain('Из них не подтверждены: 1');
  });

  it('повторное нажатие: «Вы уже отметились», счётчики и карточка не меняются', async () => {
    const before = edits();
    await pressInCard(B, hotId, '3');
    expect(answers(h).at(-1)).toBe('Вы уже отметились');
    expect(edits()).toBe(before);
    expect((await participants(hotId)).filter((p) => p.affected)).toHaveLength(2);
  });

  it('зарегистрированный без уровня 1 жмёт «Не знаю подъезд»: подъезд по квартире, нажатие в чате даёт уровень 1', async () => {
    const [before] = await h.handle.db.select().from(residency).where(eq(residency.userId, C));
    expect(before?.trustLevel).toBe(0);
    await pressInCard(C, hotId, 'Не знаю подъезд');
    expect(answers(h).at(-1)).toBe('Вы отметились: подъезд 3. Ответ УК пришлём в личку');
    const [after] = await h.handle.db.select().from(residency).where(eq(residency.userId, C));
    expect(after?.trustLevel).toBe(1);
    expect((await cardOf(hotId)).message?.message.text).toContain('отметились 3 жителя: подъезд 2 — 1, подъезд 3 — 2');
  });

  it('«Не у меня» снимает отметку', async () => {
    await pressInCard(B, hotId, 'Не у меня');
    expect(answers(h).at(-1)).toBe('Отметили: у вас горячая вода есть');
    const text = (await cardOf(hotId)).message?.message.text ?? '';
    expect(text).toContain('отметились 2 жителя: подъезд 2 — 1, подъезд 3 — 1');
    expect(text).not.toContain('не подтверждены');
    const events = await h.handle.db.select().from(incidentEvent).where(and(eq(incidentEvent.incidentId, hotId), eq(incidentEvent.type, 'left')));
    expect(events).toHaveLength(1);
  });

  it('второй житель сообщает о той же аварии в личке — отмечен в открытой, новой аварии и карточки нет', async () => {
    const cardsBefore = h.max.messagesIn({ chatId: CHAT }).length;
    await h.deliver(updates.dmText(D, '/report'));
    await h.deliver(updates.callback(D, callbackPayload(lastDm(h, D), 'Горячая вода'), dm(D)));
    await h.deliver(updates.callback(D, callbackPayload(lastDm(h, D), 'Сейчас'), dm(D)));
    await h.deliver(updates.callback(D, callbackPayload(lastDm(h, D), 'Подъезд'), dm(D)));
    expect(lastDm(h, D).text).toContain('В доме уже есть авария: нет горячей воды с 11:00. Мы отметили вас в ней');
    expect(await reported('hot_water')).toHaveLength(1);
    expect(h.max.messagesIn({ chatId: CHAT })).toHaveLength(cardsBefore);
    expect((await cardOf(hotId)).message?.message.text).toContain('отметились 3 жителя: подъезд 1 — 1, подъезд 2 — 1, подъезд 3 — 1');
  });

  it('«только в моей квартире»: авария видна УК и автору, в чат не публикуется', async () => {
    const chatBefore = h.max.messagesIn({ chatId: CHAT }).length;
    await h.deliver(updates.dmText(D, '/report'));
    await h.deliver(updates.callback(D, callbackPayload(lastDm(h, D), 'Свет'), dm(D)));
    await h.deliver(updates.callback(D, callbackPayload(lastDm(h, D), 'Сейчас'), dm(D)));
    await h.deliver(updates.callback(D, callbackPayload(lastDm(h, D), 'Квартира'), dm(D)));
    expect(lastDm(h, D).text).toContain('Авария видна УК и вам. В чат дома она не попадёт');
    const [flat] = await reported('electricity');
    expect(flat).toMatchObject({ scope: 'flat', status: 'open' });
    expect(await h.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, flat!.id))).toHaveLength(0);
    expect(h.max.messagesIn({ chatId: CHAT })).toHaveLength(chatBefore);
  });

  it('своё время: неверный формат, будущее, старше суток — с подтверждением; подъезд — по квартире', async () => {
    await h.deliver(updates.dmText(C, '/report'));
    await h.deliver(updates.callback(C, callbackPayload(lastDm(h, C), 'Отопление'), dm(C)));
    await h.deliver(updates.callback(C, callbackPayload(lastDm(h, C), 'Указать время'), dm(C)));
    expect(lastDm(h, C).text).toContain('Напишите время начала');
    await h.deliver(updates.dmText(C, 'вчера вечером'));
    expect(lastDm(h, C).text).toContain('Не понял время');
    await h.deliver(updates.dmText(C, '23:59'));
    expect(lastDm(h, C).text).toContain('Это время ещё не наступило');
    await h.deliver(updates.dmText(C, '26.09 10:00'));
    expect(lastDm(h, C).text).toBe('Авария началась больше суток назад? Проверьте дату\nНачало: 26.09 10:00');
    await h.deliver(updates.callback(C, callbackPayload(lastDm(h, C), 'Да, верно'), dm(C)));
    expect(lastDm(h, C).text).toBe('Где нет отопления?');
    await h.deliver(updates.callback(C, callbackPayload(lastDm(h, C), 'Подъезд'), dm(C)));
    const [heat] = await reported('heating');
    expect(heat).toMatchObject({ scope: 'entrance', entrance: 3, startedSource: 'custom', startedAt: msk('10:00', '2026-09-26') });
    const text = (await cardOf(heat!.id)).message?.message.text ?? '';
    expect(text).toContain('**🔴 Нет отопления · УК ещё не ответила**');
    expect(text).toContain('С 26.09 10:00 · отметился 1 житель: подъезд 3 — 1');
    expect(text).toContain('У вас тоже нет отопления? Нажмите свой подъезд:');
  });

  it('«Отмена» посреди сообщения об аварии', async () => {
    await h.deliver(updates.dmText(A, '/report'));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Отмена'), dm(A)));
    expect(answers(h).at(-1)).toBe('Отменили');
    expect(h.max.callbacks.at(-1)?.answer.message).toMatchObject({ text: 'Отменили', keyboard: [] });
    expect(lastDm(h, A).text).toContain('кв. 57');
  });

  it('номер заявки АДС: сроки ответа и локализации — от регистрации; повторный номер — только в хронологию', async () => {
    const withAds = dmMessages(h, A).findLast((m) => m.text.includes('Авария отмечена'))!;
    await h.deliver(updates.callback(A, callbackPayload(withAds, 'Ввести номер заявки'), dm(A)));
    expect(lastDm(h, A).text).toContain('Напишите номер заявки');
    await h.deliver(updates.dmText(A, 'номер?'));
    expect(lastDm(h, A).text).toContain('Не понял номер');
    await h.deliver(updates.dmText(A, '4127 11:40'));
    expect(lastDm(h, A).text).toBe('Номер заявки сохранён. Он виден в хронологии');
    // Просьба ввести номер правится: «Номер заявки — 4127» без «Отмена».
    const prompt = h.max.messagesIn({ userId: A }).find((m) => m.message.text.startsWith('Номер заявки —'));
    expect(prompt?.message).toMatchObject({ text: 'Номер заявки — **4127**', keyboard: [] });
    const [inc] = await h.handle.db.select().from(incident).where(eq(incident.id, hotId));
    expect(inc).toMatchObject({ adsRegNumber: '4127', adsRegAt: msk('11:40') });
    const dls = await h.handle.db.select().from(deadline).where(eq(deadline.incidentId, hotId));
    expect(dls.find((d) => d.kind === 'answer')?.dueAt).toEqual(msk('12:10'));
    expect(dls.find((d) => d.kind === 'fix')?.dueAt).toEqual(msk('11:00', '2026-09-30'));
    expect((await cardOf(hotId)).message?.message.text).toContain('Срок ответа УК по нормативу — до 12:10');

    const dDone = dmMessages(h, D).findLast((m) => m.text.includes('В доме уже есть авария'))!;
    await h.deliver(updates.callback(D, callbackPayload(dDone, 'Ввести номер заявки'), dm(D)));
    await h.deliver(updates.dmText(D, '5555'));
    const [again] = await h.handle.db.select().from(incident).where(eq(incident.id, hotId));
    expect(again?.adsRegNumber).toBe('4127');
    const events = await h.handle.db.select().from(incidentEvent).where(and(eq(incidentEvent.incidentId, hotId), eq(incidentEvent.type, 'ads_registered')));
    expect(events.map((e) => e.payload?.number)).toEqual(['4127', '5555']);
  });

  it('«Не дозвонился» и одно напоминание через 30 минут — только тем, кто так и не ввёл номер', async () => {
    const [flat] = await reported('electricity');
    const flatDone = dmMessages(h, D).findLast((m) => m.text.includes('В чат дома она не попадёт'))!;
    await h.deliver(updates.callback(D, callbackPayload(flatDone, 'Не дозвонился'), dm(D)));
    expect(answers(h).at(-1)).toBe('Записали попытку дозвониться. Напомним через 30 минут');
    const aBefore = dmMessages(h, A).length;
    const dBefore = dmMessages(h, D).length;
    await h.advance(31 * MIN);
    // У A номер введён — напоминания нет; у D — одно, хотя задачи было две (после создания и после «Не дозвонился»).
    // (Уведомления «срок истёк» от таймеров A7 — отдельная тема, здесь не считаются.)
    expect(dmMessages(h, A).slice(aBefore).filter((m) => m.text.startsWith('Вы сообщили'))).toHaveLength(0);
    await h.advance(31 * MIN);
    const reminders = dmMessages(h, D)
      .slice(dBefore)
      .filter((m) => m.text.startsWith('Вы сообщили: нет света'));
    expect(reminders).toHaveLength(1);
    const events = await h.handle.db.select().from(incidentEvent).where(and(eq(incidentEvent.incidentId, flat!.id), eq(incidentEvent.type, 'ads_not_reached')));
    expect(events).toHaveLength(1);
  });

  it('карточку удалили в чате — публикуется новая, в бюджет трёх сообщений замена не входит', async () => {
    const { row } = await cardOf(hotId);
    h.max.messages.get(row!.mid!)!.deleted = true;
    await h.deliver(updates.callback(7005, `v1:join:${(await h.handle.db.select().from(incident).where(eq(incident.id, hotId)))[0]!.publicId}:1`, { chatId: CHAT, chatType: 'chat' }));
    const { row: after, message } = await cardOf(hotId);
    expect(after?.mid).not.toBe(row?.mid);
    expect(message?.message.text).toContain('подъезд 1 — 2');
    const kinds = (await h.handle.db.select().from(outboundMessage).where(eq(outboundMessage.incidentId, hotId)))
      .map((o) => o.kind)
      .filter((k) => k !== 'dm')
      .sort();
    expect(kinds).toEqual(['card_create', 'card_replace']);
  });

  it('нажал до регистрации, потом зарегистрировался — отметка сохранена, «не подтверждён» пропадает', async () => {
    expect((await cardOf(hotId)).message?.message.text).toContain('Из них не подтверждены: 1');
    await registerResident(h, 7005, 3);
    const mine = (await participants(hotId)).find((p) => p.userId === 7005);
    expect(mine).toMatchObject({ affected: true, entrance: 1 });
    expect(mine?.residencyId).not.toBeNull();
    await h.drain();
    const text = (await cardOf(hotId)).message?.message.text ?? '';
    expect(text).toContain('подъезд 1 — 2');
    expect(text).not.toContain('не подтверждены');
  });

  it('закрытая авария: кнопки старой карточки отвечают «уже закрыта»', async () => {
    await h.handle.db.update(incident).set({ status: 'closed', closedAt: h.clock.now() }).where(eq(incident.id, hotId));
    const [inc] = await h.handle.db.select().from(incident).where(eq(incident.id, hotId));
    await h.deliver(updates.callback(A, `v1:join:${inc!.publicId}:2`, { chatId: CHAT, chatType: 'chat' }));
    expect(answers(h).at(-1)).toBe('Эта авария уже закрыта. Итог — в «Подробнее»');
    await h.deliver(updates.callback(A, 'v1:join:ZZZZZZZZZZ:2', { chatId: CHAT, chatType: 'chat' }));
    expect(answers(h).at(-1)).toBe('Кнопка устарела. Откройте бота заново');
  });

  it('в сообщениях чата нет имён и номеров квартир; тела отправленных сообщений не хранятся', async () => {
    const texts = h.max.messagesIn({ chatId: CHAT }).map((m) => m.message.text);
    for (const text of texts) expect(text).not.toMatch(/кв\.\s*\d/);
    const rows = await h.handle.db.select().from(outboundMessage);
    expect(rows.filter((r) => r.status === 'sent').every((r) => r.payload === null)).toBe(true);
    const house = await houseByPublicId(h.handle.db, 'dom1model1');
    expect(house?.id).toBeTypeOf('number');
  });
});
