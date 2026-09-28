/**
 * Личные уведомления присоединившимся (F04, F05): смена статуса УК, «до срока 30 минут», «срок истёк».
 * Получатели — отметившиеся «у меня тоже», не выключившие «Уведомлять меня», с начатым диалогом.
 * Каждое сообщение — через журнал исходящих с ключом (авария, событие, получатель): повтор задачи не дублирует.
 */
import { renderDeadlineNotice, renderStatusNotice, type BotMessage, type StatusNoticeInput } from '@vsemdomom/core';
import { and, eq, isNotNull } from 'drizzle-orm';
import { deadline, house, incident, incidentParticipant, maxUser, norm } from '../db/schema.ts';
import { chatOfHouse } from '../db/queries.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type JobQueue, type TxLike } from '../jobs/queue.ts';

export type NotifyJob =
  | { incidentId: number; kind: 'status'; status: StatusNoticeInput['status']; version: number }
  | { incidentId: number; kind: 'deadline_warn' | 'deadline_breach'; deadlineId: number };

export async function notifyLater(queue: JobQueue, job: NotifyJob, tx?: TxLike): Promise<void> {
  await queue.send(QUEUES.notify, job, tx ? { tx } : {});
}

/** Кому писать: отметившиеся, «Уведомлять меня» включено, бот может писать в личку. */
async function recipients(ctx: JobContext, incidentId: number): Promise<number[]> {
  const rows = await ctx.db
    .select({ userId: incidentParticipant.userId })
    .from(incidentParticipant)
    .innerJoin(maxUser, eq(maxUser.id, incidentParticipant.userId))
    .where(
      and(
        eq(incidentParticipant.incidentId, incidentId),
        eq(incidentParticipant.affected, true),
        eq(incidentParticipant.notify, true),
        eq(incidentParticipant.isModel, false),
        isNotNull(incidentParticipant.userId),
        eq(maxUser.dialogActive, true),
      ),
    );
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId]));
}

export async function notifyJob(ctx: JobContext, job: NotifyJob): Promise<number> {
  const [row] = await ctx.db.select({ incident, house }).from(incident).innerJoin(house, eq(house.id, incident.houseId)).where(eq(incident.id, job.incidentId));
  if (!row) return 0;
  const { incident: inc, house: h } = row;
  const noticeHouse = { label: h.label, timezone: h.timezone, isModel: h.isModel, hasChat: (await chatOfHouse(ctx.db, h.id)) !== null };
  const now = ctx.clock.now();
  let message: BotMessage;
  let ref: string;
  if (job.kind === 'status') {
    const [localize] = await ctx.db
      .select({ dueAt: deadline.dueAt, basisDoc: norm.basisDoc, basisPoint: norm.basisPoint })
      .from(deadline)
      .innerJoin(norm, eq(norm.id, deadline.normId))
      .where(and(eq(deadline.incidentId, inc.id), eq(deadline.kind, 'localize'), eq(deadline.status, 'pending')));
    const statusAt = job.status === 'brigade_on_site' ? inc.brigadeOnSiteAt : job.status === 'localized' ? inc.localizedAt : job.status === 'checking' ? inc.resolvedAtUk : null;
    message = renderStatusNotice(
      { incidentPublicId: inc.publicId, service: inc.serviceType, status: job.status, eta: inc.etaAt, statusAt, localize: localize ?? null, house: noticeHouse, botUsername: ctx.config.max.botUsername, now },
      ctx.i18n,
    );
    ref = `status:${job.status}:${job.version}`;
  } else {
    const [d] = await ctx.db
      .select({ dueAt: deadline.dueAt, title: norm.title })
      .from(deadline)
      .innerJoin(norm, eq(norm.id, deadline.normId))
      .where(eq(deadline.id, job.deadlineId));
    if (!d) return 0;
    const kind = job.kind === 'deadline_warn' ? 'warn' : 'breach';
    message = renderDeadlineNotice(
      { incidentPublicId: inc.publicId, service: inc.serviceType, kind, title: d.title, dueAt: d.dueAt, house: noticeHouse, botUsername: ctx.config.max.botUsername, now },
      ctx.i18n,
    );
    ref = `deadline:${job.deadlineId}:${kind}`;
  }
  const users = await recipients(ctx, inc.id);
  if (users.length === 0) return 0;
  await ctx.db.transaction(async (tx) => {
    for (const userId of users) {
      await enqueueOutbound(tx, ctx.queue, { kind: 'dm', idempotencyKey: `notify:${inc.id}:${ref}:${userId}`, target: { userId }, message, incidentId: inc.id });
    }
  });
  return users.length;
}
