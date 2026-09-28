import { describe, expect, it } from 'vitest';
import {
  renderAskFlat,
  renderAnsweredStep,
  renderAskRole,
  renderBotAdded,
  renderChooseHouse,
  renderDeleteConfirm,
  renderFlatError,
  renderHelp,
  renderMenu,
  renderPanel,
  renderReportWhen,
  renderResidencyConfirmed,
  reportQuestion,
  renderUnregisteredMenu,
  renderWelcome,
  validateBotMessage,
  type BotMessage,
} from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const house = { publicId: 'dom1model1', label: '1', address: 'ул. Модельная, 1', timezone: 'Europe/Moscow', isModel: true };
const dmHouse = { publicId: 'dom1model1', label: '1', address: 'ул. Модельная, 1', flatFrom: 1, flatTo: 144, isModel: true };
const now = new Date('2026-09-27T15:00:00Z');

/** Сообщения в группу: без имён и номеров квартир. */
function assertGroupSafe(m: BotMessage): void {
  expect(m.text).not.toMatch(/кв\.\s*\d/);
  expect(validateBotMessage(m)).toEqual([]);
}

describe('C01 — панель дома', () => {
  it('активная авария, последний итог, участники, модельные данные', () => {
    const m = renderPanel(
      {
        house,
        active: { service: 'hot_water', startedAt: new Date('2026-09-27T14:40:00Z'), count: 1 },
        lastResult: { closedAt: new Date('2026-09-12T10:00:00Z'), service: 'cold_water', inNorm: true },
        membersCount: 312,
        botUsername: 'vsemdomom_bot',
        now,
      },
      t,
    );
    assertGroupSafe(m);
    expect(m.text).toMatchSnapshot();
    expect(m.keyboard).toEqual([
      [{ type: 'open_app', text: 'Сообщить об аварии', webApp: 'vsemdomom_bot', payload: 'n_dom1model1' }],
      [{ type: 'open_app', text: 'Мой дом', webApp: 'vsemdomom_bot', payload: 'h_dom1model1' }],
    ]);
  });

  it('без активных аварий и без итога; 1 участник', () => {
    const m = renderPanel({ house, active: null, lastResult: null, membersCount: 1, botUsername: 'bot', now }, t);
    expect(m.text).toMatchSnapshot();
    expect(m.text).toContain('В чате 1 участник');
  });
});

describe('C09 — бот добавлен в чат', () => {
  it('кнопка open_app с одноразовым токеном', () => {
    const m = renderBotAdded({ token: 'abcdefghijklmnopQRSTUV', botUsername: 'bot' }, t);
    assertGroupSafe(m);
    expect(m.text).toMatchSnapshot();
    expect(m.keyboard[0]?.[0]).toMatchObject({ type: 'open_app', payload: 'c_abcdefghijklmnopQRSTUV' });
  });
});

describe('C05 — личка', () => {
  const all: [string, BotMessage][] = [
    ['welcome', renderWelcome({ privacyUrl: 'https://app.example.ru/privacy' }, t)],
    ['house', renderChooseHouse([dmHouse, { ...dmHouse, publicId: 'dom2model2', label: '2', address: 'ул. Модельная, 2' }], t)],
    ['role', renderAskRole(t)],
    ['flat', renderAskFlat(dmHouse, t)],
    ['flat-error', renderFlatError(dmHouse, t)],
    ['menu-registered', renderMenu({ house: dmHouse, flatNo: 57, botUsername: 'bot', joinChatLink: 'https://max.ru/join/x', justRegistered: true, trustReset: false }, t)],
    ['menu', renderMenu({ house: dmHouse, flatNo: 57, botUsername: 'bot', joinChatLink: null, justRegistered: false, trustReset: true }, t)],
    ['unregistered', renderUnregisteredMenu(t)],
    ['help', renderHelp(t)],
    ['delete', renderDeleteConfirm(t)],
  ];
  for (const [name, m] of all) {
    it(`${name}: в лимитах MAX`, () => {
      expect(validateBotMessage(m)).toEqual([]);
      expect({ text: m.text, keyboard: m.keyboard }).toMatchSnapshot();
    });
  }

  it('сообщения с домом заканчиваются «Модельные данные»', () => {
    for (const name of ['house', 'menu-registered', 'menu']) {
      expect(all.find(([n]) => n === name)?.[1].text.split('\n').at(-1)).toBe('Модельные данные');
    }
  });
});

describe('C05 — проживание подтверждено (уровень 2)', () => {
  it('собственником или УК; в модельном доме — пометка «Модельные данные»', () => {
    expect(renderResidencyConfirmed({ by: 'owner', flat: 57, isModel: false }, t).text).toBe(
      'Собственник подтвердил ваше проживание в кв. 57. Уровень доверия — «подтверждён»',
    );
    const uk = renderResidencyConfirmed({ by: 'uk', flat: 57, isModel: true }, t);
    expect(uk.text).toBe('УК подтвердила ваше проживание в кв. 57. Уровень доверия — «подтверждён»\nМодельные данные');
    expect(uk.keyboard).toEqual([]);
    expect(validateBotMessage(uk)).toEqual([]);
  });
});

describe('C05 — ответ на шаг в личке', () => {
  it('вопрос и выбранный ответ, без кнопок: прошлые кнопки больше не нажимаются', () => {
    const m = renderAnsweredStep(reportQuestion('when', 'cold_water', t), 'Сейчас');
    expect(m.text).toBe('С какого времени нет холодной воды? — **Сейчас**');
    expect(m.keyboard).toEqual([]);
    expect(validateBotMessage(m)).toEqual([]);
    // Вопрос шага — тот же текст, что в сообщении с кнопками.
    expect(renderReportWhen({ housePublicId: 'dom1model1', service: 'cold_water' }, t).text).toBe(reportQuestion('when', 'cold_water', t));
    expect(renderAnsweredStep('Где?', 'Дом *1*').text).toBe('Где? — **Дом \\*1\\***');
  });
});
