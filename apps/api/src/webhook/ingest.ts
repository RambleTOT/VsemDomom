/**
 * Приём события MAX: дедупликация (inbound_update.dedupe_key UNIQUE) и постановка задачи
 * process-update в одной транзакции. Тело события не хранится. Флуд одного пользователя
 * (сообщения, нажатия, «Начать») отсекается до очереди.
 */
import { MS_PER_SECOND } from '@vsemdomom/core';
import type { Db } from '../db/client.ts';
import { inboundUpdate } from '../db/schema.ts';
import { QUEUES, type JobQueue } from '../jobs/queue.ts';
import { dedupeKey, normalizeUpdate, updatePriority, updateSchema, type NormalizedUpdate, type RawUpdate } from '../max/update.ts';
import { PARAMS } from '../config/params.ts';
import { TokenBuckets } from '../util/limits.ts';

export interface UpdateThrottle {
  buckets: TokenBuckets;
  now: () => number;
  /** Первый отказ в серии — для одного предупреждения в журнале. */
  onReject?: (userId: number) => void;
}

export interface IngestDeps {
  db: Db;
  queue: JobQueue;
  keywordMatcher: ((text: string) => boolean) | null;
  /** Лимит событий на пользователя; без него (тесты) события не ограничиваются. */
  throttle?: UpdateThrottle;
}

/** Лимит событий на пользователя для api (webhook) и worker (long polling). */
export function userUpdateThrottle(log: { warn: (obj: object, msg: string) => void }, now: () => number = Date.now): UpdateThrottle {
  return {
    buckets: new TokenBuckets(PARAMS.updateBurst, PARAMS.updateRefillSec * MS_PER_SECOND),
    now,
    onReject: (userId) => log.warn({ userId }, 'webhook: слишком частые события пользователя — лишние пропущены'),
  };
}

/**
 * События, которые шлёт человек: сообщения, нажатия, «Начать» и добавление бота в группу (на каждую
 * группу бот отвечает сообщением). Сообщения ботов (наши карточки) не ограничиваются.
 */
const USER_ACTIONS = new Set(['message_created', 'message_callback', 'bot_started', 'bot_added']);

function throttled(deps: IngestDeps, raw: RawUpdate, update: NormalizedUpdate): boolean {
  const t = deps.throttle;
  if (!t || update.userId === null || !USER_ACTIONS.has(update.type) || raw.message?.sender?.is_bot === true) return false;
  const decision = t.buckets.take(update.userId, t.now());
  if (!decision.ok && decision.firstReject) t.onReject?.(update.userId);
  return !decision.ok;
}

export interface UpdateJob {
  dedupeKey: string;
  update: NormalizedUpdate;
}

export type IngestResult = 'accepted' | 'duplicate' | 'throttled';

export class InvalidUpdateError extends Error {
  constructor() {
    super('invalid update');
    this.name = 'InvalidUpdateError';
  }
}

export async function ingestUpdate(deps: IngestDeps, body: unknown): Promise<IngestResult> {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) throw new InvalidUpdateError();
  const key = dedupeKey(parsed.data);
  const update = normalizeUpdate(parsed.data, { keywordMatcher: deps.keywordMatcher });
  // MAX получает 200 и не повторяет: лишнее событие просто не попадает в очередь.
  if (throttled(deps, parsed.data, update)) return 'throttled';
  return deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(inboundUpdate)
      .values({ dedupeKey: key, updateType: update.type })
      .onConflictDoNothing()
      .returning({ key: inboundUpdate.dedupeKey });
    if (inserted.length === 0) return 'duplicate';
    const job: UpdateJob = { dedupeKey: key, update };
    await deps.queue.send(QUEUES.update, job, { priority: updatePriority(update.type), tx });
    return 'accepted';
  });
}
