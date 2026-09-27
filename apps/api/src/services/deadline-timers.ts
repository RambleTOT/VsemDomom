/**
 * Таймеры сроков по нормативам (F04): предупреждение за 30 минут и истечение срока.
 * Задача сама сверяется с текущими временами срока: если срок пересчитан (номер АДС),
 * она ставит себя заново, а выполненный или отменённый срок пропускает.
 * Истечение ставит флаг overdue (или single_limit_exceeded), пишет событие, правит карточку
 * и уведомляет присоединившихся нейтральным текстом.
 */
import { breachFlag, isOpenStatus } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { cardLater } from '../chat/card.ts';
import { deadline, incident, incidentEvent } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { QUEUES, type JobQueue, type TxLike } from '../jobs/queue.ts';
import { notifyLater } from './notify.ts';

export interface DeadlineJob {
  deadlineId: number;
  kind: 'warn' | 'breach';
}

type DeadlineRow = Pick<typeof deadline.$inferSelect, 'id' | 'status' | 'warnAt' | 'dueAt'>;

async function schedule(queue: JobQueue, job: DeadlineJob, at: Date, tx?: TxLike): Promise<void> {
  await queue.send(QUEUES.deadline, job, { startAfter: at, ...(tx ? { tx } : {}) });
}

/**
 * Задачи для невыполненных сроков. Предупреждение не ставится, если срок короче окна
 * предупреждения (например, 30 минут на ответ УК): «до срока 30 минут» сразу после сообщения бесполезно.
 */
export async function scheduleDeadlineJobs(queue: JobQueue, rows: readonly DeadlineRow[], reportedAt: Date, tx?: TxLike): Promise<void> {
  for (const row of rows) {
    if (row.status !== 'pending') continue;
    if (row.warnAt.getTime() > reportedAt.getTime()) await schedule(queue, { deadlineId: row.id, kind: 'warn' }, row.warnAt, tx);
    await schedule(queue, { deadlineId: row.id, kind: 'breach' }, row.dueAt, tx);
  }
}

export type DeadlineJobResult = 'warned' | 'breached' | 'rescheduled' | 'skipped';

export async function deadlineJob(ctx: JobContext, data: DeadlineJob): Promise<DeadlineJobResult> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [d] = await tx.select().from(deadline).where(eq(deadline.id, data.deadlineId)).for('update');
    if (d?.status !== 'pending') return 'skipped';
    const [inc] = await tx.select().from(incident).where(eq(incident.id, d.incidentId));
    if (!inc || !isOpenStatus(inc.status)) return 'skipped';

    if (data.kind === 'warn') {
      if (d.warnedAt) return 'skipped';
      if (now.getTime() < d.warnAt.getTime()) {
        await schedule(ctx.queue, data, d.warnAt, tx);
        return 'rescheduled';
      }
      if (now.getTime() >= d.dueAt.getTime()) return 'skipped';
      await tx.update(deadline).set({ warnedAt: now }).where(eq(deadline.id, d.id));
      await tx.insert(incidentEvent).values({ incidentId: inc.id, type: 'deadline_warned', actorType: 'system', source: 'system', payload: { kind: d.kind, dueAt: d.dueAt.toISOString() }, occurredAt: now });
      await notifyLater(ctx.queue, { incidentId: inc.id, kind: 'deadline_warn', deadlineId: d.id }, tx);
      return 'warned';
    }

    if (now.getTime() < d.dueAt.getTime()) {
      await schedule(ctx.queue, data, d.dueAt, tx);
      return 'rescheduled';
    }
    await tx.update(deadline).set({ status: 'breached', resolvedAt: d.dueAt }).where(eq(deadline.id, d.id));
    // Системный флаг не меняет версию: у УК не должно быть конфликта If-Match из-за таймера.
    await tx
      .update(incident)
      .set(breachFlag(d.kind) === 'overdue' ? { overdue: true } : { singleLimitExceeded: true })
      .where(eq(incident.id, inc.id));
    await tx.insert(incidentEvent).values({ incidentId: inc.id, type: 'deadline_breached', actorType: 'system', source: 'system', payload: { kind: d.kind, dueAt: d.dueAt.toISOString() }, occurredAt: now });
    await cardLater(ctx.queue, inc.id, tx);
    await notifyLater(ctx.queue, { incidentId: inc.id, kind: 'deadline_breach', deadlineId: d.id }, tx);
    return 'breached';
  });
}
