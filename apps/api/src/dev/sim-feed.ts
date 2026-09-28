/**
 * Лента страницы «Симулятор чата»: сообщения, которые бот отправил бы в MAX, восстановленные
 * из журнала FakeMaxApi (fake_max_call) — отправка, правки, удаления, ответы на нажатия и закреп.
 * Чистые функции: журнал читает маршрут, здесь только сборка.
 */
import { z } from 'zod';

/** Запись журнала — как строка таблицы fake_max_call. */
export interface JournalRow {
  id: number;
  method: string;
  path: string;
  query: Record<string, unknown> | null;
  body: unknown;
  responseStatus: number;
  response: unknown;
  createdAt: Date;
}

export type SimTarget = { chatId: number } | { userId: number };

export interface SimButton {
  type: string;
  text: string;
  payload?: string;
  url?: string;
}

export interface SimMessage {
  mid: string;
  at: string;
  text: string;
  buttons: SimButton[][];
  edited: boolean;
  deleted: boolean;
  pinned: boolean;
  /** notify: false — сообщение без звука (панель, правки). */
  silent: boolean;
  /** Ответ на сообщение (итог — ответом на карточку). */
  replyTo: string | null;
}

export interface SimNotice {
  at: string;
  text: string;
}

const buttonSchema = z
  .object({ type: z.string(), text: z.string(), payload: z.string().nullish(), url: z.string().nullish() })
  .passthrough();

const bodySchema = z
  .object({
    text: z.string().nullish(),
    attachments: z
      .array(z.object({ type: z.string(), payload: z.object({ buttons: z.array(z.array(buttonSchema)).nullish() }).passthrough().nullish() }).passthrough())
      .nullish(),
    notify: z.boolean().nullish(),
    link: z.object({ type: z.string(), mid: z.string() }).passthrough().nullish(),
  })
  .passthrough();

const sentSchema = z.object({ message: z.object({ body: z.object({ mid: z.string() }).passthrough() }).passthrough() }).passthrough();
const answerSchema = z.object({ notification: z.string().nullish(), message: bodySchema.nullish() }).passthrough();
const pinSchema = z.object({ message_id: z.string() }).passthrough();

type Body = z.infer<typeof bodySchema>;

// ---------- идентификатор нажатия ----------

const CALLBACK_ID = /^sim\.(-?\d{1,15})\.([A-Za-z0-9]{6,32})\.(\S{1,200})$/;

/**
 * callback_id нажатия со страницы: кто нажал и на каком сообщении. MAX присылает свой непрозрачный
 * идентификатор; симулятору так проще сопоставить ответ бота (POST /answers) с сообщением и жителем.
 */
export function simCallbackId(userId: number, mid: string, nonce: string): string {
  return `sim.${userId}.${nonce}.${mid}`;
}

export function parseSimCallbackId(id: string): { userId: number; mid: string } | null {
  const m = CALLBACK_ID.exec(id);
  if (!m) return null;
  return { userId: Number(m[1]), mid: m[3]! };
}

// ---------- сборка ленты ----------

function buttonsOf(body: Body): SimButton[][] {
  const keyboard = body.attachments?.find((a) => a.type === 'inline_keyboard');
  return (keyboard?.payload?.buttons ?? []).map((row) =>
    row.map((b) => ({
      type: b.type,
      text: b.text,
      ...(b.payload ? { payload: b.payload } : {}),
      ...(b.url ? { url: b.url } : {}),
    })),
  );
}

/** Строковый параметр запроса из журнала (message_id, callback_id). */
function queryText(query: Record<string, unknown> | null, key: string): string {
  const value = query?.[key];
  return typeof value === 'string' ? value : '';
}

function matchesTarget(query: Record<string, unknown> | null, target: SimTarget): boolean {
  if (!query) return false;
  return 'chatId' in target ? Number(query.chat_id) === target.chatId : Number(query.user_id) === target.userId;
}

function apply(message: SimMessage, raw: unknown): void {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return;
  if (typeof parsed.data.text === 'string') message.text = parsed.data.text;
  // При правке attachments передаётся всегда: пустой массив снимает клавиатуру.
  if (parsed.data.attachments) message.buttons = buttonsOf(parsed.data);
  message.edited = true;
}

/** Сообщения бота в чат или личку по журналу; строки — в порядке id. */
export function buildFeed(rows: readonly JournalRow[], target: SimTarget): SimMessage[] {
  const messages = new Map<string, SimMessage>();
  let pinned: string | null = null;
  const pinPath = 'chatId' in target ? `/chats/${target.chatId}/pin` : null;

  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (row.responseStatus !== 200) continue;
    if (row.path === '/messages' && row.method === 'POST') {
      if (!matchesTarget(row.query, target)) continue;
      const sent = sentSchema.safeParse(row.response);
      const body = bodySchema.safeParse(row.body);
      if (!sent.success || !body.success) continue;
      messages.set(sent.data.message.body.mid, {
        mid: sent.data.message.body.mid,
        at: row.createdAt.toISOString(),
        text: body.data.text ?? '',
        buttons: buttonsOf(body.data),
        edited: false,
        deleted: false,
        pinned: false,
        silent: body.data.notify === false,
        replyTo: body.data.link?.type === 'reply' ? body.data.link.mid : null,
      });
    } else if (row.path === '/messages' && row.method === 'PUT') {
      const message = messages.get(queryText(row.query, 'message_id'));
      if (message) apply(message, row.body);
    } else if (row.path === '/messages' && row.method === 'DELETE') {
      const message = messages.get(queryText(row.query, 'message_id'));
      if (message) message.deleted = true;
    } else if (row.path === '/answers' && row.method === 'POST') {
      const ref = parseSimCallbackId(queryText(row.query, 'callback_id'));
      const answer = answerSchema.safeParse(row.body);
      const message = ref ? messages.get(ref.mid) : undefined;
      if (message && answer.success && answer.data.message) apply(message, answer.data.message);
    } else if (pinPath !== null && row.path === pinPath && row.method === 'PUT') {
      const pin = pinSchema.safeParse(row.body);
      if (pin.success) pinned = pin.data.message_id;
    }
  }

  const list = [...messages.values()];
  for (const m of list) m.pinned = m.mid === pinned;
  return list;
}

/** Всплывающие уведомления бота на нажатия жителя (POST /answers с notification). */
export function buildNotices(rows: readonly JournalRow[], userId: number, limit: number): SimNotice[] {
  const notices: SimNotice[] = [];
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (row.responseStatus !== 200 || row.path !== '/answers' || row.method !== 'POST') continue;
    const ref = parseSimCallbackId(queryText(row.query, 'callback_id'));
    const answer = answerSchema.safeParse(row.body);
    if (ref?.userId === userId && answer.success && answer.data.notification) {
      notices.push({ at: row.createdAt.toISOString(), text: answer.data.notification });
    }
  }
  return notices.slice(-limit);
}

/** mid отправленного сообщения из ответа MAX. */
export function sentMid(row: Pick<JournalRow, 'response'>): string | null {
  const sent = sentSchema.safeParse(row.response);
  return sent.success ? sent.data.message.body.mid : null;
}
