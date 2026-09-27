import { describe, expect, it } from 'vitest';
import { formatChatTime, formatDate, formatDuration, formatPercent, formatRubles, formatTime, monthName, pluralForm } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const TZ = 'Europe/Moscow';
const at = (iso: string) => new Date(iso);

describe('время и числа по правилам стиля', () => {
  it('время в часовом поясе дома, 24 часа', () => {
    expect(formatTime(at('2026-09-27T14:40:00Z'), TZ)).toBe('17:40');
    expect(formatDate(at('2026-09-27T14:40:00Z'), TZ)).toBe('27.09');
  });

  it('в чате: тот же день — «17:40», другой — «30.09 17:40»', () => {
    const now = at('2026-09-27T15:00:00Z');
    expect(formatChatTime(at('2026-09-27T14:40:00Z'), now, TZ)).toBe('17:40');
    expect(formatChatTime(at('2026-09-30T14:40:00Z'), now, TZ)).toBe('30.09 17:40');
    // 23:30 МСК 27.09 и 00:10 МСК 28.09 — разные сутки дома
    expect(formatChatTime(at('2026-09-27T21:10:00Z'), at('2026-09-27T20:30:00Z'), TZ)).toBe('28.09 00:10');
  });

  it('длительность: «40 мин», «1 ч 30 мин», «11 ч 40 мин», «2 сут 3 ч»', () => {
    const MIN = 60_000;
    expect(formatDuration(40 * MIN)).toBe('40 мин');
    expect(formatDuration(90 * MIN)).toBe('1 ч 30 мин');
    expect(formatDuration(700 * MIN)).toBe('11 ч 40 мин');
    expect(formatDuration(180 * MIN)).toBe('3 ч');
    expect(formatDuration((2 * 24 + 3) * 60 * MIN)).toBe('2 сут 3 ч');
    expect(formatDuration(72 * 60 * MIN)).toBe('3 сут');
    expect(formatDuration(-5)).toBe('0 мин');
  });

  it('рубли и проценты: неразрывные пробелы, запятая', () => {
    expect(formatRubles(120_000)).toBe('1 200 ₽');
    expect(formatRubles(720)).toBe('7,20 ₽');
    expect(formatRubles(21_600)).toBe('216 ₽');
    expect(formatRubles(5)).toBe('0,05 ₽');
    expect(formatPercent('0.15')).toBe('0,15 %');
    expect(monthName(9)).toBe('сентябрь');
  });

  it('склонения: 1 квартира, 2 квартиры, 5 квартир, 11 квартир, 21 квартира', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111, 0].map(pluralForm)).toEqual(['one', 'few', 'many', 'many', 'many', 'one', 'few', 'many', 'many', 'many']);
    expect(t.plural(3, 'flats')).toBe('квартиры');
    expect(t.plural(11, 'residents')).toBe('жителей');
    expect(() => t.t('no.such.key')).toThrow();
  });
});
