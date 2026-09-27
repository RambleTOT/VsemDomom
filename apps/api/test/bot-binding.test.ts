import { decodeStartApp } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bindChatWithToken, bindingInfo } from '../src/bot/binding.ts';
import { buildPanel, panelJob } from '../src/chat/panel.ts';
import { houseByPublicId } from '../src/bot/queries.ts';
import { PARAMS } from '../src/config/params.ts';
import { chatBindToken, houseChat, outboundMessage, residency } from '../src/db/schema.ts';
import { QUEUES } from '../src/jobs/queue.ts';
import { button, callbackPayload, createHarness, dm, fakeChat, lastDm, STAFF_ID, updates, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const OTHER_CHAT = -1004;
const NO_ADMIN_CHAT = -1007;

describe.skipIf(!url)('привязка чата, панель и уровень доверия 1 (A4, PostgreSQL + симулятор)', () => {
  let h: Harness;
  let token = '';

  beforeAll(async () => {
    h = await createHarness(url!, {
      chats: [
        fakeChat(CHAT, { members: new Set([6001]) }),
        fakeChat(OTHER_CHAT),
        fakeChat(NO_ADMIN_CHAT, { botIsAdmin: false, botPermissions: [] }),
      ],
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const chatRow = async (chatId: number) => (await h.handle.db.select().from(houseChat).where(eq(houseChat.chatId, chatId)))[0];
  const chatMessages = (chatId: number) => h.max.messagesIn({ chatId });
  const dom1 = async () => (await houseByPublicId(h.handle.db, 'dom1model1'))!;

  it('бот добавлен в чат: приглашение с кнопкой open_app c_<токен>, токен хранится хешем', async () => {
    await h.deliver(updates.botAdded(CHAT, STAFF_ID));
    const [invite] = chatMessages(CHAT);
    expect(invite?.message.text).toContain('сотрудник УК привязывает чат к дому');
    const b = button(invite!.message, 'Привязать к дому');
    expect(b.type).toBe('open_app');
    const start = decodeStartApp(b.type === 'open_app' ? b.payload : undefined);
    expect(start?.kind).toBe('chat_binding');
    token = start!.value;
    const [row] = await h.handle.db.select().from(chatBindToken);
    expect(row?.chatId).toBe(CHAT);
    expect(row?.tokenHash).not.toBe(token);
    expect(await bindingInfo(h.ctx, token)).toMatchObject({ chatId: CHAT, status: 'active' });
  });

  it('привязка по токену: только сотрудник УК дома', async () => {
    expect(await bindChatWithToken(h.ctx, { token, housePublicId: 'dom1model1', staffUserId: 6001 })).toBe('forbidden');
    expect(await bindChatWithToken(h.ctx, { token, housePublicId: 'dom5sandbx', staffUserId: STAFF_ID })).toBe('house_not_found');
    expect(await bindChatWithToken(h.ctx, { token: 'x'.repeat(24), housePublicId: 'dom1model1', staffUserId: STAFF_ID })).toBe('token_not_found');
  });

  it('привязка: панель опубликована без уведомления и закреплена; токен погашен', async () => {
    const result = await bindChatWithToken(h.ctx, { token, housePublicId: 'dom1model1', staffUserId: STAFF_ID });
    expect(result).toMatchObject({ botIsAdmin: true });
    await h.drain();
    const row = await chatRow(CHAT);
    expect(row).toMatchObject({ participantsCount: 312, botIsAdmin: true, panelPinned: true, boundBy: STAFF_ID });
    expect(row?.panelMid).toBeTruthy();
    expect(h.max.pins.get(CHAT)).toBe(row?.panelMid);
    const panel = h.max.messages.get(row!.panelMid!);
    expect(panel?.message.notify).toBe(false);
    // Последний итог — авария из истории модельного дома 1 (2-е число месяца).
    expect(panel?.message.text).toMatch(
      /^\*\*🏠 Дом 1 · ул\. Модельная, 1\*\*\nАктивных аварий нет\nПоследний итог: 02\.09 горячая вода, (устранено в норматив|сверх нормы)\nВ чате 312 участников\nМодельные данные$/,
    );
    expect(await bindChatWithToken(h.ctx, { token, housePublicId: 'dom1model1', staffUserId: STAFF_ID })).toBe('token_used');
  });

  it('панель правится только при изменении, не чаще окна (debounce)', async () => {
    const { id } = await dom1();
    expect(await panelJob(h.ctx, { houseId: id })).toBe('unchanged');
    const edits = () => h.calls.calls.filter((c) => c.method === 'PUT' && c.path === '/messages').length;
    const before = edits();
    const debounce = vi.spyOn(h.queue, 'sendDebounced');
    await h.deliver(updates.userAdded(CHAT, 6002));
    expect((await chatRow(CHAT))?.participantsCount).toBe(313);
    expect(debounce).toHaveBeenCalledWith(QUEUES.panelRender, { houseId: id }, PARAMS.panelEditWindowSec, `panel:${id}`);
    debounce.mockRestore();
    expect(edits()).toBe(before + 1);
    const row = await chatRow(CHAT);
    expect(h.max.messages.get(row!.panelMid!)?.message.text).toContain('В чате 313 участников');
  });

  it('житель в чате дома получает уровень 1 при регистрации; вышел — уровень 0, вернулся — 1', async () => {
    const U = 6001;
    await h.deliver(updates.botStarted(U, 'h_dom1model1'));
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Согласен'), dm(U)));
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Собственник'), dm(U)));
    await h.deliver(updates.dmText(U, '7'));
    const level = async () => (await h.handle.db.select().from(residency).where(eq(residency.userId, U)))[0]?.trustLevel;
    expect(await level()).toBe(1);
    expect(lastDm(h, U).text).not.toContain('Вступите в чат дома');

    await h.deliver(updates.userRemoved(CHAT, U));
    expect(await level()).toBe(0);
    await h.deliver(updates.userAdded(CHAT, U));
    expect(await level()).toBe(1);
  });

  it('житель не в чате: уровень 0 и ссылка «Вступить в чат дома» (F12)', async () => {
    const U = 6003;
    await h.deliver(updates.botStarted(U, 'h_dom1model1'));
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Согласен'), dm(U)));
    await h.deliver(updates.callback(U, callbackPayload(lastDm(h, U), 'Снимаю'), dm(U)));
    await h.deliver(updates.dmText(U, '8'));
    const [row] = await h.handle.db.select().from(residency).where(eq(residency.userId, U));
    expect(row?.trustLevel).toBe(0);
    const menu = lastDm(h, U);
    expect(menu.text).toContain('Вступите в чат дома');
    expect(button(menu, 'Вступить в чат дома')).toMatchObject({ type: 'link', url: 'https://max.ru/join/test1001' });
  });

  it('панель удалили в чате — публикуется новая', async () => {
    const { id } = await dom1();
    const old = (await chatRow(CHAT))!.panelMid!;
    h.max.messages.get(old)!.deleted = true;
    await h.handle.db.update(houseChat).set({ panelRenderHash: 'stale' }).where(eq(houseChat.chatId, CHAT));
    expect(await panelJob(h.ctx, { houseId: id })).toBe('created');
    await h.drain();
    const row = await chatRow(CHAT);
    expect(row?.panelMid).not.toBe(old);
    expect(h.max.pins.get(CHAT)).toBe(row?.panelMid);
  });

  it('/connect <код дома> в группе: сотрудник привязывает, остальных бот игнорирует', async () => {
    await h.deliver(updates.groupText(OTHER_CHAT, 6001, '/connect dom4model4'));
    expect(await chatRow(OTHER_CHAT)).toBeUndefined();
    await h.deliver(updates.groupText(OTHER_CHAT, STAFF_ID, '/connect dom4model4'));
    const row = await chatRow(OTHER_CHAT);
    expect(row?.houseId).toBe((await houseByPublicId(h.handle.db, 'dom4model4'))?.id);
    expect(row?.panelPinned).toBe(true);
  });

  it('бот не администратор: панель без закрепа, сотруднику — подсказка в личку', async () => {
    await h.deliver(updates.botStarted(STAFF_ID));
    await h.deliver(updates.groupText(NO_ADMIN_CHAT, STAFF_ID, '/connect dom2model2'));
    const row = await chatRow(NO_ADMIN_CHAT);
    expect(row).toMatchObject({ botIsAdmin: false, panelPinned: false });
    expect(row?.panelMid).toBeTruthy();
    expect(h.max.pins.has(NO_ADMIN_CHAT)).toBe(false);
    expect(lastDm(h, STAFF_ID).text).toContain('Сделайте бота администратором');
  });

  it('повторная привязка того же дома к другому чату заменяет прежнюю', async () => {
    await h.deliver(updates.groupText(NO_ADMIN_CHAT, STAFF_ID, '/connect dom4model4'));
    expect(await chatRow(OTHER_CHAT)).toBeUndefined();
    expect((await chatRow(NO_ADMIN_CHAT))?.houseId).toBe((await houseByPublicId(h.handle.db, 'dom4model4'))?.id);
  });

  it('бота удалили из чата — привязка снимается', async () => {
    await h.deliver(updates.botRemoved(CHAT, STAFF_ID));
    expect(await chatRow(CHAT)).toBeUndefined();
    expect(await buildPanel(h.ctx, (await dom1()).id)).toBeNull();
  });

  it('в сообщениях чата нет имён и номеров квартир', async () => {
    const texts = [CHAT, OTHER_CHAT, NO_ADMIN_CHAT].flatMap((c) => chatMessages(c).map((m) => m.message.text));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toMatch(/кв\.\s*\d/);
    const rows = await h.handle.db.select().from(outboundMessage);
    expect(rows.filter((r) => r.status === 'sent').every((r) => r.payload === null)).toBe(true);
  });
});
