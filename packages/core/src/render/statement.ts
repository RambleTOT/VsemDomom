/**
 * F09: заявление в личку и формула расчёта. Текст заявления собирает клиент (ФИО и телефон
 * вводит житель); ядро только оформляет сообщение — сервер его не хранит и не логирует.
 */
import { MAX_LIMITS } from '../constants/max-limits.ts';
import { MS_PER_MINUTE } from '../constants/time.ts';
import { formatDuration, formatPercent, formatRubles } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import type { BotMessage } from './message.ts';
import { escapeMarkdown } from './text.ts';

/** C05 «Заявление»: пояснение, текст как есть, пометка про ПДн; «Скопировать», если текст помещается в кнопку. */
export function renderStatement(text: string, t: Translator): BotMessage {
  return {
    text: [t.t('bot.dm.statement'), '', escapeMarkdown(text), '', t.t('pdn.not_stored')].join('\n'),
    format: 'markdown',
    keyboard: text.length <= MAX_LIMITS.clipboardPayload ? [[{ type: 'clipboard', text: t.t('common.copy'), payload: text }]] : [],
  };
}

/** «4 ч × 0,15 % × 1 200 ₽ = 7,20 ₽». */
export function formatRecalcFormula(
  input: { excessMinutes: number; ratePercent: string; monthlyChargeKopecks: number; amountKopecks: number },
  t: Translator,
): string {
  return t.t('money.formula', {
    hours: formatDuration(input.excessMinutes * MS_PER_MINUTE),
    rate: formatPercent(input.ratePercent),
    fee: formatRubles(input.monthlyChargeKopecks),
    amount: formatRubles(input.amountKopecks),
  });
}
