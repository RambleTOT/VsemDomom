import { describe, expect, it } from 'vitest';
import { isFloorInRange, isOpenStatus, ManualClock, normBasis, normDurationMs, OPEN_STATUSES } from '../src/index.ts';
import { seedNorms } from './helpers/norms.ts';

describe('служебное ядра', () => {
  it('управляемые часы для тестов и сценария', () => {
    const clock = new ManualClock(new Date('2026-09-27T10:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-09-27T10:00:00.000Z');
    expect(clock.advance(90_000).toISOString()).toBe('2026-09-27T10:01:30.000Z');
    clock.set(new Date('2026-10-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('открытые статусы', () => {
    expect(OPEN_STATUSES.every(isOpenStatus)).toBe(true);
    expect(isOpenStatus('closed')).toBe(false);
    expect(isOpenStatus('merged')).toBe(false);
  });

  it('основание нормы для показа', () => {
    const norm = seedNorms().find((n) => n.code === 'pp416.p34.act_copy')!;
    expect(normBasis(norm)).toMatchObject({ doc: 'ПП № 416', point: 'п. 34', edition: '2026-06-20', validFrom: '2026-09-01' });
    expect(normDurationMs(norm)).toBeNull();
  });

  it('этаж в пределах дома', () => {
    expect(isFloorInRange({ floors: 9 }, 9)).toBe(true);
    expect(isFloorInRange({ floors: 9 }, 10)).toBe(false);
  });

  it('в справочнике у каждой нормы есть основание и дата проверки', () => {
    for (const n of seedNorms()) {
      expect(n.basisDoc, n.code).toBeTruthy();
      expect(n.basisPoint, n.code).toBeTruthy();
      expect(n.textPlain, n.code).toBeTruthy();
      expect(n.sourceUrl, n.code).toMatch(/^https:\/\//);
      expect(n.checkedAt, n.code).not.toBeNull();
    }
  });
});
