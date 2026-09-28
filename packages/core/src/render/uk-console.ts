/**
 * Демо-пульт УК в личке с ботом (только DEMO_MODE): открытая авария домов сотрудника и кнопки
 * следующих статусов — чтобы сценарий проходился в MAX и без мини-приложения.
 * Основной экран УК — мини-приложение (U02): там ориентир, If-Match, хронология и объединение.
 */
import type { IncidentStatus, ServiceType } from '../domain/enums.ts';
import { DISPLAY_STATUS_I18N_KEY } from '../domain/enums.ts';
import { formatChatTime } from '../format/time.ts';
import { ALLOWED_FROM, displayStatus } from '../incident/state-machine.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback } from '../payloads/codec.ts';
import type { BotMessage, KeyboardButton } from './message.ts';
import { bold, escapeMarkdown, lines, serviceName } from './text.ts';

/** Статусы, которые УК ставит из пульта, и команда машины состояний для каждого. */
export const UK_CONSOLE_STATUSES = ['accepted', 'brigade_on_site', 'localized', 'resolved'] as const;
export type UkConsoleStatus = (typeof UK_CONSOLE_STATUSES)[number];

/** Кнопок статусов в одном ряду пульта. */
const BUTTONS_PER_ROW = 2;

const COMMAND: Record<UkConsoleStatus, keyof typeof ALLOWED_FROM> = {
  accepted: 'accept',
  brigade_on_site: 'brigade_on_site',
  localized: 'localize',
  resolved: 'resolve',
};

/** Какие статусы УК можно поставить из текущего. */
export function ukConsoleTargets(status: IncidentStatus): UkConsoleStatus[] {
  return UK_CONSOLE_STATUSES.filter((s) => ALLOWED_FROM[COMMAND[s]].includes(status));
}

export function statusText(status: IncidentStatus, discrepancyUnresolved: boolean, t: Translator): string {
  return t.t(`status.${DISPLAY_STATUS_I18N_KEY[displayStatus(status, discrepancyUnresolved)]}`);
}

export interface UkConsoleIncidentInput {
  publicId: string;
  houseLabel: string;
  service: ServiceType;
  status: IncidentStatus;
  startedAt: Date;
  timezone: string;
  isModel: boolean;
  now: Date;
}

export function renderUkConsoleIncident(input: UkConsoleIncidentInput, t: Translator): BotMessage {
  const buttons: KeyboardButton[] = ukConsoleTargets(input.status).map((s) => ({
    type: 'callback',
    text: t.t(`bot.dm.uk.btn.${s}`),
    payload: encodeCallback('uk_status', input.publicId, s),
  }));
  const rows = [buttons.slice(0, BUTTONS_PER_ROW), buttons.slice(BUTTONS_PER_ROW)].filter((row) => row.length > 0);
  return {
    text: lines(
      bold(t.t('bot.dm.uk.incident', { house: escapeMarkdown(input.houseLabel), service: serviceName(t, input.service) })),
      t.t('bot.dm.uk.incident.l2', { status: statusText(input.status, false, t), time: formatChatTime(input.startedAt, input.now, input.timezone) }),
      input.isModel ? t.t('bot.footer') : null,
    ),
    format: 'markdown',
    keyboard: rows,
  };
}
