/**
 * C04. Итог — третье новое сообщение, ответом на карточку (F08).
 * Время — по отметке УК; квартиры с более поздним восстановлением считаются отдельно.
 */
import type { ServiceType } from '../domain/enums.ts';
import { formatChatTime, formatDuration, monthName } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage } from './message.ts';
import { bold, escapeMarkdown, lines, lowerFirst, serviceName } from './text.ts';

const WATER: readonly ServiceType[] = ['cold_water', 'hot_water'];

export interface ResultInput {
  incidentPublicId: string;
  service: ServiceType;
  house: { label: string; timezone: string; isModel: boolean };
  startedAt: Date;
  /** «Устранено» по отметке УК. */
  resolvedAt: Date;
  /** Квартиры, отметившиеся в аварии. */
  flats: number;
  /** Квартиры, где услуга вернулась позже отметки УК, и последнее такое время. */
  late: { flats: number; lastAt: Date } | null;
  /** Квартиры с перерывами сверх месячной нормы. */
  overNorm: { flats: number; month: number; totalMs: number; limitMs: number } | null;
  botUsername: string;
  now: Date;
}

export function renderResult(input: ResultInput, t: Translator): BotMessage {
  const tz = input.house.timezone;
  const time = (at: Date) => formatChatTime(at, input.now, tz);
  const flatsWord = (n: number) => t.plural(n, 'flats');
  const water = WATER.includes(input.service);
  const late = input.late && input.late.flats > 0 ? input.late : null;
  const flatsLine =
    input.flats === 0
      ? null
      : late
        ? t.t(water ? 'bot.result.flats' : 'bot.result.flats.other', { count: input.flats, flats: flatsWord(input.flats), late: late.flats, time: time(late.lastAt) })
        : t.t('bot.result.flats.all', { count: input.flats, flats: flatsWord(input.flats) });
  const over = input.overNorm && input.overNorm.flats > 0 ? input.overNorm : null;
  const one = over?.flats === 1;
  const monthLines = over
    ? [
        t.t(one ? 'bot.result.month.one' : 'bot.result.month', {
          late: over.flats,
          flats: t.plural(over.flats, 'flats_gen'),
          month: monthName(over.month),
          total: formatDuration(over.totalMs),
          limit: formatDuration(over.limitMs),
        }),
        t.t(one ? 'bot.result.can_apply.one' : 'bot.result.can_apply'),
      ]
    : [t.t('result.within_norm')];
  return {
    text: lines(
      bold(t.t('bot.result.l1', { service_lower: lowerFirst(serviceName(t, input.service)), house: escapeMarkdown(input.house.label) })),
      t.t('bot.result.by_uk', {
        from: time(input.startedAt),
        to: time(input.resolvedAt),
        duration: formatDuration(input.resolvedAt.getTime() - input.startedAt.getTime()),
      }),
      flatsLine,
      ...monthLines,
      t.t('bot.result.act'),
      input.house.isModel ? t.t('bot.result.footer') : t.t('bot.result.footer.plain'),
    ),
    format: 'markdown',
    keyboard: [[{ type: 'open_app', text: t.t('bot.result.btn'), webApp: input.botUsername, payload: encodeStartApp('r', input.incidentPublicId) }]],
  };
}
