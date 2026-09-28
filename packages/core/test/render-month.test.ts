import { describe, expect, it } from 'vitest';
import { renderMonthlySummary, validateBotMessage, type MonthlySummaryInput } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const H = 3_600_000;
const base: MonthlySummaryInput = {
  housePublicId: 'dom1model1',
  house: { label: '1', isModel: true },
  month: 9,
  incidents: 3,
  inNorm: 1,
  avgAcceptMs: 25 * 60_000,
  overNorm: [{ service: 'hot_water', totalMs: 10 * H + 40 * 60_000, limitMs: 8 * H, doc: 'Правила № 354', point: 'прил. 1, п. 4' }],
  botUsername: 'vsemdomom_bot',
};

describe('C08 — итог месяца в чат дома (F15)', () => {
  it('аварии, в норматив, среднее до «Принято», услуги сверх нормы с основанием, «Подробнее»', () => {
    const m = renderMonthlySummary(base, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')).toEqual([
      '**Сентябрь в доме 1: 3 аварии, 1 устранена в норматив**',
      'В среднем УК отвечала за 25 мин',
      'Горячая вода: 10 ч 40 мин перерывов при норме 8 ч (Правила № 354, прил. 1, п. 4)',
      'Модельные данные',
    ]);
    expect(m.keyboard).toEqual([[{ type: 'open_app', text: 'Подробнее', webApp: 'vsemdomom_bot', payload: 'h_dom1model1' }]]);
  });

  it('склонения и месяц без аварий', () => {
    expect(renderMonthlySummary({ ...base, incidents: 5, inNorm: 5, overNorm: [] }, t).text.split('\n')[0]).toBe('**Сентябрь в доме 1: 5 аварий, 5 устранены в норматив**');
    const quiet = renderMonthlySummary({ ...base, month: 10, incidents: 0, inNorm: 0, avgAcceptMs: null, overNorm: [], house: { label: '1', isModel: false } }, t);
    expect(quiet.text).toBe('**Октябрь в доме 1: аварий не было**');
  });
});
