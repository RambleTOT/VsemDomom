import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { incident } from '../src/db/schema.ts';
import { answers, callbackPayload, createHarness, dm, dmMessages, fakeChat, lastDm, registerResident, STAFF_ID, updates, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const A = 8601; // житель
const D = 8602; // проверяющий с демо-кодом

describe.skipIf(!url)('демо-пульт УК в личке: /democode и /uk', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness(url!, { chats: [fakeChat(CHAT)], env: { DEMO_MODE: 'true', DEMO_UK_CODE: 'DEMO-CONSOLE' } });
    await h.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    await registerResident(h, A, 57);
    await h.deliver(updates.botStarted(STAFF_ID));
    await h.deliver(updates.botStarted(D));
  });
  afterAll(async () => {
    await h?.close();
  });

  const hot = async () => (await h.handle.db.select().from(incident).where(and(eq(incident.isModel, false), eq(incident.serviceType, 'hot_water'))))[0]!;

  it('сотрудник без открытых аварий — «нет аварий»; житель — подсказка про демо-код', async () => {
    await h.deliver(updates.dmText(STAFF_ID, '/uk'));
    expect(lastDm(h, STAFF_ID).text).toBe('Открытых аварий в ваших домах нет');
    await h.deliver(updates.dmText(A, '/uk'));
    expect(lastDm(h, A).text).toBe('Эта команда — для сотрудников УК. Демо-роль: /democode и код со служебного слайда');
  });

  it('открытая авария — сообщение с кнопками; «Принято +2 ч» меняет статус и карточку', async () => {
    await h.deliver(updates.dmText(A, '/report'));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Горячая вода'), dm(A)));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Сейчас'), dm(A)));
    await h.deliver(updates.callback(A, callbackPayload(lastDm(h, A), 'Дом'), dm(A)));
    await h.deliver(updates.dmText(STAFF_ID, '/uk'));
    const console = lastDm(h, STAFF_ID);
    expect(console.text.split('\n')[0]).toBe('**Дом 1 · Горячая вода**');
    expect(dmMessages(h, STAFF_ID).at(-2)?.text).toContain('Пульт УК (демо)');
    await h.deliver(updates.callback(STAFF_ID, callbackPayload(console, 'Принято +2 ч'), dm(STAFF_ID)));
    expect(answers(h).at(-1)).toBe('Статус: Принята');
    const row = await hot();
    expect(row.status).toBe('accepted');
    expect(row.etaAt?.getTime()).toBe(h.clock.now().getTime() + 2 * 3_600_000);
    // Сообщение пульта правится ответом на нажатие: новый статус и только следующие кнопки.
    const edited = h.max.callbacks.at(-1)?.answer.message;
    expect(edited?.text.split('\n')[1]).toMatch(/^Принята, с /);
    expect(edited?.keyboard.flat().map((b) => b.text)).toEqual(['Бригада на месте', 'Локализовано', 'Устранено']);
    // Повтор той же кнопки — отказ машины состояний, без падения; сообщение показывает текущий статус.
    await h.deliver(updates.callback(STAFF_ID, callbackPayload(console, 'Принято +2 ч'), dm(STAFF_ID)));
    expect(answers(h).at(-1)).toMatch(/^Не получилось: /);
    expect(h.max.callbacks.at(-1)?.answer.message?.keyboard.flat().map((b) => b.text)).toEqual(['Бригада на месте', 'Локализовано', 'Устранено']);
  });

  it('кнопку пульта нажал не сотрудник — отказ, статус не меняется', async () => {
    const console = lastDm(h, STAFF_ID);
    await h.deliver(updates.callback(A, callbackPayload(console, 'Устранено'), dm(A)));
    expect(answers(h).at(-1)).toBe('Это авария дома другой УК');
    expect((await hot()).status).toBe('accepted');
  });

  it('/democode: неверный код — отказ; верный — демо-роль и пульт', async () => {
    await h.deliver(updates.dmText(D, '/democode WRONG-CODE'));
    expect(lastDm(h, D).text).toBe('Код не подошёл. Проверьте код и отправьте /democode <код> ещё раз');
    await h.deliver(updates.dmText(D, '/democode DEMO-CONSOLE'));
    expect(lastDm(h, D).text).toBe('Готово: у вас демо-роль сотрудника УК «Садовый квартал». Пульт аварий — /uk');
    await h.deliver(updates.dmText(D, '/uk'));
    const console = lastDm(h, D);
    await h.deliver(updates.callback(D, callbackPayload(console, 'Бригада на месте'), dm(D)));
    expect(answers(h).at(-1)).toBe('Статус: Бригада на месте');
  });

  it('при DEMO_MODE=false пульт выключен', async () => {
    const off = { ...h.ctx, config: { ...h.ctx.config, demo: { ...h.ctx.config.demo, enabled: false } } };
    const { onUkCommand } = await import('../src/bot/uk-console.ts');
    await onUkCommand(off, STAFF_ID, null, { dedupeKey: 'test:off' });
    await h.drain();
    expect(lastDm(h, STAFF_ID).text).toBe('Демо-режим выключен');
  });
});
