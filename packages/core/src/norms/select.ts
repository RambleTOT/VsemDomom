/**
 * Справочник нормативов: единственный источник чисел для сроков, лимитов и ставок.
 * Норма выбирается по виду услуги, событию, региону дома (сначала региональная,
 * потом федеральная), условию (параметры дома) и дате действия.
 */
import { tz } from '@date-fns/tz';
import { format } from 'date-fns';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../constants/time.ts';
import type { CalcStrategy, NormEvent, NormUnit, RoundMode, ServiceType } from '../domain/enums.ts';

export type NormCondition = Record<string, string | number | boolean>;

export interface NormRecord {
  id: number;
  code: string;
  serviceType: ServiceType | null;
  event: NormEvent;
  title: string;
  /** Значение нормы (числом; из numeric БД). */
  value: number;
  unit: NormUnit;
  /** Ставка снижения платы в процентах — десятичной строкой без потери точности, например "0.15". */
  ratePercent: string | null;
  calcStrategy: CalcStrategy | null;
  round: RoundMode | null;
  regionCode: string | null;
  condition: NormCondition | null;
  basisDoc: string;
  basisPoint: string;
  basisQuote: string | null;
  textPlain: string;
  editionDate: string;
  validFrom: string;
  validTo: string | null;
  checkedAt: string | null;
  sourceUrl: string;
}

/** Параметры дома, от которых зависят нормы. */
export interface NormHouseContext {
  regionCode: string | null;
  timezone: string;
  powerSources: number;
  hotWaterDeadEnd: boolean;
}

/** Значения условий норм по параметрам дома. Неизвестный ключ условия — норма не подходит. */
function houseConditionValues(house: NormHouseContext): NormCondition {
  return { power_sources: house.powerSources, hot_water_dead_end: house.hotWaterDeadEnd };
}

function conditionMatches(condition: NormCondition | null, values: NormCondition): boolean {
  if (condition === null) return true;
  return Object.entries(condition).every(([key, expected]) => key in values && values[key] === expected);
}

/** Норма действует в дату `at` (дата в часовом поясе дома, границы включительно). */
export function isNormValidAt(norm: Pick<NormRecord, 'validFrom' | 'validTo'>, at: Date, timezone: string): boolean {
  const day = format(at, 'yyyy-MM-dd', { in: tz(timezone) });
  return norm.validFrom <= day && (norm.validTo === null || day <= norm.validTo);
}

export interface NormQuery {
  service: ServiceType;
  event: NormEvent;
  house: NormHouseContext;
  at: Date;
}

/**
 * Выбор нормы: подходящие по услуге (своя услуга важнее «любой»), событию, дате и условию;
 * региональная важнее федеральной; из оставшихся — самая конкретная по условию и самая новая.
 */
export function selectNorm(norms: readonly NormRecord[], query: NormQuery): NormRecord | null {
  const values = houseConditionValues(query.house);
  const candidates = norms.filter(
    (n) =>
      n.event === query.event &&
      (n.serviceType === query.service || n.serviceType === null) &&
      isNormValidAt(n, query.at, query.house.timezone) &&
      conditionMatches(n.condition, values),
  );
  if (candidates.length === 0) return null;
  const regional =
    query.house.regionCode === null ? [] : candidates.filter((n) => n.regionCode === query.house.regionCode);
  const pool = regional.length > 0 ? regional : candidates.filter((n) => n.regionCode === null);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => {
    const serviceScore = Number(b.serviceType !== null) - Number(a.serviceType !== null);
    if (serviceScore !== 0) return serviceScore;
    const specificity = Object.keys(b.condition ?? {}).length - Object.keys(a.condition ?? {}).length;
    if (specificity !== 0) return specificity;
    return b.validFrom.localeCompare(a.validFrom);
  });
  return sorted[0] ?? null;
}

/** Длительность нормы в миллисекундах; null — единица не длительность (рабочие дни, люди, градусы). */
export function normDurationMs(norm: Pick<NormRecord, 'value' | 'unit'>): number | null {
  switch (norm.unit) {
    case 'min':
      return norm.value * MS_PER_MINUTE;
    case 'h':
      return norm.value * MS_PER_HOUR;
    case 'day':
      return norm.value * MS_PER_DAY;
    case 'workday':
    case 'person':
    case 'celsius':
      return null;
  }
}

/** Основание для показа рядом с числом: «Основание: {doc}, {point}». */
export interface NormBasis {
  code: string;
  title: string;
  doc: string;
  point: string;
  textPlain: string;
  quote: string | null;
  edition: string;
  validFrom: string;
  validTo: string | null;
  checkedAt: string | null;
  sourceUrl: string;
}

export function normBasis(norm: NormRecord): NormBasis {
  return {
    code: norm.code,
    title: norm.title,
    doc: norm.basisDoc,
    point: norm.basisPoint,
    textPlain: norm.textPlain,
    quote: norm.basisQuote,
    edition: norm.editionDate,
    validFrom: norm.validFrom,
    validTo: norm.validTo,
    checkedAt: norm.checkedAt,
    sourceUrl: norm.sourceUrl,
  };
}
