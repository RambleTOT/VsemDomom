import type { ActInfo, IncidentDetail, Result } from '@vsemdomom/shared';
import { describe, expect, it } from 'vitest';
import discrepancy from '@vsemdomom/shared/examples/incident-discrepancy.json' with { type: 'json' };
import resultExample from '@vsemdomom/shared/examples/result.json' with { type: 'json' };
import { actTemplateText, parseCharge, statementText, timelineText } from '../src/documents.ts';

const incident = discrepancy as IncidentDetail;
const result = resultExample as Result;

describe('сумма из квитанции', () => {
  it.each([
    ['1250', 1250],
    ['1 250', 1250],
    ['1 250,50', 1250.5],
    ['99.9', 99.9],
  ])('«%s» → %s', (text, value) => {
    expect(parseCharge(text)).toBe(value);
  });

  it.each(['', '0', '-5', 'abc', '12,345', '1e3', '2000000'])('«%s» — ошибка', (text) => {
    expect(parseCharge(text)).toBeNull();
  });
});

describe('заявление на перерасчёт', () => {
  const withAds: IncidentDetail = {
    ...incident,
    ads: { ...incident.ads, registration: { number: '4127', at: '2026-09-27T14:52:00Z', notReached: false } },
    me: incident.me ? { ...incident.me, adsRereport: { number: '4188', at: '2026-09-27T16:30:00Z' } } : null,
  };

  it('по шаблону: УК, квартира, время, заявки в АДС и пункт нормы', () => {
    const text = statementText({ result, incident: withAds, ukName: 'УК Модельная', fio: 'Тестов Тест', phone: '+7 900 000-00-00' });
    expect(text).toContain('В УК Модельная от Тестов Тест');
    expect(text).toContain('кв. 57');
    expect(text).toContain('с 17:40 до 23:20');
    expect(text).toContain('№ 4127, 4188');
    expect(text).toContain(`${result.month!.norm.doc}, ${result.month!.norm.point}`);
    expect(text).toContain('горячую воду');
    expect(text).toContain('Телефон: +7 900 000-00-00');
    expect(text).not.toMatch(/[{}]/);
  });

  it('без номеров заявок — без скобки про АДС, без ФИО — место для подписи', () => {
    const noAds: IncidentDetail = { ...incident, ads: { ...incident.ads, registration: null }, me: incident.me ? { ...incident.me, adsRereport: null } : null };
    const text = statementText({ result, incident: noAds, ukName: 'УК Модельная', fio: '  ', phone: '' });
    expect(text).not.toContain('АДС №');
    expect(text).toContain('от ____');
    expect(text).not.toContain('Телефон');
  });

  it('не житель дома или нет месячной нормы — пусто', () => {
    expect(statementText({ result: { ...result, my: null }, incident, ukName: 'УК', fio: 'Ф', phone: '' })).toBe('');
    expect(statementText({ result: { ...result, month: null }, incident, ukName: 'УК', fio: 'Ф', phone: '' })).toBe('');
  });
});

describe('образец акта и хронология', () => {
  const act: ActInfo = {
    available: true,
    checkDueAt: '2026-09-27T18:30:00Z',
    requiredConsumers: 2,
    readyCount: 1,
    myReady: true,
    introOptIn: false,
    norm: result.month!.norm,
  };

  it('акт: адрес, услуга, основание; подписи пустые', () => {
    const text = actTemplateText(incident, act);
    expect(text).toContain(incident.house.address);
    expect(text).toContain('Горячая вода');
    expect(text).toContain(`${act.norm.doc}, ${act.norm.point}`);
    expect(text).toContain('____');
    expect(text).not.toMatch(/[{}]/);
  });

  it('хронология — по порядку, от старых к новым', () => {
    const lines = timelineText(incident).split('\n');
    expect(lines.length).toBe(incident.timeline.length + 1);
    expect(lines[1]).toContain('Авария отмечена');
  });
});
