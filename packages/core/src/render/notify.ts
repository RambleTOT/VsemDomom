/**
 * C05. Личные уведомления присоединившимся: смена статуса УК и сроки по нормативам (F04).
 * Тон нейтральный к УК: «срок по нормативу истёк», без оценок. Кнопки — «Подробнее» и «Не присылать».
 */
import type { ServiceType } from '../domain/enums.ts';
import { SERVICE_I18N_KEY } from '../domain/enums.ts';
import { formatChatTime } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback, encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage, Keyboard } from './message.ts';
import { escapeMarkdown, lines, lowerFirst, serviceName } from './text.ts';

interface NoticeHouse {
  label: string;
  timezone: string;
  isModel: boolean;
}

export interface StatusNoticeInput {
  incidentPublicId: string;
  service: ServiceType;
  status: 'accepted' | 'brigade_on_site' | 'localized' | 'checking';
  eta: Date | null;
  /** Время шага УК: бригада на месте, локализована, устранена. */
  statusAt: Date | null;
  /** Невыполненный срок локализации — для «Принята». */
  localize: { dueAt: Date; basisDoc: string; basisPoint: string } | null;
  house: NoticeHouse;
  botUsername: string;
  now: Date;
}

const MARKER: Record<StatusNoticeInput['status'], string> = {
  accepted: 'work',
  brigade_on_site: 'work',
  localized: 'work',
  checking: 'checking',
};

function keyboard(incidentPublicId: string, botUsername: string, t: Translator): Keyboard {
  return [
    [
      { type: 'open_app', text: t.t('bot.dm.btn.details'), webApp: botUsername, payload: encodeStartApp('i', incidentPublicId) },
      { type: 'callback', text: t.t('bot.dm.btn.mute'), payload: encodeCallback('mute', incidentPublicId) },
    ],
  ];
}

export function renderStatusNotice(input: StatusNoticeInput, t: Translator): BotMessage {
  const time = (at: Date) => formatChatTime(at, input.now, input.house.timezone);
  const marker = t.t(`bot.marker.${MARKER[input.status]}`);
  const where = { service: serviceName(t, input.service), house: escapeMarkdown(input.house.label) };
  const statusAt = time(input.statusAt ?? input.now);
  let l1: string;
  let l2: string;
  switch (input.status) {
    case 'accepted':
      l1 = input.eta ? t.t('bot.dm.status', { marker, eta: time(input.eta) }) : t.t('bot.dm.status.accepted_no_eta', { marker });
      l2 = input.localize
        ? t.t('bot.dm.status.l2', {
            ...where,
            time: time(input.localize.dueAt),
            doc: escapeMarkdown(input.localize.basisDoc),
            point: escapeMarkdown(input.localize.basisPoint),
          })
        : input.eta
          ? t.t('bot.dm.status.l2.eta', { ...where, eta: time(input.eta) })
          : t.t('bot.dm.status.l2.plain', where);
      break;
    case 'brigade_on_site':
    case 'localized':
      l1 = t.t(input.status === 'brigade_on_site' ? 'bot.dm.status.brigade' : 'bot.dm.status.localized', { marker, time: statusAt });
      l2 = input.eta ? t.t('bot.dm.status.l2.eta', { ...where, eta: time(input.eta) }) : t.t('bot.dm.status.l2.plain', where);
      break;
    case 'checking':
      l1 = t.t('bot.dm.status.resolved', { marker, time: statusAt });
      l2 = t.t('bot.dm.status.l2.resolved', { ...where, restore_question: t.t(`restore.question.${SERVICE_I18N_KEY[input.service]}`) });
      break;
  }
  return {
    text: lines(l1, l2, input.house.isModel ? t.t('bot.footer') : null),
    format: 'markdown',
    keyboard: keyboard(input.incidentPublicId, input.botUsername, t),
  };
}

export interface DeadlineNoticeInput {
  incidentPublicId: string;
  service: ServiceType;
  kind: 'warn' | 'breach';
  /** Название нормы: «Локализовать аварию». */
  title: string;
  dueAt: Date;
  house: NoticeHouse;
  botUsername: string;
  now: Date;
}

export function renderDeadlineNotice(input: DeadlineNoticeInput, t: Translator): BotMessage {
  const time = formatChatTime(input.dueAt, input.now, input.house.timezone);
  const what = lowerFirst(escapeMarkdown(input.title));
  const l1 = input.kind === 'warn' ? t.t('bot.dm.timer.soon', { deadline_title: what, time }) : t.t('bot.dm.timer.expired', { time, what });
  return {
    text: lines(
      l1,
      t.t('bot.dm.timer.l2', { service: serviceName(t, input.service), house: escapeMarkdown(input.house.label) }),
      input.house.isModel ? t.t('bot.footer') : null,
    ),
    format: 'markdown',
    keyboard: keyboard(input.incidentPublicId, input.botUsername, t),
  };
}
