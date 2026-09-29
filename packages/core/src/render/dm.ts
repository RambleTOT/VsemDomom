/** C05. Личка с ботом: согласие, выбор дома, роль, квартира, меню, помощь, удаление данных. */
import { RESIDENCY_ROLE_I18N_KEY, RESIDENCY_ROLES, type ResidencyRole } from '../domain/enums.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback, encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage, KeyboardButton } from './message.ts';
import { bold, escapeMarkdown, lines } from './text.ts';

const msg = (text: string, keyboard: BotMessage['keyboard'] = []): BotMessage => ({ text, format: 'markdown', keyboard });

/**
 * Шаг, на который уже ответили: вопрос и выбранный ответ без кнопок. Им правится сообщение шага
 * при нажатии (ответ на нажатие с message) — в личке не остаются старые кнопки.
 */
export function renderAnsweredStep(question: string, answer: string, footer: string | null = null): BotMessage {
  return msg(lines(`${question} — ${bold(escapeMarkdown(answer))}`, footer));
}

export interface DmHouse {
  publicId: string;
  label: string;
  address: string;
  flatFrom: number;
  flatTo: number;
  isModel: boolean;
}

export function renderWelcome(input: { privacyUrl: string }, t: Translator): BotMessage {
  return msg(lines(t.t('bot.dm.welcome.l1'), t.t('bot.dm.welcome.l2')), [
    [
      { type: 'callback', text: t.t('bot.dm.btn.agree'), payload: encodeCallback('pdn', null) },
      { type: 'link', text: t.t('bot.dm.btn.policy'), url: input.privacyUrl },
    ],
  ]);
}

/** Приветствие после «Согласен»: кнопки согласия больше нет, ссылка на политику остаётся. */
export function renderWelcomeAgreed(input: { privacyUrl: string }, t: Translator): BotMessage {
  return msg(lines(t.t('bot.dm.welcome.l1'), `${t.t('bot.dm.welcome.l2')} — ${bold(t.t('bot.dm.btn.agree'))}`), [
    [{ type: 'link', text: t.t('bot.dm.btn.policy'), url: input.privacyUrl }],
  ]);
}

export function renderChooseHouse(houses: readonly DmHouse[], t: Translator): BotMessage {
  return msg(
    lines(t.t('bot.dm.house.choose'), houses.some((h) => h.isModel) ? t.t('bot.footer') : null),
    houses.map((h) => [
      { type: 'callback', text: t.t('bot.dm.house.btn', { house: h.label, address: h.address }), payload: encodeCallback('house', h.publicId) },
    ]),
  );
}

/** Роли по две в ряд: полные подписи не помещаются в ряд из четырёх. */
export function renderAskRole(t: Translator): BotMessage {
  const btn = (role: ResidencyRole): KeyboardButton => ({
    type: 'callback',
    text: t.t(`bot.dm.btn.${RESIDENCY_ROLE_I18N_KEY[role]}`),
    payload: encodeCallback('role', null, role),
  });
  const [owner, social, renter, family] = RESIDENCY_ROLES;
  return msg(lines(t.t('bot.dm.role'), t.t('bot.dm.role.why')), [
    [btn(owner), btn(renter)],
    [btn(social), btn(family)],
    [{ type: 'callback', text: t.t('bot.dm.btn.cancel'), payload: encodeCallback('cancel', null) }],
  ]);
}

export function renderAskFlat(house: DmHouse, t: Translator): BotMessage {
  return msg(lines(t.t('bot.dm.flat'), t.t('bot.dm.flat.range', { from: house.flatFrom, to: house.flatTo })), [
    [{ type: 'callback', text: t.t('bot.dm.btn.cancel'), payload: encodeCallback('cancel', null) }],
  ]);
}

export function renderFlatError(house: DmHouse, t: Translator): BotMessage {
  return msg(t.t('bot.dm.flat.error', { from: house.flatFrom, to: house.flatTo }), [
    [{ type: 'callback', text: t.t('bot.dm.btn.cancel'), payload: encodeCallback('cancel', null) }],
  ]);
}

export interface MenuInput {
  house: DmHouse;
  flatNo: number;
  botUsername: string;
  /** Ссылка на чат дома, если житель в нём не состоит (F12). */
  joinChatLink: string | null;
  /** Только что зарегистрировался: «Готово. Вы — житель…». */
  justRegistered: boolean;
  /** Квартира сменилась — уровень доверия сброшен. */
  trustReset: boolean;
  /** У дома нет привязанного чата: «кнопкой в чате дома» не пишем. */
  noChat?: boolean;
}

export function renderMenu(input: MenuInput, t: Translator): BotMessage {
  const title = input.justRegistered
    ? t.t('bot.dm.menu', { house: escapeMarkdown(input.house.label), flat: input.flatNo })
    : t.t('bot.dm.menu.title', { house: escapeMarkdown(input.house.label), flat: input.flatNo });
  const keyboard: BotMessage['keyboard'] = [
    [{ type: 'callback', text: t.t('report.cta'), payload: encodeCallback('rep_service', input.house.publicId) }],
    [{ type: 'open_app', text: t.t('bot.panel.btn.home'), webApp: input.botUsername, payload: encodeStartApp('h', input.house.publicId) }],
  ];
  if (input.joinChatLink) keyboard.push([{ type: 'link', text: t.t('bot.dm.btn.join'), url: input.joinChatLink }]);
  return msg(
    lines(
      title,
      input.trustReset ? t.t('bot.dm.flat.moved') : null,
      t.t(input.noChat ? 'bot.dm.menu.l2.no_chat' : 'bot.dm.menu.l2'),
      input.joinChatLink ? t.t('bot.dm.join') : null,
      input.house.isModel ? t.t('bot.footer') : null,
    ),
    keyboard,
  );
}

/** resume — регистрация начата: кнопка продолжает с того же шага. */
export function renderUnregisteredMenu(t: Translator, resume = false): BotMessage {
  return msg(t.t(resume ? 'bot.dm.menu.unregistered.resume' : 'bot.dm.menu.unregistered'), [
    [{ type: 'callback', text: t.t(resume ? 'bot.dm.btn.resume' : 'bot.dm.btn.register'), payload: encodeCallback('menu', null, 'register') }],
  ]);
}

export function renderHelp(t: Translator): BotMessage {
  return msg(lines(t.t('bot.dm.help.l1'), t.t('bot.dm.help.l2')));
}

export function renderDeleteConfirm(t: Translator): BotMessage {
  return msg(lines(t.t('bot.dm.delete'), t.t('bot.dm.delete.text')), [
    [
      { type: 'callback', text: t.t('bot.dm.btn.delete'), payload: encodeCallback('delete', null, 'yes') },
      { type: 'callback', text: t.t('bot.dm.btn.cancel'), payload: encodeCallback('delete', null, 'no') },
    ],
  ]);
}

export function renderText(key: string, t: Translator, params?: Record<string, string | number>): BotMessage {
  return msg(t.t(key, params));
}

/** Готовый текст (ответ на нажатие) сообщением в личку: без кнопок, разметка экранирована. */
export function renderNotice(text: string): BotMessage {
  return msg(escapeMarkdown(text));
}

/** Проживание подтверждено (уровень доверия 2): собственником по ссылке или УК в очереди подтверждения. */
export function renderResidencyConfirmed(input: { by: 'owner' | 'uk'; flat: number; isModel: boolean }, t: Translator): BotMessage {
  const key = input.by === 'owner' ? 'bot.dm.owner.confirmed' : 'bot.dm.uk.confirmed';
  return msg(lines(t.t(key, { flat: input.flat }), input.isModel ? t.t('bot.footer') : null));
}
