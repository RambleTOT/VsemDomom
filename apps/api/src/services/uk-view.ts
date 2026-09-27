/**
 * Представления для экранов УК (U01–U03): аварии с сеткой «подъезд × этаж» и действиями,
 * дома с чатом и правами бота, итог месяца. Без имён и контактов жителей — их нет в БД.
 */
import { allowedUkActions, deadlineState, isActualAnswer, isOpenStatus, monthBounds, monthKey, monthOf, nextDeadline, nextUkAction } from '@vsemdomom/core';
import type { IncidentSummary, MonthlySummarySchema, UkHouseSchema, UkIncidentDetailSchema } from '@vsemdomom/shared';
import { and, count, eq, gte, inArray, lt } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppConfig } from '../config/env.ts';
import type { Executor } from '../db/client.ts';
import type { HouseChatRow, HouseRow } from '../db/queries.ts';
import { incident, incidentEvent, residency } from '../db/schema.ts';
import { incidentDetail, type IncidentBundle, type IncidentViewer } from './incident-view.ts';
import { monthSummary } from './month.ts';
import { chatInfo } from './views.ts';

type Reader = Pick<Executor, 'select'>;
export type UkIncidentDetail = z.infer<typeof UkIncidentDetailSchema>;
type UkHouse = z.infer<typeof UkHouseSchema>;
type MonthlySummary = z.infer<typeof MonthlySummarySchema>;

const MS_PER_MINUTE = 60_000;

/** Порядок в списке УК: срок истёк → срок подходит → новые (не приняты) → остальные. */
export function urgency(b: IncidentBundle, now: Date): number {
  const inc = b.incident;
  if (!isOpenStatus(inc.status)) return 4;
  const states = b.deadlines.filter((d) => d.kind !== 'single_limit').map((d) => deadlineState(d, now));
  if (inc.overdue || states.includes('breached')) return 0;
  if (states.includes('soon')) return 1;
  if (inc.status === 'open') return 2;
  return 3;
}

export function isExpired(b: IncidentBundle, now: Date): boolean {
  return isOpenStatus(b.incident.status) && urgency(b, now) === 0;
}

function grid(b: IncidentBundle): UkIncidentDetail['grid'] {
  const affected = b.participants.filter((p) => p.affected);
  const cells = new Map<string, { entrance: number; floor: number; count: number }>();
  const unknownFloor = new Map<number, number>();
  let unknownEntrance = 0;
  for (const p of affected) {
    if (p.entrance === null) {
      unknownEntrance += 1;
    } else if (p.floor === null) {
      unknownFloor.set(p.entrance, (unknownFloor.get(p.entrance) ?? 0) + 1);
    } else {
      const key = `${p.entrance}:${p.floor}`;
      const cell = cells.get(key) ?? { entrance: p.entrance, floor: p.floor, count: 0 };
      cell.count += 1;
      cells.set(key, cell);
    }
  }
  return {
    entrances: b.house.entrances,
    floors: b.house.floors,
    cells: [...cells.values()].sort((a, c) => a.entrance - c.entrance || a.floor - c.floor),
    unknownFloor: [...unknownFloor.entries()].sort(([a], [c]) => a - c).map(([entrance, n]) => ({ entrance, count: n })),
    unknownEntrance,
  };
}

function people(b: IncidentBundle): UkIncidentDetail['people'] {
  const affected = b.participants.filter((p) => p.affected);
  const since = b.incident.checkStartedAt;
  const actual = since ? affected.filter((p) => isActualAnswer({ answer: p.restoredAnswer, answeredAt: p.restoredAnswerAt }, since)) : [];
  const confirmed = affected.filter((p) => (p.trust ?? 0) >= 1).length;
  return {
    total: affected.length,
    confirmed,
    unconfirmed: affected.length - confirmed,
    notMe: b.participants.filter((p) => !p.affected).length,
    answers: {
      yes: actual.filter((p) => p.restoredAnswer === 'yes').length,
      no: actual.filter((p) => p.restoredAnswer === 'no').length,
      weak: actual.filter((p) => p.restoredAnswer === 'weak').length,
    },
  };
}

export function ukIncidentDetail(
  b: IncidentBundle,
  viewer: IncidentViewer,
  config: AppConfig,
  now: Date,
  mergeCandidates: IncidentSummary[],
): UkIncidentDetail {
  return {
    ...incidentDetail(b, viewer, config, now),
    grid: grid(b),
    people: people(b),
    allowedActions: allowedUkActions(b.incident.status),
    nextAction: nextUkAction(b.incident.status),
    mergeCandidates,
    cardUpdate: b.hasCard ? 'queued' : 'none',
  };
}

/** Кандидаты на объединение: открытые аварии того же вида в доме, не «только квартира». */
export function mergeCandidateIds(all: readonly IncidentBundle[], b: IncidentBundle): number[] {
  if (!allowedUkActions(b.incident.status).includes('merge')) return [];
  return all
    .filter(
      (x) =>
        x.incident.id !== b.incident.id &&
        x.incident.houseId === b.incident.houseId &&
        x.incident.serviceType === b.incident.serviceType &&
        x.incident.scope !== 'flat' &&
        isOpenStatus(x.incident.status),
    )
    .map((x) => x.incident.id);
}

export async function ukHouseView(db: Reader, h: HouseRow, chat: HouseChatRow | null): Promise<UkHouse> {
  const [active] = await db
    .select({ n: count() })
    .from(incident)
    .where(and(eq(incident.houseId, h.id), inArray(incident.status, ['open', 'accepted', 'brigade_on_site', 'localized', 'checking', 'discrepancy'])));
  const [pending] = await db
    .select({ n: count() })
    .from(residency)
    .where(and(eq(residency.houseId, h.id), eq(residency.reviewStatus, 'pending'), lt(residency.trustLevel, 2), eq(residency.isModel, false)));
  const info = chatInfo(chat);
  return {
    id: h.publicId,
    label: h.label,
    address: h.address,
    entrances: h.entrances,
    floors: h.floors,
    flatFrom: h.flatFrom,
    flatTo: h.flatTo,
    isModel: h.isModel,
    isSandbox: h.isSandbox,
    chat: info && chat ? { ...info, botIsAdmin: chat.botIsAdmin } : null,
    activeIncidents: active?.n ?? 0,
    pendingResidents: pending?.n ?? 0,
  };
}

/** U06: аварии месяца, устранено в норматив, среднее время до «Принято», расхождения, перерывы. */
export async function monthlySummaryView(db: Reader, h: HouseRow, now: Date): Promise<MonthlySummary> {
  const month = monthOf(now, h.timezone);
  const bounds = monthBounds(month, h.timezone);
  const rows = await db
    .select()
    .from(incident)
    .where(and(eq(incident.houseId, h.id), gte(incident.startedAt, bounds.start), lt(incident.startedAt, bounds.end)));
  const list = rows.filter((r) => r.scope !== 'flat' && r.status !== 'merged');
  const ids = list.map((r) => r.id);
  const accepted = ids.length > 0 ? await db.select().from(incidentEvent).where(and(inArray(incidentEvent.incidentId, ids), eq(incidentEvent.type, 'uk_accepted'))) : [];
  const waits = list.flatMap((r) => {
    const first = accepted.filter((e) => e.incidentId === r.id).sort((a, c) => a.occurredAt.getTime() - c.occurredAt.getTime())[0];
    return first ? [Math.max(0, first.occurredAt.getTime() - r.createdAt.getTime())] : [];
  });
  const house = await monthSummary(db, h, null, now);
  return {
    month: monthKey(month),
    incidents: list.length,
    inNorm: list.filter((r) => r.status === 'closed' && !r.overdue).length,
    avgAcceptMinutes: waits.length > 0 ? Math.round(waits.reduce((a, c) => a + c, 0) / waits.length / MS_PER_MINUTE) : null,
    discrepancies: list.filter((r) => r.discrepancyAt !== null).length,
    services: house.services,
  };
}

/** Следующий срок для сортировки внутри группы. */
export function nextDueAt(b: IncidentBundle): number {
  return nextDeadline(b.deadlines)?.dueAt.getTime() ?? Number.MAX_SAFE_INTEGER;
}
