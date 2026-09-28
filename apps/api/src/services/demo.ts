/**
 * Демо-инструменты для проверяющих: роль сотрудника «УК Модельная» по демо-коду, пять модельных
 * соседей в текущую аварию, сдвиг начала аварии на 6 ч назад, сброс демо-данных дома.
 * Работают только при DEMO_MODE и в модельных домах (проверяет маршрут). Модельные данные помечены
 * is_model (и model в событиях) и в метрики не входят; каждое действие пишется в audit_log.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  computeDeadlines,
  flatLocation,
  isOpenStatus,
  OPEN_STATUSES,
  spreadFlats,
  type DeadlinePlan,
  type EventSource,
  type IncidentEventType,
} from '@vsemdomom/core';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { cardLater } from '../chat/card.ts';
import { panelLater } from '../chat/panel.ts';
import { PARAMS } from '../config/params.ts';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import type { HouseRow } from '../db/queries.ts';
import { deadline, house, incident, incidentEvent, incidentParticipant, managementCompany, maxUser, poll, residency, staff } from '../db/schema.ts';
import { modelUserId, reseedHouseHistory } from '../db/seed.ts';
import type { JobContext } from '../jobs/context.ts';
import { audit, staffActor, userActor } from './audit.ts';
import { breachDeadline, scheduleDeadlineJobs } from './deadline-timers.ts';
import { scheduleDemoAnswers } from './demo-answers.ts';
import { removeIncidents } from './incident-removal.ts';

type Reader = Pick<Executor, 'select'>;
type IncidentRow = typeof incident.$inferSelect;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Демо-код сравнивается за постоянное время: хеши выравнивают длину. */
export function demoCodeMatches(input: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(input), digest(expected));
}

/**
 * Роль сотрудника модельной УК с пометкой «Демо-роль». Если пользователь уже сотрудник этой УК,
 * его роль не меняется: настоящая роль не должна стать демо (её снимает /delete).
 */
export async function grantDemoRole(ctx: JobContext, userId: number): Promise<boolean> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [uk] = await tx.select({ id: managementCompany.id }).from(managementCompany).where(eq(managementCompany.isModel, true)).orderBy(asc(managementCompany.id)).limit(1);
    if (!uk) return false;
    await tx.insert(maxUser).values({ id: userId }).onConflictDoNothing();
    await tx.insert(staff).values({ userId, ukId: uk.id, role: 'curator', isDemo: true }).onConflictDoNothing();
    await audit(tx, { actor: userActor(userId), action: 'demo_uk_role', entity: 'user', entityId: String(userId), at: now });
    return true;
  });
}

/** Текущая авария дома для демо-инструментов: последняя открытая, кроме «только в квартире». */
export async function activeDemoIncident(db: Reader, houseId: number): Promise<IncidentRow | null> {
  const [row] = await db
    .select()
    .from(incident)
    .where(and(eq(incident.houseId, houseId), inArray(incident.status, [...OPEN_STATUSES]), ne(incident.scope, 'flat')))
    .orderBy(desc(incident.createdAt))
    .limit(1);
  return row ?? null;
}

/** Модельный житель квартиры: та же схема ID, что у истории в сидах (отрицательные, не пересекаются с MAX). */
function neighbourUserId(h: HouseRow, flatNo: number): number {
  const id = modelUserId(h.label, flatNo);
  return Number.isSafeInteger(id) ? id : modelUserId(String(h.id), flatNo);
}

export type NeighboursResult = { status: 'added'; incident: IncidentRow; added: number } | { status: 'no_active_incident' };

/**
 * Пять модельных соседей в текущую аварию: уровень доверия 1, разные подъезды и этажи, без уведомлений.
 * Повторный вызов добавляет только недостающих. Во время проверки они ответят «Да» через задержку.
 */
export async function addDemoNeighbours(ctx: JobContext, input: { house: HouseRow; staffUserId: number; source: EventSource }): Promise<NeighboursResult> {
  const h = input.house;
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const active = await activeDemoIncident(tx, h.id);
    if (!active) return { status: 'no_active_incident' };
    const [inc] = await tx.select().from(incident).where(eq(incident.id, active.id)).for('update');
    if (!inc || !isOpenStatus(inc.status)) return { status: 'no_active_incident' };

    const present = await tx
      .select({ isModel: incidentParticipant.isModel, flatNo: residency.flatNo })
      .from(incidentParticipant)
      .leftJoin(residency, eq(residency.id, incidentParticipant.residencyId))
      .where(eq(incidentParticipant.incidentId, inc.id));
    const need = Math.max(0, PARAMS.demoNeighbours - present.filter((p) => p.isModel).length);
    const flats = spreadFlats(h, need, new Set(present.flatMap((p) => (p.flatNo === null ? [] : [p.flatNo]))));

    const events: { type: IncidentEventType; actorType: 'resident' | 'uk'; actorId: number; source: EventSource; payload: Record<string, unknown> }[] = [];
    for (const flatNo of flats) {
      const userId = neighbourUserId(h, flatNo);
      const loc = flatLocation(h, flatNo);
      await tx
        .insert(maxUser)
        .values({ id: userId, consentVersion: PARAMS.consentVersion, consentAt: now, notifyDefault: false, isModel: true })
        .onConflictDoNothing();
      const [res] = await tx
        .insert(residency)
        .values({ userId, houseId: h.id, flatNo, role: 'owner', trustLevel: 1, reviewStatus: 'confirmed', source: 'chat', isModel: true })
        .onConflictDoUpdate({ target: [residency.userId, residency.houseId], set: { flatNo, trustLevel: 1, updatedAt: now } })
        .returning({ id: residency.id });
      const joined = await tx
        .insert(incidentParticipant)
        .values({
          incidentId: inc.id,
          userId,
          residencyId: res?.id ?? null,
          entrance: loc?.entrance ?? null,
          floor: loc?.floor ?? null,
          trustLevelAtJoin: 1,
          notify: false,
          joinedAt: now,
          isModel: true,
        })
        .onConflictDoNothing()
        .returning({ id: incidentParticipant.id });
      if (joined.length > 0) events.push({ type: 'joined', actorType: 'resident', actorId: userId, source: 'system', payload: { entrance: loc?.entrance ?? null, model: true } });
    }
    const added = events.length;
    if (added > 0) {
      events.push({ type: 'demo_neighbours_added', actorType: 'uk', actorId: input.staffUserId, source: input.source, payload: { added, model: true } });
      await tx.insert(incidentEvent).values(events.map((e) => ({ ...e, incidentId: inc.id, occurredAt: now })));
      await cardLater(ctx.queue, inc.id, tx);
      // Вопрос о восстановлении уже задан — ответят через задержку после добавления.
      if (inc.checkStartedAt && (inc.status === 'checking' || inc.status === 'discrepancy')) {
        await scheduleDemoAnswers(ctx, tx, { incidentId: inc.id, house: h, checkStartedAt: inc.checkStartedAt, from: now });
      }
    }
    await audit(tx, { actor: staffActor(input.staffUserId), action: 'demo_neighbours', entity: 'incident', entityId: inc.publicId, at: now });
    return { status: 'added', incident: inc, added };
  });
}

export type TimeShiftResult = { status: 'shifted'; incident: IncidentRow } | { status: 'not_open'; mergedInto: string | null } | { status: 'not_found' };

/**
 * Начало аварии — на PARAMS.demoTimeShiftHours назад. Сроки от начала аварии (устранение, допустимый
 * перерыв) пересчитываются по справочнику: наступившие истекают сразу, остальные получают новые задачи;
 * отмеченное УК позже пересчитанного срока становится истёкшим. Сроки от сообщения не меняются.
 * Итог и месячные суммы считаются от начала аварии при каждом запросе.
 */
export async function shiftIncidentStart(ctx: JobContext, input: { incidentId: number; staffUserId: number; source: EventSource }): Promise<TimeShiftResult> {
  const now = ctx.clock.now();
  const norms = await loadNorms(ctx.db);
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, input.incidentId)).for('update');
    if (!inc) return { status: 'not_found' };
    if (!isOpenStatus(inc.status)) {
      const [into] = inc.mergedIntoId ? await tx.select({ publicId: incident.publicId }).from(incident).where(eq(incident.id, inc.mergedIntoId)) : [];
      return { status: 'not_open', mergedInto: into?.publicId ?? null };
    }
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    if (!h) return { status: 'not_found' };
    const startedAt = new Date(inc.startedAt.getTime() - PARAMS.demoTimeShiftHours * MS_PER_HOUR);
    await tx.update(incident).set({ startedAt, version: inc.version + 1 }).where(eq(incident.id, inc.id));
    await tx.insert(incidentEvent).values({
      incidentId: inc.id,
      type: 'demo_time_shift',
      actorType: 'uk',
      actorId: input.staffUserId,
      source: input.source,
      payload: { hours: PARAMS.demoTimeShiftHours, from: inc.startedAt.toISOString(), to: startedAt.toISOString(), model: true },
      occurredAt: now,
    });

    const plans: DeadlinePlan[] = computeDeadlines(
      { serviceType: inc.serviceType, startedAt, createdAt: inc.createdAt, adsRegAt: inc.adsRegAt },
      norms,
      { regionCode: h.regionCode, timezone: h.timezone, powerSources: h.powerSources, hotWaterDeadEnd: h.hotWaterDeadEnd },
      { warnBeforeMs: PARAMS.deadlineWarnMin * MS_PER_MINUTE },
    ).filter((p) => p.anchor === 'started');
    const rows = plans.length > 0 ? await tx.select().from(deadline).where(and(eq(deadline.incidentId, inc.id), inArray(deadline.kind, plans.map((p) => p.kind)))) : [];
    for (const d of rows) {
      const plan = plans.find((p) => p.kind === d.kind);
      if (!plan) continue;
      const moved = { ...d, dueAt: plan.dueAt, warnAt: plan.warnAt };
      await tx
        .update(deadline)
        .set({ dueAt: plan.dueAt, warnAt: plan.warnAt, ...(d.status === 'breached' ? { resolvedAt: plan.dueAt } : {}) })
        .where(eq(deadline.id, d.id));
      const lateMet = d.status === 'met' && d.resolvedAt !== null && d.resolvedAt.getTime() > plan.dueAt.getTime();
      const duePending = d.status === 'pending' && plan.dueAt.getTime() <= now.getTime();
      if (lateMet || duePending) await breachDeadline(ctx, tx, moved, now);
      else if (d.status === 'pending') await scheduleDeadlineJobs(ctx.queue, [moved], now, tx);
    }
    await cardLater(ctx.queue, inc.id, tx);
    await panelLater(ctx.queue, h.id, tx);
    await audit(tx, { actor: staffActor(input.staffUserId), action: 'demo_time_shift', entity: 'incident', entityId: inc.publicId, at: now });
    const [saved] = await tx.select().from(incident).where(eq(incident.id, inc.id));
    return saved ? { status: 'shifted', incident: saved } : { status: 'not_found' };
  });
}

/**
 * Сброс демо-данных дома: аварии, созданные при проверке (с отметками, хронологией, сроками,
 * карточками), удаляются, неотправленные сообщения по ним отменяются, история дома пересоздаётся
 * в текущем месяце, как после сидов. Проживания, роли и сообщения, уже отправленные в чат, остаются.
 */
export async function resetDemoHouse(ctx: JobContext, input: { house: HouseRow; staffUserId: number; seedsDir: string }): Promise<{ removedIncidents: number; history: number }> {
  const h = input.house;
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.select({ id: incident.id }).from(incident).where(and(eq(incident.houseId, h.id), eq(incident.isModel, false)));
    const ids = rows.map((r) => r.id);
    await removeIncidents(tx, ids);
    // Опросы дома тоже демо-данные: «Тепло ли у вас?» после сброса можно запустить снова.
    await tx.delete(poll).where(eq(poll.houseId, h.id));
    const history = await reseedHouseHistory(tx, { seedsDir: input.seedsDir, house: h, now, log: ctx.log });
    await panelLater(ctx.queue, h.id, tx);
    await audit(tx, { actor: staffActor(input.staffUserId), action: 'demo_reset', entity: 'house', entityId: h.publicId, at: now });
    return { removedIncidents: ids.length, history };
  });
}
