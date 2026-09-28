/**
 * C06. Ответ на «нет воды» и похожие фразы в чате дома (F13): словарь без LLM, не чаще раза
 * в 10 минут на чат. Есть открытая авария — «Присоединиться к аварии»; всегда — «Сообщить об аварии».
 */
import type { ServiceType } from '../domain/enums.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback, encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage, Keyboard } from './message.ts';
import { lines, lowerFirst, serviceNo } from './text.ts';

export interface KeywordReplyInput {
  housePublicId: string;
  /** Последняя открытая авария дома (не «только квартира»). */
  incident: { publicId: string; service: ServiceType } | null;
  isModel: boolean;
  botUsername: string;
}

export function renderKeywordReply(input: KeywordReplyInput, t: Translator): BotMessage {
  const rows: Keyboard = [];
  // Нажатие = «У меня тоже» без подъезда (как «Не знаю подъезд» в карточке).
  if (input.incident) rows.push([{ type: 'callback', text: t.t('bot.c06.join'), payload: encodeCallback('join', input.incident.publicId, 0) }]);
  rows.push([{ type: 'open_app', text: t.t('bot.panel.btn.report'), webApp: input.botUsername, payload: encodeStartApp('n', input.housePublicId) }]);
  return {
    text: lines(
      input.incident ? t.t('bot.c06.open', { service_no: lowerFirst(serviceNo(t, input.incident.service)) }) : t.t('bot.c06.none'),
      input.isModel ? t.t('bot.footer') : null,
    ),
    format: 'markdown',
    keyboard: rows,
  };
}
