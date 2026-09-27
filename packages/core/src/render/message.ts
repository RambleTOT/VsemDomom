/**
 * Сообщение бота: текст (markdown) и inline-клавиатура. Рендеры ядра возвращают BotMessage,
 * клиент MAX превращает его в NewMessageBody. Проверка — по лимитам платформы.
 */
import { MAX_LIMITS } from '../constants/max-limits.ts';

export type KeyboardButton =
  | { type: 'callback'; text: string; payload: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'open_app'; text: string; webApp: string; payload?: string }
  | { type: 'clipboard'; text: string; payload: string }
  | { type: 'request_contact'; text: string };

export type Keyboard = KeyboardButton[][];

export interface BotMessage {
  text: string;
  format: 'markdown';
  keyboard: Keyboard;
}

const WIDE_TYPES: ReadonlySet<KeyboardButton['type']> = new Set(['link', 'open_app', 'request_contact']);
const OPEN_APP_PAYLOAD = /^[\w-]*$/;

/** Ошибки сообщения относительно лимитов MAX; пустой список — сообщение допустимо. */
export function validateBotMessage(message: Pick<BotMessage, 'text' | 'keyboard'>): string[] {
  const problems: string[] = [];
  // Длина в UTF-16 (эмодзи — 2 единицы): консервативнее подсчёта по кодовым точкам.
  const textLength = message.text.length;
  if (textLength > MAX_LIMITS.messageText) problems.push(`текст длиннее ${MAX_LIMITS.messageText} символов: ${textLength}`);
  const rows = message.keyboard;
  if (rows.length > MAX_LIMITS.rows) problems.push(`рядов больше ${MAX_LIMITS.rows}: ${rows.length}`);
  const total = rows.reduce((sum, row) => sum + row.length, 0);
  if (total > MAX_LIMITS.buttons) problems.push(`кнопок больше ${MAX_LIMITS.buttons}: ${total}`);
  rows.forEach((row, r) => {
    if (row.length === 0) problems.push(`ряд ${r + 1} пустой`);
    const wide = row.some((b) => WIDE_TYPES.has(b.type));
    const limit = wide ? MAX_LIMITS.buttonsPerRowWithWide : MAX_LIMITS.buttonsPerRow;
    if (row.length > limit) problems.push(`в ряду ${r + 1} кнопок ${row.length}, допустимо ${limit}`);
    row.forEach((b, i) => {
      const where = `кнопка ${r + 1}.${i + 1}`;
      const len = b.text.length;
      if (len === 0 || len > MAX_LIMITS.buttonText) problems.push(`${where}: текст 1–${MAX_LIMITS.buttonText} символов`);
      switch (b.type) {
        case 'callback':
          if (b.payload.length > MAX_LIMITS.callbackPayload) problems.push(`${where}: payload длиннее ${MAX_LIMITS.callbackPayload}`);
          break;
        case 'clipboard':
          if (b.payload.length > MAX_LIMITS.clipboardPayload) problems.push(`${where}: payload длиннее ${MAX_LIMITS.clipboardPayload}`);
          break;
        case 'link':
          if (b.url.length > MAX_LIMITS.linkUrl) problems.push(`${where}: url длиннее ${MAX_LIMITS.linkUrl}`);
          break;
        case 'open_app':
          if (b.payload !== undefined && (b.payload.length > MAX_LIMITS.openAppPayload || !OPEN_APP_PAYLOAD.test(b.payload))) {
            problems.push(`${where}: payload open_app — до ${MAX_LIMITS.openAppPayload} символов A-Za-z0-9_-`);
          }
          if (!b.webApp) problems.push(`${where}: open_app без web_app`);
          break;
        case 'request_contact':
          break;
      }
    });
  });
  return problems;
}
