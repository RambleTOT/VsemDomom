/** Время и длительности — всегда в часовом поясе дома (ядро через packages/shared). */
import { formatChatTime, formatDate, formatDuration, formatPercent, formatRubles, formatTime, monthName } from '@vsemdomom/shared/browser';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export const toDate = (iso: string): Date => new Date(iso);
export const timeIn = (iso: string, tz: string): string => formatTime(toDate(iso), tz);
export const dateIn = (iso: string, tz: string): string => formatDate(toDate(iso), tz);
/** «28.09.2026» — для документов (заявление, акт). */
export const fullDateIn = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(toDate(iso));
/** «17:40», «вчера 22:10», «25.09 08:00» — относительно «сейчас». */
export const whenIn = (iso: string, tz: string, now: Date = new Date()): string => formatChatTime(toDate(iso), now, tz);
export const minutesText = (minutes: number): string => formatDuration(minutes * MS_PER_MINUTE);
export const msText = (ms: number): string => formatDuration(ms);
export const rubles = (value: number): string => formatRubles(Math.round(value * 100));
export const percent = (value: number): string => formatPercent(value);
/** «2026-09» → «сентябрь». */
export function monthOfKey(key: string): string {
  const month = Number(key.split('-')[1]);
  return Number.isInteger(month) ? monthName(month) : key;
}
/** Минут до срока (не меньше нуля). */
export const minutesLeft = (iso: string, now: Date = new Date()): number => Math.max(0, Math.ceil((toDate(iso).getTime() - now.getTime()) / MS_PER_MINUTE));

/** Значение для <input type="datetime-local"> в часовом поясе устройства. */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Сегодня в hour:00 по часовому поясу дома; null — это время уже прошло. */
export function todayAt(hour: number, tz: string, now: Date = new Date()): Date | null {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const minutesNow = value('hour') * MINUTES_PER_HOUR + value('minute');
  const diff = hour * MINUTES_PER_HOUR - minutesNow;
  if (diff <= 0) return null;
  const at = new Date(now.getTime() + diff * MS_PER_MINUTE);
  at.setSeconds(0, 0);
  return at;
}
