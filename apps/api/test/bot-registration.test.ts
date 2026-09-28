import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARAMS } from '../src/config/params.ts';
import { inboundUpdate, maxUser, outboundMessage, residency } from '../src/db/schema.ts';
import { answers, button, callbackPayload, cb, createHarness, dm, dmMessages, lastDm, updates, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();

describe.skipIf(!url)('регистрация в личке (A4, PostgreSQL + симулятор)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness(url!);
  });
  afterAll(async () => {
    await h?.close();
  });

  const user = async (id: number) => (await h.handle.db.select().from(maxUser).where(eq(maxUser.id, id)))[0];
  const flats = async (id: number) => h.handle.db.select().from(residency).where(eq(residency.userId, id));

  it('QR-код дома: согласие → роль → квартира; дом не спрашиваем', async () => {
    const U = 5001;
    await h.deliver(updates.botStarted(U, 'h_dom1model1'));
    const welcome = lastDm(h, U);
    expect(welcome.text).toContain('Для начала нужно ваше согласие');
    expect(button(welcome, 'Политика данных')).toMatchObject({ type: 'link', url: 'https://vsemdomom.test/privacy' });
    expect((await user(U))?.dialogActive).toBe(true);

    await h.deliver(updates.callback(U, callbackPayload(welcome, 'Согласен'), dm(U)));
    expect(lastDm(h, U).text).toContain('Кто вы в квартире?');
    expect((await user(U))?.consentVersion).toBe(PARAMS.consentVersion);
    expect(answers(h).at(-1)).toBe('Готово');

    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Собственник'), dm(U)));
    expect(lastDm(h, U).text).toContain('номер квартиры');
    expect(h.max.callbacks.at(-1)?.answer.message).toMatchObject({ text: 'Кто вы в квартире? — **Собственник**', keyboard: [] });

    await h.deliver(updates.dmText(U, '999'));
    expect(lastDm(h, U).text).toContain('Квартиры в этом доме: 1–144. Проверьте номер');
    expect(await flats(U)).toHaveLength(0);

    await h.deliver(updates.dmText(U, ' 57 '));
    expect(lastDm(h, U).text).toContain('Готово. Вы — житель дома 1, кв. 57');
    const [row] = await flats(U);
    expect(row).toMatchObject({ flatNo: 57, role: 'owner', trustLevel: 0, source: 'qr' });
    expect((await user(U))?.dialogState).toBeNull();
  });

  it('без QR: выбор дома из модельных, песочница скрыта', async () => {
    const U = 5002;
    await h.deliver(updates.botStarted(U));
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Согласен'), dm(U)));
    const choose = lastDm(h, U);
    expect(choose.text).toContain('В каком доме вы живёте?');
    const labels = choose.keyboard.flat().map((b) => b.text);
    expect(labels.filter((t) => t.startsWith('Дом '))).toHaveLength(4);
    expect(JSON.stringify(choose.keyboard)).not.toContain('dom5sandbx');

    await h.deliver(updates.callback(U, callbackPayload(choose, 'Модельная, 2'), dm(U)));
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Снимаю'), dm(U)));
    await h.deliver(updates.dmText(U, '12'));
    const [row] = await flats(U);
    expect(row).toMatchObject({ flatNo: 12, role: 'renter', source: 'dm' });
  });

  it('повтор события от MAX не даёт второго сообщения', async () => {
    const U = 5003;
    const started = updates.botStarted(U);
    expect(await h.deliver(started)).toBe('accepted');
    const before = dmMessages(h, U).length;
    expect(await h.deliver(started)).toBe('duplicate');
    expect(dmMessages(h, U)).toHaveLength(before);
    const [row] = await h.handle.db.select().from(inboundUpdate).where(eq(inboundUpdate.dedupeKey, `bot_started:${U + 100_000}:${U}:${started.timestamp}`));
    expect(row?.processedAt).not.toBeNull();
  });

  it('«Отмена» на шаге квартиры: меню, регистрация не меняется', async () => {
    const U = 5001;
    await h.deliver(updates.dmText(U, '/start h_dom1model1'));
    expect(lastDm(h, U).text).toContain('Вы — житель дома 1, кв. 57');
    await h.deliver(updates.callback(U, cb('house', 'dom1model1'), dm(U)));
    expect(lastDm(h, U).text).toContain('Кто вы в квартире?');
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Отмена'), dm(U)));
    expect(answers(h).at(-1)).toBe('Отменили. Данные регистрации сохранены');
    expect(lastDm(h, U).text).toContain('кв. 57');
  });

  it('смена квартиры в том же доме — одна запись, уровень доверия сбрасывается', async () => {
    const U = 5001;
    await h.handle.db.update(residency).set({ trustLevel: 1 }).where(eq(residency.userId, U));
    await h.deliver(updates.dmText(U, '/start h_dom1model1'));
    // Уже зарегистрирован в этом доме — меню; переписать квартиру можно через регистрацию заново.
    await h.deliver(updates.callback(U, cb('menu', null, 'register'), dm(U)));
    await h.deliver(updates.callback(U, cb('house', 'dom1model1'), dm(U)));
    await h.deliver(updates.callback(U, cb('role', null, 'family'), dm(U)));
    await h.deliver(updates.dmText(U, '58'));
    const rows = await flats(U);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flatNo: 58, role: 'family', trustLevel: 0 });
    expect(lastDm(h, U).text).toContain('уровень доверия сброшен');
  });

  it('команды /menu, /help и непонятный текст', async () => {
    const U = 5002;
    await h.deliver(updates.dmText(U, '/menu'));
    expect(lastDm(h, U).text).toContain('кв. 12');
    await h.deliver(updates.dmText(U, '/help'));
    expect(lastDm(h, U).text).toContain('/delete');
    const before = dmMessages(h, U).length;
    await h.deliver(updates.dmText(U, 'привет'));
    const after = dmMessages(h, U);
    expect(after).toHaveLength(before + 2);
    expect(after.at(-2)?.text).toContain('Не понял сообщение');
  });

  it('устаревшая или чужая кнопка — ответ «Кнопка устарела», без изменений', async () => {
    await h.deliver(updates.callback(5002, 'v0:unknown', dm(5002)));
    expect(answers(h).at(-1)).toBe('Кнопка устарела. Откройте бота заново');
  });

  it('/delete: подтверждение, удаление проживания, отзыв согласия; /start — заново', async () => {
    const U = 5002;
    await h.deliver(updates.dmText(U, '/delete'));
    const confirm = lastDm(h, U);
    expect(confirm.text).toContain('Удалить ваши данные?');

    await h.deliver(updates.callback(U, callbackPayload(confirm, 'Отмена'), dm(U)));
    expect(answers(h).at(-1)).toBe('Хорошо, данные остаются');
    expect(await flats(U)).toHaveLength(1);

    await h.deliver(updates.callback(U, callbackPayload(confirm, 'Удалить'), dm(U)));
    expect(await flats(U)).toHaveLength(0);
    const u = await user(U);
    expect(u).toMatchObject({ consentVersion: null, dialogState: null, dialogActive: true });
    expect(u?.deletedAt).not.toBeNull();
    expect(lastDm(h, U).text).toContain('Данные удалены');
    // Журнал личных сообщений очищен (кроме подтверждения удаления).
    const logged = await h.handle.db.select().from(outboundMessage).where(and(eq(outboundMessage.userId, U)));
    expect(logged).toHaveLength(1);

    await h.deliver(updates.dmText(U, '/start'));
    expect(lastDm(h, U).text).toContain('Для начала нужно ваше согласие');
  });

  it('пользователь, остановивший бота: сообщение не доставлено, диалог помечен закрытым', async () => {
    const U = 5004;
    h.max.setDialog(5001, true);
    h.max.setDialog(5002, true);
    h.max.setDialog(5003, true);
    await h.deliver(updates.botStarted(U));
    const [row] = await h.handle.db.select().from(outboundMessage).where(eq(outboundMessage.userId, U));
    expect(row).toMatchObject({ status: 'failed', payload: null });
    expect((await user(U))?.dialogActive).toBe(false);
    h.max.dialogUsers = null;
  });

  it('в журналах и данных задач нет текстов переписки и имён', async () => {
    const rows = await h.handle.db.select().from(outboundMessage);
    expect(rows.every((r) => r.status !== 'sent' || r.payload === null)).toBe(true);
    expect(JSON.stringify(await h.handle.db.select().from(maxUser))).not.toContain('Житель');
  });
});
