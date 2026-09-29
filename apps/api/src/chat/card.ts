/**
 * Живая карточка аварии в чате дома (F02): одно сообщение, обновления — правкой.
 * Правки объединяются: не чаще одной за окно на карточку (задача с debounce) и только
 * при изменении текста или кнопок. Пропавшая карточка публикуется заново (вне бюджета трёх сообщений).
 */
import { randomUUID } from 'node:crypto';
import { isActualAnswer, participantCounts, renderCard, renderCheckQuestion, type CardInput } from '@vsemdomom/core';
import { and, eq, sql } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import type { Executor } from '../db/client.ts';
import { chatCard, deadline, house, incident, incidentEvent, incidentParticipant, norm, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type JobQueue, type TxLike } from '../jobs/queue.ts';
import { MaxApiError, type OutgoingMessage } from '../max/types.ts';
import { loadIncidentBundle } from '../services/incident-view.ts';
import { computeResult } from '../services/result.ts';
import { messageHash } from './panel.ts';

type Reader = Pick<Executor, 'select'>;

/** Правка карточки — не чаще одной за окно на аварию. */
export async function cardLater(queue: JobQueue, incidentId: number, tx?: TxLike): Promise<void> {
  const key = `card:${incidentId}`;
  if (tx) await queue.sendDebounced(QUEUES.cardRender, { incidentId }, PARAMS.cardEditWindowSec, key, { tx });
  else await queue.sendDebounced(QUEUES.cardRender, { incidentId }, PARAMS.cardEditWindowSec, key);
}

/** Данные карточки из БД (в том числе внутри транзакции создания аварии). */
export async function loadCardInput(db: Reader, ctx: JobContext, incidentId: number): Promise<CardInput | null> {
  const [row] = await db.select({ incident, house }).from(incident).innerJoin(house, eq(house.id, incident.houseId)).where(eq(incident.id, incidentId));
  if (!row) return null;
  const { incident: inc, house: h } = row;
  const participants = await db
    .select({
      entrance: incidentParticipant.entrance,
      affected: incidentParticipant.affected,
      trust: residency.trustLevel,
      flatNo: residency.flatNo,
      userId: incidentParticipant.userId,
      answer: incidentParticipant.restoredAnswer,
      answeredAt: incidentParticipant.restoredAnswerAt,
    })
    .from(incidentParticipant)
    .leftJoin(residency, eq(residency.id, incidentParticipant.residencyId))
    .where(eq(incidentParticipant.incidentId, incidentId));
  const deadlines = await db
    .select({ kind: deadline.kind, status: deadline.status, dueAt: deadline.dueAt, warnAt: deadline.warnAt, basisDoc: norm.basisDoc, basisPoint: norm.basisPoint })
    .from(deadline)
    .innerJoin(norm, eq(norm.id, deadline.normId))
    .where(eq(deadline.incidentId, incidentId));
  const [last] = await db
    .select({ at: sql<Date | string | null>`max(${incidentEvent.occurredAt})` })
    .from(incidentEvent)
    .where(eq(incidentEvent.incidentId, incidentId));
  const [merged] = inc.mergedIntoId ? await db.select({ publicId: incident.publicId }).from(incident).where(eq(incident.id, inc.mergedIntoId)) : [];

  // «Нет» после последнего «Устранено»: квартиры зарегистрированных, остальные — поштучно.
  const saidNo = participants.filter(
    (p) => p.affected && p.answer === 'no' && inc.checkStartedAt !== null && isActualAnswer({ answer: p.answer, answeredAt: p.answeredAt }, inc.checkStartedAt),
  );
  const discrepancyFlats = new Set(saidNo.map((p) => (p.flatNo === null ? `u${p.userId ?? ''}` : `f${p.flatNo}`))).size;

  // Закрытая: у скольких квартир перерывы за месяц сверх нормы (итог F08).
  let overNorm: CardInput['overNorm'] = null;
  if (inc.status === 'closed') {
    const bundle = await loadIncidentBundle(db, inc.id);
    const result = bundle ? await computeResult(db, bundle, ctx.clock.now()) : null;
    overNorm = result?.eligible ? { flats: result.eligible.flats, durationMs: result.eligible.maxTotalMs } : null;
  }

  return {
    incident: {
      publicId: inc.publicId,
      service: inc.serviceType,
      status: inc.status,
      discrepancyUnresolved: inc.discrepancyUnresolved,
      startedAt: inc.startedAt,
      etaAt: inc.etaAt,
      brigadeOnSiteAt: inc.brigadeOnSiteAt,
      localizedAt: inc.localizedAt,
      resolvedAtUk: inc.resolvedAtUk,
    },
    house: { entrances: h.entrances, timezone: h.timezone, isModel: h.isModel },
    counts: participantCounts(participants.map((p) => ({ entrance: p.entrance, affected: p.affected, trustLevel: p.trust ?? 0 }))),
    deadlines,
    discrepancyFlats,
    overNorm,
    unconfirmedRestoreFlats: inc.discrepancyUnresolved ? discrepancyFlats : 0,
    mergedIntoPublicId: merged?.publicId ?? null,
    brigadeConfirm: ctx.config.features.brigadeConfirm,
    discrepancyMaxHours: ctx.config.discrepancyMaxHours,
    updatedAt: last?.at ? new Date(last.at) : inc.createdAt,
    botUsername: ctx.config.max.botUsername,
    now: ctx.clock.now(),
  };
}

export async function renderCardFor(db: Reader, ctx: JobContext, incidentId: number): Promise<{ message: OutgoingMessage; hash: string } | null> {
  const input = await loadCardInput(db, ctx, incidentId);
  if (!input) return null;
  const message = renderCard(input, ctx.i18n);
  return { message, hash: messageHash(message) };
}

export type CardJobResult = 'edited' | 'unchanged' | 'skipped' | 'replaced';

/**
 * Вопрос о восстановлении (C03) правится, а не пишется заново: при повторном «Устранено»
 * вторая строка — «Повторная проверка, УК: …». Правка — только при изменении.
 */
async function checkQuestionJob(ctx: JobContext, card: typeof chatCard.$inferSelect): Promise<void> {
  if (!card.checkMid) return;
  const [row] = await ctx.db.select({ incident, house }).from(incident).innerJoin(house, eq(house.id, incident.houseId)).where(eq(incident.id, card.incidentId));
  if (!row?.incident.resolvedAtUk) return;
  const [repeat] = await ctx.db
    .select({ id: incidentEvent.id })
    .from(incidentEvent)
    .where(and(eq(incidentEvent.incidentId, card.incidentId), eq(incidentEvent.type, 'check_repeated')))
    .limit(1);
  const message = renderCheckQuestion(
    {
      incidentPublicId: row.incident.publicId,
      service: row.incident.serviceType,
      resolvedAt: row.incident.resolvedAtUk,
      recheck: repeat !== undefined,
      closedAt: row.incident.status === 'closed' ? row.incident.closedAt : null,
      house: { timezone: row.house.timezone, isModel: row.house.isModel },
      now: ctx.clock.now(),
    },
    ctx.i18n,
  );
  const hash = messageHash(message);
  if (hash === card.checkRenderHash) return;
  try {
    await ctx.max.editMessage(card.checkMid, message, { chatId: card.chatId });
    await ctx.db.update(chatCard).set({ checkRenderHash: hash }).where(eq(chatCard.incidentId, card.incidentId));
  } catch (err) {
    if (!(err instanceof MaxApiError) || err.retryable) throw err;
    ctx.log.warn({ incidentId: card.incidentId, kind: err.kind }, 'вопрос о восстановлении не обновлён');
  }
}

export async function cardJob(ctx: JobContext, data: { incidentId: number }): Promise<CardJobResult> {
  const [card] = await ctx.db.select().from(chatCard).where(eq(chatCard.incidentId, data.incidentId));
  if (card) await checkQuestionJob(ctx, card);
  // Нет карточки или публикация ещё в очереди: после отправки задача поставится снова.
  if (!card?.mid) return 'skipped';
  const built = await renderCardFor(ctx.db, ctx, data.incidentId);
  if (!built) return 'skipped';
  if (built.hash === card.renderHash) return 'unchanged';
  try {
    await ctx.max.editMessage(card.mid, built.message, { chatId: card.chatId });
    await ctx.db
      .update(chatCard)
      .set({ renderHash: built.hash, lastEditedAt: ctx.clock.now() })
      .where(and(eq(chatCard.incidentId, data.incidentId), eq(chatCard.mid, card.mid)));
    return 'edited';
  } catch (err) {
    if (!(err instanceof MaxApiError) || err.retryable) throw err;
    if (err.kind === 'not_found') {
      await ctx.db.transaction(async (tx) => {
        await tx.update(chatCard).set({ mid: null, renderHash: built.hash }).where(eq(chatCard.incidentId, data.incidentId));
        await enqueueOutbound(tx, ctx.queue, {
          kind: 'card_replace',
          idempotencyKey: `card:replace:${data.incidentId}:${randomUUID()}`,
          target: { chatId: card.chatId },
          message: built.message,
          incidentId: data.incidentId,
          afterSend: { type: 'card', incidentId: data.incidentId },
        });
      });
      return 'replaced';
    }
    // Нет прав или бот удалён из чата: повтор не поможет.
    ctx.log.warn({ incidentId: data.incidentId, kind: err.kind }, 'карточка не обновлена');
    return 'skipped';
  }
}
