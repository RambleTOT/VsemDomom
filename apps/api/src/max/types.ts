/**
 * Интерфейс Bot API MAX, которым пользуются сервисы. Две реализации: HttpMaxApi
 * (platform-api2.max.ru) и FakeMaxApi (симулятор). Сервисы не знают про HTTP.
 */
import type { BotMessage } from '@vsemdomom/core';
import type { components } from './schema.gen.ts';

type Schemas = components['schemas'];

export type MaxBotInfo = Schemas['BotInfo'];
export type MaxBotCommand = Schemas['BotCommand'];
export type MaxChat = Schemas['Chat'];
export type MaxChatMember = Schemas['ChatMember'];
export type MaxSubscription = Schemas['Subscription'];
export type MaxNewMessageBody = Schemas['NewMessageBody'];
export type MaxMessage = Schemas['Message'];

/** Получатель: групповой чат или пользователь (личка). */
export type MaxTarget = { chatId: number } | { userId: number };

/** Сообщение к отправке: рендер ядра + параметры доставки. */
export interface OutgoingMessage extends BotMessage {
  /** false — участники чата не получат push-уведомление. */
  notify?: boolean;
  /** Ответом на сообщение (итог — ответом на карточку). */
  replyToMid?: string;
}

export interface SendOptions {
  /** Текст с ПДн (заявление): симулятор маскирует его в журнале, логгер не пишет. */
  sensitive?: boolean;
  disableLinkPreview?: boolean;
}

export interface CallbackAnswerInput {
  /** Одноразовое уведомление нажавшему. */
  notification?: string;
  /** Правка сообщения с кнопкой. */
  message?: OutgoingMessage;
}

export interface UpdatesPage {
  updates: unknown[];
  marker: number | null;
}

export interface MaxApi {
  readonly kind: 'http' | 'fake';
  getMe(): Promise<MaxBotInfo>;
  setCommands(commands: MaxBotCommand[]): Promise<void>;
  listSubscriptions(): Promise<MaxSubscription[]>;
  subscribe(input: { url: string; updateTypes: string[]; secret: string }): Promise<void>;
  unsubscribe(url: string): Promise<void>;
  sendMessage(target: MaxTarget, message: OutgoingMessage, options?: SendOptions): Promise<{ mid: string }>;
  editMessage(mid: string, message: OutgoingMessage): Promise<void>;
  deleteMessage(mid: string): Promise<void>;
  answerCallback(callbackId: string, answer: CallbackAnswerInput): Promise<void>;
  pinMessage(chatId: number, mid: string, options?: { notify?: boolean }): Promise<void>;
  getChat(chatId: number): Promise<MaxChat>;
  /** Членство пользователей в чате (нужны права администратора). */
  getChatMembers(chatId: number, userIds: number[]): Promise<MaxChatMember[]>;
  /** Права бота в чате. */
  getMyMembership(chatId: number): Promise<MaxChatMember>;
  getUpdates(options: { marker?: number | null; timeoutSec?: number; limit?: number; types?: string[] }): Promise<UpdatesPage>;
}

export type MaxErrorKind =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout';

/** Ошибка вызова MAX. retryable — стоит повторить с задержкой. */
export class MaxApiError extends Error {
  readonly kind: MaxErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    kind: MaxErrorKind,
    message: string,
    details: { status?: number | null; code?: string | null; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = 'MaxApiError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.code = details.code ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
  }

  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'server' || this.kind === 'network' || this.kind === 'timeout';
  }
}
