/**
 * Расчёт уменьшения платы по нормам (F09): часы сверх нормы × ставка × плата за месяц.
 * Вся арифметика — в целых копейках и рациональных числах, округление до копеек банковское.
 * Какие часы считать (месячный лимит или максимум с единовременным) и как округлять
 * неполный час — поля справочника, а не код.
 */
import { MAX_MONTHLY_CHARGE_RUBLES } from '../constants/limits.ts';
import { KOPECKS_PER_RUBLE, MINUTES_PER_HOUR, MS_PER_MINUTE, PERCENT } from '../constants/time.ts';
import type { CalcStrategy, RoundMode } from '../domain/enums.ts';

/** Десятичная строка "0.15" → 15/100 без потерь точности. */
export function parseDecimal(value: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal: ${value}`);
  const fraction = m[2] ?? '';
  const den = BigInt(`1${'0'.repeat(fraction.length)}`);
  return { num: BigInt(`${m[1]}${fraction}`), den };
}

const TWO = 2n;

/** Банковское округление num/den до целого (половина — к чётному). */
export function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error('denominator must be positive');
  const negative = num < 0n;
  const n = negative ? -num : num;
  const q = n / den;
  const r = n % den;
  let rounded: bigint;
  if (r * TWO > den) rounded = q + 1n;
  else if (r * TWO < den) rounded = q;
  else rounded = q % TWO === 0n ? q : q + 1n;
  return negative ? -rounded : rounded;
}

/** Минуты сверх нормы с округлением неполного часа по правилу справочника. */
export function roundExcessMinutes(excessMs: number, mode: RoundMode): number {
  const minutes = excessMs / MS_PER_MINUTE;
  switch (mode) {
    case 'ceil':
      return Math.ceil(minutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
    case 'floor':
      return Math.floor(minutes / MINUTES_PER_HOUR) * MINUTES_PER_HOUR;
    case 'exact':
      return Math.round(minutes);
  }
}

/** Какие часы идут в деньги: по умолчанию — превышение месячного лимита. */
export function excessForMoney(strategy: CalcStrategy, excess: { singleMs: number; monthlyMs: number }): number {
  switch (strategy) {
    case 'monthly_total':
      return excess.monthlyMs;
    case 'max_of_single_and_monthly':
      return Math.max(excess.singleMs, excess.monthlyMs);
  }
}

/** Сумма из квитанции (₽) → целые копейки. */
export function rublesToKopecks(rubles: number): number {
  return Math.round(rubles * KOPECKS_PER_RUBLE);
}

/**
 * Уменьшение платы в копейках: плата × минуты × ставка% / (60 × 100), банковское округление.
 */
export function reductionKopecks(input: { monthlyChargeKopecks: number; excessMinutes: number; ratePercent: string }): number {
  if (!Number.isSafeInteger(input.monthlyChargeKopecks) || input.monthlyChargeKopecks < 0) {
    throw new Error('monthlyChargeKopecks must be a non-negative integer');
  }
  if (!Number.isSafeInteger(input.excessMinutes) || input.excessMinutes < 0) {
    throw new Error('excessMinutes must be a non-negative integer');
  }
  const rate = parseDecimal(input.ratePercent);
  const num = BigInt(input.monthlyChargeKopecks) * BigInt(input.excessMinutes) * rate.num;
  const den = rate.den * BigInt(MINUTES_PER_HOUR) * BigInt(PERCENT);
  return Number(roundHalfEven(num, den));
}

export interface RecalcInput {
  /** Плата за услугу за месяц из квитанции, ₽. */
  monthlyCharge: number;
  singleExcessMs: number;
  monthlyExcessMs: number;
  strategy: CalcStrategy;
  round: RoundMode;
  ratePercent: string;
}

export interface RecalcResult {
  monthlyChargeKopecks: number;
  excessMinutes: number;
  /** Часы для формулы (для ceil/floor — целые). */
  excessHours: number;
  amountKopecks: number;
  withinNorm: boolean;
}

export type RecalcError = 'monthly_charge_invalid';

export function validateMonthlyCharge(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_MONTHLY_CHARGE_RUBLES;
}

export function recalc(input: RecalcInput): { ok: true; result: RecalcResult } | { ok: false; error: RecalcError } {
  if (!validateMonthlyCharge(input.monthlyCharge)) return { ok: false, error: 'monthly_charge_invalid' };
  const monthlyChargeKopecks = rublesToKopecks(input.monthlyCharge);
  const excessMs = excessForMoney(input.strategy, { singleMs: input.singleExcessMs, monthlyMs: input.monthlyExcessMs });
  const excessMinutes = excessMs > 0 ? roundExcessMinutes(excessMs, input.round) : 0;
  const amountKopecks = reductionKopecks({ monthlyChargeKopecks, excessMinutes, ratePercent: input.ratePercent });
  return {
    ok: true,
    result: {
      monthlyChargeKopecks,
      excessMinutes,
      excessHours: excessMinutes / MINUTES_PER_HOUR,
      amountKopecks,
      withinNorm: excessMinutes === 0,
    },
  };
}
