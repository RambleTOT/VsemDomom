/** C01. Панель дома в закрепе: активные аварии, последний итог, кнопки мини-приложения. */
import type { ServiceType } from '../domain/enums.ts';
import { formatChatTime, formatDate } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage } from './message.ts';
import { bold, escapeMarkdown, lines, lowerFirst, serviceName, serviceNo } from './text.ts';

export interface PanelInput {
  house: { publicId: string; label: string; address: string; timezone: string; isModel: boolean };
  /** Первая из активных аварий и их число. */
  active: { service: ServiceType; startedAt: Date; count: number } | null;
  lastResult: { closedAt: Date; service: ServiceType; inNorm: boolean } | null;
  membersCount: number | null;
  botUsername: string;
  now: Date;
}

export function renderPanel(input: PanelInput, t: Translator): BotMessage {
  const { house } = input;
  const active = input.active
    ? t.t('bot.panel.active', {
        count: input.active.count,
        service_no_lower: lowerFirst(serviceNo(t, input.active.service)),
        time: formatChatTime(input.active.startedAt, input.now, house.timezone),
      })
    : t.t('bot.panel.active.none');
  const last = input.lastResult
    ? t.t('bot.panel.last', {
        date: formatDate(input.lastResult.closedAt, house.timezone),
        service_lower: lowerFirst(serviceName(t, input.lastResult.service)),
        result: t.t(input.lastResult.inNorm ? 'bot.panel.result.in_norm' : 'bot.panel.result.over_norm'),
      })
    : null;
  const members =
    input.membersCount === null
      ? null
      : t.t('bot.panel.members.count', { count: input.membersCount, members: t.plural(input.membersCount, 'members') });
  return {
    text: lines(
      bold(t.t('bot.panel.l1', { house: escapeMarkdown(house.label), address: escapeMarkdown(house.address) })),
      active,
      last,
      members,
      house.isModel ? t.t('bot.footer') : null,
    ),
    format: 'markdown',
    keyboard: [
      [{ type: 'open_app', text: t.t('bot.panel.btn.report'), webApp: input.botUsername, payload: encodeStartApp('n', house.publicId) }],
      [{ type: 'open_app', text: t.t('bot.panel.btn.home'), webApp: input.botUsername, payload: encodeStartApp('h', house.publicId) }],
    ],
  };
}
