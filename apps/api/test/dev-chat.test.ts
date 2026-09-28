import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { incident, residency } from '../src/db/schema.ts';
import { DEV_CHAT_PATH, registerDevChat, SIM_RESIDENT_IDS } from '../src/dev/sim-chat.ts';
import { buildFeed, buildNotices, parseSimCallbackId, simCallbackId, type JournalRow, type SimMessage } from '../src/dev/sim-feed.ts';
import { createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const [R1] = SIM_RESIDENT_IDS;

let rowId = 0;
const row = (method: string, path: string, query: Record<string, unknown> | null, body: unknown, response: unknown = { success: true }): JournalRow => ({
  id: (rowId += 1),
  method,
  path,
  query,
  body,
  responseStatus: 200,
  response,
  createdAt: new Date('2026-09-28T07:00:00Z'),
});
const sent = (query: Record<string, unknown>, mid: string, text: string, buttons: object[][] = []) =>
  row('POST', '/messages', query, { text, format: 'markdown', ...(buttons.length ? { attachments: [{ type: 'inline_keyboard', payload: { buttons } }] } : {}) }, { message: { body: { mid } } });

describe('лента симулятора по журналу', () => {
  it('отправка, правка, удаление, закреп и правка ответом на нажатие', () => {
    const rows = [
      sent({ chat_id: CHAT }, 'm1', '**Панель**', [[{ type: 'open_app', text: 'Мой дом', web_app: 'bot', payload: 'h_1' }]]),
      sent({ chat_id: CHAT }, 'm2', 'Карточка', [[{ type: 'callback', text: 'У меня тоже', payload: 'join:1' }]]),
      sent({ user_id: R1 }, 'm3', 'Личка'),
      row('PUT', '/chats/-1001/pin', null, { message_id: 'm1', notify: false }),
      row('PUT', '/messages', { message_id: 'm2' }, { text: 'Карточка v2', attachments: [] }),
      row('DELETE', '/messages', { message_id: 'm1' }, null),
      row('POST', '/answers', { callback_id: simCallbackId(R1, 'm2', 'abc123') }, { notification: 'Вы отмечены', message: { text: 'Карточка v3' } }),
    ];
    const chat = buildFeed(rows, { chatId: CHAT });
    expect(chat.map((m) => m.mid)).toEqual(['m1', 'm2']);
    expect(chat[0]).toMatchObject({ pinned: true, deleted: true, buttons: [[{ type: 'open_app', text: 'Мой дом', payload: 'h_1' }]] });
    expect(chat[1]).toMatchObject({ text: 'Карточка v3', edited: true, buttons: [] });
    expect(buildFeed(rows, { userId: R1 }).map((m) => m.text)).toEqual(['Личка']);
    expect(buildNotices(rows, R1, 5)).toEqual([{ at: '2026-09-28T07:00:00.000Z', text: 'Вы отмечены' }]);
    expect(buildNotices(rows, -9002, 5)).toEqual([]);
  });

  it('идентификатор нажатия: житель и сообщение', () => {
    expect(parseSimCallbackId(simCallbackId(-9002, 'mid.fake.1-2', 'a1b2c3'))).toEqual({ userId: -9002, mid: 'mid.fake.1-2' });
    expect(parseSimCallbackId('cb.123')).toBeNull();
  });
});

interface State {
  chat: { bound: boolean; house: { id: string } | null; messages: SimMessage[] };
  dm: { residency: { flatNo: number; trustLevel: number } | null; messages: SimMessage[]; notices: { text: string }[] };
  uk: { incidents: { id: string; status: string; statusText: string }[] };
  texts: Record<string, string>;
}

describe.skipIf(!url)('страница «Симулятор чата» /dev/chat (PostgreSQL + симулятор)', () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await createApiHarness(url!, { dbJournal: true, env: { DEMO_MODE: 'true' } });
  });
  afterAll(async () => {
    await api?.close();
  });

  const state = async (user: number = R1) => {
    const res = await api.app.inject({ method: 'GET', url: `${DEV_CHAT_PATH}/state?chat=${CHAT}&user=${user}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<State>();
  };
  const post = async (path: 'resident' | 'uk', body: object) => {
    const res = await api.app.inject({ method: 'POST', url: `${DEV_CHAT_PATH}/${path}`, payload: { chat: CHAT, ...body } });
    await api.drain();
    return res;
  };
  const buttonIn = (messages: SimMessage[], text: string) => {
    for (const m of [...messages].reverse()) {
      const b = m.buttons.flat().find((x) => x.text.includes(text));
      if (b) return { mid: m.mid, payload: b.payload ?? '' };
    }
    throw new Error(`нет кнопки «${text}»`);
  };
  const press = async (where: 'chat' | 'dm', text: string, user: number = R1) => {
    const s = await state(user);
    const b = buttonIn(where === 'chat' ? s.chat.messages : s.dm.messages, text);
    const res = await post('resident', { kind: 'callback', user, where, mid: b.mid, payload: b.payload });
    expect(res.statusCode, res.body).toBe(200);
  };

  it('страница и статика со строгой CSP, тексты из словаря', async () => {
    const page = await api.app.inject({ method: 'GET', url: DEV_CHAT_PATH });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['x-robots-tag']).toBe('noindex');
    for (const asset of ['app.js', 'app.css']) {
      expect((await api.app.inject({ method: 'GET', url: `${DEV_CHAT_PATH}/${asset}` })).statusCode, asset).toBe(200);
    }
    const s = await state();
    expect(s.texts['dev.chat.title']).toBe('Симулятор чата');
    expect(s.chat).toMatchObject({ bound: false, house: { id: 'dom1model1' }, messages: [] });
  });

  it('чужой чат или пользователь — 400; без режима simulator страницы нет', async () => {
    expect((await api.app.inject({ method: 'GET', url: `${DEV_CHAT_PATH}/state?chat=-5&user=${R1}` })).statusCode).toBe(400);
    expect((await api.app.inject({ method: 'GET', url: `${DEV_CHAT_PATH}/state?chat=${CHAT}&user=424242` })).statusCode).toBe(400);
    expect((await post('resident', { kind: 'dm_text', user: 424242, text: '12' })).statusCode).toBe(400);
    const other = Fastify();
    const config = { ...api.ctx.config, max: { ...api.ctx.config.max, mode: 'webhook' as const } };
    expect(registerDevChat(other, { config, ctx: api.ctx, ingest: { db: api.handle.db, queue: api.queue, keywordMatcher: null } })).toBe(false);
    await other.close();
  });

  it('привязка чата: приглашение, затем панель в закрепе', async () => {
    expect((await post('uk', { kind: 'bind' })).statusCode).toBe(200);
    const s = await state();
    expect(s.chat.bound).toBe(true);
    expect(s.chat.messages.some((m) => m.text.includes('сотрудник УК привязывает чат к дому'))).toBe(true);
    const panel = s.chat.messages.find((m) => m.pinned);
    expect(panel?.text).toContain('Дом 1');
    expect(panel?.silent).toBe(true);
    expect((await post('uk', { kind: 'bind' })).json()).toMatchObject({ ok: true, result: 'already_bound' });
  });

  it('житель: QR дома → согласие → роль → квартира → авария в личке; карточка в чате', async () => {
    expect((await post('resident', { kind: 'start', user: R1 })).statusCode).toBe(200);
    await press('dm', 'Согласен');
    await press('dm', 'Собственник');
    expect((await post('resident', { kind: 'dm_text', user: R1, text: '12' })).statusCode).toBe(200);
    expect((await state()).dm.residency).toMatchObject({ flatNo: 12, trustLevel: 1 });

    await post('resident', { kind: 'dm_text', user: R1, text: '/report' });
    await press('dm', 'Горячая вода');
    await press('dm', 'Сейчас');
    await press('dm', 'Дом');
    const [inc] = await api.handle.db.select().from(incident).where(and(eq(incident.isModel, false), eq(incident.serviceType, 'hot_water')));
    expect(inc).toMatchObject({ status: 'open', createdBy: R1 });
    const s = await state();
    expect(s.chat.messages.some((m) => !m.pinned && m.buttons.flat().some((b) => b.type === 'callback'))).toBe(true);
    expect(s.uk.incidents).toMatchObject([{ id: inc!.publicId, status: 'open' }]);
  });

  it('второй житель жмёт кнопку в карточке; УК меняет статус — карточка правится', async () => {
    const R2 = SIM_RESIDENT_IDS[1];
    const card = (s: State) => s.chat.messages.find((m) => !m.pinned && m.buttons.flat().some((b) => b.type === 'callback'))!;
    await press('chat', 'Не знаю подъезд', R2);
    const pressed = await state(R2);
    expect(pressed.dm.notices.at(-1)?.text).toContain('Вы отметились');
    expect(card(pressed).text).toContain('отметились 2 жителя');

    const [inc] = (await state()).uk.incidents;
    const res = await post('uk', { kind: 'status', incident: inc!.id, status: 'accepted' });
    expect(res.statusCode, res.body).toBe(200);
    const after = await state();
    expect(after.uk.incidents[0]).toMatchObject({ status: 'accepted', statusText: 'Принята' });
    expect(card(after).edited).toBe(true);
    const [row] = await api.handle.db.select().from(residency).where(eq(residency.userId, R2));
    expect(row).toBeUndefined();
  });

  it('действие УК не над аварией этого дома — 404; ошибка машины состояний — 409', async () => {
    expect((await post('uk', { kind: 'status', incident: 'nosuchinc1', status: 'resolved' })).statusCode).toBe(404);
    const [inc] = (await state()).uk.incidents;
    await post('uk', { kind: 'status', incident: inc!.id, status: 'resolved' });
    const again = await post('uk', { kind: 'status', incident: inc!.id, status: 'accepted' });
    expect(again.statusCode).toBe(409);
  });
});
