/**
 * C03. Вопрос о восстановлении — второе новое сообщение в чат (F07).
 * Повторное «Устранено» правит это же сообщение: вторая строка «Повторная проверка, УК: 21:05».
 */
import type { ServiceType } from '../domain/enums.ts';
import { SERVICE_I18N_KEY } from '../domain/enums.ts';
import { formatChatTime } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback } from '../payloads/codec.ts';
import type { BotMessage, Keyboard } from './message.ts';
import { bold, lines } from './text.ts';

/** Третья кнопка «есть, но плохо» — только там, где качество бывает плохим. */
const BAD_LABEL: Partial<Record<ServiceType, string>> = {
  cold_water: 'restore.answer.bad.water',
  hot_water: 'restore.answer.bad.water',
  heating: 'restore.answer.bad.heat',
  electricity: 'restore.answer.bad.power',
};

export interface CheckQuestionInput {
  incidentPublicId: string;
  service: ServiceType;
  /** Отметка УК «Устранено» (последняя). */
  resolvedAt: Date;
  recheck: boolean;
  /** Авария закрыта: вопрос остаётся в чате без кнопок. */
  closedAt?: Date | null;
  house: { timezone: string; isModel: boolean };
  now: Date;
}

export function renderCheckQuestion(input: CheckQuestionInput, t: Translator): BotMessage {
  const time = formatChatTime(input.resolvedAt, input.now, input.house.timezone);
  const id = input.incidentPublicId;
  const question = bold(t.t(`restore.question.${SERVICE_I18N_KEY[input.service]}`));
  const footer = input.house.isModel ? t.t('bot.footer') : null;
  if (input.closedAt) {
    // Нажатия после закрытия не принимаются — кнопки убираем, чтобы не отвечать «не получилось».
    return { text: lines(question, t.t('bot.restore.closed', { time: formatChatTime(input.closedAt, input.now, input.house.timezone) }), footer), format: 'markdown', keyboard: [] };
  }
  const keyboard: Keyboard = [
    [
      { type: 'callback', text: t.t('restore.answer.yes'), payload: encodeCallback('restore', id, 'yes') },
      { type: 'callback', text: t.t('restore.answer.no'), payload: encodeCallback('restore', id, 'no') },
    ],
  ];
  const bad = BAD_LABEL[input.service];
  if (bad) keyboard.push([{ type: 'callback', text: t.t(bad), payload: encodeCallback('restore', id, 'weak') }]);
  return {
    text: lines(question, input.recheck ? t.t('bot.restore.recheck', { time }) : t.t('bot.restore.meta', { time }), footer),
    format: 'markdown',
    keyboard,
  };
}
