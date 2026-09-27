import { describe, expect, it } from 'vitest';
import {
  renderAskFlat,
  renderAskRole,
  renderBotAdded,
  renderChooseHouse,
  renderDeleteConfirm,
  renderFlatError,
  renderHelp,
  renderMenu,
  renderPanel,
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
