/**
 * C08. Итог месяца в чат дома (F15): аварии, сколько устранено в норматив, среднее время до «Принято»
 * и услуги сверх месячной нормы — с основанием. Одно сообщение в месяц, не в тихие часы.
 */
import type { ServiceType } from '../domain/enums.ts';
import { formatDuration, monthName } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage } from './message.ts';
import { bold, escapeMarkdown, lines, serviceName, upperFirst } from './text.ts';

export interface MonthlySummaryInput {
  housePublicId: string;
  house: { label: string; isModel: boolean };
  /** Месяц итога, 1–12. */
  month: number;
  incidents: number;
  inNorm: number;
  /** Среднее время до «Принято»; null — не было принятых аварий. */
  avgAcceptMs: number | null;
  /** Услуги сверх месячной нормы: сумма перерывов, норма и её основание. */
  overNorm: readonly { service: ServiceType; totalMs: number; limitMs: number; doc: string; point: string }[];
  botUsername: string;
}

export function renderMonthlySummary(input: MonthlySummaryInput, t: Translator): BotMessage {
  const base = { month: upperFirst(monthName(input.month)), house: escapeMarkdown(input.house.label) };
  const head =
    input.incidents === 0
      ? t.t('bot.c08.l1.none', base)
      : t.t('bot.c08.l1', {
          ...base,
          count: input.incidents,
          incidents: t.plural(input.incidents, 'incidents'),
          in_norm: input.inNorm,
          fixed: t.plural(input.inNorm, 'fixed'),
        });
  return {
    text: lines(
      bold(head),
      input.avgAcceptMs === null ? null : t.t('bot.c08.l2', { duration: formatDuration(input.avgAcceptMs) }),
      ...input.overNorm.map((s) =>
        t.t('bot.c08.l3', {
          service: serviceName(t, s.service),
          total: formatDuration(s.totalMs),
          limit: formatDuration(s.limitMs),
          doc: escapeMarkdown(s.doc),
          point: escapeMarkdown(s.point),
        }),
      ),
      input.house.isModel ? t.t('bot.footer') : null,
    ),
    format: 'markdown',
    keyboard: [[{ type: 'open_app', text: t.t('bot.dm.btn.details'), webApp: input.botUsername, payload: encodeStartApp('h', input.housePublicId) }]],
  };
}
