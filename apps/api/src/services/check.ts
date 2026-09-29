/**
 * Проверка после «Устранено» (F07) и итог (F08). Ответ жителя (последний действует) пересчитывает
 * правило закрытия ядра: первое актуальное «Нет» → расхождение и инструкция ответившему; все жители
 * уровня 1–2 ответили «Да» или «плохая» → закрыто. По времени закрывает задача check-tick: окно
 * проверки без «Нет» или предельный срок расхождения (с флагом discrepancy_unresolved).
 * Закрытие: итог C04 — третье новое сообщение, ответом на карточку; карточка — финальная; уведомления.
 */
import {
  applyRestoredAnswer,
  evaluateCheck,
  flatLocation,
  nextCheckDeadline,
  normDurationMs,
  renderNoWater,
  renderWeakQuality,
  restoreBadLabel,
  renderResult,
  selectNorm,
  transition,
  type CheckInput,
  type EventSource,
  type IncidentCommand,
  type IncidentStatus,
  type RestoredAnswer,
} from '@vsemdomom/core';
import { and, eq } from 'drizzle-orm';
import { cardLater } from '../chat/card.ts';
import { panelLater } from '../chat/panel.ts';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import type { HouseRow } from '../db/queries.ts';
import { chatCard, deadline, house, incident, incidentEvent, incidentParticipant, managementCompany, maxUser, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type JobQueue, type TxLike } from '../jobs/queue.ts';
import { scheduleActJob } from './act.ts';
import { loadIncidentBundle } from './incident-view.ts';
import { notifyLater } from './notify.ts';
import { scheduleWaterPoll } from './polls.ts';
import { checkWindowMs } from './policy.ts';
import { computeResult } from './result.ts';

type Tx = Executor & TxLike;
type IncidentRow = typeof incident.$inferSelect;

const MS_PER_HOUR = 3_600_000;

export interface CheckJob {
  incidentId: number;
}

export async function scheduleCheckJob(queue: JobQueue, incidentId: number, at: Date, tx?: TxLike): Promise<void> {
  await queue.send(QUEUES.check, { incidentId }, { startAfter: at, ...(tx ? { tx } : {}) });
}

async function checkInput(tx: Tx, ctx: JobContext, inc: IncidentRow, h: HouseRow, now: Date): Promise<CheckInput | null> {
  if ((inc.status !== 'checking' && inc.status !== 'discrepancy') || !inc.checkStartedAt) return null;
  const rows = await tx
    .select({ affected: incidentParticipant.affected, trust: residency.trustLevel, answer: incidentParticipant.restoredAnswer, answeredAt: incidentParticipant.restoredAnswerAt })
    .from(incidentParticipant)
    .leftJoin(residency, eq(residency.id, incidentParticipant.residencyId))
    .where(eq(incidentParticipant.incidentId, inc.id));
  return {
    status: inc.status,
    checkStartedAt: inc.checkStartedAt,
    discrepancyAt: inc.discrepancyAt,
    participants: rows.map((r) => ({ affected: r.affected, trustLevel: r.trust ?? 0, answer: r.answer, answeredAt: r.answeredAt })),
    now,
    checkWindowMs: checkWindowMs(ctx.config, h),
    discrepancyMaxMs: ctx.config.discrepancyMaxHours * MS_PER_HOUR,
  };
}

/** Итог C04 — ответом на карточку (третье новое сообщение); без карточки в чате — только в приложении. */
async function postResult(tx: Tx, ctx: JobContext, incidentId: number): Promise<void> {
  const [card] = await tx.select().from(chatCard).where(eq(chatCard.incidentId, incidentId));
  if (!card) return;
  const bundle = await loadIncidentBundle(tx, incidentId);
  if (!bundle) return;
  const now = ctx.clock.now();
  const r = await computeResult(tx, bundle, now);
  const inc = bundle.incident;
  const message = renderResult(
    {
      incidentPublicId: inc.publicId,
      service: inc.serviceType,
      house: { label: bundle.house.label, timezone: bundle.house.timezone, isModel: bundle.house.isModel },
      startedAt: inc.startedAt,
      resolvedAt: r.resolvedAt,
      flats: r.flatsCount,
      late: r.late,
      overNorm:
        r.eligible && r.norms.monthly && r.norms.monthly.ms !== null
          ? { flats: r.eligible.flats, month: r.month.month, totalMs: r.eligible.maxTotalMs, limitMs: r.norms.monthly.ms }
          : null,
      botUsername: ctx.config.max.botUsername,
      now,
    },
    ctx.i18n,
  );
  await enqueueOutbound(tx, ctx.queue, {
    kind: 'result',
    idempotencyKey: `result:${incidentId}`,
    target: { chatId: card.chatId },
    message: card.mid ? { ...message, replyToMid: card.mid } : message,
    incidentId,
    afterSend: { type: 'result', incidentId },
  });
}

/**
 * Переход проверки (расхождение или закрытие) с эффектами. Возвращает новый статус или null,
 * если переход недоступен (например, уже закрыто параллельно).
 */
async function applyCheckCommand(tx: Tx, ctx: JobContext, inc: IncidentRow, h: HouseRow, command: IncidentCommand, now: Date): Promise<IncidentStatus | null> {
  const result = transition(inc.status, command);
  if (!result.ok) return null;
  const t = result.transition;
  const update: Partial<IncidentRow> = { status: t.to, version: inc.version + 1 };
  if (t.to === 'closed') update.closedAt = now;
  const after: ((x: Tx) => Promise<void>)[] = [];
  for (const effect of t.effects) {
    switch (effect.type) {
      case 'set_discrepancy_at':
        update.discrepancyAt = now;
        after.push((x) => scheduleCheckJob(ctx.queue, inc.id, new Date(now.getTime() + ctx.config.discrepancyMaxHours * MS_PER_HOUR), x));
        break;
      case 'set_discrepancy_unresolved':
        update.discrepancyUnresolved = true;
        break;
      case 'cancel_pending_deadlines':
        await tx.update(deadline).set({ status: 'cancelled' }).where(and(eq(deadline.incidentId, inc.id), eq(deadline.status, 'pending')));
        break;
      case 'post_result':
        after.push((x) => postResult(x, ctx, inc.id));
        break;
      case 'edit_card':
        after.push((x) => cardLater(ctx.queue, inc.id, x));
        break;
      case 'notify_participants':
        after.push((x) => notifyLater(ctx.queue, { incidentId: inc.id, kind: 'status', status: 'closed', version: inc.version + 1 }, x));
        break;
      case 'instruct_answerer':
        // Инструкцию получает каждый ответивший «Нет» — её ставит answerCheck.
        break;
      case 'set_eta':
      case 'mark_deadlines_met':
      case 'drop_deadlines':
      case 'set_resolved_at_uk':
      case 'start_check':
      case 'post_check_question':
      case 'edit_check_question':
      case 'move_participants':
        break;
    }
  }
  await tx.update(incident).set(update).where(eq(incident.id, inc.id));
  const reason = command.type === 'close' ? command.reason : null;
  await tx.insert(incidentEvent).values(
    t.events.map((type) => ({ incidentId: inc.id, type, actorType: 'system' as const, source: 'system' as const, payload: reason ? { reason } : {}, occurredAt: now })),
  );
  for (const run of after) await run(tx);
  if (t.to === 'closed') {
    await panelLater(ctx.queue, h.id, tx);
    await scheduleWaterPoll(ctx, tx, inc, now);
  }
  return t.to;
}

/** «Воды нет — что делать» ответившему «Нет», если диалог с ботом начат (одно сообщение на проверку). */
async function instructAnswerer(tx: Tx, ctx: JobContext, inc: IncidentRow, h: HouseRow, userId: number): Promise<boolean> {
  const [user] = await tx.select({ dialogActive: maxUser.dialogActive }).from(maxUser).where(eq(maxUser.id, userId));
  if (!user?.dialogActive) return false;
  const [uk] = await tx.select({ adsPhone: managementCompany.adsPhone }).from(managementCompany).where(eq(managementCompany.id, h.ukId));
  const norms = await loadNorms(tx);
  const ctxHouse = { regionCode: h.regionCode, timezone: h.timezone, powerSources: h.powerSources, hotWaterDeadEnd: h.hotWaterDeadEnd };
  const now = ctx.clock.now();
  const visit = selectNorm(norms, { service: inc.serviceType, event: 'check_visit', house: ctxHouse, at: now });
  const act = selectNorm(norms, { service: inc.serviceType, event: 'act_without_executor', house: ctxHouse, at: now });
  const visitMs = visit ? normDurationMs(visit) : null;
  const message = renderNoWater(
    {
      incidentPublicId: inc.publicId,
      service: inc.serviceType,
      adsPhone: uk?.adsPhone ?? '',
      actNorms: visitMs !== null && act ? { checkVisitMs: visitMs, actPersons: act.value } : null,
      // «Как составить акт» (S09) — только при включённой функции.
      withAct: ctx.config.features.actTemplate,
      telLinks: ctx.config.max.telLinks,
      isModel: h.isModel,
      botUsername: ctx.config.max.botUsername,
    },
    ctx.i18n,
  );
  await enqueueOutbound(tx, ctx.queue, {
    kind: 'dm',
    idempotencyKey: `nowater:${inc.id}:${userId}:${inc.checkStartedAt?.getTime() ?? 0}`,
    target: { userId },
    message,
    incidentId: inc.id,
  });
  return true;
}

/** Ответ «есть, но плохо»: подсказка про АДС и опрос о качестве; одна на проверку. */
async function offerQualityReport(tx: Tx, ctx: JobContext, inc: IncidentRow, h: HouseRow, userId: number): Promise<void> {
  const [user] = await tx.select({ dialogActive: maxUser.dialogActive }).from(maxUser).where(eq(maxUser.id, userId));
  const label = restoreBadLabel(inc.serviceType, ctx.i18n);
  if (!user?.dialogActive || !label) return;
  const [uk] = await tx.select({ adsPhone: managementCompany.adsPhone }).from(managementCompany).where(eq(managementCompany.id, h.ukId));
  const water = inc.serviceType === 'cold_water' || inc.serviceType === 'hot_water';
  const message = renderWeakQuality(
    {
      service: inc.serviceType,
      answerLabel: label,
      adsPhone: uk?.adsPhone ?? '',
      pollHours: water && ctx.config.features.polls ? ctx.config.waterQualityPollDelayHours : null,
      isModel: h.isModel,
    },
    ctx.i18n,
  );
  await enqueueOutbound(tx, ctx.queue, {
    kind: 'dm',
    idempotencyKey: `weak:${inc.id}:${userId}:${inc.checkStartedAt?.getTime() ?? 0}`,
    target: { userId },
    message,
    incidentId: inc.id,
  });
}

export type AnswerResult = { status: 'saved'; to: IncidentStatus | null; instructed: boolean } | { status: 'not_checking' };

/**
 * Ответ на вопрос о восстановлении: действует последний. Ответивший становится участником аварии
 * (отметился — значит, услуги у него не было). Нажатие в чате дома подтверждает уровень 1.
 */
export async function answerCheck(
  ctx: JobContext,
  input: { incidentId: number; userId: number; answer: RestoredAnswer; viaAds?: { number?: string; at?: Date }; source: EventSource; fromHouseChat: boolean },
): Promise<AnswerResult> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, input.incidentId)).for('update');
    if ((inc?.status !== 'checking' && inc?.status !== 'discrepancy') || !inc.checkStartedAt) return { status: 'not_checking' };
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    if (!h) return { status: 'not_checking' };
    const [res] = await tx.select().from(residency).where(and(eq(residency.userId, input.userId), eq(residency.houseId, h.id)));
    if (res && input.fromHouseChat && res.trustLevel === 0) {
      await tx.update(residency).set({ trustLevel: 1, membershipCheckedAt: now, updatedAt: now }).where(and(eq(residency.id, res.id), eq(residency.trustLevel, 0)));
    }
    let [p] = await tx
      .select()
      .from(incidentParticipant)
      .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.userId, input.userId)))
      .for('update');
    if (!p) {
      const loc = res ? flatLocation(h, res.flatNo) : null;
      const [user] = await tx.select({ notifyDefault: maxUser.notifyDefault }).from(maxUser).where(eq(maxUser.id, input.userId));
      [p] = await tx
        .insert(incidentParticipant)
        .values({
          incidentId: inc.id,
          userId: input.userId,
          residencyId: res?.id ?? null,
          entrance: loc?.entrance ?? null,
          floor: loc?.floor ?? null,
          trustLevelAtJoin: res ? (input.fromHouseChat && res.trustLevel === 0 ? 1 : res.trustLevel) : 0,
          notify: user?.notifyDefault ?? true,
          joinedAt: now,
        })
        .returning();
      await tx.insert(incidentEvent).values({ incidentId: inc.id, type: 'joined', actorType: 'resident', actorId: input.userId, source: input.source, payload: { entrance: loc?.entrance ?? null, viaCheck: true }, occurredAt: now });
    }
    if (!p) throw new Error('участник не записан');
    const restoration = applyRestoredAnswer(
      { answer: p.restoredAnswer, restoredAt: p.restoredAt, restoredSource: p.restoredSource },
      { answer: input.answer, at: input.viaAds?.at ?? now, resolvedAtUk: inc.resolvedAtUk ?? now, viaAds: input.viaAds !== undefined },
    );
    await tx
      .update(incidentParticipant)
      .set({ affected: true, restoredAnswer: restoration.answer, restoredAnswerAt: restoration.answeredAt, restoredAt: restoration.restoredAt, restoredSource: restoration.restoredSource })
      .where(eq(incidentParticipant.id, p.id));
    await tx.insert(incidentEvent).values({
      incidentId: inc.id,
      type: input.answer === 'yes' ? 'restored_yes' : input.answer === 'no' ? 'restored_no' : 'restored_weak',
      actorType: 'resident',
      actorId: input.userId,
      source: input.source,
      payload: {
        ...(input.viaAds ? { viaAds: true, ...(input.viaAds.number ? { number: input.viaAds.number } : {}) } : {}),
        // Ответы модельных соседей (демо) помечены: в метрики они не входят.
        ...(p.isModel ? { model: true } : {}),
      },
      occurredAt: now,
    });

    const check = await checkInput(tx, ctx, inc, h, now);
    const command = check ? evaluateCheck(check) : null;
    const to = command ? await applyCheckCommand(tx, ctx, inc, h, command, now) : null;
    if (!to) await cardLater(ctx.queue, inc.id, tx);
    const instructed = input.answer === 'no' && (to ?? inc.status) !== 'closed' ? await instructAnswerer(tx, ctx, inc, h, input.userId) : false;
    // «Есть, но плохо» — восстановление, но с плохим качеством: подсказать, куда сообщить (F07 → F14). Демо-соседям не пишем.
    if (input.answer === 'weak' && !p.isModel) await offerQualityReport(tx, ctx, inc, h, input.userId);
    return { status: 'saved', to, instructed };
  });
}

/** Задача check-tick: окно проверки или предельный срок расхождения. Раньше срока — ставит себя заново. */
export async function checkTimerJob(ctx: JobContext, data: CheckJob): Promise<IncidentStatus | 'waiting' | 'skipped'> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, data.incidentId)).for('update');
    if (!inc) return 'skipped';
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    if (!h) return 'skipped';
    const check = await checkInput(tx, ctx, inc, h, now);
    if (!check) return 'skipped';
    const command = evaluateCheck(check);
    if (command) return (await applyCheckCommand(tx, ctx, inc, h, command, now)) ?? 'skipped';
    const next = nextCheckDeadline(check);
    if (next.getTime() > now.getTime()) await scheduleCheckJob(ctx.queue, inc.id, next, tx);
    return 'waiting';
  });
}

/**
 * «Я сообщил в АДС» после ответа «Нет» (п. 108): номер и время повторного сообщения у участника,
 * событие в хронологии, таймер срока проверки для предложения акта без исполнителя (S09).
 */
export async function rereportAds(ctx: JobContext, input: { incidentId: number; userId: number; number: string | null; at: Date; source: EventSource }): Promise<'saved' | 'not_checking'> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, input.incidentId));
    if (inc?.status !== 'checking' && inc?.status !== 'discrepancy') return 'not_checking';
    const updated = await tx
      .update(incidentParticipant)
      .set({ adsRereportNumber: input.number, adsRereportAt: input.at })
      .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.userId, input.userId)))
      .returning({ id: incidentParticipant.id });
    if (updated.length === 0) return 'not_checking';
    await tx.insert(incidentEvent).values({
      incidentId: inc.id,
      type: 'ads_rereported',
      actorType: 'resident',
      actorId: input.userId,
      source: input.source,
      payload: { ...(input.number ? { number: input.number } : {}), at: input.at.toISOString() },
      occurredAt: now,
    });
    // Срок проверки по повторному сообщению (п. 108): нет отметки УК — предложение акта (S09).
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    if (h) await scheduleActJob(ctx, tx, { incident: inc, house: h, userId: input.userId, rereportAt: input.at });
    return 'saved';
  });
}
