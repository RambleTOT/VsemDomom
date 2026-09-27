import { ManualClock, type BotMessage } from '@vsemdomom/core';
import { describe, expect, it } from 'vitest';
import { FakeMaxApi, MemoryFakeCallStore, type FakeChat } from '../src/max/fake.ts';
import { MaxApiError } from '../src/max/types.ts';

const CHAT = -1001;
const chat = (over: Partial<FakeChat> = {}): FakeChat => ({
  chatId: CHAT,
  title: 'Дом 1 (демо)',
  link: 'https://max.ru/join/demo',
  participantsCount: 312,
  members: new Set([1001, 1002]),
  botIsAdmin: true,
  botPermissions: ['read_all_messages', 'pin_message', 'write'],
  ...over,
});

function setup(over: Partial<ConstructorParameters<typeof FakeMaxApi>[0]> = {}) {
  const clock = new ManualClock(new Date('2026-09-27T14:40:00Z'));
  const store = new MemoryFakeCallStore();
  const max = new FakeMaxApi({ clock, store, botUsername: 'vsemdomom_bot', chats: [chat()], ...over });
  return { clock, store, max };
}

const card: BotMessage = {
  text: '**🔴 Нет горячей воды · УК ещё не ответила**\nМодельные данные',
  format: 'markdown',
  keyboard: [
    [1, 2, 3, 4].map((n) => ({ type: 'callback' as const, text: String(n), payload: `v1:join:K3f9QpZ2aB:${n}` })),
    [{ type: 'open_app', text: 'Подробнее и сроки', webApp: 'vsemdomom_bot', payload: 'i_K3f9QpZ2aB' }],
  ],
};

describe('FakeMaxApi (симулятор MAX)', () => {
  it('отправка в чат выдаёт mid и пишет вызов в журнал в формате MAX', async () => {
    const { max, store } = setup();
    const { mid } = await max.sendMessage({ chatId: CHAT }, card);
    expect(mid).toMatch(/^mid\.fake\./);
    const call = store.calls.at(-1)!;
    expect(call).toMatchObject({ method: 'POST', path: '/messages', query: { chat_id: CHAT }, responseStatus: 200 });
    expect(call.body).toMatchObject({
      text: card.text,
      format: 'markdown',
      attachments: [{ type: 'inline_keyboard', payload: { buttons: [expect.any(Array), [{ type: 'open_app', web_app: 'vsemdomom_bot', payload: 'i_K3f9QpZ2aB' }]] } }],
    });
  });

  it('правка снимает клавиатуру пустым attachments', async () => {
    const { max, store } = setup();
    const { mid } = await max.sendMessage({ chatId: CHAT }, card);
    await max.editMessage(mid, { ...card, keyboard: [] });
    expect(store.calls.at(-1)).toMatchObject({ method: 'PUT', query: { message_id: mid }, body: { attachments: [] } });
    expect(max.messagesIn({ chatId: CHAT })[0]?.editedAt).not.toBeNull();
  });

  it('сообщение сверх лимитов MAX — 400, как ответил бы сервер', async () => {
    const { max, store } = setup();
    const tooWide = { ...card, keyboard: [Array.from({ length: 8 }).map((_, i) => ({ type: 'callback' as const, text: String(i), payload: 'x' }))] };
    await expect(max.sendMessage({ chatId: CHAT }, tooWide)).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
    const openAppRow = [Array.from({ length: 4 }).map(() => ({ type: 'open_app' as const, text: 'Открыть', webApp: 'bot' }))];
    await expect(max.sendMessage({ chatId: CHAT }, { ...card, keyboard: openAppRow })).rejects.toBeInstanceOf(MaxApiError);
    await expect(max.sendMessage({ chatId: CHAT }, { ...card, text: 'x'.repeat(4001) })).rejects.toMatchObject({ kind: 'bad_request' });
    expect(store.calls.at(-1)?.responseStatus).toBe(400);
  });

  it('эмулирует 429 и 500 по флагу, затем отвечает нормально', async () => {
    const { max } = setup();
    max.failNext({ operation: 'sendMessage', kind: 'rate_limited', times: 2, retryAfterMs: 1500 });
    const e = await max.sendMessage({ chatId: CHAT }, card).catch((err: unknown) => err);
    expect(e).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterMs: 1500 });
    expect((e as MaxApiError).retryable).toBe(true);
    await expect(max.sendMessage({ chatId: CHAT }, card)).rejects.toMatchObject({ kind: 'rate_limited' });
    await expect(max.sendMessage({ chatId: CHAT }, card)).resolves.toHaveProperty('mid');
    max.failNext({ kind: 'server', times: 1 });
    await expect(max.getMe()).rejects.toMatchObject({ kind: 'server', status: 500 });
  });

  it('личка: пользователю без начатого диалога бот написать не может', async () => {
    const { max } = setup({ dialogUsers: new Set([1001]) });
    await expect(max.sendMessage({ userId: 1001 }, { ...card, keyboard: [] })).resolves.toHaveProperty('mid');
    await expect(max.sendMessage({ userId: 1002 }, { ...card, keyboard: [] })).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('текст заявления маскируется в журнале симулятора — и в кнопке «Скопировать»', async () => {
    const { max, store } = setup();
    const text = 'Заявление. Иванов Иван, +7 900 000-00-00';
    await max.sendMessage({ userId: 1001 }, { text, format: 'markdown', keyboard: [[{ type: 'clipboard', text: 'Скопировать', payload: text }]] }, { sensitive: true });
    expect(JSON.stringify(store.calls)).not.toMatch(/Иванов|900/);
    expect(JSON.stringify([...max.messages.values()])).not.toMatch(/Иванов/);
  });

  it('закреп и участники требуют прав администратора', async () => {
    const { max } = setup({ chats: [chat({ botIsAdmin: false })] });
    const { mid } = await max.sendMessage({ chatId: CHAT }, card);
    await expect(max.pinMessage(CHAT, mid, { notify: false })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(max.getChatMembers(CHAT, [1001])).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await max.getMyMembership(CHAT)).is_admin).toBe(false);
  });

  it('участники чата и сведения о чате', async () => {
    const { max } = setup();
    expect((await max.getChatMembers(CHAT, [1001, 1003])).map((m) => m.user_id)).toEqual([1001]);
    expect(await max.getChat(CHAT)).toMatchObject({ title: 'Дом 1 (демо)', link: 'https://max.ru/join/demo', participants_count: 312 });
    const { mid } = await max.sendMessage({ chatId: CHAT }, card);
    await max.pinMessage(CHAT, mid, { notify: false });
    expect(max.pins.get(CHAT)).toBe(mid);
  });

  it('подписки webhook: секрет в журнал не попадает', async () => {
    const { max, store } = setup();
    await max.subscribe({ url: 'https://app.example.ru/webhook/max', updateTypes: ['message_callback'], secret: 'super_secret_value' });
    expect(await max.listSubscriptions()).toHaveLength(1);
    expect(JSON.stringify(store.calls)).not.toMatch(/super_secret_value/);
    await max.unsubscribe('https://app.example.ru/webhook/max');
    expect(await max.listSubscriptions()).toEqual([]);
  });

  it('по желанию эмулирует лимит частоты по чату', async () => {
    const { max, clock } = setup({ perChatRateLimits: { sendMessage: 2 } });
    await max.sendMessage({ chatId: CHAT }, card);
    await max.sendMessage({ chatId: CHAT }, card);
    await expect(max.sendMessage({ chatId: CHAT }, card)).rejects.toMatchObject({ kind: 'rate_limited' });
    clock.advance(1000);
    await expect(max.sendMessage({ chatId: CHAT }, card)).resolves.toHaveProperty('mid');
  });
});
