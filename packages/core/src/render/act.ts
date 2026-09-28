/**
 * S09 в личке: акт о нарушении качества без исполнителя. Предложение приходит, если проверки нет
 * в срок после повторного сообщения в АДС (Правила № 354, п. 108). «Я готов подписать» и знакомство
 * с готовыми подписать — только по согласию каждого: бот присылает упоминания профилей MAX,
 * контакты сервис не хранит. Числа сроков и потребителей — из таблицы норм, рядом с основанием.
 */
import { formatDuration } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback, encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage, Keyboard } from './message.ts';
import { bold, escapeMarkdown, lines } from './text.ts';

export interface ActBasis {
  doc: string;
  point: string;
}

export interface ActOfferInput {
  incidentPublicId: string;
  /** Срок проверки после повторного сообщения в АДС (норма check_visit). */
  checkVisitMs: number;
  visitBasis: ActBasis;
  /** Сколько потребителей нужно для акта (норма act_without_executor). */
  persons: number;
  actBasis: ActBasis;
  readyCount: number;
  myReady: boolean;
  introOptIn: boolean;
  /** Кнопка «Как составить акт» — экран S09 мини-приложения. */
  withTemplate: boolean;
  botUsername: string;
  isModel: boolean;
}

const basis = (b: ActBasis) => `${escapeMarkdown(b.doc)}, ${escapeMarkdown(b.point)}`;

/** Предложение акта и состояние «готовы подписать» (одно сообщение на шаг). */
export function renderActOffer(input: ActOfferInput, t: Translator): BotMessage {
  const id = input.incidentPublicId;
  const rows: Keyboard = [];
  if (!input.myReady) rows.push([{ type: 'callback', text: t.t('bot.dm.act.btn.ready'), payload: encodeCallback('act_ready', id) }]);
  else if (!input.introOptIn) rows.push([{ type: 'callback', text: t.t('bot.dm.act.btn.intro'), payload: encodeCallback('act_intro', id) }]);
  if (input.withTemplate) rows.push([{ type: 'open_app', text: t.t('bot.dm.btn.act'), webApp: input.botUsername, payload: encodeStartApp('a', id) }]);
  return {
    text: lines(
      bold(t.t('bot.dm.act.title')),
      t.t('bot.dm.act.lead', { hours: formatDuration(input.checkVisitMs), visit_basis: basis(input.visitBasis) }),
      t.t('bot.dm.act.need', { persons: `${input.persons} ${t.plural(input.persons, 'neighbours')}`, act_basis: basis(input.actBasis) }),
      input.readyCount > 0 ? t.t('bot.dm.act.ready', { count: input.readyCount, neighbours: t.plural(input.readyCount, 'neighbours') }) : null,
      input.myReady ? t.t('bot.dm.act.me') : null,
      input.myReady ? t.t(input.introOptIn ? 'bot.dm.act.intro.on' : 'bot.dm.act.intro.ask') : null,
      input.isModel ? t.t('bot.footer') : null,
    ),
    format: 'markdown',
    keyboard: rows,
  };
}

export interface ActIntroInput {
  /** MAX user id соседей, согласившихся на знакомство (кроме получателя). */
  neighbours: readonly number[];
  isModel: boolean;
}

/** Знакомство готовых подписать: упоминания профилей MAX без имён и контактов. */
export function renderActIntro(input: ActIntroInput, t: Translator): BotMessage {
  const mentions = input.neighbours
    .filter((userId) => Number.isSafeInteger(userId))
    .map((userId, i) => `[${t.t('bot.dm.act.intro.neighbour', { n: i + 1 })}](max://user/${userId})`)
    .join(', ');
  return {
    text: lines(bold(t.t('bot.dm.act.intro.title')), mentions, t.t('bot.dm.act.intro.l2'), input.isModel ? t.t('bot.footer') : null),
    format: 'markdown',
    keyboard: [],
  };
}
