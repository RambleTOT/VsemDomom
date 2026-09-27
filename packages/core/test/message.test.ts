import { describe, expect, it } from 'vitest';
import { MAX_LIMITS, validateBotMessage, type KeyboardButton } from '../src/index.ts';

const cb = (text: string, payload = 'v1:x'): KeyboardButton => ({ type: 'callback', text, payload });

describe('сообщение бота в лимитах MAX', () => {
  it('допустимое сообщение без замечаний', () => {
    expect(validateBotMessage({ text: 'Карточка', keyboard: [[cb('1'), cb('2')], [{ type: 'open_app', text: 'Подробнее', webApp: 'bot', payload: 'i_K3f9QpZ2aB' }]] })).toEqual([]);
  });

  it('до 7 кнопок в ряду, до 3 — если в ряду link, open_app или request_contact', () => {
    expect(validateBotMessage({ text: 't', keyboard: [Array.from({ length: 7 }).map((_, i) => cb(String(i)))] })).toEqual([]);
    expect(validateBotMessage({ text: 't', keyboard: [Array.from({ length: 8 }).map((_, i) => cb(String(i)))] })).toHaveLength(1);
    const wide: KeyboardButton[] = [cb('a'), cb('b'), cb('c'), { type: 'link', text: 'l', url: 'https://max.ru' }];
    expect(validateBotMessage({ text: 't', keyboard: [wide] })).toHaveLength(1);
  });

  it('текст до 4000, подпись кнопки 1–128, payload по типам', () => {
    expect(validateBotMessage({ text: 'x'.repeat(MAX_LIMITS.messageText + 1), keyboard: [] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[cb('')]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[cb('x'.repeat(129))]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[cb('ok', 'p'.repeat(1025))]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[{ type: 'clipboard', text: 'Скопировать', payload: 'z'.repeat(1025) }]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[{ type: 'open_app', text: 'o', webApp: 'bot', payload: 'bad payload!' }]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[{ type: 'open_app', text: 'o', webApp: '' }]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[{ type: 'link', text: 'l', url: `https://x/${'a'.repeat(2048)}` }]] })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: [[]] })).toHaveLength(1);
  });

  it('не больше 30 рядов и 210 кнопок', () => {
    expect(validateBotMessage({ text: 't', keyboard: Array.from({ length: 31 }).map(() => [cb('1')]) })).toHaveLength(1);
    expect(validateBotMessage({ text: 't', keyboard: Array.from({ length: 30 }).map(() => Array.from({ length: 7 }).map(() => cb('1'))) })).toEqual([]);
    const tooMany = Array.from({ length: 30 }).map(() => Array.from({ length: 7 }).map(() => cb('1')));
    tooMany[0]!.push(cb('extra'));
    expect(validateBotMessage({ text: 't', keyboard: tooMany }).length).toBeGreaterThan(0);
  });
});
