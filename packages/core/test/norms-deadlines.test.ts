import { describe, expect, it } from 'vitest';
import {
  computeDeadlines,
  deadlineState,
  isNormValidAt,
  deadlineDone,
  nextDeadline,
  normDurationMs,
  resolveDeadlineAt,
  selectNorm,
  type NormRecord,
} from '../src/index.ts';
import { at, H, house1, MIN, seedNorms } from './helpers/norms.ts';

const norms = seedNorms();
const now = at('2026-09-27T12:00:00Z');

describe('выбор нормы из справочника', () => {
  it('горячая вода: 4 ч единовременно, на тупиковой магистрали — 24 ч', () => {
    const q = { service: 'hot_water' as const, event: 'interruption_single' as const, at: now };
    expect(selectNorm(norms, { ...q, house: house1 })?.code).toBe('pr354.app1.p4.single');
    expect(selectNorm(norms, { ...q, house: { ...house1, hotWaterDeadEnd: true } })?.code).toBe('pr354.app1.p4.single_dead_end');
  });

  it('свет: 2 ч при двух источниках, 24 ч при одном', () => {
    const q = { service: 'electricity' as const, event: 'interruption_monthly' as const, at: now };
    const two = selectNorm(norms, { ...q, house: house1 });
    const one = selectNorm(norms, { ...q, house: { ...house1, powerSources: 1 } });
    expect(two && normDurationMs(two)).toBe(2 * H);
    expect(one && normDurationMs(one)).toBe(24 * H);
  });

  it('отопление: по умолчанию 16 ч единовременно', () => {
    const n = selectNorm(norms, { service: 'heating', event: 'interruption_single', house: house1, at: now });
    expect(n && normDurationMs(n)).toBe(16 * H);
  });

  it('норма «для любой услуги» подходит, если своей нет', () => {
    expect(selectNorm(norms, { service: 'gas', event: 'uk_eta', house: house1, at: now })?.code).toBe('pp416.p13.uk_eta');
    expect(selectNorm(norms, { service: 'gas', event: 'localize', house: house1, at: now })).toBeNull();
  });

  it('региональная норма важнее федеральной', () => {
    const regional: NormRecord = { ...norms.find((n) => n.code === 'pr354.app1.p4.monthly')!, id: 999, code: 'region.77.hw', value: 6, regionCode: '77' };
    const list = [...norms, regional];
    expect(selectNorm(list, { service: 'hot_water', event: 'interruption_monthly', house: { ...house1, regionCode: '77' }, at: now })?.code).toBe('region.77.hw');
    expect(selectNorm(list, { service: 'hot_water', event: 'interruption_monthly', house: house1, at: now })?.code).toBe('pr354.app1.p4.monthly');
  });

  it('учитывает даты действия редакции (в часовом поясе дома)', () => {
    const n = { validFrom: '2026-09-01', validTo: '2027-12-31' };
    expect(isNormValidAt(n, at('2026-08-31T20:59:00Z'), 'Europe/Moscow')).toBe(false); // 23:59 МСК 31.08
    expect(isNormValidAt(n, at('2026-08-31T21:00:00Z'), 'Europe/Moscow')).toBe(true); // 00:00 МСК 01.09
    expect(isNormValidAt(n, at('2028-01-01T12:00:00Z'), 'Europe/Moscow')).toBe(false);
  });
});

describe('сроки по нормативам (F04)', () => {
  const incident = {
    serviceType: 'hot_water' as const,
    startedAt: at('2026-09-27T14:40:00Z'),
    createdAt: at('2026-09-27T14:42:00Z'),
    adsRegAt: null,
  };
  const opts = { warnBeforeMs: 30 * MIN };

  it('горячая вода: сообщить сроки, локализовать, устранить, единовременный лимит', () => {
    const plans = computeDeadlines(incident, norms, house1, opts);
    const byKind = Object.fromEntries(plans.map((p) => [p.kind, p]));
    expect(Object.keys(byKind).sort()).toEqual(['answer', 'fix', 'localize', 'single_limit']);
    expect(byKind.answer?.dueAt).toEqual(at('2026-09-27T15:12:00Z'));
    expect(byKind.answer?.anchor).toBe('service_report');
    expect(byKind.localize?.dueAt).toEqual(at('2026-09-27T15:12:00Z'));
    expect(byKind.fix?.dueAt).toEqual(at('2026-09-30T14:40:00Z'));
    expect(byKind.fix?.anchor).toBe('started');
    expect(byKind.single_limit?.dueAt).toEqual(at('2026-09-27T18:40:00Z'));
    expect(byKind.fix?.warnAt).toEqual(at('2026-09-30T14:10:00Z'));
    expect(byKind.answer?.norm.basisPoint).toBe('п. 13');
  });

  it('регистрация в АДС пересчитывает сроки от её времени', () => {
    const plans = computeDeadlines({ ...incident, adsRegAt: at('2026-09-27T15:00:00Z') }, norms, house1, opts);
    const answer = plans.find((p) => p.kind === 'answer');
    expect(answer?.dueAt).toEqual(at('2026-09-27T15:30:00Z'));
    expect(answer?.anchor).toBe('ads_registration');
    expect(plans.find((p) => p.kind === 'fix')?.dueAt).toEqual(at('2026-09-30T14:40:00Z'));
  });

  it('канализация получает срок устранения засора; газ — только «сообщить сроки»', () => {
    expect(computeDeadlines({ ...incident, serviceType: 'sewerage' }, norms, house1, opts).map((p) => p.kind)).toContain('clog');
    expect(computeDeadlines({ ...incident, serviceType: 'gas' }, norms, house1, opts).map((p) => p.kind)).toEqual(['answer']);
  });

  it('нормы нет — срок не создаётся', () => {
    expect(computeDeadlines(incident, [], house1, opts)).toEqual([]);
  });

  it('предупреждение не раньше точки отсчёта', () => {
    const plans = computeDeadlines(incident, norms, house1, { warnBeforeMs: 60 * MIN });
    expect(plans.find((p) => p.kind === 'answer')?.warnAt).toEqual(incident.createdAt);
  });

  it('состояние: pending → soon → breached; следующий срок включает истёкшие', () => {
    const d = { kind: 'answer' as const, status: 'pending' as const, dueAt: at('2026-09-27T15:12:00Z'), warnAt: at('2026-09-27T14:42:00Z') };
    expect(deadlineState(d, at('2026-09-27T14:41:00Z'))).toBe('pending');
    expect(deadlineState(d, at('2026-09-27T14:50:00Z'))).toBe('soon');
    expect(deadlineState(d, at('2026-09-27T15:12:00Z'))).toBe('breached');
    expect(deadlineState({ ...d, status: 'met' }, at('2026-09-27T16:00:00Z'))).toBe('met');
    const list = [
      { ...d, kind: 'single_limit' as const, dueAt: at('2026-09-27T15:00:00Z') },
      { ...d, kind: 'fix' as const, dueAt: at('2026-09-30T14:40:00Z') },
      { ...d, status: 'breached' as const },
    ];
    expect(nextDeadline(list)?.kind).toBe('answer');
    // УК назвала ориентир уже после срока: истёкший срок ответа выполнен — следующим становится «устранить».
    const late = { etaAt: at('2026-09-27T16:00:00Z'), localizedAt: null, resolvedAtUk: null };
    expect(nextDeadline(list, late)?.kind).toBe('fix');
    expect(deadlineDone('answer', late)).toBe(true);
    expect(deadlineDone('localize', late)).toBe(false);
    expect(deadlineDone('localize', { ...late, resolvedAtUk: at('2026-09-27T17:00:00Z') })).toBe(true);
    expect(resolveDeadlineAt(d, at('2026-09-27T15:00:00Z'))).toBe('met');
    expect(resolveDeadlineAt(d, at('2026-09-27T15:20:00Z'))).toBe('breached');
  });
});
