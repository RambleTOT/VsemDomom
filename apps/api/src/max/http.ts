/**
 * HttpMaxApi — тонкий клиент Bot API MAX поверх fetch.
 * - Только https://platform-api2.max.ru, токен в заголовке `Authorization: <token>` без Bearer.
 * - Тайм-аут 10 с; до 5 попыток на сетевые ошибки, 429, 500, 502, 503, 504 с экспоненциальной
 *   задержкой и джиттером (0,5 → 8 с) и с учётом Retry-After.
 * - Лимиты: не больше N отправок и правок в секунду в один чат, отдельный лимит ответов
 *   на нажатия, общий лимит на бота.
 * Токен и тела запросов не логируются.
 */
import type { Logger } from 'pino';
import { toNewMessageBody } from './body.ts';
import { realSleep, type RateLimiter, type Sleep } from './rate-limiter.ts';
import {
  MaxApiError,
  type CallbackAnswerInput,
  type ChatScope,
  type MaxApi,
  type MaxBotCommand,
  type MaxBotInfo,
  type MaxChat,
  type MaxChatMember,
  type MaxErrorKind,
  type MaxMessage,
  type MaxSubscription,
  type MaxTarget,
  type OutgoingMessage,
  type SendOptions,
  type UpdatesPage,
} from './types.ts';

export interface HttpMaxApiOptions {
  baseUrl: string;
  token: string;
  log: Logger;
  limiter: RateLimiter;
  rate: { perChat: number; answersPerChat: number };
  fetch?: typeof fetch;
  sleep?: Sleep;
  random?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
}

interface RequestSpec {
  op: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Ключ лимита частоты по чату и сколько вызовов в секунду допустимо. */
  rateKey?: string | null;
  perSecond?: number;
  timeoutMs?: number;
  /** Попыток для этого вызова; по умолчанию — из настроек клиента. */
  maxAttempts?: number;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 5;
const POLL_EXTRA_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1000;

function kindByStatus(status: number): MaxErrorKind {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'server' : 'bad_request';
}

/** Retry-After: секунды или HTTP-дата. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * MS_PER_SECOND), MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

export class HttpMaxApi implements MaxApi {
  readonly kind = 'http' as const;
  private readonly options: Required<Omit<HttpMaxApiOptions, 'fetch' | 'sleep' | 'random' | 'timeoutMs' | 'maxAttempts'>> & {
    fetch: typeof fetch;
    sleep: Sleep;
    random: () => number;
    timeoutMs: number;
    maxAttempts: number;
  };

  constructor(options: HttpMaxApiOptions) {
    this.options = {
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      fetch: options.fetch ?? fetch,
      sleep: options.sleep ?? realSleep,
      random: options.random ?? Math.random,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxAttempts: options.maxAttempts ?? DEFAULT_ATTEMPTS,
    };
  }

  async getMe(): Promise<MaxBotInfo> {
    return this.request<MaxBotInfo>({ op: 'getMe', method: 'GET', path: '/me' });
  }

  async setCommands(commands: MaxBotCommand[]): Promise<void> {
    await this.request({ op: 'setCommands', method: 'PATCH', path: '/me/commands', body: { commands } });
  }

  async listSubscriptions(): Promise<MaxSubscription[]> {
    const r = await this.request<{ subscriptions: MaxSubscription[] }>({ op: 'listSubscriptions', method: 'GET', path: '/subscriptions' });
    return r.subscriptions;
  }

  async subscribe(input: { url: string; updateTypes: string[]; secret: string }): Promise<void> {
    await this.request({
      op: 'subscribe',
      method: 'POST',
      path: '/subscriptions',
      body: { url: input.url, update_types: input.updateTypes, secret: input.secret },
    });
  }

  async unsubscribe(url: string): Promise<void> {
    await this.request({ op: 'unsubscribe', method: 'DELETE', path: '/subscriptions', query: { url } });
  }

  async sendMessage(target: MaxTarget, message: OutgoingMessage, options: SendOptions = {}): Promise<{ mid: string }> {
    const isChat = 'chatId' in target;
    const r = await this.request<{ message: MaxMessage }>({
      op: 'sendMessage',
      method: 'POST',
      path: '/messages',
      query: {
        ...(isChat ? { chat_id: target.chatId } : { user_id: target.userId }),
        ...(options.disableLinkPreview ? { disable_link_preview: true } : {}),
      },
      body: toNewMessageBody(message, 'send'),
      rateKey: isChat ? `send:chat:${target.chatId}` : `send:user:${target.userId}`,
      perSecond: this.options.rate.perChat,
      ...(options.attempts === undefined ? {} : { maxAttempts: options.attempts }),
    });
    return { mid: r.message.body.mid };
  }

  async editMessage(mid: string, message: OutgoingMessage, options: ChatScope = {}): Promise<void> {
    await this.request({
      op: 'editMessage',
      method: 'PUT',
      path: '/messages',
      query: { message_id: mid },
      body: toNewMessageBody(message, 'edit'),
      rateKey: options.chatId === undefined || options.chatId === null ? `edit:mid:${mid}` : `edit:chat:${options.chatId}`,
      perSecond: this.options.rate.perChat,
    });
  }

  async deleteMessage(mid: string, options: ChatScope = {}): Promise<void> {
    await this.request({
      op: 'deleteMessage',
      method: 'DELETE',
      path: '/messages',
      query: { message_id: mid },
      rateKey: options.chatId === undefined || options.chatId === null ? null : `edit:chat:${options.chatId}`,
      perSecond: this.options.rate.perChat,
    });
  }

  async answerCallback(callbackId: string, answer: CallbackAnswerInput, options: ChatScope = {}): Promise<void> {
    await this.request({
      op: 'answerCallback',
      method: 'POST',
      path: '/answers',
      query: { callback_id: callbackId },
      body: {
        ...(answer.notification === undefined ? {} : { notification: answer.notification }),
        ...(answer.message ? { message: toNewMessageBody(answer.message, 'edit') } : {}),
      },
      rateKey: options.chatId === undefined || options.chatId === null ? null : `answer:chat:${options.chatId}`,
      perSecond: this.options.rate.answersPerChat,
    });
  }

  async pinMessage(chatId: number, mid: string, options: { notify?: boolean } = {}): Promise<void> {
    await this.request({
      op: 'pinMessage',
      method: 'PUT',
      path: `/chats/${chatId}/pin`,
      body: { message_id: mid, notify: options.notify ?? true },
    });
  }

  async getChat(chatId: number): Promise<MaxChat> {
    return this.request<MaxChat>({ op: 'getChat', method: 'GET', path: `/chats/${chatId}` });
  }

  async getChatMembers(chatId: number, userIds: number[]): Promise<MaxChatMember[]> {
    const r = await this.request<{ members: MaxChatMember[] }>({
      op: 'getChatMembers',
      method: 'GET',
      path: `/chats/${chatId}/members`,
      query: { user_ids: userIds.join(',') },
    });
    return r.members;
  }

  async getMyMembership(chatId: number): Promise<MaxChatMember> {
    return this.request<MaxChatMember>({ op: 'getMyMembership', method: 'GET', path: `/chats/${chatId}/members/me` });
  }

  async getUpdates(options: { marker?: number | null; timeoutSec?: number; limit?: number; types?: string[] }): Promise<UpdatesPage> {
    const timeoutSec = options.timeoutSec ?? 30;
    const r = await this.request<{ updates: unknown[]; marker?: number | null }>({
      op: 'getUpdates',
      method: 'GET',
      path: '/updates',
      query: {
        timeout: timeoutSec,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.marker === undefined || options.marker === null ? {} : { marker: options.marker }),
        ...(options.types?.length ? { types: options.types.join(',') } : {}),
      },
      timeoutMs: timeoutSec * MS_PER_SECOND + POLL_EXTRA_TIMEOUT_MS,
    });
    return { updates: r.updates, marker: r.marker ?? null };
  }

  // ---------- транспорт ----------

  private url(spec: RequestSpec): string {
    const url = new URL(`${this.options.baseUrl}${spec.path}`);
    for (const [k, v] of Object.entries(spec.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private backoff(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null) return retryAfterMs;
    const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
    return Math.round(base / 2 + (this.options.random() * base) / 2);
  }

  private async request<T>(spec: RequestSpec): Promise<T> {
    const { log } = this.options;
    const maxAttempts = spec.maxAttempts ?? this.options.maxAttempts;
    let lastError: MaxApiError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.options.limiter.acquire(spec.rateKey ?? null, spec.perSecond ?? 0);
      const started = Date.now();
      try {
        const result = await this.once<T>(spec);
        log.debug({ op: spec.op, attempt, ms: Date.now() - started }, 'MAX: ok');
        return result;
      } catch (err) {
        const error =
          err instanceof MaxApiError ? err : new MaxApiError('network', err instanceof Error ? err.message : 'network error');
        lastError = error;
        if (!error.retryable || attempt === maxAttempts) break;
        const delay = this.backoff(attempt, error.retryAfterMs);
        log.warn({ op: spec.op, attempt, kind: error.kind, status: error.status, delayMs: delay }, 'MAX: повтор');
        await this.options.sleep(delay);
      }
    }
    log.error({ op: spec.op, kind: lastError?.kind, status: lastError?.status, code: lastError?.code }, 'MAX: запрос не выполнен');
    throw lastError ?? new MaxApiError('network', 'unknown');
  }

  private async once<T>(spec: RequestSpec): Promise<T> {
    let response: Response;
    try {
      response = await this.options.fetch(this.url(spec), {
        method: spec.method,
        headers: {
          Authorization: this.options.token,
          ...(spec.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
        signal: AbortSignal.timeout(spec.timeoutMs ?? this.options.timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new MaxApiError(isTimeout ? 'timeout' : 'network', isTimeout ? 'timeout' : 'network error');
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const body = (json ?? {}) as { code?: string; message?: string };
      const kind = RETRY_STATUSES.has(response.status) ? (response.status === 429 ? 'rate_limited' : 'server') : kindByStatus(response.status);
      throw new MaxApiError(kind, body.message ?? `HTTP ${response.status}`, {
        status: response.status,
        code: body.code ?? null,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), Date.now()),
      });
    }

    // Методы с SimpleQueryResult отвечают 200 и success=false при логической ошибке.
    const result = json as { success?: unknown; message?: unknown } | null;
    if (result !== null && typeof result === 'object' && result.success === false) {
      const message = typeof result.message === 'string' ? result.message : 'success=false';
      throw new MaxApiError(/not.?found|не найден/i.test(message) ? 'not_found' : 'bad_request', message, { status: response.status });
    }
    return json as T;
  }
}
