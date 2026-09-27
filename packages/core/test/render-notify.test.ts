import { describe, expect, it } from 'vitest';
import { renderDeadlineNotice, renderStatusNotice, validateBotMessage, type BotMessage, type StatusNoticeInput } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const TZ = 'Europe/Moscow';
const at = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);
const house = { label: '1', timezone: TZ, isModel: true };

function assertDm(m: BotMessage): void {
  expect(validateBotMessage(m)).toEqual([]);
  expect(m.text).not.toMatch(/\{\w+\}/);
  expect(m.keyboard.map((r) => r.map((b) => `${b.type}:${b.text}`))).toEqual([['open_app:Подробнее', 'callback:Не присылать']]);
  expect(m.text.split('\n').at(-1)).toBe('Модельные данные');
}

const base: StatusNoticeInput = {
  incidentPublicId: 'K3f9QpZ2aB',
  service: 'hot_water',
  status: 'accepted',
  eta: at('18:00'),
  statusAt: at('17:50'),
  localize: { dueAt: at('18:10'), basisDoc: 'ПП № 416', basisPoint: 'п. 13' },
  house,
  botUsername: 'vsemdomom_bot',
  now: at('17:50'),
};

describe('личные уведомления присоединившимся (C05 «Статус изменился», F04)', () => {
  it('«Принята»: ориентир УК и срок локализации с основанием', () => {
    const m = renderStatusNotice(base, t);
    assertDm(m);
    expect(m.text).toMatchInlineSnapshot(`
      "🟠 УК приняла аварию, ориентир 18:00
      Горячая вода, Дом 1. Локализовать до 18:10 (ПП № 416, п. 13)
      Модельные данные"
    `);
    expect(m.keyboard[0]?.[1]).toMatchObject({ payload: 'v1:mute:K3f9QpZ2aB' });
    expect(m.keyboard[0]?.[0]).toMatchObject({ payload: 'i_K3f9QpZ2aB' });
  });

  it('остальные шаги УК', () => {
    const lines = (input: Partial<StatusNoticeInput>) => renderStatusNotice({ ...base, ...input }, t).text.split('\n');
    expect(lines({ eta: null, localize: null })).toEqual(['🟠 УК приняла аварию', 'Горячая вода, Дом 1', 'Модельные данные']);
    expect(lines({ status: 'brigade_on_site', statusAt: at('18:05') })).toEqual([
      '🟠 Бригада УК на месте с 18:05',
      'Горячая вода, Дом 1. Ориентир УК 18:00',
      'Модельные данные',
    ]);
    expect(lines({ status: 'localized', statusAt: at('18:20'), eta: null })[0]).toBe('🟠 Авария локализована в 18:20');
    expect(lines({ status: 'checking', statusAt: at('19:10'), service: 'heating' })).toEqual([
      '🔵 УК отметила устранение в 19:10',
      'Отопление, Дом 1. Батареи снова тёплые? Ответьте в чате дома или в «Подробнее»',
      'Модельные данные',
    ]);
  });

  it('сроки: «до срока 30 минут» и «срок истёк» — нейтрально, с названием нормы', () => {
    const input = { incidentPublicId: 'K3f9QpZ2aB', service: 'hot_water' as const, title: 'Локализовать аварию', dueAt: at('18:10'), house, botUsername: 'vsemdomom_bot', now: at('17:40') };
    const soon = renderDeadlineNotice({ ...input, kind: 'warn' }, t);
    assertDm(soon);
    expect(soon.text).toBe('До срока по нормативу 30 минут: локализовать аварию до 18:10\nГорячая вода, Дом 1\nМодельные данные');
    const expired = renderDeadlineNotice({ ...input, kind: 'breach', now: at('18:11') }, t);
    assertDm(expired);
    expect(expired.text.split('\n')[0]).toBe('Срок по нормативу истёк в 18:10: локализовать аварию');
    expect(expired.text).not.toMatch(/наруш|виноват|УК не/i);
    const answer = renderDeadlineNotice({ ...input, kind: 'breach', title: 'УК сообщит сроки работ', now: at('18:11') }, t);
    expect(answer.text.split('\n')[0]).toBe('Срок по нормативу истёк в 18:10: УК сообщит сроки работ');
  });
});
