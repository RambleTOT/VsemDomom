import type { IncidentDetail, TimelineEvent } from '@vsemdomom/shared';
import { describe, expect, it } from 'vitest';
import open from '@vsemdomom/shared/examples/incident-open.json' with { type: 'json' };
import discrepancy from '@vsemdomom/shared/examples/incident-discrepancy.json' with { type: 'json' };
import { heatState } from '../src/components/grid.tsx';
import { eventText, headlineText } from '../src/texts.ts';

const NOW = new Date('2026-09-27T16:30:00Z');
const openIncident = open as IncidentDetail;
const discIncident = discrepancy as IncidentDetail;

function withStatus(status: IncidentDetail['displayStatus'], headline: Partial<IncidentDetail['headline']> = {}): IncidentDetail {
  return { ...openIncident, displayStatus: status, headline: { ...openIncident.headline, displayStatus: status, ...headline } };
}

describe('первая строка: знает ли УК и когда', () => {
  it('открыта — УК ещё не ответила', () => {
    expect(headlineText(openIncident, NOW).title).toContain('УК ещё не ответила');
  });

  it('принята с ориентиром и без', () => {
    expect(headlineText(withStatus('accepted', { eta: '2026-09-27T18:00:00Z' }), NOW).title).toBe('УК приняла · ориентир 21:00');
    expect(headlineText(withStatus('accepted', { eta: null }), NOW).title).not.toContain('{');
  });

  it('расхождение — число квартир по-русски', () => {
    const { title, sub } = headlineText(discIncident, NOW);
    expect(title).toBe('У 3 квартир нет горячей воды');
    expect(sub).toBe('УК отметила устранение в 19:10');
  });

  it('закрыта — длительность по отметке УК', () => {
    expect(headlineText(withStatus('closed', { durationMinutes: 90 }), NOW).title).toBe('Закрыта · 1 ч 30 мин по отметке УК');
  });

  it('во всех статусах нет незаполненных подстановок', () => {
    for (const s of ['open', 'accepted', 'brigade_on_site', 'localized', 'checking', 'discrepancy', 'closed', 'closed_with_discrepancy', 'merged'] as const) {
      const { title, sub } = headlineText(withStatus(s, { statusAt: '2026-09-27T16:10:00Z' }), NOW);
      expect(`${title} ${sub ?? ''}`).not.toMatch(/[{}]/);
    }
  });
});

describe('хронология', () => {
  const event = (type: TimelineEvent['type'], payload: Record<string, unknown> = {}): TimelineEvent => ({
    type,
    at: '2026-09-27T15:00:00Z',
    actorType: 'resident',
    source: 'miniapp',
    mine: false,
    payload,
  });

  it('подставляет подъезд, номер заявки и пропущенные шаги', () => {
    expect(eventText(event('joined', { entrance: 2 }), 'Europe/Moscow')).toContain('2');
    expect(eventText(event('ads_registered', { number: '4127' }), 'Europe/Moscow')).toContain('4127');
    expect(eventText(event('skipped_steps', { steps: ['brigade_on_site', 'localized'] }), 'Europe/Moscow')).toMatch(/Бригада на месте.*Локализована/);
  });

  it('у каждого типа события есть текст', () => {
    for (const e of discIncident.timeline) expect(eventText(e, 'Europe/Moscow')).not.toBe(e.type);
  });
});

describe('тепловая карта', () => {
  it('ячейка — по большинству, при равенстве — холоднее', () => {
    expect(heatState(undefined)).toBe('none');
    expect(heatState({ warm: 0, luke: 0, cold: 0 })).toBe('none');
    expect(heatState({ warm: 3, luke: 1, cold: 0 })).toBe('warm');
    expect(heatState({ warm: 1, luke: 1, cold: 0 })).toBe('luke');
    expect(heatState({ warm: 1, luke: 1, cold: 1 })).toBe('cold');
  });
});
