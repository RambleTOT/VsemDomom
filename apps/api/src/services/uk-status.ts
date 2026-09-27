/**
 * Действия УК (F05): статус и ориентир, объединение дублей. Переход и его эффекты задаёт машина
 * состояний ядра; здесь они исполняются в одной транзакции: запись аварии (версия +1), события
 * хронологии, сроки, вопрос C03 и задачи (правка карточки, уведомления, панель).
 * Ответ API не ждёт MAX: всё, что касается чата, уходит в очередь.
 */
import {
  breachFlag,
  isOpenStatus,
  renderCheckQuestion,
  resolveDeadlineAt,
  transition,
  type DeadlineKind,
  type EventSource,
  type IncidentCommand,
  type IncidentEventType,
} from '@vsemdomom/core';
import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { cardLater } from '../chat/card.ts';
import { messageHash, panelLater } from '../chat/panel.ts';
import type { Executor } from '../db/client.ts';
import { chatCard, deadline, house, incident, incidentEvent, incidentParticipant } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import type { TxLike } from '../jobs/queue.ts';
import { ServiceError } from './errors.ts';
import { notifyLater } from './notify.ts';

type Tx = Executor & TxLike;
type IncidentRow = typeof incident.$inferSelect;

export type UkStatusTarget = 'accepted' | 'brigade_on_site' | 'localized' | 'resolved';

const MS_PER_SECOND = 1000;
/** Допуск на расхождение часов: ориентир «сейчас» с клиента не считается прошлым. */
const ETA_SKEW_MS = 60 * MS_PER_SECOND;

export interface UkStatusInput {
  incidentId: number;
  staffUserId: number;
  status: UkStatusTarget;
  eta: Date | null;
  /** If-Match; null — последнее изменение выигрывает. */
  expectedVersion: number | null;
  source: EventSource;
}

function command(input: UkStatusInput, sandbox: boolean): IncidentCommand {
  const eta = input.eta ?? undefined;
  switch (input.status) {
    case 'accepted':
      if (!input.eta) throw new ServiceError('eta_required', 'Для «Принято» нужен ориентир');
      return { type: 'accept', eta: input.eta };
    case 'brigade_on_site':
      return eta ? { type: 'brigade_on_site', eta } : { type: 'brigade_on_site' };
    case 'localized':
      return eta ? { type: 'localize', eta } : { type: 'localize' };
    case 'resolved':
      return { type: 'resolve', sandbox };
  }
}

async function lockIncident(tx: Tx, id: number): Promise<IncidentRow> {
  const [row] = await tx.select().from(incident).where(eq(incident.id, id)).for('update');
  if (!row) throw new ServiceError('not_found', 'Авария не найдена');
  return row;
}

function assertVersion(expected: number | null, current: IncidentRow): void {
  if (expected !== null && expected !== current.version) {
    throw new ServiceError('version_conflict', 'Авария изменилась', { currentVersion: current.version });
  }
}

/** Сроки видов kinds: выполнен, если отмечено до срока, иначе истёк (таймер мог не успеть). */
async function markDeadlines(tx: Tx, inc: IncidentRow, kinds: readonly DeadlineKind[], now: Date, events: EventRow[]): Promise<Partial<IncidentRow>> {
  const rows = await tx
    .select()
    .from(deadline)
    .where(and(eq(deadline.incidentId, inc.id), eq(deadline.status, 'pending'), inArray(deadline.kind, [...kinds])));
  const flags: Partial<IncidentRow> = {};
  for (const d of rows) {
    const status = resolveDeadlineAt(d, now);
    await tx
      .update(deadline)
      .set({ status, resolvedAt: status === 'met' ? now : d.dueAt })
      .where(eq(deadline.id, d.id));
    if (status === 'met') {
      events.push({ type: 'deadline_met', payload: { kind: d.kind } });
    } else {
      events.push({ type: 'deadline_breached', payload: { kind: d.kind, dueAt: d.dueAt.toISOString() } });
      if (breachFlag(d.kind) === 'overdue') flags.overdue = true;
      else flags.singleLimitExceeded = true;
    }
  }
  return flags;
}

interface EventRow {
  type: IncidentEventType;
  payload?: Record<string, unknown>;
  actor?: 'uk' | 'system';
}

/** Вопрос о восстановлении (C03) — второе новое сообщение, если у аварии есть карточка в чате. */
async function postCheckQuestion(tx: Tx, ctx: JobContext, inc: IncidentRow, resolvedAt: Date): Promise<void> {
  const [card] = await tx.select().from(chatCard).where(eq(chatCard.incidentId, inc.id));
  if (!card) return;
  const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
  if (!h) return;
  const message = renderCheckQuestion(
    { incidentPublicId: inc.publicId, service: inc.serviceType, resolvedAt, recheck: false, house: { timezone: h.timezone, isModel: h.isModel }, now: ctx.clock.now() },
    ctx.i18n,
  );
  await tx.update(chatCard).set({ checkRenderHash: messageHash(message) }).where(eq(chatCard.incidentId, inc.id));
  await enqueueOutbound(tx, ctx.queue, {
    kind: 'check_question',
    idempotencyKey: `check:question:${inc.id}`,
    target: { chatId: card.chatId },
    message,
    incidentId: inc.id,
    afterSend: { type: 'check_question', incidentId: inc.id },
  });
}

export async function applyUkStatus(ctx: JobContext, input: UkStatusInput): Promise<IncidentRow> {
  const now = ctx.clock.now();
  if (input.eta && input.eta.getTime() < now.getTime() - ETA_SKEW_MS) throw new ServiceError('eta_in_past', 'Ориентир в прошлом');
  return ctx.db.transaction(async (tx) => {
    const inc = await lockIncident(tx, input.incidentId);
    assertVersion(input.expectedVersion, inc);
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    const result = transition(inc.status, command(input, h?.isSandbox ?? false));
    if (!result.ok) throw new ServiceError('invalid_transition', 'Такой переход недоступен', { from: inc.status, command: result.command });
    const t = result.transition;

    const update: Partial<IncidentRow> = { status: t.to, version: inc.version + 1 };
    if (t.to === 'brigade_on_site') update.brigadeOnSiteAt = now;
    if (t.to === 'localized') update.localizedAt = now;
    if (t.to === 'closed') update.closedAt = now;
    const events: EventRow[] = t.events.map((type) => ({ type, actor: type === 'check_asked' || type === 'closed' ? 'system' : 'uk' }));
    const extra: EventRow[] = [];
    const after: ((tx: Tx) => Promise<void>)[] = [];

    for (const effect of t.effects) {
      switch (effect.type) {
        case 'set_eta':
          update.etaAt = effect.eta;
          break;
        case 'mark_deadlines_met':
          Object.assign(update, await markDeadlines(tx, inc, effect.kinds, now, extra));
          break;
        case 'cancel_pending_deadlines':
          await tx.update(deadline).set({ status: 'cancelled' }).where(and(eq(deadline.incidentId, inc.id), eq(deadline.status, 'pending')));
          break;
        case 'set_resolved_at_uk':
          update.resolvedAtUk = now;
          break;
        case 'start_check':
          update.checkStartedAt = now;
          break;
        case 'post_check_question':
          after.push((x) => postCheckQuestion(x, ctx, inc, now));
          break;
        case 'edit_check_question':
        case 'edit_card':
          after.push((x) => cardLater(ctx.queue, inc.id, x));
          break;
        case 'notify_participants':
          if (t.to === 'accepted' || t.to === 'brigade_on_site' || t.to === 'localized' || t.to === 'checking') {
            const status = t.to;
            after.push((x) => notifyLater(ctx.queue, { incidentId: inc.id, kind: 'status', status, version: inc.version + 1 }, x));
          }
          break;
        case 'set_discrepancy_at':
        case 'instruct_answerer':
        case 'post_result':
        case 'set_discrepancy_unresolved':
        case 'move_participants':
          // Эффекты ответов жителей, итога (A8) и объединения при действиях УК со статусом не возникают.
          break;
      }
    }

    await tx.update(incident).set(update).where(eq(incident.id, inc.id));
    const payloadFor = (type: IncidentEventType): Record<string, unknown> => {
      if (type === 'skipped_steps') return { steps: t.skippedSteps };
      if (type === 'uk_accepted' || type === 'uk_brigade_on_site' || type === 'uk_localized') return input.eta ? { eta: input.eta.toISOString() } : {};
      if (type === 'closed') return { reason: 'sandbox' };
      return {};
    };
    // Хронология показывается новыми сверху: главный шаг УК записывается последним и оказывается первым.
    const all = [...extra.map((e) => ({ ...e, actor: 'system' as const })), ...events.map((e) => ({ ...e, payload: payloadFor(e.type) })).reverse()];
    await tx.insert(incidentEvent).values(
      all.map((e) => ({
        incidentId: inc.id,
        type: e.type,
        actorType: e.actor ?? 'uk',
        actorId: (e.actor ?? 'uk') === 'uk' ? input.staffUserId : null,
        source: (e.actor ?? 'uk') === 'uk' ? input.source : 'system',
        payload: e.payload ?? {},
        occurredAt: now,
      })),
    );
    for (const run of after) await run(tx);
    if (t.to === 'closed') await panelLater(ctx.queue, inc.houseId, tx);
    const [saved] = await tx.select().from(incident).where(eq(incident.id, inc.id));
    if (!saved) throw new ServiceError('not_found', 'Авария не найдена');
    return saved;
  });
}

export interface MergeInput {
  incidentId: number;
  intoPublicId: string;
  staffUserId: number;
  expectedVersion: number | null;
  source: EventSource;
}

/** Объединить дубль с актуальной аварией того же вида в том же доме: участники переносятся. */
export async function mergeIncident(ctx: JobContext, input: MergeInput): Promise<IncidentRow> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const src = await lockIncident(tx, input.incidentId);
    assertVersion(input.expectedVersion, src);
    const [target] = await tx.select().from(incident).where(eq(incident.publicId, input.intoPublicId)).for('update');
    if (!target || target.id === src.id || target.houseId !== src.houseId || target.serviceType !== src.serviceType || !isOpenStatus(target.status)) {
      throw new ServiceError('merge_target_invalid', 'Объединять можно только с открытой аварией того же вида в этом доме');
    }
    const result = transition(src.status, { type: 'merge', intoId: target.publicId });
    if (!result.ok) throw new ServiceError('invalid_transition', 'Такой переход недоступен', { from: src.status, command: 'merge' });

    // Участники переносятся; кто уже отмечен в актуальной аварии — остаётся там.
    const already = await tx.select({ userId: incidentParticipant.userId }).from(incidentParticipant).where(eq(incidentParticipant.incidentId, target.id));
    const taken = already.flatMap((r) => (r.userId === null ? [] : [r.userId]));
    const moved = await tx
      .update(incidentParticipant)
      .set({ incidentId: target.id })
      .where(and(eq(incidentParticipant.incidentId, src.id), taken.length > 0 ? or(isNull(incidentParticipant.userId), notInArray(incidentParticipant.userId, taken)) : undefined))
      .returning({ id: incidentParticipant.id });

    await tx.update(deadline).set({ status: 'cancelled' }).where(and(eq(deadline.incidentId, src.id), eq(deadline.status, 'pending')));
    await tx.update(incident).set({ status: 'merged', mergedIntoId: target.id, version: src.version + 1 }).where(eq(incident.id, src.id));
    await tx.update(incident).set({ version: target.version + 1 }).where(eq(incident.id, target.id));
    await tx.insert(incidentEvent).values([
      { incidentId: src.id, type: 'merged', actorType: 'uk', actorId: input.staffUserId, source: input.source, payload: { into: target.publicId }, occurredAt: now },
      { incidentId: target.id, type: 'merged', actorType: 'uk', actorId: input.staffUserId, source: input.source, payload: { from: src.publicId, moved: moved.length }, occurredAt: now },
    ]);
    await cardLater(ctx.queue, src.id, tx);
    await cardLater(ctx.queue, target.id, tx);
    await panelLater(ctx.queue, src.houseId, tx);
    const [saved] = await tx.select().from(incident).where(eq(incident.id, target.id));
    if (!saved) throw new ServiceError('not_found', 'Авария не найдена');
    return saved;
  });
}
