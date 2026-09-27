import { describe, expect, it } from 'vitest';
import { historyWindow, modelUserId } from '../src/db/seed.ts';

const TZ = 'Europe/Moscow';
const step = { monthDay: 2, startTime: '08:00', steps: { resolvedMin: 360 } };

describe('даты истории в сидах', () => {
  it('ставит интервал в заданный день текущего месяца в поясе дома', () => {
    const w = historyWindow(step, TZ, new Date('2026-09-27T10:00:00Z'));
    expect(w?.start.toISOString()).toBe('2026-09-02T05:00:00.000Z');
    expect(w?.end.toISOString()).toBe('2026-09-02T11:00:00.000Z');
  });

  it('если день ещё не наступил — интервал заканчивается прямо перед запуском', () => {
    const w = historyWindow(step, TZ, new Date('2026-10-01T09:00:00Z')); // 12:00 МСК 1 октября
    expect(w?.start.toISOString()).toBe('2026-10-01T02:55:00.000Z'); // 05:55 МСК
    expect(w?.end.toISOString()).toBe('2026-10-01T08:55:00.000Z'); // 11:55 МСК
  });

  it('в самом начале месяца прижимает к началу месяца и укорачивает', () => {
    const w = historyWindow(step, TZ, new Date('2026-10-01T00:00:00Z')); // 03:00 МСК 1 октября
    expect(w?.start.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // 00:00 МСК
    expect(w?.end.toISOString()).toBe('2026-09-30T23:55:00.000Z'); // 02:55 МСК
  });

  it('если места в месяце нет — пропускает', () => {
    expect(historyWindow(step, TZ, new Date('2026-09-30T21:03:00Z'))).toBeNull();
  });

  it('синтетические пользователи — отрицательные ID по дому и квартире', () => {
    expect(modelUserId('1', 21)).toBe(-100021);
    expect(modelUserId('3', 190)).toBe(-300190);
  });
});
