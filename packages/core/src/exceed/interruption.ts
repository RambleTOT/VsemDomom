/**
 * Перерывы услуги за календарный месяц в часовом поясе дома: интервалы объединяются
 * (пересечения не складываются дважды) и обрезаются границами месяца.
 */
import { TZDate } from '@date-fns/tz';
import { MONTH_DIGITS } from '../constants/limits.ts';

export interface Interval {
  start: Date;
  end: Date;
}

export interface MonthRef {
  year: number;
  /** 1–12 */
  month: number;
}

/** Объединение интервалов: отсортированные непересекающиеся отрезки. Пустые и обратные отбрасываются. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end.getTime() > i.start.getTime())
    .map((i) => ({ start: i.start.getTime(), end: i.end.getTime() }))
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged.map((m) => ({ start: new Date(m.start), end: new Date(m.end) }));
}

/** Месяц, в который попадает момент, в часовом поясе дома. */
export function monthOf(at: Date, timezone: string): MonthRef {
  const local = new TZDate(at.getTime(), timezone);
  return { year: local.getFullYear(), month: local.getMonth() + 1 };
}

/** Границы месяца [start, end) в часовом поясе дома. */
export function monthBounds(month: MonthRef, timezone: string): Interval {
  const start = new TZDate(month.year, month.month - 1, 1, 0, 0, 0, timezone);
  const end = new TZDate(month.year, month.month, 1, 0, 0, 0, timezone);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export function monthKey(month: MonthRef): string {
  return `${month.year}-${String(month.month).padStart(MONTH_DIGITS, '0')}`;
}

function totalMs(list: readonly Interval[]): number {
  return list.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
}

export interface InterruptionInput {
  intervals: readonly Interval[];
  month: MonthRef;
  timezone: string;
  /** Допустимый перерыв единовременно; null — норматив не установлен. */
  singleLimitMs: number | null;
  /** Допустимые перерывы за месяц суммарно; null — норматив не установлен. */
  monthlyLimitMs: number | null;
}

export interface InterruptionSummary {
  month: MonthRef;
  /** Объединённые интервалы, обрезанные границами месяца. */
  intervals: Interval[];
  monthlyTotalMs: number;
  /** Самый длинный непрерывный перерыв, задевающий месяц (без обрезки границей месяца). */
  longestMs: number;
  singleExceeded: boolean;
  singleExcessMs: number;
  monthlyExcessMs: number;
}

export function computeInterruption(input: InterruptionInput): InterruptionSummary {
  const bounds = monthBounds(input.month, input.timezone);
  const merged = mergeIntervals(input.intervals);
  const touching = merged.filter(
    (i) => i.end.getTime() > bounds.start.getTime() && i.start.getTime() < bounds.end.getTime(),
  );
  const clipped = touching.map((i) => ({
    start: new Date(Math.max(i.start.getTime(), bounds.start.getTime())),
    end: new Date(Math.min(i.end.getTime(), bounds.end.getTime())),
  }));
  const monthlyTotalMs = totalMs(clipped);
  const longestMs = touching.reduce((max, i) => Math.max(max, i.end.getTime() - i.start.getTime()), 0);
  const singleExcessMs = input.singleLimitMs === null ? 0 : Math.max(0, longestMs - input.singleLimitMs);
  const monthlyExcessMs = input.monthlyLimitMs === null ? 0 : Math.max(0, monthlyTotalMs - input.monthlyLimitMs);
  return {
    month: input.month,
    intervals: clipped,
    monthlyTotalMs,
    longestMs,
    singleExceeded: singleExcessMs > 0,
    singleExcessMs,
    monthlyExcessMs,
  };
}
