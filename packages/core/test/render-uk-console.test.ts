import { describe, expect, it } from 'vitest';
import { renderUkConsoleIncident, ukConsoleTargets, validateBotMessage } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const at = (hhmm: string) => new Date(`2026-09-27T${hhmm}:00+03:00`);

describe('демо-пульт УК в личке', () => {
  it('следующие статусы — по машине состояний', () => {
    expect(ukConsoleTargets('open')).toEqual(['accepted', 'brigade_on_site', 'localized', 'resolved']);
    expect(ukConsoleTargets('accepted')).toEqual(['brigade_on_site', 'localized', 'resolved']);
    expect(ukConsoleTargets('discrepancy')).toEqual(['resolved']);
    expect(ukConsoleTargets('checking')).toEqual([]);
  });

  it('сообщение аварии: дом, услуга, статус и кнопки по два в ряд', () => {
    const m = renderUkConsoleIncident({ publicId: 'K3f9QpZ2aB', houseLabel: '1', service: 'hot_water', status: 'open', startedAt: at('17:40'), timezone: 'Europe/Moscow', isModel: true, now: at('18:00') }, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')).toEqual(['**Дом 1 · Горячая вода**', 'Открыта, с 17:40', 'Модельные данные']);
    expect(m.keyboard.map((r) => r.map((b) => (b.type === 'callback' ? `${b.text}=${b.payload}` : b.text)))).toEqual([
      ['Принято +2 ч=v1:uk_status:K3f9QpZ2aB:accepted', 'Бригада на месте=v1:uk_status:K3f9QpZ2aB:brigade_on_site'],
      ['Локализовано=v1:uk_status:K3f9QpZ2aB:localized', 'Устранено=v1:uk_status:K3f9QpZ2aB:resolved'],
    ]);
  });
});
