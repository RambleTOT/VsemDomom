import { describe, expect, it } from 'vitest';
import { decodeCallback, renderActIntro, renderActOffer, validateBotMessage, type ActOfferInput } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const H = 3_600_000;
const base: ActOfferInput = {
  incidentPublicId: 'K3f9QpZ2aB',
  checkVisitMs: 2 * H,
  visitBasis: { doc: 'Правила № 354', point: 'п. 108' },
  persons: 2,
  actBasis: { doc: 'Правила № 354', point: 'п. 110(1)' },
  readyCount: 0,
  myReady: false,
  introOptIn: false,
  withTemplate: true,
  botUsername: 'vsemdomom_bot',
  isModel: true,
};
const buttons = (m: { keyboard: { type: string; text: string }[][] }) => m.keyboard.map((r) => r.map((b) => `${b.type}:${b.text}`));

describe('S09 в личке — акт без исполнителя', () => {
  it('предложение: сроки и число потребителей с основаниями, «Я готов подписать» и «Как составить акт»', () => {
    const m = renderActOffer(base, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')).toEqual([
      '**Акт без исполнителя**',
      'Проверки нет больше 2 ч после повторного сообщения в АДС (Правила № 354, п. 108). Акт о нарушении качества можно составить без исполнителя',
      'Нужны 2 соседа и председатель совета дома (Правила № 354, п. 110(1))',
      'Модельные данные',
    ]);
    expect(buttons(m)).toEqual([['callback:Я готов подписать'], ['open_app:Как составить акт']]);
    expect(decodeCallback(m.keyboard[0]![0]!.type === 'callback' ? m.keyboard[0]![0]!.payload : '')).toEqual({ action: 'act_ready', id: 'K3f9QpZ2aB', arg: null });
  });

  it('после согласия — счётчик и вопрос о знакомстве; после знакомства — без кнопок-нажатий', () => {
    const ready = renderActOffer({ ...base, readyCount: 3, myReady: true, withTemplate: false }, t);
    expect(ready.text).toContain('Готовы подписать: 3 соседа');
    expect(ready.text).toContain('Вы в списке готовых подписать');
    expect(buttons(ready)).toEqual([['callback:Познакомить с соседями']]);
    const intro = renderActOffer({ ...base, readyCount: 1, myReady: true, introOptIn: true, withTemplate: false, isModel: false }, t);
    expect(intro.text).toContain('Готовы подписать: 1 сосед');
    expect(intro.text).toContain('Когда согласятся двое и больше');
    expect(intro.keyboard).toEqual([]);
    expect(intro.text).not.toContain('Модельные данные');
  });

  it('знакомство: упоминания профилей MAX без имён и контактов', () => {
    const m = renderActIntro({ neighbours: [101, 202], isModel: false }, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')).toEqual([
      '**Готовы подписать акт вместе с вами**',
      '[сосед 1](max://user/101), [сосед 2](max://user/202)',
      'Договоритесь о времени и позовите председателя совета дома. Контакты сервис не хранит',
    ]);
  });
});
