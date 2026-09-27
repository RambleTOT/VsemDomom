/** C09. Бот добавлен в чат: приглашение сотруднику УК привязать чат к дому. */
import type { Translator } from '../i18n/translator.ts';
import { encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage } from './message.ts';
import { lines } from './text.ts';

export function renderBotAdded(input: { token: string; botUsername: string }, t: Translator): BotMessage {
  return {
    text: lines(t.t('bot.added.l1'), t.t('bot.added.l2')),
    format: 'markdown',
    keyboard: [[{ type: 'open_app', text: t.t('bot.added.btn'), webApp: input.botUsername, payload: encodeStartApp('c', input.token) }]],
  };
}
