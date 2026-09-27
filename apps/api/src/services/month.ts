/**
 * Перерывы услуги за календарный месяц против лимитов (S03 «Этот месяц», F09): для жителя — по его
 * квартире, для УК — по авариям всего дома. Интервалы объединяются и обрезаются границами месяца
 * в поясе дома; лимиты — только из справочника норм.
 */
import {
  computeInterruption,
  flatIntervals,
  flatLocation,
  houseIntervals,
  monthBounds,
  monthKey,
  monthOf,
  normDurationMs,
  selectNorm,
  SERVICE_TYPES,
  type IntervalIncident,
  type MonthRef,
  type NormRecord,
  type ServiceType,
} from '@vsemdomom/core';
import type { HouseMonthSummarySchema, HouseMonthResponseSchema, NormBasis } from '@vsemdomom/shared';
import { and, eq, inArray, lt, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import type { HouseRow, ResidencyRow } from '../db/queries.ts';
import { incident, incidentParticipant, residency } from '../db/schema.ts';
import { iso } from './views.ts';

type Reader = Pick<Executor, 'select'>;
type MonthResponse = z.infer<typeof HouseMonthResponseSchema>;
type MonthSummary = z.infer<typeof HouseMonthSummarySchema>;

const MS_PER_MINUTE = 60_000;
const minutes = (ms: number) => Math.floor(ms / MS_PER_MINUTE);

export function basisOf(n: NormRecord): NormBasis {
  return {
    code: n.code,
    title: n.title,
    doc: n.basisDoc,
    point: n.basisPoint,
    textPlain: n.textPlain,
    quote: n.basisQuote,
    edition: n.editionDate,
    validFrom: n.validFrom,
    validTo: n.validTo,
    checkedAt: n.checkedAt,
    sourceUrl: n.sourceUrl,
  };
}

const MONTH = /^(\d{4})-(\d{2})$/;

export function parseMonth(value: string | undefined, now: Date, timezone: string): MonthRef {
  const m = value ? MONTH.exec(value) : null;
  if (!m) return monthOf(now, timezone);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Аварии дома с участниками, которые могут задевать месяц (начались до его конца). */
async function loadIntervalIncidents(db: Reader, h: HouseRow, month: MonthRef, services: readonly ServiceType[]): Promise<IntervalIncident[]> {
  const bounds = monthBounds(month, h.timezone);
  const rows = await db
    .select()
    .from(incident)
    .where(and(eq(incident.houseId, h.id), inArray(incident.serviceType, [...services]), ne(incident.status, 'merged'), lt(incident.startedAt, bounds.end)));
  if (rows.length === 0) return [];
  const parts = await db
    .select({ p: incidentParticipant, flatNo: residency.flatNo })
    .from(incidentParticipant)
    .leftJoin(residency, eq(residency.id, incidentParticipant.residencyId))
    .where(inArray(incidentParticipant.incidentId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    id: r.publicId,
    serviceType: r.serviceType,
    scope: r.scope,
    entrance: r.entrance,
    status: r.status,
    startedAt: r.startedAt,
    resolvedAtUk: r.resolvedAtUk,
    participants: parts
      .filter((x) => x.p.incidentId === r.id)
      .map((x) => ({ flatNo: x.flatNo, affected: x.p.affected, restoredAt: x.p.restoredAt, restoredAnswer: x.p.restoredAnswer })),
  }));
}

function limits(norms: readonly NormRecord[], h: HouseRow, service: ServiceType, at: Date) {
  const ctx = { regionCode: h.regionCode, timezone: h.timezone, powerSources: h.powerSources, hotWaterDeadEnd: h.hotWaterDeadEnd };
  const single = selectNorm(norms, { service, event: 'interruption_single', house: ctx, at });
  const monthly = selectNorm(norms, { service, event: 'interruption_monthly', house: ctx, at });
  return {
    single: single ? { norm: single, ms: normDurationMs(single) } : null,
    monthly: monthly ? { norm: monthly, ms: normDurationMs(monthly) } : null,
  };
}

function intervalsFor(incidents: readonly IntervalIncident[], service: ServiceType, h: HouseRow, flat: ResidencyRow | null, now: Date) {
  if (!flat) return houseIntervals(incidents, service, now);
  return flatIntervals(incidents, service, { flatNo: flat.flatNo, entrance: flatLocation(h, flat.flatNo)?.entrance ?? null }, now);
}

/** GET /houses/{id}/month: интервалы по авариям, сумма без двойного счёта, лимиты с основаниями. */
export async function monthDetail(
  db: Reader,
  h: HouseRow,
  service: ServiceType,
  monthValue: string | undefined,
  flat: ResidencyRow | null,
  now: Date,
): Promise<MonthResponse> {
  const month = parseMonth(monthValue, now, h.timezone);
  const bounds = monthBounds(month, h.timezone);
  const incidents = await loadIntervalIncidents(db, h, month, [service]);
  const list = intervalsFor(incidents, service, h, flat, now).filter((i) => i.end.getTime() > bounds.start.getTime());
  const norms = await loadNorms(db);
  const lim = limits(norms, h, service, bounds.start);
  const singleMs = lim.single?.ms ?? null;
  const monthlyMs = lim.monthly?.ms ?? null;
  const summary = computeInterruption({ intervals: list, month, timezone: h.timezone, singleLimitMs: singleMs, monthlyLimitMs: monthlyMs });
  return {
    month: monthKey(month),
    service,
    scope: flat ? 'flat' : 'house',
    timezone: h.timezone,
    intervals: list.map((i) => {
      const from = new Date(Math.max(i.start.getTime(), bounds.start.getTime()));
      const to = new Date(Math.min(i.end.getTime(), bounds.end.getTime()));
      return { incidentId: i.incidentId, from: iso(from), to: iso(to), minutes: minutes(Math.max(0, to.getTime() - from.getTime())), ongoing: i.ongoing };
    }),
    totalMinutes: minutes(summary.monthlyTotalMs),
    single:
      lim.single && singleMs !== null
        ? { limitMinutes: minutes(singleMs), longestMinutes: minutes(summary.longestMs), exceeded: summary.singleExceeded, norm: basisOf(lim.single.norm) }
        : null,
    monthly:
      lim.monthly && monthlyMs !== null
        ? { limitMinutes: minutes(monthlyMs), excessMinutes: minutes(summary.monthlyExcessMs), norm: basisOf(lim.monthly.norm) }
        : null,
  };
}

/** «Этот месяц» на главной: только услуги с перерывами. */
export async function monthSummary(db: Reader, h: HouseRow, flat: ResidencyRow | null, now: Date): Promise<MonthSummary> {
  const month = monthOf(now, h.timezone);
  const bounds = monthBounds(month, h.timezone);
  const incidents = await loadIntervalIncidents(db, h, month, SERVICE_TYPES);
  const norms = await loadNorms(db);
  const services: MonthSummary['services'] = [];
  for (const service of SERVICE_TYPES) {
    const list = intervalsFor(incidents, service, h, flat, now);
    if (list.length === 0) continue;
    const lim = limits(norms, h, service, bounds.start);
    const summary = computeInterruption({ intervals: list, month, timezone: h.timezone, singleLimitMs: lim.single?.ms ?? null, monthlyLimitMs: lim.monthly?.ms ?? null });
    if (summary.monthlyTotalMs <= 0) continue;
    services.push({
      service,
      totalMinutes: minutes(summary.monthlyTotalMs),
      limitMinutes: lim.monthly && lim.monthly.ms !== null ? minutes(lim.monthly.ms) : null,
      excessMinutes: minutes(summary.monthlyExcessMs),
      norm: lim.monthly ? basisOf(lim.monthly.norm) : null,
    });
  }
  return { month: monthKey(month), scope: flat ? 'flat' : 'house', services };
}
