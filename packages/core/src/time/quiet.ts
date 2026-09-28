/**
 * Тихие часы (по умолчанию 22:00–08:00 по времени дома): опросы и итог месяца в чат в это время
 * не отправляются, а переносятся на их конец.
 */
import { TZDate } from '@date-fns/tz';
import { MINUTES_PER_HOUR } from '../constants/time.ts';

export interface QuietHours {
  /** Начало, HH:MM. */
  from: string;
  /** Конец, HH:MM. */
  to: string;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * MINUTES_PER_HOUR + (m ?? 0);
}

export function isQuietTime(at: Date, timezone: string, quiet: QuietHours): boolean {
  const local = new TZDate(at.getTime(), timezone);
  const now = local.getHours() * MINUTES_PER_HOUR + local.getMinutes();
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Первый момент не раньше at вне тихих часов (конец тихих часов, если at внутри них). */
export function afterQuietHours(at: Date, timezone: string, quiet: QuietHours): Date {
  if (!isQuietTime(at, timezone, quiet)) return at;
  const local = new TZDate(at.getTime(), timezone);
  const to = minutesOf(quiet.to);
  const end = new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), Math.floor(to / MINUTES_PER_HOUR), to % MINUTES_PER_HOUR, 0, timezone);
  // Тихие часы через полночь, а сейчас вечер — конец завтра утром.
  if (end.getTime() <= at.getTime()) end.setDate(end.getDate() + 1);
  return new Date(end.getTime());
}
