import type { HouseDetail, IncidentDetail, Problem } from '@vsemdomom/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatCard, incident, incidentParticipant, outboundMessage } from '../src/db/schema.ts';
import { createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { callbackPayload, dm, dmMessages, fakeChat, lastDm, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const MIN = 60_000;
const HOUR = 60 * MIN;
// Часы стенда: 27.09.2026 12:00 по Москве.
const msk = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);

type Result = {
  my: { flatNo: number; restoredAt: string; durationMinutes: number; source: string } | null;
  month: { totalMinutes: number; limitMinutes: number; excessMinutes: number; withinNorm: boolean } | null;
  single: { limitMinutes: number; longestMinutes: number; exceeded: boolean } | null;
  flatsCount: number;
  lateFlats: { count: number; lastRestoredAt: string | null };
  eligibleFlats: number;
  actCopyNorm: { point: string } | null;
  disclaimer: string;
};

describe.skipIf(!url)('проверка после «Устранено», расхождение, закрытие и итог (A8)', () => {
  let api: ApiHarness;
  let uk = '';
  const tokens: Record<number, string> = {};
  const A = 8001; // кв. 57
  const B = 8002; // кв. 100
  const C = 8003; // кв. 5

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
  /** После сдвига часов больше чем на 12 часов сессии истекают — входим заново. */
  const relogin = async () => {
    uk = await api.login(STAFF_ID, 'uk');
    for (const user of [A, B, C]) tokens[user] = await api.login(user);
  };
  afterAll(async () => {
    await api?.close();
  });

  const report = async (service: string, scope = 'house', preset = 'now') => {
    const res = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: tokens[A], body: { houseId: 'dom1model1', service, scope, startedPreset: preset } });
    expect(res.status).toBe(201);
    return res.body;
  };
  const status = async (id: string, body: object) => {
    const res = await api.call<IncidentDetail>('POST', `/api/v1/uk/incidents/${id}/status`, { token: uk, body });
    expect(res.status).toBe(200);
    await api.drain();
    return res.body;
  };
  const eta = () => new Date(api.clock.now().getTime() + 2 * HOUR).toISOString();
  const row = async (publicId: string) => (await api.handle.db.select().from(incident).where(eq(incident.publicId, publicId)))[0]!;
  const cardRow = async (publicId: string) => (await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, (await row(publicId)).id)))[0]!;
  const messageText = (mid: string | null | undefined) => (mid ? api.max.messages.get(mid)?.message.text : undefined);
  const press = async (user: number, publicId: string, text: string) => {
    const c = await cardRow(publicId);
    const question = api.max.messages.get(c.checkMid!)!.message;
    await api.deliver(updates.callback(user, callbackPayload(question, text), { chatId: CHAT, chatType: 'chat' }, c.checkMid!));
  };
  const answers = () => api.max.callbacks.map((c) => c.answer.notification ?? '');

  describe('горячая вода: «Нет» → расхождение → «Да» позже → итог со временем по квартире', () => {
    let hot: IncidentDetail;

    it('подготовка: авария с 11:00, отметились три квартиры, УК «Устранено» в 12:00', async () => {
      hot = await report('hot_water', 'house', '1h');
      for (const user of [B, C]) await api.call('POST', `/api/v1/incidents/${hot.id}/join`, { token: tokens[user], body: {} });
      await status(hot.id, { status: 'accepted', eta: eta() });
      const checking = await status(hot.id, { status: 'resolved' });
      expect(checking.status).toBe('checking');
      expect(messageText((await cardRow(hot.id)).checkMid)?.split('\n')[0]).toBe('**Горячая вода вернулась?**');
    });

    it('«Да» — ответ сохранён; «Нет» — расхождение, карточка, инструкция в личку с нормами из справочника', async () => {
      await press(A, hot.id, 'Да, есть');
      expect(answers().at(-1)).toBe('Ответ сохранён. Его можно изменить — считается последний');
      await press(B, hot.id, 'Нет');
      expect(answers().at(-1)).toBe('Ответ «Нет» сохранён. В личку придёт подсказка, как сообщить в АДС');
      expect((await row(hot.id)).status).toBe('discrepancy');
      expect(messageText((await cardRow(hot.id)).mid)?.split('\n').slice(0, 2)).toEqual([
        '**⚠️ Горячая вода · у 1 квартиры воды нет**',
        'УК отметила устранение в 12:00. Им пришла подсказка в личку',
      ]);
      const help = lastDm(api, B);
      expect(help.text).toContain('**Воды нет — что делать**');
      expect(help.text).toContain('2. Если через 2 ч проверки нет, акт могут составить 2 соседа и председатель совета');
      expect(dmMessages(api, A).some((m) => m.text.includes('Воды нет'))).toBe(false);
    });

    it('«Я сообщил в АДС» в личке: номер и время повторного сообщения — у участника и в хронологии', async () => {
      api.clock.set(msk('12:15'));
      await api.deliver(updates.callback(B, callbackPayload(lastDm(api, B), 'Я сообщил в АДС'), dm(B)));
      expect(lastDm(api, B).text).toContain('повторного сообщения в АДС');
      await api.deliver(updates.dmText(B, '4130 12:10'));
      expect(lastDm(api, B).text).toBe('Записали повторное сообщение в АДС — оно видно в хронологии');
      const [p] = await api.handle.db
        .select()
        .from(incidentParticipant)
        .where(and(eq(incidentParticipant.incidentId, (await row(hot.id)).id), eq(incidentParticipant.userId, B)));
      expect(p).toMatchObject({ adsRereportNumber: '4130', adsRereportAt: msk('12:10') });
    });

    it('окно проверки не закрывает аварию с актуальным «Нет»', async () => {
      await api.advance(10 * MIN);
      expect((await row(hot.id)).status).toBe('discrepancy');
    });

    it('«Нет» сменили на «Да» в 15:40: закрыто, итог — ответом на карточку, в бюджете трёх сообщений', async () => {
      api.clock.set(msk('15:40'));
      await press(B, hot.id, 'Да, есть');
      await api.drain();
      const closed = await row(hot.id);
      expect(closed).toMatchObject({ status: 'closed', discrepancyUnresolved: false });
      const c = await cardRow(hot.id);
      expect(messageText(c.mid)?.split('\n').slice(0, 2)).toEqual([
        '**✅ Закрыта · горячая вода есть**',
        'У 1 квартиры перерыв 10 ч 40 мин, сверх месячной нормы. Итог ниже',
      ]);
      const result = api.max.messages.get(c.resultMid!);
      expect(result?.message.replyToMid).toBe(c.mid);
      // Вопрос о восстановлении после закрытия — без кнопок (правка, не новое сообщение).
      const question = api.max.messages.get(c.checkMid!);
      expect(question?.message.keyboard).toEqual([]);
      expect(question?.message.text.split('\n')[1]).toBe('Проверка закончена в 15:40. Итог — ответом на карточку');
      expect(result?.message.text).toMatchInlineSnapshot(`
        "**Итог: горячая вода, Дом 1**
        По отметке УК: 11:00–12:00, 1 ч
        Отметились 3 квартиры. У 1 вода вернулась позже, в 15:40
        У 1 квартиры за сентябрь 10 ч 40 мин перерывов при норме 8 ч
        Её жители могут подать заявление на перерасчёт
        Копию акта о нарушении качества выдают по запросу за 3 рабочих дня (ПП № 416, п. 34)
        Это расчёт по нормам · Модельные данные"
      `);
      const kinds = (await api.handle.db.select().from(outboundMessage).where(eq(outboundMessage.incidentId, closed.id))).map((o) => o.kind);
      expect(kinds.filter((k) => k !== 'dm').sort()).toEqual(['card_create', 'check_question', 'result']);
      expect(lastDm(api, A).text.split('\n')[0]).toBe('✅ Авария закрыта · горячая вода есть');
      // «Я сообщил в АДС» из старой инструкции после закрытия — ответ, а не просьба номера.
      const help = dmMessages(api, B).find((m) => m.text.includes('Воды нет'))!;
      const dmsBefore = dmMessages(api, B).length;
      await api.deliver(updates.callback(B, callbackPayload(help, 'Я сообщил в АДС'), dm(B)));
      expect(answers().at(-1)).toBe('Эта авария уже закрыта. Итог — в «Подробнее»');
      expect(dmMessages(api, B)).toHaveLength(dmsBefore);
    });

    it('итог в приложении: для каждой квартиры своё время и месяц против нормы', async () => {
      const b = await api.call<Result>('GET', `/api/v1/incidents/${hot.id}/result`, { token: tokens[B] });
      expect(b.status).toBe(200);
      expect(b.body).toMatchObject({
        my: { flatNo: 100, restoredAt: msk('15:40').toISOString(), durationMinutes: 280, source: 'resident_answer' },
        month: { totalMinutes: 640, limitMinutes: 480, excessMinutes: 160, withinNorm: false },
        // Единовременный лимит — перерыв этой аварии у квартиры (11:00–15:40), а не самый длинный за месяц (6 ч в истории).
        single: { limitMinutes: 240, longestMinutes: 280, exceeded: true },
        flatsCount: 3,
        lateFlats: { count: 1, lastRestoredAt: msk('15:40').toISOString() },
        eligibleFlats: 1,
        actCopyNorm: { point: 'п. 34' },
        disclaimer: 'Это расчёт по нормам, итог определяет исполнитель услуги',
      });
      const a = await api.call<Result>('GET', `/api/v1/incidents/${hot.id}/result`, { token: tokens[A] });
      expect(a.body).toMatchObject({ my: { flatNo: 57, restoredAt: msk('12:00').toISOString(), source: 'uk_mark' }, month: { totalMinutes: 420, withinNorm: true } });
      const u = await api.call<Result>('GET', `/api/v1/incidents/${hot.id}/result`, { token: uk });
      expect(u.body.my).toBeNull();
      // Главная дома: в «Последних итогах» — сколько квартир сверх месячной нормы (как в итоге в чате).
      const home = await api.call<HouseDetail>('GET', '/api/v1/houses/dom1model1', { token: tokens[A] });
      expect(home.body.recentResults.find((r) => r.id === hot.id)?.overNormFlats).toBe(1);
    });
  });

  it('правило (а): все жители уровня 1–2 ответили «Да» — закрытие сразу', async () => {
    const cold = await report('cold_water');
    const checking = await status(cold.id, { status: 'resolved' });
    // «Устранено» без «Принято»: срок ответа отменён, в хронологии нет «Срок выполнен: УК сообщит сроки работ».
    expect(checking.deadlines.find((d) => d.kind === 'answer')?.state).toBe('cancelled');
    expect(checking.timeline.filter((e) => e.type === 'deadline_met').map((e) => e.payload?.kind)).not.toContain('answer');
    expect(checking.headline.nextDeadline).toBeNull();
    const res = await api.call<IncidentDetail>('POST', `/api/v1/incidents/${cold.id}/observations`, { token: tokens[A], body: { kind: 'restored_yes' } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(res.body.timeline.find((e) => e.type === 'closed')?.payload).toEqual({ reason: 'all_confirmed' });
    expect((await api.call<Problem>('POST', `/api/v1/incidents/${cold.id}/observations`, { token: tokens[A], body: { kind: 'restored_no' } })).body.code).toBe(
      'invalid_transition',
    );
  });

  it('правило (б): окно проверки прошло без «Нет» — закрытие по таймеру', async () => {
    const heat = await report('heating');
    await status(heat.id, { status: 'resolved' });
    // До закрытия итог предварительный (на текущий момент).
    expect((await api.call<{ preliminary: boolean }>('GET', `/api/v1/incidents/${heat.id}/result`, { token: tokens[A] })).body.preliminary).toBe(true);
    // В модельном доме в демо-режиме окно проверки — DEMO_CHECK_WINDOW_MIN (5 минут).
    await api.advance(6 * MIN);
    const closed = await row(heat.id);
    expect(closed.status).toBe('closed');
    const detail = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${heat.id}`, { token: tokens[A] });
    expect(detail.body.timeline.find((e) => e.type === 'closed')?.payload).toEqual({ reason: 'check_window_elapsed' });
  });

  it('расхождение без ответа до предельного срока — «Закрыта с расхождением»', async () => {
    const power = await report('electricity');
    await api.call('POST', `/api/v1/incidents/${power.id}/join`, { token: tokens[B], body: {} });
    await status(power.id, { status: 'resolved' });
    await api.call('POST', `/api/v1/incidents/${power.id}/observations`, { token: tokens[B], body: { kind: 'restored_no' } });
    expect((await row(power.id)).status).toBe('discrepancy');
    await api.advance(72 * HOUR + MIN);
    await relogin();
    expect(await row(power.id)).toMatchObject({ status: 'closed', discrepancyUnresolved: true });
    expect(messageText((await cardRow(power.id)).mid)?.split('\n').slice(0, 2)).toEqual([
      '**⚠️ Закрыта · у 1 квартиры восстановление не подтверждено**',
      'За 72 ч подтверждения восстановления не пришло. Итог ниже',
    ]);
    const detail = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${power.id}`, { token: tokens[B] });
    expect(detail.body.displayStatus).toBe('closed_with_discrepancy');
  });

  it('«Подтверждаю» от двух квартир уровня 1–2 — событие в хронологии; вне статуса — «кнопка устарела»', async () => {
    const sewer = await report('sewerage');
    await status(sewer.id, { status: 'brigade_on_site' });
    const card = await cardRow(sewer.id);
    const message = api.max.messages.get(card.mid!)!.message;
    await api.deliver(updates.callback(A, callbackPayload(message, 'Подтверждаю'), { chatId: CHAT, chatType: 'chat' }, card.mid!));
    expect(answers().at(-1)).toBe('Спасибо, отметили. Когда подтвердят и соседи из других квартир, это появится в хронологии');
    await api.deliver(updates.callback(B, callbackPayload(message, 'Подтверждаю'), { chatId: CHAT, chatType: 'chat' }, card.mid!));
    const detail = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${sewer.id}`, { token: tokens[A] });
    expect(detail.body.timeline.find((e) => e.type === 'residents_brigade_confirmed')?.payload).toEqual({ flats: 2 });
    expect(detail.body.counters.brigade).toEqual({ confirmed: 2, absent: 0 });
    await status(sewer.id, { status: 'localized' });
    await api.deliver(updates.callback(C, callbackPayload(message, 'Бригады нет'), { chatId: CHAT, chatType: 'chat' }, card.mid!));
    expect(answers().at(-1)).toBe('Кнопка устарела. Откройте бота заново');
  });
});
