import { describe, expect, it } from 'vitest';
import { renderKeywordReply, validateBotMessage } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

describe('C06 — ответ на «нет воды» в чате дома (F13)', () => {
  it('есть открытая авария: вид услуги из аварии, «Присоединиться» и «Сообщить об аварии»', () => {
    const m = renderKeywordReply({ housePublicId: 'dom1model1', incident: { publicId: 'K3f9QpZ2aB', service: 'hot_water' }, isModel: true, botUsername: 'vsemdomom_bot' }, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')).toEqual(['Похоже, в доме нет горячей воды. Отметьтесь одной кнопкой — соседи увидят в карточке', 'Модельные данные']);
    expect(m.keyboard).toEqual([
      [{ type: 'callback', text: 'Присоединиться к аварии', payload: 'v1:join:K3f9QpZ2aB:0' }],
      [{ type: 'open_app', text: 'Сообщить об аварии', webApp: 'vsemdomom_bot', payload: 'n_dom1model1' }],
    ]);
  });

  it('открытой аварии нет — только «Сообщить об аварии»', () => {
    const m = renderKeywordReply({ housePublicId: 'dom1model1', incident: null, isModel: false, botUsername: 'vsemdomom_bot' }, t);
    expect(m.text).toBe('Похоже, в доме авария. Сообщите о ней одной кнопкой — соседи увидят карточку в чате');
    expect(m.keyboard.map((r) => r.map((b) => b.text))).toEqual([['Сообщить об аварии']]);
  });
});
