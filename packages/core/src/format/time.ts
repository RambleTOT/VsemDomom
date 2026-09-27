/**
 * Время и длительности по правилам стиля: 24 часа («18:00»), даты «27.09» в чате,
 * длительность «11 ч 40 мин», «2 сут 3 ч». Всегда в часовом поясе дома.
 */
import { tz } from '@date-fns/tz';
import { format } from 'date-fns';
import { KOPECK_DIGITS } from '../constants/limits.ts';
import { HOURS_PER_DAY, KOPECKS_PER_RUBLE, MINUTES_PER_HOUR, MS_PER_MINUTE } from '../constants/time.ts';

const inZone = (timezone: string) => ({ in: tz(timezone) });

/** «17:40». */
export function formatTime(at: Date, timezone: string): string {
  return format(at, 'HH:mm', inZone(timezone));
}

/** «27.09». */
export function formatDate(at: Date, timezone: string): string {
  return format(at, 'dd.MM', inZone(timezone));
}

function sameLocalDay(a: Date, b: Date, timezone: string): boolean {
  return format(a, 'yyyy-MM-dd', inZone(timezone)) === format(b, 'yyyy-MM-dd', inZone(timezone));
}

/**
 * Время для чата: в тот же день — «17:40», в другой — «28.09 17:40».
 * Относительного времени («через 12 мин») в чате нет: карточка правится не каждую минуту.
 */
export function formatChatTime(at: Date, now: Date, timezone: string): string {
  return sameLocalDay(at, now, timezone) ? formatTime(at, timezone) : `${formatDate(at, timezone)} ${formatTime(at, timezone)}`;
}

/** Месяц в именительном падеже для итогов: «сентябрь». */
const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

/** «За сентябрь»: предлог «за» требует винительного, он совпадает с именительным для месяцев. */
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** Длительность: «40 мин», «1 ч 30 мин», «11 ч 40 мин», «2 сут 3 ч». Минуты округляются вниз. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MS_PER_MINUTE));
  const minutesPerDay = HOURS_PER_DAY * MINUTES_PER_HOUR;
  const days = Math.floor(totalMinutes / minutesPerDay);
  const hours = Math.floor((totalMinutes % minutesPerDay) / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (days > 0) return hours > 0 ? `${days} сут ${hours} ч` : `${days} сут`;
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  return `${minutes} мин`;
}

const NBSP = ' ';

/** Сумма в рублях: «1 200 ₽», «7,20 ₽» — неразрывные пробелы, запятая. */
export function formatRubles(kopecks: number): string {
  const sign = kopecks < 0 ? '−' : '';
  const abs = Math.abs(Math.round(kopecks));
  const rubles = Math.floor(abs / KOPECKS_PER_RUBLE);
  const cents = abs % KOPECKS_PER_RUBLE;
  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return cents === 0
    ? `${sign}${grouped}${NBSP}₽`
    : `${sign}${grouped},${String(cents).padStart(KOPECK_DIGITS, '0')}${NBSP}₽`;
}

/** Процент: «0,15 %». */
export function formatPercent(value: string | number): string {
  return `${String(value).replace('.', ',')}${NBSP}%`;
}
