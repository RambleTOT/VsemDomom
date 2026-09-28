/**
 * C07. Опросы (F14): «Как вода сейчас?» после закрытия аварии и «Тепло ли у вас?» по запуску УК.
 * Одно сообщение на опрос; общий счётчик ответов — правкой, сами ответы видит только УК.
 * Не больше одного опроса в сутки на дом и не в тихие часы — это проверяет сервис.
 */
import { MAX_LIMITS } from '../constants/max-limits.ts';
import { HEAT_POLL_VALUES, WATER_POLL_VALUES, type PollType } from '../domain/enums.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback } from '../payloads/codec.ts';
import type { BotMessage, Keyboard } from './message.ts';
import { bold, escapeMarkdown, lines } from './text.ts';

export interface PollMessageInput {
  type: PollType;
  /** Публичный ID аварии (вода) или дома (отопление) — в payload кнопок. */
  refId: string;
  house: { label: string; entrances: number; isModel: boolean };
  answered: number;
  closed: boolean;
}

export function renderPoll(input: PollMessageInput, t: Translator): BotMessage {
  const water = input.type === 'water_quality';
  const rows: Keyboard = [];
  if (!input.closed && water) {
    rows.push(WATER_POLL_VALUES.map((v) => ({ type: 'callback' as const, text: t.t(`bot.c07.water.${v}`), payload: encodeCallback('poll', input.refId, v) })));
  } else if (!input.closed) {
    rows.push(HEAT_POLL_VALUES.map((v) => ({ type: 'callback' as const, text: t.t(`bot.c07.heat.${v}`), payload: encodeCallback('heat', input.refId, v) })));
    // Подъезд — вторым рядом (≤ 7 кнопок в ряду MAX); жителям с квартирой он известен и так.
    if (input.house.entrances <= MAX_LIMITS.buttonsPerRow) {
      rows.push(
        Array.from({ length: input.house.entrances }, (_, i) => ({
          type: 'callback' as const,
          text: String(i + 1),
          payload: encodeCallback('heat_ent', input.refId, i + 1),
        })),
      );
    }
  }
  return {
    text: lines(
      bold(t.t(water ? 'bot.c07.water' : 'bot.c07.heat')),
      t.t(water ? 'bot.c07.meta.water' : 'bot.c07.meta.heat', { house: escapeMarkdown(input.house.label) }),
      input.answered > 0 ? t.t('bot.c07.count', { count: input.answered }) : null,
      input.closed ? t.t('bot.c07.closed') : null,
      t.t(input.house.isModel ? 'bot.c07.legal' : 'bot.c07.legal.plain'),
    ),
    format: 'markdown',
    keyboard: rows,
  };
}
