/**
 * Ответы модельных соседей (демо-инструменты): через DEMO_NEIGHBOUR_ANSWER_DELAY_SEC после вопроса
 * о восстановлении (или после добавления, если вопрос уже задан) они сами отвечают «Да».
 * Задача demo-tick привязана к конкретной проверке: при повторной проверке ставится новая.
 */
import { isActualAnswer } from '@vsemdomom/core';
import { and, eq, lte } from 'drizzle-orm';
import type { HouseRow } from '../db/queries.ts';
import { incident, incidentParticipant } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { QUEUES, type TxLike } from '../jobs/queue.ts';
import { answerCheck } from './check.ts';

const MS_PER_SECOND = 1000;

export interface DemoAnswersJob {
  incidentId: number;
  /** Начало проверки, к которой относится задача (ISO). */
  checkStartedAt: string;
}

/** Демо-инструменты работают только при DEMO_MODE в модельных домах (не в песочнице). */
export function demoAllowed(ctx: Pick<JobContext, 'config'>, h: Pick<HouseRow, 'isModel' | 'isSandbox'>): boolean {
  return ctx.config.demo.enabled && h.isModel && !h.isSandbox;
}

/** Поставить ответы модельных соседей, если они есть среди участников аварии. */
export async function scheduleDemoAnswers(
  ctx: JobContext,
  tx: Pick<JobContext['db'], 'select'> & TxLike,
  input: { incidentId: number; house: Pick<HouseRow, 'isModel' | 'isSandbox'>; checkStartedAt: Date; from: Date },
): Promise<boolean> {
  if (!demoAllowed(ctx, input.house)) return false;
  const [model] = await tx
    .select({ id: incidentParticipant.id })
    .from(incidentParticipant)
    .where(and(eq(incidentParticipant.incidentId, input.incidentId), eq(incidentParticipant.isModel, true), eq(incidentParticipant.affected, true)))
    .limit(1);
  if (!model) return false;
  const startAfter = new Date(input.from.getTime() + ctx.config.demo.neighbourAnswerDelaySec * MS_PER_SECOND);
  await ctx.queue.send(QUEUES.demo, { incidentId: input.incidentId, checkStartedAt: input.checkStartedAt.toISOString() } satisfies DemoAnswersJob, { startAfter, tx });
  return true;
}

/** Задача demo-tick: модельные соседи без актуального ответа отвечают «Да». Возвращает число ответов. */
export async function demoAnswersJob(ctx: JobContext, data: DemoAnswersJob): Promise<number> {
  const [inc] = await ctx.db.select().from(incident).where(eq(incident.id, data.incidentId));
  if ((inc?.status !== 'checking' && inc?.status !== 'discrepancy') || !inc.checkStartedAt) return 0;
  // Задача прежней проверки: для повторной поставлена своя.
  if (inc.checkStartedAt.toISOString() !== data.checkStartedAt) return 0;
  const now = ctx.clock.now();
  // Добавленные позже отвечают по своей задаче — тоже через положенную задержку.
  const joinedBefore = new Date(now.getTime() - ctx.config.demo.neighbourAnswerDelaySec * MS_PER_SECOND);
  const rows = await ctx.db
    .select({ userId: incidentParticipant.userId, answer: incidentParticipant.restoredAnswer, answeredAt: incidentParticipant.restoredAnswerAt })
    .from(incidentParticipant)
    .where(
      and(
        eq(incidentParticipant.incidentId, inc.id),
        eq(incidentParticipant.isModel, true),
        eq(incidentParticipant.affected, true),
        lte(incidentParticipant.joinedAt, joinedBefore),
      ),
    );
  let answered = 0;
  for (const p of rows) {
    if (p.userId === null || isActualAnswer(p, inc.checkStartedAt)) continue;
    const saved = await answerCheck(ctx, { incidentId: inc.id, userId: p.userId, answer: 'yes', source: 'system', fromHouseChat: false });
    if (saved.status === 'not_checking') break;
    answered += 1;
  }
  return answered;
}
