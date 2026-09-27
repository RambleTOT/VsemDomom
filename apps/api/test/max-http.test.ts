import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { HttpMaxApi, parseRetryAfter } from '../src/max/http.ts';
import { RateLimiter } from '../src/max/rate-limiter.ts';
import { MaxApiError } from '../src/max/types.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function setup(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const slept: number[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('нет ответа');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const api = new HttpMaxApi({
    baseUrl: 'https://platform-api2.max.ru',
    token: 'test-token-value',
    log: pino({ level: 'silent' }),
    limiter: new RateLimiter({ globalRps: 1000, sleep: async () => {} }),
    rate: { perChat: 2, answersPerChat: 2 },
    fetch: fetchMock,
    sleep: async (ms) => {
      slept.push(ms);
    },
    random: () => 0.5,
  });
  return { api, calls, slept };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('HttpMaxApi', () => {
  it('токен — в заголовке Authorization без Bearer, адрес — platform-api2.max.ru', async () => {
    const { api, calls } = setup([json(200, { user_id: 1, first_name: 'Бот', username: 'bot', is_bot: true })]);
    await api.getMe();
    expect(calls[0]?.url).toBe('https://platform-api2.max.ru/me');
    expect(calls[0]?.headers.Authorization).toBe('test-token-value');
    expect(calls[0]?.url).not.toContain('token');
  });

  it('отправка в чат: chat_id в query, клавиатура в attachments, mid из ответа', async () => {
    const { api, calls } = setup([json(200, { message: { recipient: { chat_type: 'chat' }, timestamp: 1, body: { mid: 'mid.1', seq: 1 } } })]);
    const r = await api.sendMessage(
      { chatId: -1001 },
      { text: 'Карточка', format: 'markdown', keyboard: [[{ type: 'callback', text: '1', payload: 'v1:join:x:1' }]], notify: false },
    );
    expect(r).toEqual({ mid: 'mid.1' });
    expect(calls[0]?.url).toBe('https://platform-api2.max.ru/messages?chat_id=-1001');
    expect(calls[0]?.body).toEqual({
      text: 'Карточка',
      format: 'markdown',
      attachments: [{ type: 'inline_keyboard', payload: { buttons: [[{ type: 'callback', text: '1', payload: 'v1:join:x:1' }]] } }],
      notify: false,
    });
  });

  it('429 с Retry-After → ждёт указанное время и повторяет', async () => {
    const { api, calls, slept } = setup([json(429, { code: 'too.many.requests', message: 'slow down' }, { 'retry-after': '3' }), json(200, { success: true })]);
    await api.editMessage('mid.1', { text: 't', format: 'markdown', keyboard: [] }, { chatId: -1001 });
    expect(calls).toHaveLength(2);
    expect(slept).toEqual([3000]);
    expect(calls[0]?.body).toMatchObject({ attachments: [] });
  });

  it('500 и сетевые ошибки — экспоненциальная задержка, до 5 попыток', async () => {
    const { api, calls, slept } = setup([json(500, {}), new TypeError('fetch failed'), json(503, {}), json(502, {}), json(500, {})]);
    const err = await api.getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MaxApiError);
    expect(calls).toHaveLength(5);
    expect(slept).toEqual([375, 750, 1500, 3000]);
  });

  it('400 и 404 не повторяются', async () => {
    const { api, calls } = setup([json(400, { code: 'proto.payload', message: 'bad' })]);
    await expect(api.getChat(-1)).rejects.toMatchObject({ kind: 'bad_request', status: 400, code: 'proto.payload' });
    expect(calls).toHaveLength(1);
    const nf = setup([json(404, { code: 'not.found', message: 'chat not found' })]);
    await expect(nf.api.getChat(-1)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('success=false в ответе 200 — ошибка; «not found» распознаётся', async () => {
    const { api } = setup([json(200, { success: false, message: 'Message not found' })]);
    await expect(api.editMessage('mid.x', { text: 't', format: 'markdown', keyboard: [] })).rejects.toMatchObject({ kind: 'not_found' });
    const other = setup([json(200, { success: false, message: 'something' })]);
    await expect(other.api.pinMessage(-1, 'mid')).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('ответ на нажатие и закреп без уведомления', async () => {
    const { api, calls } = setup([json(200, { success: true }), json(200, { success: true })]);
    await api.answerCallback('cb-1', { notification: 'Вы отметились' }, { chatId: -1001 });
    await api.pinMessage(-1001, 'mid.1', { notify: false });
    expect(calls[0]?.url).toBe('https://platform-api2.max.ru/answers?callback_id=cb-1');
    expect(calls[0]?.body).toEqual({ notification: 'Вы отметились' });
    expect(calls[1]?.url).toBe('https://platform-api2.max.ru/chats/-1001/pin');
    expect(calls[1]?.body).toEqual({ message_id: 'mid.1', notify: false });
  });

  it('участники чата — user_ids через запятую; подписка с секретом и типами событий', async () => {
    const { api, calls } = setup([json(200, { members: [] }), json(200, { success: true })]);
    await api.getChatMembers(-1001, [1, 2]);
    await api.subscribe({ url: 'https://app.example.ru/webhook/max', updateTypes: ['message_callback'], secret: 's3cret_value' });
    expect(decodeURIComponent(calls[0]!.url)).toBe('https://platform-api2.max.ru/chats/-1001/members?user_ids=1,2');
    expect(calls[1]?.body).toEqual({ url: 'https://app.example.ru/webhook/max', update_types: ['message_callback'], secret: 's3cret_value' });
  });

  it('Retry-After: секунды и HTTP-дата', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter('Wed, 27 Sep 2026 12:00:05 GMT', Date.parse('Wed, 27 Sep 2026 12:00:00 GMT'))).toBe(5000);
    expect(parseRetryAfter('9999', 0)).toBe(60_000);
  });
});
