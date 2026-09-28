import { describe, expect, it } from 'vitest';
import { afterQuietHours, decodeCallback, isQuietTime, renderPoll, validateBotMessage, type PollMessageInput } from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const TZ = 'Europe/Moscow';
const QUIET = { from: '22:00', to: '08:00' };
const msk = (s: string) => new Date(`${s}+03:00`);
const house = { label: '1', entrances: 4, isModel: true };
const payloads = (m: { keyboard: { type: string; text: string; payload?: string }[][] }) => m.keyboard.map((r) => r.map((b) => `${b.text}=${b.payload ?? ''}`));

describe('тихие часы по времени дома', () => {
  it('22:00–08:00 через полночь: вечер и ночь — тихо, перенос на 08:00', () => {
    expect(isQuietTime(msk('2026-09-27T21:59:00'), TZ, QUIET)).toBe(false);
    expect(isQuietTime(msk('2026-09-27T22:00:00'), TZ, QUIET)).toBe(true);
    expect(isQuietTime(msk('2026-09-28T07:59:00'), TZ, QUIET)).toBe(true);
    expect(afterQuietHours(msk('2026-09-27T23:30:00'), TZ, QUIET)).toEqual(msk('2026-09-28T08:00:00'));
    expect(afterQuietHours(msk('2026-09-28T03:00:00'), TZ, QUIET)).toEqual(msk('2026-09-28T08:00:00'));
    expect(afterQuietHours(msk('2026-09-28T12:00:00'), TZ, QUIET)).toEqual(msk('2026-09-28T12:00:00'));
  });

  it('тихие часы внутри суток и пустой интервал', () => {
    const day = { from: '13:00', to: '15:00' };
    expect(afterQuietHours(msk('2026-09-28T14:00:00'), TZ, day)).toEqual(msk('2026-09-28T15:00:00'));
    expect(isQuietTime(msk('2026-09-28T14:00:00'), TZ, { from: '08:00', to: '08:00' })).toBe(false);
  });
});

describe('C07 — опросы в чате дома (F14)', () => {
  const water: PollMessageInput = { type: 'water_quality', refId: 'K3f9QpZ2aB', house, answered: 0, closed: false };

  it('«Как вода сейчас?»: три ответа одним рядом, оговорка про АДС', () => {
    const m = renderPoll(water, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')).toEqual([
      '**Как вода сейчас?**',
      'Опрос УК по дому 1. Ответ видит только УК, в чате — общий счётчик',
      'Опрос не заменяет обращение в АДС · Модельные данные',
    ]);
    expect(payloads(m)).toEqual([['Нормально=v1:poll:K3f9QpZ2aB:ok', 'Ржавая=v1:poll:K3f9QpZ2aB:rust', 'Слабый напор=v1:poll:K3f9QpZ2aB:low']]);
    expect(decodeCallback(m.keyboard[0]![1]!.type === 'callback' ? m.keyboard[0]![1]!.payload : '')).toEqual({ action: 'poll', id: 'K3f9QpZ2aB', arg: 'rust' });
  });

  it('счётчик ответов и завершение: кнопки снимаются', () => {
    const closed = renderPoll({ ...water, answered: 7, closed: true, house: { ...house, isModel: false } }, t);
    expect(closed.text.split('\n').slice(2)).toEqual(['Ответили: 7', 'Опрос завершён', 'Опрос не заменяет обращение в АДС']);
    expect(closed.keyboard).toEqual([]);
  });

  it('«Тепло ли у вас?»: ответы и ряд подъездов; больше 7 подъездов — без ряда', () => {
    const m = renderPoll({ type: 'heating', refId: 'dom1model1', house, answered: 2, closed: false }, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text.split('\n')[0]).toBe('**Тепло ли у вас?**');
    expect(payloads(m)).toEqual([
      ['Тепло=v1:heat:dom1model1:warm', 'Чуть тёплые=v1:heat:dom1model1:luke', 'Холодные=v1:heat:dom1model1:cold'],
      ['1=v1:heat_ent:dom1model1:1', '2=v1:heat_ent:dom1model1:2', '3=v1:heat_ent:dom1model1:3', '4=v1:heat_ent:dom1model1:4'],
    ]);
    expect(renderPoll({ type: 'heating', refId: 'dom1model1', house: { ...house, entrances: 9 }, answered: 0, closed: false }, t).keyboard).toHaveLength(1);
  });
});
