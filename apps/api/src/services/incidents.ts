/**
 * Авария: создание (F01) с защитой от дублей, отметки «У меня тоже» / «Не у меня» (F02, F03),
 * регистрация в АДС с пересчётом сроков (F04). Общий код для бота и REST.
 * Изменения данных и постановка задач (карточка, панель) — в одной транзакции.
 */
import {
  computeDeadlines,
  flatLocation,
  isEntranceInRange,
  isFloorInRange,
  OPEN_STATUSES,
  type DeadlinePlan,
  type EventSource,
  type IncidentScope,
  type NormRecord,
  type ServiceType,
  type StartedPreset,
  type TrustLevel,
} from '@vsemdomom/core';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { cardLater, renderCardFor } from '../chat/card.ts';
import { panelLater } from '../chat/panel.ts';
import { PARAMS } from '../config/params.ts';
import { isUniqueViolation, type Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import { chatCard, deadline, house, houseChat, incident, incidentEvent, incidentParticipant, maxUser, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES } from '../jobs/queue.ts';
import { newPublicId } from '../util/ids.ts';

export type IncidentRow = typeof incident.$inferSelect;
type HouseRow = typeof house.$inferSelect;
type ResidencyRow = typeof residency.$inferSelect;

const MS_PER_MINUTE = 60_000;

/** Статусы, в которых житель ещё может отметиться «у меня тоже». */
export const JOINABLE_STATUSES = OPEN_STATUSES;

/** Статусы до «Устранено»: номер заявки АДС пересчитывает сроки. */
const BEFORE_RESOLVE = ['open', 'accepted', 'brigade_on_site', 'localized'] as const;

function houseContext(h: HouseRow) {
  return { regionCode: h.regionCode, timezone: h.timezone, powerSources: h.powerSources, hotWaterDeadEnd: h.hotWaterDeadEnd };
}

export async function incidentByPublicId(db: Pick<Executor, 'select'>, publicId: string): Promise<IncidentRow | null> {
  const [row] = await db.select().from(incident).where(eq(incident.publicId, publicId));
  return row ?? null;
}

/** Открытая авария вида X в доме (не уровня «квартира»). */
export async function openIncidentOf(db: Pick<Executor, 'select'>, houseId: number, service: ServiceType): Promise<IncidentRow | null> {
  const [row] = await db
    .select()
    .from(incident)
    .where(and(eq(incident.houseId, houseId), eq(incident.serviceType, service), inArray(incident.status, [...OPEN_STATUSES]), ne(incident.scope, 'flat')));
  return row ?? null;
}

/**
 * Подъезд и этаж участника. В чате у зарегистрированного — по квартире; в мини-приложении
 * выбранные в форме подъезд и этаж важнее (preferExplicit).
 */
function locate(
  h: HouseRow,
  res: ResidencyRow | null,
  pick: { entrance: number | null; floor?: number | null; preferExplicit?: boolean },
): { entrance: number | null; floor: number | null } {
  const byFlat = res ? flatLocation(h, res.flatNo) : null;
  const entrance = pick.entrance !== null && isEntranceInRange(h, pick.entrance) ? pick.entrance : null;
  const floor = pick.floor !== undefined && pick.floor !== null && isFloorInRange(h, pick.floor) ? pick.floor : null;
  if (pick.preferExplicit && entrance !== null) {
    return { entrance, floor: floor ?? (byFlat?.entrance === entrance ? byFlat.floor : null) };
  }
  if (byFlat) return byFlat;
  return { entrance, floor };
}

function deadlineRows(incidentId: number, plans: DeadlinePlan[]) {
  return plans.map((p) => ({ incidentId, normId: p.norm.id, kind: p.kind, dueAt: p.dueAt, warnAt: p.warnAt, status: 'pending' as const }));
}

export interface CreateIncidentInput {
  house: HouseRow;
  service: ServiceType;
  scope: IncidentScope;
  /** Подъезд и этаж из формы; null — по квартире автора. */
  entrance: number | null;
  floor?: number | null;
  startedAt: Date;
  startedSource: StartedPreset;
  reporter: { userId: number; residency: ResidencyRow | null };
  source: EventSource;
}

export type CreateIncidentResult = { status: 'created'; incident: IncidentRow } | { status: 'duplicate'; incident: IncidentRow };

/**
 * Новая авария. Уже открыта авария того же вида (не «квартира») — дубль: вызывающий
 * присоединяет жителя к ней. Гонку двух запросов ловит частичный уникальный индекс.
 */
export async function createIncident(ctx: JobContext, input: CreateIncidentInput): Promise<CreateIncidentResult> {
  const { house: h } = input;
  if (input.scope !== 'flat') {
    const existing = await openIncidentOf(ctx.db, h.id, input.service);
    if (existing) return { status: 'duplicate', incident: existing };
  }
  const norms: NormRecord[] = await loadNorms(ctx.db);
  const now = ctx.clock.now();
  const loc = locate(h, input.reporter.residency, { entrance: input.entrance, floor: input.floor ?? null, preferExplicit: true });
  try {
    const created = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(incident)
        .values({
          publicId: newPublicId(),
          houseId: h.id,
          serviceType: input.service,
          scope: input.scope,
          entrance: input.scope === 'entrance' ? loc.entrance : null,
          status: 'open',
          startedAt: input.startedAt,
          startedSource: input.startedSource,
          createdAt: now,
          createdBy: input.reporter.userId,
          isSandbox: h.isSandbox,
        })
        .returning();
      if (!row) throw new Error('авария не создана');
      await tx.insert(incidentParticipant).values({
        incidentId: row.id,
        userId: input.reporter.userId,
        residencyId: input.reporter.residency?.id ?? null,
        entrance: loc.entrance,
        floor: loc.floor,
        trustLevelAtJoin: input.reporter.residency?.trustLevel ?? 0,
        joinedAt: now,
      });
      await tx.insert(incidentEvent).values({
        incidentId: row.id,
        type: 'reported',
        actorType: 'resident',
        actorId: input.reporter.userId,
        source: input.source,
        payload: { service: input.service, scope: input.scope, entrance: loc.entrance, startedSource: input.startedSource },
        occurredAt: now,
      });
      const plans = computeDeadlines(
        { serviceType: input.service, startedAt: input.startedAt, createdAt: now, adsRegAt: null },
        norms,
        houseContext(h),
        { warnBeforeMs: PARAMS.deadlineWarnMin * MS_PER_MINUTE },
      );
      if (plans.length > 0) await tx.insert(deadline).values(deadlineRows(row.id, plans));

      // Карточка в чат дома: не для «только квартира» и не для песочницы.
      const [chat] = input.scope === 'flat' || h.isSandbox ? [] : await tx.select().from(houseChat).where(eq(houseChat.houseId, h.id));
      if (chat) {
        const message = await renderCardFor(tx, ctx, row.id);
        if (message) {
          await tx.insert(chatCard).values({ incidentId: row.id, chatId: chat.chatId, renderHash: message.hash });
          await enqueueOutbound(tx, ctx.queue, {
            kind: 'card_create',
            idempotencyKey: `card:create:${row.id}`,
            target: { chatId: chat.chatId },
            message: message.message,
            incidentId: row.id,
            afterSend: { type: 'card', incidentId: row.id },
          });
        }
        await panelLater(ctx.queue, h.id, tx);
      }
      return row;
    });
    return { status: 'created', incident: created };
  } catch (err) {
    if (isUniqueViolation(err, 'incident_active_house_service')) {
      const existing = await openIncidentOf(ctx.db, h.id, input.service);
      if (existing) return { status: 'duplicate', incident: existing };
    }
    throw err;
  }
}

export interface JoinInput {
  incident: IncidentRow;
  userId: number;
  /** Нажатый подъезд; null — «Не знаю подъезд». */
  entrance: number | null;
  floor?: number | null;
  /** Мини-приложение: выбранные подъезд и этаж важнее вычисленных по квартире. */
  preferExplicit?: boolean;
  source: EventSource;
  /** Нажатие пришло из чата этого дома — членство в чате подтверждено (уровень 1). */
  fromHouseChat: boolean;
}

export interface JoinResult {
  result: 'joined' | 'already_joined' | 'updated';
  entrance: number | null;
  registered: boolean;
  dialogActive: boolean;
}

/** «У меня тоже»: повторное нажатие счётчики не меняет; подъезд можно уточнить. */
export async function joinIncident(ctx: JobContext, input: JoinInput): Promise<JoinResult> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [h] = await tx.select().from(house).where(eq(house.id, input.incident.houseId));
    if (!h) throw new Error('дом аварии не найден');
    const [res] = await tx.select().from(residency).where(and(eq(residency.userId, input.userId), eq(residency.houseId, h.id)));
    let trust: TrustLevel = res?.trustLevel ?? 0;
    if (res && input.fromHouseChat && trust === 0) {
      // Нажал кнопку в чате дома — значит, состоит в чате.
      await tx
        .update(residency)
        .set({ trustLevel: 1, membershipCheckedAt: now, updatedAt: now })
        .where(and(eq(residency.id, res.id), eq(residency.trustLevel, 0)));
      trust = 1;
    }
    const loc = locate(h, res ?? null, { entrance: input.entrance, floor: input.floor ?? null, preferExplicit: input.preferExplicit ?? false });
    const [user] = await tx.select({ dialogActive: maxUser.dialogActive }).from(maxUser).where(eq(maxUser.id, input.userId));
    const base = { registered: Boolean(res), dialogActive: user?.dialogActive ?? false };

    const [existing] = await tx
      .select()
      .from(incidentParticipant)
      .where(and(eq(incidentParticipant.incidentId, input.incident.id), eq(incidentParticipant.userId, input.userId)))
      .for('update');
    let result: JoinResult['result'];
    if (!existing) {
      const inserted = await tx
        .insert(incidentParticipant)
        .values({
          incidentId: input.incident.id,
          userId: input.userId,
          residencyId: res?.id ?? null,
          entrance: loc.entrance,
          floor: loc.floor,
          trustLevelAtJoin: trust,
          joinedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: incidentParticipant.id });
      // Параллельное нажатие того же жителя уже записало участие.
      if (inserted.length === 0) return { ...base, result: 'already_joined', entrance: loc.entrance };
      result = 'joined';
    } else if (!existing.affected) {
      await tx
        .update(incidentParticipant)
        .set({ affected: true, entrance: loc.entrance ?? existing.entrance, floor: loc.floor ?? existing.floor, residencyId: res?.id ?? existing.residencyId })
        .where(eq(incidentParticipant.id, existing.id));
      result = 'joined';
    } else if (
      loc.entrance !== null &&
      (existing.entrance === null || (input.preferExplicit === true && (existing.entrance !== loc.entrance || (loc.floor !== null && existing.floor !== loc.floor))))
    ) {
      await tx.update(incidentParticipant).set({ entrance: loc.entrance, floor: loc.floor }).where(eq(incidentParticipant.id, existing.id));
      result = 'updated';
    } else {
      return { ...base, result: 'already_joined', entrance: existing.entrance };
    }
    await tx.insert(incidentEvent).values({
      incidentId: input.incident.id,
      type: 'joined',
      actorType: 'resident',
      actorId: input.userId,
      source: input.source,
      payload: { entrance: loc.entrance, update: result === 'updated' },
      occurredAt: now,
    });
    await cardLater(ctx.queue, input.incident.id, tx);
    return { ...base, result, entrance: loc.entrance ?? existing?.entrance ?? null };
  });
}

/** «Не у меня»: отметка снимается (или записывается «не затронут»); событие left — только если отмечался. */
export async function markNotAffected(ctx: JobContext, input: { incident: IncidentRow; userId: number; source: EventSource }): Promise<'left' | 'noted' | 'already'> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(incidentParticipant)
      .where(and(eq(incidentParticipant.incidentId, input.incident.id), eq(incidentParticipant.userId, input.userId)))
      .for('update');
    if (existing && !existing.affected) return 'already';
    if (existing) {
      await tx.update(incidentParticipant).set({ affected: false }).where(eq(incidentParticipant.id, existing.id));
      await tx.insert(incidentEvent).values({
        incidentId: input.incident.id,
        type: 'left',
        actorType: 'resident',
        actorId: input.userId,
        source: input.source,
        occurredAt: now,
      });
      await cardLater(ctx.queue, input.incident.id, tx);
      return 'left';
    }
    const [res] = await tx.select().from(residency).where(and(eq(residency.userId, input.userId), eq(residency.houseId, input.incident.houseId)));
    const [h] = await tx.select().from(house).where(eq(house.id, input.incident.houseId));
    const loc = h ? locate(h, res ?? null, { entrance: null }) : { entrance: null, floor: null };
    await tx
      .insert(incidentParticipant)
      .values({
        incidentId: input.incident.id,
        userId: input.userId,
        residencyId: res?.id ?? null,
        entrance: loc.entrance,
        floor: loc.floor,
        trustLevelAtJoin: res?.trustLevel ?? 0,
        affected: false,
        joinedAt: now,
      })
      .onConflictDoNothing();
    return 'noted';
  });
}

export type AdsResult = 'registered' | 'noted' | 'too_late';

/**
 * Номер заявки АДС (номер не является ПДн). Первая регистрация переносит точку отсчёта
 * сроков ответа и локализации на время регистрации; следующие — только событие в хронологии.
 */
export async function registerAds(
  ctx: JobContext,
  input: { incident: IncidentRow; userId: number; number: string; registeredAt: Date; source: EventSource },
): Promise<AdsResult> {
  if (!(BEFORE_RESOLVE as readonly string[]).includes(input.incident.status)) return 'too_late';
  const norms = await loadNorms(ctx.db);
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [current] = await tx.select().from(incident).where(eq(incident.id, input.incident.id)).for('update');
    if (!current) throw new Error('авария не найдена');
    const first = current.adsRegNumber === null;
    if (first) {
      await tx
        .update(incident)
        .set({ adsRegNumber: input.number, adsRegAt: input.registeredAt, version: current.version + 1 })
        .where(eq(incident.id, current.id));
      const [h] = await tx.select().from(house).where(eq(house.id, current.houseId));
      if (h) {
        const plans = computeDeadlines(
          { serviceType: current.serviceType, startedAt: current.startedAt, createdAt: current.createdAt, adsRegAt: input.registeredAt },
          norms,
          houseContext(h),
          { warnBeforeMs: PARAMS.deadlineWarnMin * MS_PER_MINUTE },
        );
        // Пересчитываются только невыполненные сроки, отсчитанные от сообщения.
        for (const p of plans.filter((plan) => plan.anchor === 'ads_registration')) {
          await tx
            .update(deadline)
            .set({ dueAt: p.dueAt, warnAt: p.warnAt })
            .where(and(eq(deadline.incidentId, current.id), eq(deadline.kind, p.kind), eq(deadline.status, 'pending')));
        }
      }
    }
    await tx.insert(incidentEvent).values({
      incidentId: current.id,
      type: 'ads_registered',
      actorType: 'resident',
      actorId: input.userId,
      source: input.source,
      payload: { number: input.number, registeredAt: input.registeredAt.toISOString(), first },
      occurredAt: now,
    });
    await cardLater(ctx.queue, current.id, tx);
    return first ? 'registered' : 'noted';
  });
}

/** «Не дозвонился»: событие в хронологии и одно напоминание через 30 минут. */
export async function adsNotReached(ctx: JobContext, input: { incident: IncidentRow; userId: number; source: EventSource }): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await tx.insert(incidentEvent).values({
      incidentId: input.incident.id,
      type: 'ads_not_reached',
      actorType: 'resident',
      actorId: input.userId,
      source: input.source,
      occurredAt: ctx.clock.now(),
    });
    await scheduleAdsReminder(ctx, input.incident.id, input.userId, tx);
  });
}

/** Одно напоминание ввести номер заявки: повторная постановка ничего не добавит (ключ сообщения). */
export async function scheduleAdsReminder(ctx: JobContext, incidentId: number, userId: number, tx?: Parameters<typeof cardLater>[2]): Promise<void> {
  const startAfter = new Date(ctx.clock.now().getTime() + PARAMS.adsReminderMin * MS_PER_MINUTE);
  await ctx.queue.send(QUEUES.adsReminder, { incidentId, userId }, { startAfter, ...(tx ? { tx } : {}) });
}
