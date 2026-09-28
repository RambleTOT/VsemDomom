/**
 * Стенд бота для интеграционных тестов: тестовая база с сидами, FakeMaxApi, очередь в памяти
 * и ручные часы. События подаются как из webhook, задачи выполняются до пустой очереди.
 */
import { encodeCallback, keywordMatcher, ManualClock, type CallbackAction, type KeyboardButton } from '@vsemdomom/core';
import { ruTranslator } from '@vsemdomom/shared';
import { pino } from 'pino';
import { botJobHandlers, botUpdateHandlers } from '../../src/bot/index.ts';
import { LOCAL_SESSION_SECRET, loadConfig } from '../../src/config/env.ts';
import { KEYWORD_PHRASES } from '../../src/config/params.ts';
import type { DbHandle } from '../../src/db/client.ts';
import { runSeeds } from '../../src/db/seed.ts';
import type { JobContext } from '../../src/jobs/context.ts';
import { processUpdate } from '../../src/jobs/process-update.ts';
import { MemoryJobQueue, QUEUES } from '../../src/jobs/queue.ts';
import { FakeMaxApi, MemoryFakeCallStore, type FakeCallStore, type FakeChat } from '../../src/max/fake.ts';
import { DbFakeCallStore } from '../../src/max/fake-store.ts';
import type { OutgoingMessage } from '../../src/max/types.ts';
import { ingestUpdate, type UpdateJob } from '../../src/webhook/ingest.ts';
import { freshDb, seedsDir } from './test-db.ts';

export const STAFF_ID = 9001;
export const BOT_USERNAME = 'vsemdomom_test_bot';

export interface Harness {
  handle: DbHandle;
  ctx: JobContext;
  queue: MemoryJobQueue;
  max: FakeMaxApi;
  calls: MemoryFakeCallStore;
  clock: ManualClock;
  /** Принять событие как webhook и выполнить задачи до пустой очереди. */
  deliver(raw: object): Promise<'accepted' | 'duplicate'>;
  /** Выполнить задачи, срок которых наступил (startAfter ≤ часов стенда). */
  drain(): Promise<number>;
  /** Сдвинуть часы и выполнить наступившие задачи. */
  advance(ms: number): Promise<number>;
  /** Задачи, отложенные на будущее. */
  delayed(): { queue: string; data: object; startAfter: Date }[];
  close(): Promise<void>;
}

export function fakeChat(chatId: number, overrides: Partial<FakeChat> = {}): FakeChat {
  return {
    chatId,
    title: `Чат ${chatId}`,
    link: `https://max.ru/join/test${Math.abs(chatId)}`,
    participantsCount: 312,
    members: null,
    botIsAdmin: true,
    botPermissions: ['read_all_messages', 'pin_message', 'write'],
    ...overrides,
  };
}

export async function createHarness(
  url: string,
  options: { env?: Record<string, string>; chats?: FakeChat[]; /** Журнал симулятора ещё и в fake_max_call (страница /dev/chat). */ dbJournal?: boolean } = {},
): Promise<Harness> {
  const handle = await freshDb(url);
  const clock = new ManualClock(new Date('2026-09-27T09:00:00Z'));
  const log = pino({ level: 'silent' });
  await runSeeds(handle.db, { seedsDir, staffMaxIds: [STAFF_ID], now: clock.now(), log });
  const config = loadConfig({
    DATABASE_URL: url,
    SESSION_SECRET: LOCAL_SESSION_SECRET,
    MAX_BOT_USERNAME: BOT_USERNAME,
    PUBLIC_BASE_URL: 'https://vsemdomom.test',
    ...options.env,
  });
  const calls = new MemoryFakeCallStore();
  const dbJournal = options.dbJournal ? new DbFakeCallStore(handle.db) : null;
  const store: FakeCallStore = dbJournal
    ? {
        async record(call) {
          await calls.record(call);
          await dbJournal.record(call);
        },
      }
    : calls;
  const max = new FakeMaxApi({ clock, store, botUsername: BOT_USERNAME, chats: options.chats ?? [fakeChat(-1001), fakeChat(-1004)] });
  const queue = new MemoryJobQueue();
  // Как в api и worker: словарь F13 — только при включённом флаге.
  const matcher = config.features.keywordReply ? keywordMatcher(KEYWORD_PHRASES) : null;
  const ctx: JobContext = { config, db: handle.db, queue, max, log, clock, i18n: ruTranslator };

  const due = (job: MemoryJobQueue['sent'][number]) => !job.options?.startAfter || job.options.startAfter.getTime() <= clock.now().getTime();
  const drain = async (): Promise<number> => {
    let done = 0;
    for (let guard = 0; ; guard += 1) {
      if (guard > 500) throw new Error('очередь не опустела: вероятен цикл задач');
      const index = queue.sent.findIndex(due);
      if (index < 0) break;
      const [job] = queue.sent.splice(index, 1);
      if (!job) break;
      if (job.queue === QUEUES.update) {
        await processUpdate(job.data as UpdateJob, botUpdateHandlers, ctx);
      } else {
        const handler = botJobHandlers[job.queue];
        if (!handler) throw new Error(`нет обработчика очереди ${job.queue}`);
        await handler(job.data as never, ctx);
      }
      done += 1;
    }
    return done;
  };

  return {
    handle,
    ctx,
    queue,
    max,
    calls,
    clock,
    drain,
    async deliver(raw) {
      const result = await ingestUpdate({ db: handle.db, queue, keywordMatcher: matcher }, raw);
      await drain();
      return result;
    },
    async advance(ms) {
      clock.advance(ms);
      return drain();
    },
    delayed: () =>
      queue.sent.filter((j) => !due(j)).map((j) => ({ queue: j.queue, data: j.data, startAfter: j.options?.startAfter ?? clock.now() })),
    close: () => handle.close(),
  };
}

// ---------- события MAX ----------

let seq = 1_790_000_000_000;
const nextTs = () => (seq += 1);

export const updates = {
  botStarted: (userId: number, payload?: string) => ({
    update_type: 'bot_started',
    timestamp: nextTs(),
    chat_id: userId + 100_000,
    user: { user_id: userId, first_name: 'Житель', is_bot: false },
    ...(payload === undefined ? {} : { payload }),
    user_locale: 'ru',
  }),
  dmText: (userId: number, text: string) => ({
    update_type: 'message_created',
    timestamp: nextTs(),
    message: {
      sender: { user_id: userId, first_name: 'Житель', is_bot: false },
      recipient: { chat_id: userId + 100_000, chat_type: 'dialog' },
      timestamp: seq,
      body: { mid: `mid.in.${seq}`, seq, text },
    },
  }),
  groupText: (chatId: number, userId: number, text: string) => ({
    update_type: 'message_created',
    timestamp: nextTs(),
    message: {
      sender: { user_id: userId, first_name: 'Сотрудник', is_bot: false },
      recipient: { chat_id: chatId, chat_type: 'chat' },
      timestamp: seq,
      body: { mid: `mid.in.${seq}`, seq, text },
    },
  }),
  callback: (userId: number, payload: string, where: { chatId: number; chatType: 'dialog' | 'chat' }, mid = 'mid.any') => ({
    update_type: 'message_callback',
    timestamp: nextTs(),
    callback: { callback_id: `cb.${seq}`, payload, user: { user_id: userId, first_name: 'Житель', is_bot: false }, timestamp: seq },
    message: { recipient: { chat_id: where.chatId, chat_type: where.chatType }, timestamp: seq, body: { mid, seq } },
  }),
  botAdded: (chatId: number, userId: number) => ({ update_type: 'bot_added', timestamp: nextTs(), chat_id: chatId, user: { user_id: userId }, is_channel: false }),
  botRemoved: (chatId: number, userId: number) => ({ update_type: 'bot_removed', timestamp: nextTs(), chat_id: chatId, user: { user_id: userId }, is_channel: false }),
  userAdded: (chatId: number, userId: number) => ({ update_type: 'user_added', timestamp: nextTs(), chat_id: chatId, user: { user_id: userId }, is_channel: false }),
  userRemoved: (chatId: number, userId: number) => ({ update_type: 'user_removed', timestamp: nextTs(), chat_id: chatId, user: { user_id: userId }, is_channel: false }),
};

/** Личка пользователя в симуляторе: chat_id диалога. */
export const dm = (userId: number) => ({ chatId: userId + 100_000, chatType: 'dialog' as const });

// ---------- чтение отправленного ----------

export function dmMessages(h: Harness, userId: number): OutgoingMessage[] {
  return h.max.messagesIn({ userId }).map((m) => m.message);
}

export function lastDm(h: Harness, userId: number): OutgoingMessage {
  const all = dmMessages(h, userId);
  const last = all.at(-1);
  if (!last) throw new Error(`в личке ${userId} нет сообщений`);
  return last;
}

/** Кнопка сообщения по тексту (подстрока). */
export function button(message: OutgoingMessage, text: string): KeyboardButton {
  const found = message.keyboard.flat().find((b) => b.text.includes(text));
  if (!found) throw new Error(`нет кнопки «${text}» в сообщении «${message.text}»`);
  return found;
}

export function callbackPayload(message: OutgoingMessage, text: string): string {
  const b = button(message, text);
  if (b.type !== 'callback') throw new Error(`кнопка «${text}» — не callback`);
  return b.payload;
}

export const cb = (action: CallbackAction, id: string | null = null, arg?: string) => encodeCallback(action, id, arg);

/** Уведомления, которыми бот ответил на нажатия. */
export function answers(h: Harness): string[] {
  return h.max.callbacks.map((c) => c.answer.notification ?? '');
}

/** Регистрация жителя в личке по QR дома: согласие → роль → квартира. */
export async function registerResident(h: Harness, userId: number, flatNo: number, options: { role?: string; house?: string } = {}): Promise<void> {
  await h.deliver(updates.botStarted(userId, `h_${options.house ?? 'dom1model1'}`));
  await h.deliver(updates.callback(userId, callbackPayload(lastDm(h, userId), 'Согласен'), dm(userId)));
  await h.deliver(updates.callback(userId, callbackPayload(lastDm(h, userId), options.role ?? 'Собственник'), dm(userId)));
  await h.deliver(updates.dmText(userId, String(flatNo)));
}
