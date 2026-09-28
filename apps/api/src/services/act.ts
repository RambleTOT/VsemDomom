/**
 * S09. Акт без исполнителя: таймер после повторного сообщения в АДС (п. 108), предложение акта
 * в личку, «Я готов подписать» и знакомство готовых подписать (по согласию каждого — упоминания
 * профилей MAX в личку; контакты не хранятся). Только при FEATURE_ACT_TEMPLATE.
 */
import { renderActIntro, renderActOffer, type EventSource } from '@vsemdomom/core';
import { eq, inArray } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import type { HouseRow } from '../db/queries.ts';
import { house, incident, incidentEvent, incidentParticipant, maxUser } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type JobQueue, type TxLike } from '../jobs/queue.ts';
import { actInfo, actNormsFor, awaitingCheck, checkDueAt, type ActInfo, type ActNorms } from './act-info.ts';

type Tx = Executor & TxLike;
type Reader = Pick<Executor, 'select'>;
type IncidentRow = typeof incident.$inferSelect;
type ParticipantRow = typeof incidentParticipant.$inferSelect;

export interface ActJob {
  incidentId: number;
  userId: number;
}

export async function loadActNorms(db: Reader, h: HouseRow, inc: Pick<IncidentRow, 'serviceType'>, at: Date): Promise<ActNorms | null> {
  return actNormsFor(await loadNorms(db), h, inc.serviceType, at);
}

/** Срок проверки по повторному сообщению в АДС: задача проверит, пришла ли отметка УК. */
export async function scheduleActJob(ctx: JobContext, tx: Tx, input: { incident: IncidentRow; house: HouseRow; userId: number; rereportAt: Date }): Promise<void> {
  if (!ctx.config.features.actTemplate) return;
  const norms = await loadActNorms(tx, input.house, input.incident, input.rereportAt);
  if (!norms) return;
  await sendActJob(ctx.queue, { incidentId: input.incident.id, userId: input.userId }, checkDueAt({ adsRereportAt: input.rereportAt }, norms), tx);
}

async function sendActJob(queue: JobQueue, job: ActJob, at: Date, tx: TxLike): Promise<void> {
  await queue.send(QUEUES.act, job, { startAfter: at, tx });
}

async function participantsOf(db: Reader, incidentId: number): Promise<ParticipantRow[]> {
  return db.select().from(incidentParticipant).where(eq(incidentParticipant.incidentId, incidentId));
}

/** Сообщение S09 в личку по текущему состоянию. */
function offerMessage(ctx: JobContext, inc: IncidentRow, h: HouseRow, norms: ActNorms, info: ActInfo) {
  return renderActOffer(
    {
      incidentPublicId: inc.publicId,
      checkVisitMs: norms.visitMs,
      visitBasis: { doc: norms.visit.basisDoc, point: norms.visit.basisPoint },
      persons: norms.persons,
      actBasis: { doc: norms.act.basisDoc, point: norms.act.basisPoint },
      readyCount: info.readyCount,
      myReady: info.myReady,
      introOptIn: info.introOptIn,
      withTemplate: true,
      botUsername: ctx.config.max.botUsername,
      isModel: h.isModel,
    },
    ctx.i18n,
  );
}

async function dialogActive(db: Reader, userIds: readonly number[]): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const rows = await db.select({ id: maxUser.id, active: maxUser.dialogActive }).from(maxUser).where(inArray(maxUser.id, [...userIds]));
  return new Set(rows.filter((r) => r.active).map((r) => r.id));
}

/**
 * Задача act-tick: срок проверки после повторного сообщения в АДС истёк, отметки УК нет — житель
 * получает в личку предложение акта. Раньше срока — ставит себя заново.
 */
export async function actTimerJob(ctx: JobContext, data: ActJob): Promise<'offered' | 'waiting' | 'skipped'> {
  if (!ctx.config.features.actTemplate) return 'skipped';
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, data.incidentId));
    if (inc?.status !== 'checking' && inc?.status !== 'discrepancy') return 'skipped';
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    if (!h) return 'skipped';
    const participants = await participantsOf(tx, inc.id);
    const p = participants.find((x) => x.userId === data.userId);
    if (!p || !awaitingCheck(inc, p)) return 'skipped';
    const norms = await loadActNorms(tx, h, inc, now);
    if (!norms) return 'skipped';
    const due = checkDueAt(p, norms);
    if (due.getTime() > now.getTime()) {
      await sendActJob(ctx.queue, data, due, tx);
      return 'waiting';
    }
    if (!(await dialogActive(tx, [data.userId])).has(data.userId)) return 'skipped';
    const info = actInfo(inc, participants, data.userId, norms, now);
    if (!info?.available) return 'skipped';
    await enqueueOutbound(tx, ctx.queue, {
      kind: 'dm',
      idempotencyKey: `act_offer:${inc.id}:${data.userId}:${p.adsRereportAt.getTime()}`,
      target: { userId: data.userId },
      message: offerMessage(ctx, inc, h, norms, info),
      incidentId: inc.id,
    });
    return 'offered';
  });
}

export type ActReadyResult = { status: 'saved'; info: ActInfo; introduced: number } | { status: 'not_participant' } | { status: 'not_available' };

/**
 * «Я готов подписать» (ready) и «Познакомить с соседями» (introOptIn). Отказ от готовности снимает
 * и согласие на знакомство. Первое согласие на знакомство при других согласившихся: бот шлёт
 * в личку упоминания профилей MAX — новому участнику всех, остальным — нового.
 */
export async function setActReady(
  ctx: JobContext,
  input: { incidentId: number; userId: number; ready: boolean; introOptIn?: boolean; source: EventSource; nextStepDm?: boolean },
): Promise<ActReadyResult> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, input.incidentId)).for('update');
    if (!inc) return { status: 'not_available' };
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    if (!h) return { status: 'not_available' };
    const participants = await participantsOf(tx, inc.id);
    const p = participants.find((x) => x.userId === input.userId && x.affected);
    if (!p) return { status: 'not_participant' };
    const norms = ctx.config.features.actTemplate ? await loadActNorms(tx, h, inc, now) : null;
    if (!actInfo(inc, participants, input.userId, norms, now)?.available) return { status: 'not_available' };

    const consent = input.ready ? (input.introOptIn ?? p.shareContactConsent) : false;
    await tx.update(incidentParticipant).set({ readyToSign: input.ready, shareContactConsent: consent }).where(eq(incidentParticipant.id, p.id));
    await tx.insert(incidentEvent).values({
      incidentId: inc.id,
      type: 'act_ready',
      actorType: 'resident',
      actorId: input.userId,
      source: input.source,
      payload: { ready: input.ready, introOptIn: consent },
      occurredAt: now,
    });
    const updated = participants.map((x) => (x.id === p.id ? { ...x, readyToSign: input.ready, shareContactConsent: consent } : x));

    let introduced = 0;
    if (consent && !p.shareContactConsent) {
      const others = updated
        .flatMap((x) => (x.id !== p.id && x.affected && x.readyToSign && x.shareContactConsent && x.userId !== null ? [x.userId] : []))
        .slice(0, PARAMS.actIntroMax);
      const reachable = await dialogActive(tx, [input.userId, ...others]);
      if (others.length > 0 && reachable.has(input.userId)) {
        await enqueueOutbound(tx, ctx.queue, {
          kind: 'dm',
          idempotencyKey: `act_intro:${inc.id}:${input.userId}:all`,
          target: { userId: input.userId },
          message: renderActIntro({ neighbours: others, isModel: h.isModel }, ctx.i18n),
          incidentId: inc.id,
        });
      }
      for (const other of others.filter((id) => reachable.has(id))) {
        await enqueueOutbound(tx, ctx.queue, {
          kind: 'dm',
          idempotencyKey: `act_intro:${inc.id}:${other}:${input.userId}`,
          target: { userId: other },
          message: renderActIntro({ neighbours: [input.userId], isModel: h.isModel }, ctx.i18n),
          incidentId: inc.id,
        });
      }
      introduced = others.length;
    }

    const info = actInfo(inc, updated, input.userId, norms, now);
    if (!info || !norms) return { status: 'not_available' };
    // В личке следующий шаг — новым сообщением: после «Я готов подписать» — вопрос о знакомстве.
    if (input.nextStepDm && input.ready && !consent) {
      await enqueueOutbound(tx, ctx.queue, {
        kind: 'dm',
        idempotencyKey: `act_step:${inc.id}:${input.userId}:${now.getTime()}`,
        target: { userId: input.userId },
        message: offerMessage(ctx, inc, h, norms, info),
        incidentId: inc.id,
      });
    }
    return { status: 'saved', info, introduced };
  });
}
