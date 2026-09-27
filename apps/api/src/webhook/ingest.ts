/**
 * Приём события MAX: дедупликация (inbound_update.dedupe_key UNIQUE) и постановка задачи
 * process-update в одной транзакции. Тело события не хранится.
 */
import type { Db } from '../db/client.ts';
import { inboundUpdate } from '../db/schema.ts';
import { QUEUES, type JobQueue } from '../jobs/queue.ts';
import { dedupeKey, normalizeUpdate, updatePriority, updateSchema, type NormalizedUpdate } from '../max/update.ts';

export interface IngestDeps {
  db: Db;
  queue: JobQueue;
  keywordMatcher: ((text: string) => boolean) | null;
}

export interface UpdateJob {
  dedupeKey: string;
  update: NormalizedUpdate;
}

export type IngestResult = 'accepted' | 'duplicate';

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
