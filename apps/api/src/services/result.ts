/**
 * Итог аварии (F08): время по отметке УК и время для каждой квартиры (позже — если житель отвечал «Нет»,
 * а потом подтвердил восстановление), квартиры сверх месячной нормы. Считается ядром по интервалам
 * всех аварий этой услуги в доме за месяц в поясе дома; лимиты — только из справочника норм.
 */
import {
  computeInterruption,
  displayStatus,
  flatIntervals,
  flatLocation,
  houseIntervals,
  monthKey,
  monthOf,
  selectNorm,
  type MonthRef,
  type NormRecord,
  type Translator,
} from '@vsemdomom/core';
import type { ResultSchema } from '@vsemdomom/shared';
import type { z } from 'zod';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import type { IncidentBundle, IncidentViewer } from './incident-view.ts';
import { basisOf, limits, loadIntervalIncidents } from './month.ts';
import { iso } from './views.ts';

const MS_PER_MINUTE = 60_000;

type Reader = Pick<Executor, 'select'>;

export interface FlatOutcome {
  flatNo: number;
  restoredAt: Date;
  monthlyTotalMs: number;
  monthlyExcessMs: number;
  longestMs: number;
  singleExceeded: boolean;
}

export interface ResultNumbers {
  month: MonthRef;
  resolvedAt: Date;
  /** Квартиры зарегистрированных участников. */
  flatsCount: number;
  late: { flats: number; lastAt: Date } | null;
  /** Квартиры сверх месячной нормы — могут оформить перерасчёт. */
  eligible: { flats: number; maxTotalMs: number } | null;
  perFlat: Map<number, FlatOutcome>;
  norms: { single: { norm: NormRecord; ms: number | null } | null; monthly: { norm: NormRecord; ms: number | null } | null; actCopy: NormRecord | null };
}

export async function computeResult(db: Reader, b: IncidentBundle, now: Date): Promise<ResultNumbers> {
  const inc = b.incident;
  const h = b.house;
  const resolvedAt = inc.resolvedAtUk ?? inc.closedAt ?? now;
  const month = monthOf(resolvedAt, h.timezone);
  const norms = await loadNorms(db);
  const lim = limits(norms, h, inc.serviceType, resolvedAt);
  const ctx = { regionCode: h.regionCode, timezone: h.timezone, powerSources: h.powerSources, hotWaterDeadEnd: h.hotWaterDeadEnd };
  const actCopy = selectNorm(norms, { service: inc.serviceType, event: 'act_copy', house: ctx, at: resolvedAt });
  const incidents = await loadIntervalIncidents(db, h, month, [inc.serviceType]);

  const affected = b.participants.filter((p) => p.affected);
  const flats = [...new Set(affected.flatMap((p) => (p.flatNo === null ? [] : [p.flatNo])))];
  const perFlat = new Map<number, FlatOutcome>();
  for (const flatNo of flats) {
    const intervals = flatIntervals(incidents, inc.serviceType, { flatNo, entrance: flatLocation(h, flatNo)?.entrance ?? null }, now);
    const summary = computeInterruption({
      intervals,
      month,
      timezone: h.timezone,
      singleLimitMs: lim.single?.ms ?? null,
      monthlyLimitMs: lim.monthly?.ms ?? null,
    });
    const participant = affected.find((p) => p.flatNo === flatNo);
    perFlat.set(flatNo, {
      flatNo,
      restoredAt: participant?.restoredAt ?? resolvedAt,
      monthlyTotalMs: summary.monthlyTotalMs,
      monthlyExcessMs: summary.monthlyExcessMs,
      longestMs: summary.longestMs,
      singleExceeded: summary.singleExceeded,
    });
  }

  // Позже отметки УК: зарегистрированные — по квартирам, незарегистрированные — поштучно.
  const lateList = affected.filter((p) => p.restoredAt !== null && p.restoredAt.getTime() > resolvedAt.getTime());
  const lateKeys = new Set(lateList.map((p) => (p.flatNo === null ? `u${p.id}` : `f${p.flatNo}`)));
  const lastAt = lateList.reduce<Date | null>((max, p) => (p.restoredAt && (!max || p.restoredAt > max) ? p.restoredAt : max), null);
  const eligible = [...perFlat.values()].filter((f) => f.monthlyExcessMs > 0);

  return {
    month,
    resolvedAt,
    flatsCount: flats.length,
    late: lastAt && lateKeys.size > 0 ? { flats: lateKeys.size, lastAt } : null,
    eligible: eligible.length > 0 ? { flats: eligible.length, maxTotalMs: Math.max(...eligible.map((f) => f.monthlyTotalMs)) } : null,
    perFlat,
    norms: { single: lim.single, monthly: lim.monthly, actCopy },
  };
}

type ResultView = z.infer<typeof ResultSchema>;

/** Перерывы за месяц для одной квартиры (или для дома, если квартира не известна). */
async function outcomeFor(db: Reader, b: IncidentBundle, flatNo: number | null, month: MonthRef, now: Date, lim: ReturnType<typeof limits>) {
  const inc = b.incident;
  const incidents = await loadIntervalIncidents(db, b.house, month, [inc.serviceType]);
  const intervals =
    flatNo === null
      ? houseIntervals(incidents, inc.serviceType, now)
      : flatIntervals(incidents, inc.serviceType, { flatNo, entrance: flatLocation(b.house, flatNo)?.entrance ?? null }, now);
  return computeInterruption({ intervals, month, timezone: b.house.timezone, singleLimitMs: lim.single?.ms ?? null, monthlyLimitMs: lim.monthly?.ms ?? null });
}

const minutes = (ms: number) => Math.max(0, Math.floor(ms / MS_PER_MINUTE));

/** GET /incidents/{id}/result: итог для смотрящего — по его квартире, для УК — по дому. */
export async function resultView(db: Reader, b: IncidentBundle, viewer: IncidentViewer, t: Translator, now: Date): Promise<ResultView> {
  const inc = b.incident;
  const r = await computeResult(db, b, now);
  const lim = { single: r.norms.single, monthly: r.norms.monthly };
  const flatNo = viewer.residency?.flatNo ?? null;
  const summary = await outcomeFor(db, b, flatNo, r.month, now, lim);
  const mine = viewer.residency ? b.participants.find((p) => p.userId === viewer.userId) : undefined;
  const affectsMe = viewer.residency !== null && (mine?.affected === true || (mine === undefined && summary.intervals.length > 0));
  const restoredAt = mine?.restoredAt ?? r.resolvedAt;
  return {
    incidentId: inc.publicId,
    service: inc.serviceType,
    house: { id: b.house.publicId, label: b.house.label, address: b.house.address, timezone: b.house.timezone, entrances: b.house.entrances, isModel: b.house.isModel },
    displayStatus: displayStatus(inc.status, inc.discrepancyUnresolved),
    startedAt: iso(inc.startedAt),
    uk: { resolvedAt: iso(r.resolvedAt), durationMinutes: minutes(r.resolvedAt.getTime() - inc.startedAt.getTime()) },
    my:
      affectsMe && flatNo !== null
        ? { flatNo, restoredAt: iso(restoredAt), durationMinutes: minutes(restoredAt.getTime() - inc.startedAt.getTime()), source: mine?.restoredSource ?? 'uk_mark' }
        : null,
    single:
      lim.single && lim.single.ms !== null
        ? { limitMinutes: minutes(lim.single.ms), longestMinutes: minutes(summary.longestMs), exceeded: summary.singleExceeded, norm: basisOf(lim.single.norm) }
        : null,
    month:
      lim.monthly && lim.monthly.ms !== null
        ? {
            month: monthKey(r.month),
            totalMinutes: minutes(summary.monthlyTotalMs),
            limitMinutes: minutes(lim.monthly.ms),
            excessMinutes: minutes(summary.monthlyExcessMs),
            withinNorm: summary.monthlyExcessMs === 0,
            norm: basisOf(lim.monthly.norm),
          }
        : null,
    flatsCount: r.flatsCount,
    lateFlats: { count: r.late?.flats ?? 0, lastRestoredAt: r.late ? iso(r.late.lastAt) : null },
    eligibleFlats: r.eligible?.flats ?? 0,
    actCopyNorm: r.norms.actCopy ? basisOf(r.norms.actCopy) : null,
    disclaimer: t.t('calc.disclaimer'),
  };
}
