/**
 * Разбор объекта Update MAX (терпимый: неизвестные поля и типы не ломают приём),
 * ключ дедупликации и нормализация для очереди. В данные задачи попадают только
 * идентификаторы и то, что нужно логике: без имён, контактов и текстов группы.
 */
import { z } from 'zod';

const userSchema = z.object({ user_id: z.number(), is_bot: z.boolean().nullish() }).passthrough();
const recipientSchema = z
  .object({ chat_id: z.number().nullish(), user_id: z.number().nullish(), chat_type: z.string().nullish() })
  .passthrough();
const messageSchema = z
  .object({
    sender: userSchema.nullish(),
    recipient: recipientSchema.nullish(),
    body: z.object({ mid: z.string(), text: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export const updateSchema = z
  .object({
    update_type: z.string().min(1),
    timestamp: z.number(),
    chat_id: z.number().nullish(),
    user: userSchema.nullish(),
    user_id: z.number().nullish(),
    payload: z.string().nullish(),
    user_locale: z.string().nullish(),
    is_channel: z.boolean().nullish(),
    inviter_id: z.number().nullish(),
    admin_id: z.number().nullish(),
    title: z.string().nullish(),
    is_admin: z.boolean().nullish(),
    bot_id: z.number().nullish(),
    permissions: z.array(z.string()).nullish(),
    callback: z
      .object({ callback_id: z.string().min(1), payload: z.string().nullish(), user: userSchema, timestamp: z.number().optional() })
      .passthrough()
      .nullish(),
    message: messageSchema.nullish(),
  })
  .passthrough();

export type RawUpdate = z.infer<typeof updateSchema>;

/** Типы событий, на которые подписывается бот. */
export const SUBSCRIBED_UPDATE_TYPES = [
  'bot_started',
  'bot_stopped',
  'dialog_removed',
  'bot_added',
  'bot_removed',
  'message_callback',
  'message_created',
  'user_added',
  'user_removed',
  'chat_title_changed',
  'bot_admin_permissions_changed',
] as const;

/**
 * Текст из лички попадает в задачу, только если это команда или короткий ввод шага диалога
 * (квартира, время, номер заявки — в них всегда есть цифра). Свободный текст, где могут быть
 * имя или телефон, не хранится: бот всё равно ответит подсказкой и меню.
 */
const DM_COMMAND = /^\/[A-Za-z_]{1,32}(?:\s+\S{1,64})?$/;
const DM_INPUT = /^(?=.*\d)[0-9A-Za-zА-Яа-яЁё\s:.,/+-]{1,32}$/;
const PHONE_LIKE = /\d{10,}/;

function dmText(text: string): string {
  const t = text.trim();
  if (DM_COMMAND.test(t)) return t;
  return DM_INPUT.test(t) && !PHONE_LIKE.test(t.replace(/[\s()+-]/g, '')) ? t : '';
}

/** Из группы в задачу попадает только команда привязки /connect <код дома>. */
const GROUP_COMMAND = /^\/connect(@\S+)?(\s|$)/i;
const MAX_GROUP_COMMAND_TEXT = 64;

export interface NormalizedUpdate {
  type: string;
  timestamp: number;
  chatId: number | null;
  userId: number | null;
  chatType: string | null;
  callbackId?: string;
  /** Payload кнопки или диплинка bot_started. */
  payload?: string | null;
  mid?: string;
  /** Текст сообщения — только из лички (команды и шаги диалога) и команда /connect в группе. */
  text?: string;
  /** Сообщение группы содержит ключевые слова F13; сам текст не хранится. */
  keywordHit?: boolean;
  locale?: string | null;
  isChannel?: boolean;
  inviterId?: number | null;
  adminId?: number | null;
  title?: string | null;
  isAdmin?: boolean;
  permissions?: string[];
}

/** Ключ дедупликации: повтор события от MAX не должен менять состояние. */
export function dedupeKey(u: RawUpdate): string {
  if (u.update_type === 'message_callback' && u.callback) return `cb:${u.callback.callback_id}`;
  if (u.update_type === 'message_created' && u.message?.body?.mid) return `msg:${u.message.body.mid}`;
  const chatId = u.chat_id ?? u.message?.recipient?.chat_id ?? '';
  const userId = u.user?.user_id ?? u.user_id ?? u.message?.sender?.user_id ?? '';
  return `${u.update_type}:${chatId}:${userId}:${u.timestamp}`;
}

export interface NormalizeOptions {
  /** Проверка ключевых слов F13 для сообщений группы; null — функция выключена. */
  keywordMatcher: ((text: string) => boolean) | null;
}

export function normalizeUpdate(u: RawUpdate, options: NormalizeOptions): NormalizedUpdate {
  const base: NormalizedUpdate = {
    type: u.update_type,
    timestamp: u.timestamp,
    chatId: u.chat_id ?? null,
    userId: u.user?.user_id ?? u.user_id ?? null,
    chatType: null,
    locale: u.user_locale ?? null,
  };
  switch (u.update_type) {
    case 'message_callback':
      return {
        ...base,
        chatId: u.message?.recipient?.chat_id ?? base.chatId,
        chatType: u.message?.recipient?.chat_type ?? null,
        userId: u.callback?.user.user_id ?? base.userId,
        callbackId: u.callback?.callback_id,
        payload: u.callback?.payload ?? null,
        ...(u.message?.body?.mid ? { mid: u.message.body.mid } : {}),
      };
    case 'message_created': {
      const recipient = u.message?.recipient;
      const chatType = recipient?.chat_type ?? null;
      // Сообщения ботов (в том числе нашего — карточка «Нет горячей воды») не команды и не ключевые слова.
      const text = u.message?.sender?.is_bot === true ? '' : (u.message?.body?.text ?? '');
      const isDialog = chatType === 'dialog';
      return {
        ...base,
        chatId: recipient?.chat_id ?? null,
        chatType,
        userId: u.message?.sender?.user_id ?? null,
        ...(u.message?.body?.mid ? { mid: u.message.body.mid } : {}),
        ...(isDialog ? { text: dmText(text) } : {}),
        ...(!isDialog && GROUP_COMMAND.test(text) ? { text: text.slice(0, MAX_GROUP_COMMAND_TEXT) } : {}),
        ...(!isDialog && options.keywordMatcher ? { keywordHit: options.keywordMatcher(text) } : {}),
      };
    }
    case 'bot_started':
      return { ...base, chatType: 'dialog', payload: u.payload ?? null };
    case 'bot_added':
    case 'bot_removed':
      return { ...base, isChannel: u.is_channel ?? false };
    case 'user_added':
      return { ...base, isChannel: u.is_channel ?? false, inviterId: u.inviter_id ?? null };
    case 'user_removed':
      return { ...base, isChannel: u.is_channel ?? false, adminId: u.admin_id ?? null };
    case 'chat_title_changed':
      return { ...base, title: u.title ?? null };
    case 'bot_admin_permissions_changed':
      return {
        ...base,
        userId: u.user_id ?? null,
        isChannel: u.is_channel ?? false,
        isAdmin: u.is_admin ?? false,
        permissions: u.permissions ?? [],
      };
    default:
      return base;
  }
}

/** Нажатия кнопок обрабатываются раньше остального: человек ждёт ответа. */
export function updatePriority(type: string): number {
  return type === 'message_callback' ? 10 : 0;
}
