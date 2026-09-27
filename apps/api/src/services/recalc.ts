/**
 * Перерасчёт по нормам (F09): по квартире жителя — объединение перерывов услуги за месяц (пересечения
 * не складываются) минус допустимое; ставка, стратегия и округление — из справочника норм.
 * Ничего не сохраняется: сумма из квитанции живёт только в ответе.
 */
import {
  computeInterruption,
  flatIntervals,
  flatLocation,
  formatDuration,
  formatRecalcFormula,
  monthKey,
  monthOf,
  recalc,
  validateMonthlyCharge,
  type Translator,
} from '@vsemdomom/core';
import type { RecalculationResponseSchema } from '@vsemdomom/shared';
import type { z } from 'zod';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import type { ResidencyRow } from '../db/queries.ts';
import type { IncidentBundle } from './incident-view.ts';
import { basisOf, limits, loadIntervalIncidents } from './month.ts';

type Reader = Pick<Executor, 'select'>;
type Recalculation = z.infer<typeof RecalculationResponseSchema>;

const MS_PER_MINUTE = 60_000;
const KOPECKS_PER_RUBLE = 100;
const minutes = (ms: number) => Math.max(0, Math.floor(ms / MS_PER_MINUTE));

export async function recalcForFlat(
  db: Reader,
  b: IncidentBundle,
  flat: ResidencyRow,
  monthlyCharge: number,
  t: Translator,
  now: Date,
): Promise<Recalculation | 'monthly_charge_invalid'> {
  if (!validateMonthlyCharge(monthlyCharge)) return 'monthly_charge_invalid';
  const inc = b.incident;
  const h = b.house;
  const resolvedAt = inc.resolvedAtUk ?? now;
  const month = monthOf(resolvedAt, h.timezone);
  const lim = limits(await loadNorms(db), h, inc.serviceType, resolvedAt);
  const incidents = await loadIntervalIncidents(db, h, month, [inc.serviceType]);
  const intervals = flatIntervals(incidents, inc.serviceType, { flatNo: flat.flatNo, entrance: flatLocation(h, flat.flatNo)?.entrance ?? null }, now);
  const summary = computeInterruption({
    intervals,
    month,
    timezone: h.timezone,
    singleLimitMs: lim.single?.ms ?? null,
    monthlyLimitMs: lim.monthly?.ms ?? null,
  });
  const base = {
    incidentId: inc.publicId,
    service: inc.serviceType,
    month: monthKey(month),
    preliminary: inc.status !== 'closed',
    monthlyCharge,
    totalMinutes: minutes(summary.monthlyTotalMs),
    singleLimitExceeded: summary.singleExceeded,
    disclaimer: t.t('calc.disclaimer'),
  };
  const norm = lim.monthly?.norm;
  const limitMs = lim.monthly?.ms ?? null;
  if (!norm || limitMs === null || norm.ratePercent === null) {
    return {
      ...base,
      limitMinutes: null,
      excessMinutes: 0,
      excessHours: 0,
      round: norm?.round ?? 'exact',
      ratePercent: 0,
      amount: 0,
      withinNorm: true,
      formula: t.t('money.no_norm'),
      norm: norm ? basisOf(norm) : null,
    };
  }
  const result = recalc({
    monthlyCharge,
    singleExcessMs: summary.singleExcessMs,
    monthlyExcessMs: summary.monthlyExcessMs,
    strategy: norm.calcStrategy ?? 'monthly_total',
    round: norm.round ?? 'ceil',
    ratePercent: norm.ratePercent,
  });
  if (!result.ok) return 'monthly_charge_invalid';
  const r = result.result;
  return {
    ...base,
    limitMinutes: minutes(limitMs),
    excessMinutes: minutes(summary.monthlyExcessMs),
    excessHours: r.excessHours,
    round: norm.round ?? 'ceil',
    ratePercent: Number(norm.ratePercent),
    amount: r.amountKopecks / KOPECKS_PER_RUBLE,
    withinNorm: r.withinNorm,
    formula: r.withinNorm
      ? t.t('money.none', { limit: formatDuration(limitMs) })
      : formatRecalcFormula({ excessMinutes: r.excessMinutes, ratePercent: norm.ratePercent, monthlyChargeKopecks: r.monthlyChargeKopecks, amountKopecks: r.amountKopecks }, t),
    norm: basisOf(norm),
  };
}
