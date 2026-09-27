import { describe, expect, it } from 'vitest';
import {
  computeInterruption,
  flatIntervals,
  houseIntervals,
  mergeIntervals,
  monthBounds,
  monthKey,
  monthOf,
  normDurationMs,
  parseDecimal,
  recalc,
  reductionKopecks,
  roundExcessMinutes,
  roundHalfEven,
  selectNorm,
  type IntervalIncident,
} from '../src/index.ts';
import { at, H, house1, MIN, seedNorms } from './helpers/norms.ts';

const TZ = 'Europe/Moscow';
const sept = { year: 2026, month: 9 };
const norms = seedNorms();

function limits(service: 'hot_water' | 'heating' | 'electricity', powerSources = 2) {
  const house = { ...house1, powerSources };
  const q = { service, house, at: at('2026-09-15T12:00:00Z') };
  const single = selectNorm(norms, { ...q, event: 'interruption_single' });
  const monthly = selectNorm(norms, { ...q, event: 'interruption_monthly' })!;
  return { singleLimitMs: single ? normDurationMs(single) : null, monthlyLimitMs: normDurationMs(monthly), monthly };
}

function money(monthlyCharge: number, sum: ReturnType<typeof computeInterruption>, service: 'hot_water' | 'heating' | 'electricity', powerSources = 2) {
  const { monthly } = limits(service, powerSources);
  const r = recalc({
    monthlyCharge,
    singleExcessMs: sum.singleExcessMs,
    monthlyExcessMs: sum.monthlyExcessMs,
    strategy: monthly.calcStrategy!,
    round: monthly.round!,
    ratePercent: monthly.ratePercent!,
  });
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

const iv = (from: string, to: string) => ({ start: at(from), end: at(to) });

describe('превышение и перерасчёт: таблица тестов', () => {
  it('ГВС 3 ч за месяц → превышения нет → 0 ₽', () => {
    const sum = computeInterruption({ intervals: [iv('2026-09-10T06:00:00Z', '2026-09-10T09:00:00Z')], month: sept, timezone: TZ, ...limits('hot_water') });
    expect(sum.monthlyTotalMs).toBe(3 * H);
    expect(sum.monthlyExcessMs).toBe(0);
    expect(money(1200, sum, 'hot_water')).toMatchObject({ excessHours: 0, amountKopecks: 0, withinNorm: true });
  });

  it('ГВС 5 ч 40 мин подряд без других перерывов → флаг единовременного превышения, денег 0', () => {
    const sum = computeInterruption({ intervals: [iv('2026-09-27T14:40:00Z', '2026-09-27T20:20:00Z')], month: sept, timezone: TZ, ...limits('hot_water') });
    expect(sum.singleExceeded).toBe(true);
    expect(sum.singleExcessMs).toBe(100 * MIN);
    expect(sum.monthlyExcessMs).toBe(0);
    expect(money(1200, sum, 'hot_water').amountKopecks).toBe(0);
  });

  it('ГВС 5 ч 40 мин + ранее 6 ч = 11 ч 40 мин → сверх нормы 3 ч 40 мин → 4 ч × 0,15 % × 1 200 ₽ = 7,20 ₽', () => {
    const sum = computeInterruption({
      intervals: [iv('2026-09-02T05:00:00Z', '2026-09-02T11:00:00Z'), iv('2026-09-27T14:40:00Z', '2026-09-27T20:20:00Z')],
      month: sept,
      timezone: TZ,
      ...limits('hot_water'),
    });
    expect(sum.monthlyTotalMs).toBe(11 * H + 40 * MIN);
    expect(sum.monthlyExcessMs).toBe(3 * H + 40 * MIN);
    expect(money(1200, sum, 'hot_water')).toMatchObject({ excessMinutes: 240, excessHours: 4, amountKopecks: 720 });
  });

  it('две пересекающиеся аварии 14:00–18:00 и 16:00–20:00 → 6 ч, а не 8 ч', () => {
    const merged = mergeIntervals([iv('2026-09-05T11:00:00Z', '2026-09-05T15:00:00Z'), iv('2026-09-05T13:00:00Z', '2026-09-05T17:00:00Z')]);
    expect(merged).toEqual([iv('2026-09-05T11:00:00Z', '2026-09-05T17:00:00Z')]);
    const sum = computeInterruption({ intervals: merged, month: sept, timezone: TZ, ...limits('hot_water') });
    expect(sum.monthlyTotalMs).toBe(6 * H);
  });

  it('отопление 72 ч за месяц при лимите 24 ч → 48 ч × 0,15 % × 3 000 ₽ = 216 ₽', () => {
    const sum = computeInterruption({ intervals: [iv('2026-09-10T00:00:00Z', '2026-09-13T00:00:00Z')], month: sept, timezone: TZ, ...limits('heating') });
    expect(sum.monthlyExcessMs).toBe(48 * H);
    expect(money(3000, sum, 'heating')).toMatchObject({ excessHours: 48, amountKopecks: 21_600 });
  });

  it('авария через границу месяца считается по частям в каждом месяце', () => {
    // 30.09 20:00 — 01.10 04:00 МСК
    const intervals = [iv('2026-09-30T17:00:00Z', '2026-10-01T01:00:00Z')];
    const s = computeInterruption({ intervals, month: sept, timezone: TZ, ...limits('hot_water') });
    const o = computeInterruption({ intervals, month: { year: 2026, month: 10 }, timezone: TZ, ...limits('hot_water') });
    expect(s.monthlyTotalMs).toBe(4 * H);
    expect(o.monthlyTotalMs).toBe(4 * H);
    expect(s.longestMs).toBe(8 * H);
    expect(s.singleExceeded).toBe(true);
  });

  it('электричество: при двух источниках лимит 2 ч, при одном — 24 ч', () => {
    const intervals = [iv('2026-09-10T06:00:00Z', '2026-09-10T11:00:00Z')];
    const two = computeInterruption({ intervals, month: sept, timezone: TZ, ...limits('electricity', 2) });
    const one = computeInterruption({ intervals, month: sept, timezone: TZ, ...limits('electricity', 1) });
    expect(two.monthlyExcessMs).toBe(3 * H);
    expect(money(1000, two, 'electricity', 2).amountKopecks).toBe(450);
    expect(one.monthlyExcessMs).toBe(0);
    expect(one.singleExceeded).toBe(false);
  });

  it('норматив не установлен → превышений нет', () => {
    const sum = computeInterruption({ intervals: [iv('2026-09-10T06:00:00Z', '2026-09-11T06:00:00Z')], month: sept, timezone: TZ, singleLimitMs: null, monthlyLimitMs: null });
    expect(sum).toMatchObject({ singleExceeded: false, singleExcessMs: 0, monthlyExcessMs: 0, monthlyTotalMs: 24 * H });
  });
});

describe('арифметика расчёта', () => {
  it('десятичные ставки и банковское округление', () => {
    expect(parseDecimal('0.15')).toEqual({ num: 15n, den: 100n });
    expect(parseDecimal('2')).toEqual({ num: 2n, den: 1n });
    expect(roundHalfEven(5n, 2n)).toBe(2n); // 2,5 → 2
    expect(roundHalfEven(7n, 2n)).toBe(4n); // 3,5 → 4
    expect(roundHalfEven(26n, 10n)).toBe(3n);
    expect(roundHalfEven(24n, 10n)).toBe(2n);
    expect(() => parseDecimal('abc')).toThrow();
  });

  it('округление неполного часа по правилу справочника', () => {
    expect(roundExcessMinutes(3 * H + 40 * MIN, 'ceil')).toBe(240);
    expect(roundExcessMinutes(3 * H + 40 * MIN, 'floor')).toBe(180);
    expect(roundExcessMinutes(3 * H + 40 * MIN, 'exact')).toBe(220);
  });

  it('копейки: половина копейки — к чётному', () => {
    // 1 ₽ × 1 ч × 0,15 % = 0,15 коп. → 0; 10 ₽ × 1 ч × 0,15 % = 1,5 коп. → 2; 30 ₽ → 4,5 коп. → 4
    expect(reductionKopecks({ monthlyChargeKopecks: 100, excessMinutes: 60, ratePercent: '0.15' })).toBe(0);
    expect(reductionKopecks({ monthlyChargeKopecks: 1000, excessMinutes: 60, ratePercent: '0.15' })).toBe(2);
    expect(reductionKopecks({ monthlyChargeKopecks: 3000, excessMinutes: 60, ratePercent: '0.15' })).toBe(4);
  });

  it('стратегия max_of_single_and_monthly — правкой справочника, без кода', () => {
    const r = recalc({ monthlyCharge: 1200, singleExcessMs: 100 * MIN, monthlyExcessMs: 0, strategy: 'max_of_single_and_monthly', round: 'ceil', ratePercent: '0.15' });
    expect(r.ok && r.result).toMatchObject({ excessHours: 2, amountKopecks: 360 });
  });

  it('сумма ≤ 0 или не число → monthly_charge_invalid', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(recalc({ monthlyCharge: bad, singleExcessMs: 0, monthlyExcessMs: 0, strategy: 'monthly_total', round: 'ceil', ratePercent: '0.15' })).toEqual({
        ok: false,
        error: 'monthly_charge_invalid',
      });
    }
    expect(recalc({ monthlyCharge: 1250.55, singleExcessMs: 0, monthlyExcessMs: H, strategy: 'monthly_total', round: 'ceil', ratePercent: '0.15' })).toMatchObject({
      ok: true,
      result: { monthlyChargeKopecks: 125_055 },
    });
  });
});

describe('месяц в часовом поясе дома', () => {
  it('границы месяца и ключ', () => {
    expect(monthBounds(sept, TZ)).toEqual({ start: at('2026-08-31T21:00:00Z'), end: at('2026-09-30T21:00:00Z') });
    expect(monthOf(at('2026-09-30T21:30:00Z'), TZ)).toEqual({ year: 2026, month: 10 });
    expect(monthKey({ year: 2026, month: 9 })).toBe('2026-09');
  });
});

describe('интервалы квартиры', () => {
  const now = at('2026-09-27T20:00:00Z');
  const base: Omit<IntervalIncident, 'id' | 'scope' | 'entrance' | 'status' | 'participants'> = {
    serviceType: 'hot_water',
    startedAt: at('2026-09-27T14:40:00Z'),
    resolvedAtUk: at('2026-09-27T16:10:00Z'),
  };
  const incidents: IntervalIncident[] = [
    { ...base, id: 'house', scope: 'house', entrance: null, status: 'closed', participants: [] },
    { ...base, id: 'ent2', scope: 'entrance', entrance: 2, status: 'closed', participants: [] },
    { ...base, id: 'ent3', scope: 'entrance', entrance: 3, status: 'closed', participants: [] },
    { ...base, id: 'flat', scope: 'flat', entrance: null, status: 'closed', participants: [{ flatNo: 57, affected: true, restoredAt: at('2026-09-27T19:00:00Z'), restoredAnswer: 'yes' }] },
    { ...base, id: 'merged', scope: 'house', entrance: null, status: 'merged', participants: [] },
    { ...base, id: 'other', scope: 'house', entrance: null, status: 'closed', serviceType: 'cold_water', participants: [] },
    { ...base, id: 'notme', scope: 'house', entrance: null, status: 'closed', participants: [{ flatNo: 57, affected: false, restoredAt: null, restoredAnswer: null }] },
    { ...base, id: 'open', scope: 'house', entrance: null, status: 'accepted', resolvedAtUk: null, participants: [] },
    { ...base, id: 'no', scope: 'house', entrance: null, status: 'discrepancy', participants: [{ flatNo: 57, affected: true, restoredAt: null, restoredAnswer: 'no' }] },
  ];

  it('дом, свой подъезд и участие; без объединённых, чужих услуг и «Не у меня»', () => {
    const r = flatIntervals(incidents, 'hot_water', { flatNo: 57, entrance: 2 }, now);
    expect(r.map((i) => i.incidentId)).toEqual(['house', 'ent2', 'flat', 'open', 'no']);
    expect(r.find((i) => i.incidentId === 'flat')?.end).toEqual(at('2026-09-27T19:00:00Z'));
    expect(r.find((i) => i.incidentId === 'house')?.end).toEqual(base.resolvedAtUk);
    expect(r.find((i) => i.incidentId === 'open')).toMatchObject({ end: now, ongoing: true });
    expect(r.find((i) => i.incidentId === 'no')).toMatchObject({ end: now, ongoing: true });
  });

  it('интервалы дома — только аварии масштаба «дом»', () => {
    expect(houseIntervals(incidents, 'hot_water', now).map((i) => i.incidentId)).toEqual(['house', 'notme', 'open', 'no']);
  });
});
