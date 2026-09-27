/**
 * FakeMaxApi — симулятор Bot API MAX для режима simulator, тестов и сценария без токена.
 * Пишет каждый вызов в журнал (fake_max_call), выдаёт mid, проверяет сообщения по лимитам
 * платформы (как сервер MAX ответил бы 400), эмулирует сбои (429, 500, «не найдено»)
 * и, по желанию, лимиты частоты по чату.
 */
import { randomUUID } from 'node:crypto';
import { validateBotMessage, type Clock } from '@vsemdomom/core';
import { toNewMessageBody } from './body.ts';
import {
  MaxApiError,
  type CallbackAnswerInput,
  type MaxApi,
  type MaxBotCommand,
  type MaxBotInfo,
  type MaxChat,
  type MaxChatMember,
  type MaxErrorKind,
  type MaxSubscription,
  type MaxTarget,
  type OutgoingMessage,
  type SendOptions,
  type UpdatesPage,
} from './types.ts';

/** Запись журнала вызовов — в формате, близком к HTTP-запросу к MAX. */
export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, unknown> | null;
  body: unknown;
  responseStatus: number;
  response: unknown;
  at: Date;
}

export interface FakeCallStore {
  record(call: FakeCall): Promise<void>;
}

export class MemoryFakeCallStore implements FakeCallStore {
  readonly calls: FakeCall[] = [];

  async record(call: FakeCall): Promise<void> {
    this.calls.push(call);
  }
}

/** Операции MAX, к которым можно подмешать сбой или лимит частоты. */
export type FakeOperation =
  | 'getMe'
  | 'setCommands'
  | 'listSubscriptions'
  | 'subscribe'
  | 'unsubscribe'
  | 'sendMessage'
  | 'editMessage'
  | 'deleteMessage'
  | 'answerCallback'
  | 'pinMessage'
  | 'getChat'
  | 'getChatMembers'
  | 'getMyMembership'
  | 'getUpdates';

export interface FakeFailure {
  operation?: FakeOperation;
  kind: MaxErrorKind;
  /** Сколько вызовов подряд завершатся ошибкой. */
  times: number;
  retryAfterMs?: number;
}

export interface FakeChat {
  chatId: number;
  title: string;
  link: string | null;
  participantsCount: number;
  /** Участники чата; null — участником считается любой пользователь. */
  members: Set<number> | null;
  botIsAdmin: boolean;
  botPermissions: string[];
}

export interface FakeMaxOptions {
  clock: Clock;
  store?: FakeCallStore;
  botUsername: string;
  botUserId?: number;
  chats?: FakeChat[];
  /** Пользователи, начавшие диалог с ботом; null — писать можно любому. */
  dialogUsers?: Set<number> | null;
  /**
   * Эмуляция лимитов частоты: не больше N вызовов операции в секунду в один чат.
   * Превышение → 429, как у MAX. Пусто — без лимитов.
   */
  perChatRateLimits?: Partial<Record<'sendMessage' | 'editMessage' | 'answerCallback', number>>;
}

interface StoredMessage {
  target: MaxTarget;
  chatId: number | null;
  message: OutgoingMessage;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
}

const RATE_WINDOW_MS = 1000;
const SENSITIVE_MASK = '[текст скрыт симулятором: ПДн]';

export class FakeMaxApi implements MaxApi {
  readonly kind = 'fake' as const;
  readonly messages = new Map<string, StoredMessage>();
  readonly callbacks: { callbackId: string; answer: CallbackAnswerInput }[] = [];
  readonly pins = new Map<number, string>();
  /** Связь callback_id → чат: нужна для эмуляции лимита ответов по чату. */
  readonly callbackChats = new Map<string, number>();
  readonly chats = new Map<number, FakeChat>();
  subscriptions: MaxSubscription[] = [];
  commands: MaxBotCommand[] = [];
  dialogUsers: Set<number> | null;

  private readonly failures: FakeFailure[] = [];
  private readonly rateHits = new Map<string, number[]>();
  private readonly clock: Clock;
  private readonly store: FakeCallStore;
  private readonly bot: MaxBotInfo;
  private readonly rateLimits: FakeMaxOptions['perChatRateLimits'];

  constructor(options: FakeMaxOptions) {
    this.clock = options.clock;
    this.store = options.store ?? new MemoryFakeCallStore();
    this.dialogUsers = options.dialogUsers ?? null;
    this.rateLimits = options.perChatRateLimits ?? {};
    this.bot = {
      user_id: options.botUserId ?? 1,
      first_name: 'Всем домом (симулятор)',
      username: options.botUsername,
      is_bot: true,
      last_activity_time: options.clock.now().getTime(),
    };
    for (const chat of options.chats ?? []) this.chats.set(chat.chatId, chat);
  }

  /** Следующие `times` вызовов операции (или любых) завершатся ошибкой. */
  failNext(failure: FakeFailure): void {
    this.failures.push({ ...failure });
  }

  setDialog(userId: number, active: boolean): void {
    if (this.dialogUsers === null) this.dialogUsers = new Set();
    if (active) this.dialogUsers.add(userId);
    else this.dialogUsers.delete(userId);
  }

  // ---------- Bot API ----------

  async getMe(): Promise<MaxBotInfo> {
    return this.call('getMe', 'GET', '/me', null, null, () => this.bot);
  }

  async setCommands(commands: MaxBotCommand[]): Promise<void> {
    await this.call('setCommands', 'PATCH', '/me/commands', null, { commands }, () => {
      this.commands = commands;
      return { commands };
    });
  }

  async listSubscriptions(): Promise<MaxSubscription[]> {
    return this.call('listSubscriptions', 'GET', '/subscriptions', null, null, () => ({ subscriptions: this.subscriptions })).then(
      (r) => r.subscriptions,
    );
  }

  async subscribe(input: { url: string; updateTypes: string[]; secret: string }): Promise<void> {
    await this.call('subscribe', 'POST', '/subscriptions', null, { url: input.url, update_types: input.updateTypes, secret: '[secret]' }, () => {
      this.subscriptions = [
        ...this.subscriptions.filter((s) => s.url !== input.url),
        { url: input.url, time: this.clock.now().getTime(), update_types: input.updateTypes },
      ];
      return { success: true };
    });
  }

  async unsubscribe(url: string): Promise<void> {
    await this.call('unsubscribe', 'DELETE', '/subscriptions', { url }, null, () => {
      this.subscriptions = this.subscriptions.filter((s) => s.url !== url);
      return { success: true };
    });
  }

  async sendMessage(target: MaxTarget, message: OutgoingMessage, options: SendOptions = {}): Promise<{ mid: string }> {
    const query = 'chatId' in target ? { chat_id: target.chatId } : { user_id: target.userId };
    const body = this.recordedBody(toNewMessageBody(message, 'send'), options.sensitive === true);
    const chatId = 'chatId' in target ? target.chatId : null;
    return this.call('sendMessage', 'POST', '/messages', query, body, () => {
      this.assertValid(message);
      if ('userId' in target && this.dialogUsers !== null && !this.dialogUsers.has(target.userId)) {
        throw new MaxApiError('forbidden', 'dialog.not.started', { status: 403, code: 'chat.denied' });
      }
      if (chatId !== null && !this.chats.has(chatId)) {
        throw new MaxApiError('not_found', 'chat.not.found', { status: 404, code: 'not.found' });
      }
      const mid = `mid.fake.${randomUUID()}`;
      this.messages.set(mid, {
        target,
        chatId,
        message: options.sensitive ? { ...message, text: SENSITIVE_MASK } : message,
        createdAt: this.clock.now(),
        editedAt: null,
        deleted: false,
      });
      return {
        message: {
          recipient: chatId !== null ? { chat_id: chatId, chat_type: 'chat' } : { user_id: (target as { userId: number }).userId, chat_type: 'dialog' },
          timestamp: this.clock.now().getTime(),
          body: { mid, seq: this.messages.size, text: body.text ?? null },
        },
      };
    }, chatId).then((r) => ({ mid: r.message.body.mid }));
  }

  async editMessage(mid: string, message: OutgoingMessage): Promise<void> {
    const stored = this.messages.get(mid);
    await this.call('editMessage', 'PUT', '/messages', { message_id: mid }, toNewMessageBody(message, 'edit'), () => {
      this.assertValid(message);
      if (stored?.deleted) throw new MaxApiError('not_found', 'message.not.found', { status: 404, code: 'not.found' });
      if (stored) {
        stored.message = message;
        stored.editedAt = this.clock.now();
      }
      return { success: true };
    }, stored?.chatId ?? null);
  }

  async deleteMessage(mid: string): Promise<void> {
    await this.call('deleteMessage', 'DELETE', '/messages', { message_id: mid }, null, () => {
      const stored = this.messages.get(mid);
      if (stored) stored.deleted = true;
      return { success: true };
    });
  }

  async answerCallback(callbackId: string, answer: CallbackAnswerInput): Promise<void> {
    const body = {
      ...(answer.notification === undefined ? {} : { notification: answer.notification }),
      ...(answer.message ? { message: toNewMessageBody(answer.message, 'edit') } : {}),
    };
    const chatId = this.callbackChats.get(callbackId) ?? null;
    await this.call('answerCallback', 'POST', '/answers', { callback_id: callbackId }, body, () => {
      if (answer.message) this.assertValid(answer.message);
      this.callbacks.push({ callbackId, answer });
      return { success: true };
    }, chatId);
  }

  async pinMessage(chatId: number, mid: string, options: { notify?: boolean } = {}): Promise<void> {
    await this.call('pinMessage', 'PUT', `/chats/${chatId}/pin`, null, { message_id: mid, notify: options.notify ?? true }, () => {
      const chat = this.chats.get(chatId);
      if (!chat) throw new MaxApiError('not_found', 'chat.not.found', { status: 404, code: 'not.found' });
      if (!chat.botIsAdmin) throw new MaxApiError('forbidden', 'bot is not admin', { status: 403, code: 'chat.denied' });
      this.pins.set(chatId, mid);
      return { success: true };
    });
  }

  async getChat(chatId: number): Promise<MaxChat> {
    return this.call('getChat', 'GET', `/chats/${chatId}`, null, null, () => {
      const chat = this.chats.get(chatId);
      if (!chat) throw new MaxApiError('not_found', 'chat.not.found', { status: 404, code: 'not.found' });
      return {
        chat_id: chat.chatId,
        type: 'chat' as const,
        status: 'active' as const,
        title: chat.title,
        last_event_time: this.clock.now().getTime(),
        participants_count: chat.participantsCount,
        is_public: false,
        link: chat.link,
      };
    });
  }

  async getChatMembers(chatId: number, userIds: number[]): Promise<MaxChatMember[]> {
    return this.call('getChatMembers', 'GET', `/chats/${chatId}/members`, { user_ids: userIds.join(',') }, null, () => {
      const chat = this.chats.get(chatId);
      if (!chat) throw new MaxApiError('not_found', 'chat.not.found', { status: 404, code: 'not.found' });
      if (!chat.botIsAdmin) throw new MaxApiError('forbidden', 'bot is not admin', { status: 403, code: 'chat.denied' });
      const now = this.clock.now().getTime();
      const members = userIds
        .filter((id) => chat.members === null || chat.members.has(id))
        .map((id) => ({ user_id: id, first_name: 'Участник', is_bot: false, last_access_time: now, is_owner: false, is_admin: false, join_time: now }));
      return { members, marker: null };
    }).then((r) => r.members);
  }

  async getMyMembership(chatId: number): Promise<MaxChatMember> {
    return this.call('getMyMembership', 'GET', `/chats/${chatId}/members/me`, null, null, () => {
      const chat = this.chats.get(chatId);
      if (!chat) throw new MaxApiError('not_found', 'chat.not.found', { status: 404, code: 'not.found' });
      const now = this.clock.now().getTime();
      return {
        ...this.bot,
        last_access_time: now,
        is_owner: false,
        is_admin: chat.botIsAdmin,
        join_time: now,
        permissions: chat.botIsAdmin ? (chat.botPermissions as MaxChatMember['permissions']) : null,
      };
    });
  }

  async getUpdates(): Promise<UpdatesPage> {
    // В симуляторе события приходят на /webhook/max от скриптов и страницы симулятора.
    return this.call('getUpdates', 'GET', '/updates', null, null, () => ({ updates: [], marker: null }));
  }

  // ---------- Служебное ----------

  /** Сообщения, которые бот отправил в чат (для тестов и страницы симулятора). */
  messagesIn(target: MaxTarget): { mid: string; message: OutgoingMessage; editedAt: Date | null; deleted: boolean }[] {
    return [...this.messages.entries()]
      .filter(([, m]) => ('chatId' in target ? m.chatId === target.chatId : 'userId' in m.target && m.target.userId === target.userId))
      .map(([mid, m]) => ({ mid, message: m.message, editedAt: m.editedAt, deleted: m.deleted }));
  }

  private assertValid(message: OutgoingMessage): void {
    const problems = validateBotMessage(message);
    if (problems.length > 0) {
      throw new MaxApiError('bad_request', `invalid message: ${problems.join('; ')}`, { status: 400, code: 'proto.payload' });
    }
  }

  private recordedBody<T extends { text?: string | null }>(body: T, sensitive: boolean): T {
    return sensitive ? { ...body, text: SENSITIVE_MASK } : body;
  }

  private takeFailure(operation: FakeOperation): FakeFailure | null {
    const index = this.failures.findIndex((f) => f.times > 0 && (f.operation === undefined || f.operation === operation));
    if (index < 0) return null;
    const failure = this.failures[index]!;
    failure.times -= 1;
    if (failure.times <= 0) this.failures.splice(index, 1);
    return failure;
  }

  private checkRate(operation: FakeOperation, chatId: number | null): void {
    if (chatId === null) return;
    const limit = (this.rateLimits as Record<string, number | undefined>)[operation];
    if (!limit) return;
    const key = `${operation}:${chatId}`;
    const now = this.clock.now().getTime();
    const hits = (this.rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (hits.length >= limit) {
      this.rateHits.set(key, hits);
      throw new MaxApiError('rate_limited', 'too many requests', { status: 429, code: 'too.many.requests', retryAfterMs: RATE_WINDOW_MS });
    }
    hits.push(now);
    this.rateHits.set(key, hits);
  }

  private async call<T>(
    operation: FakeOperation,
    method: string,
    path: string,
    query: Record<string, unknown> | null,
    body: unknown,
    run: () => T,
    chatId: number | null = null,
  ): Promise<T> {
    const at = this.clock.now();
    try {
      const failure = this.takeFailure(operation);
      if (failure) {
        throw new MaxApiError(failure.kind, `simulated ${failure.kind}`, {
          status: STATUS_BY_KIND[failure.kind],
          retryAfterMs: failure.retryAfterMs ?? null,
        });
      }
      this.checkRate(operation, chatId);
      const response = run();
      await this.store.record({ method, path, query, body, responseStatus: 200, response, at });
      return response;
    } catch (err) {
      const status = err instanceof MaxApiError ? (err.status ?? 0) : 500;
      await this.store.record({
        method,
        path,
        query,
        body,
        responseStatus: status,
        response: { code: err instanceof MaxApiError ? err.code : 'internal', message: err instanceof Error ? err.message : 'error' },
        at,
      });
      throw err;
    }
  }
}

const STATUS_BY_KIND: Record<MaxErrorKind, number | null> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  server: 500,
  network: null,
  timeout: null,
};
