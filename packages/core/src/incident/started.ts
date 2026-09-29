/**
 * Начало аварии (F01): быстрые варианты и своё время. Время в будущем — ошибка
 * (с допуском на расхождение часов), старше порога — нужно подтверждение.
 */
import { TZDate } from '@date-fns/tz';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../constants/time.ts';
import { STARTED_PRESET_HOURS, type StartedPreset } from '../domain/enums.ts';

/**
 * С точностью до минуты: время в сообщениях — без секунд, и с секундами в начале длительность
 * расходилась с показанным временем («16:52–17:57, 1 ч 4 мин»).
 */
export function startedAtFromPreset(preset: Exclude<StartedPreset, 'custom'>, now: Date): Date {
  const at = now.getTime() - STARTED_PRESET_HOURS[preset] * MS_PER_HOUR;
  return new Date(Math.floor(at / MS_PER_MINUTE) * MS_PER_MINUTE);
}

export type StartedAtCheck = 'ok' | 'future' | 'old' | 'too_old';

/**
 * Начало аварии: в будущем (с допуском на часы) — ошибка; старше confirmOldAfterMs — нужно
 * подтверждение; старше maxAgeMs — не принимается (такое начало ломает сроки и суммы за месяц).
 */
export function checkStartedAt(
  startedAt: Date,
  now: Date,
  options: { futureSkewMs: number; confirmOldAfterMs: number; maxAgeMs?: number },
): StartedAtCheck {
  if (startedAt.getTime() > now.getTime() + options.futureSkewMs) return 'future';
  const age = now.getTime() - startedAt.getTime();
  if (options.maxAgeMs !== undefined && age > options.maxAgeMs) return 'too_old';
  if (age > options.confirmOldAfterMs) return 'old';
  return 'ok';
}

/** Момент события аварии (регистрация в АДС, повторное сообщение): не раньше notBefore и не в будущем. */
export function checkMomentInRange(at: Date, now: Date, options: { notBefore: Date; futureSkewMs: number }): 'ok' | 'before' | 'future' {
  if (at.getTime() > now.getTime() + options.futureSkewMs) return 'future';
  if (at.getTime() < options.notBefore.getTime()) return 'before';
  return 'ok';
}

const TIME_ONLY = /^\s*(\d{1,2})[:.](\d{2})\s*$/;
const DATE_TIME = /^\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2})[:.](\d{2})\s*$/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_MONTH = 12;

function inZone(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date | null {
  if (hour > MAX_HOUR || minute > MAX_MINUTE || month < 1 || month > MAX_MONTH || day < 1) return null;
  const date = new TZDate(year, month - 1, day, hour, minute, timezone);
  // 31.02 и подобные даты date-fns переносит на следующий месяц — такие отвергаем.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return new Date(date.getTime());
}

/**
 * Время, написанное жителем в личке, в поясе дома: «17:40» (сегодня), «26.09 17:40»
 * (этот год), «26.09.2026 17:40». null — формат не распознан.
 */
export function parseLocalDateTime(text: string, now: Date, timezone: string): Date | null {
  const today = new TZDate(now.getTime(), timezone);
  const time = TIME_ONLY.exec(text);
  if (time) return inZone(today.getFullYear(), today.getMonth() + 1, today.getDate(), Number(time[1]), Number(time[2]), timezone);
  const full = DATE_TIME.exec(text);
  if (full) {
    const year = full[3] ? Number(full[3]) : today.getFullYear();
    return inZone(year, Number(full[2]), Number(full[1]), Number(full[4]), Number(full[5]), timezone);
  }
  return null;
}
