import { describe, expect, it } from 'vitest';
import {
  formatRecalcFormula,
  renderDeadlineNotice,
  renderNoWater,
  renderStatement,
  renderStatusNotice,
  validateBotMessage,
  type BotMessage,
  type StatusNoticeInput,
} from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const TZ = 'Europe/Moscow';
const at = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);
const house = { label: '1', timezone: TZ, isModel: true };

function assertDm(m: BotMessage): void {
  expect(validateBotMessage(m)).toEqual([]);
  expect(m.text).not.toMatch(/\{\w+\}/);
  expect(m.keyboard.map((r) => r.map((b) => `${b.type}:${b.text}`))).toEqual([['open_app:Подробнее', 'callback:Не присылать']]);
  expect(m.text.split('\n').at(-1)).toBe('Модельные данные');
}

const base: StatusNoticeInput = {
  incidentPublicId: 'K3f9QpZ2aB',
  service: 'hot_water',
  status: 'accepted',
  eta: at('18:00'),
  statusAt: at('17:50'),
  localize: { dueAt: at('18:10'), basisDoc: 'ПП № 416', basisPoint: 'п. 13' },
  house,
  botUsername: 'vsemdomom_bot',
  now: at('17:50'),
};

describe('личные уведомления присоединившимся (C05 «Статус изменился», F04)', () => {
  it('«Принята»: ориентир УК и срок локализации с основанием', () => {
    const m = renderStatusNotice(base, t);
    assertDm(m);
    expect(m.text).toMatchInlineSnapshot(`
      "🟠 УК приняла аварию, ориентир 18:00
      Горячая вода, Дом 1. Локализовать до 18:10 (ПП № 416, п. 13)
      Модельные данные"
    `);
    expect(m.keyboard[0]?.[1]).toMatchObject({ payload: 'v1:mute:K3f9QpZ2aB' });
    expect(m.keyboard[0]?.[0]).toMatchObject({ payload: 'i_K3f9QpZ2aB' });
  });

  it('остальные шаги УК', () => {
    const lines = (input: Partial<StatusNoticeInput>) => renderStatusNotice({ ...base, ...input }, t).text.split('\n');
    expect(lines({ eta: null, localize: null })).toEqual(['🟠 УК приняла аварию', 'Горячая вода, Дом 1', 'Модельные данные']);
    // Срок локализации уже прошёл: ориентир — только в первой строке, без повтора.
    expect(lines({ localize: null })).toEqual(['🟠 УК приняла аварию, ориентир 18:00', 'Горячая вода, Дом 1', 'Модельные данные']);
    expect(lines({ status: 'brigade_on_site', statusAt: at('18:05') })).toEqual([
      '🟠 Бригада УК на месте с 18:05',
      'Горячая вода, Дом 1. Ориентир УК 18:00',
      'Модельные данные',
    ]);
    expect(lines({ status: 'localized', statusAt: at('18:20'), eta: null })[0]).toBe('🟠 Авария локализована в 18:20');
    expect(lines({ status: 'checking', statusAt: at('19:10'), service: 'heating' })).toEqual([
      '🔵 УК отметила устранение в 19:10',
      'Отопление, Дом 1. Батареи снова тёплые? Ответьте в чате дома или в «Подробнее»',
      'Модельные данные',
    ]);
  });

  it('сроки: «до срока 30 минут» и «срок истёк» — нейтрально, с названием нормы', () => {
    const input = { incidentPublicId: 'K3f9QpZ2aB', service: 'hot_water' as const, title: 'Локализовать аварию', dueAt: at('18:10'), house, botUsername: 'vsemdomom_bot', now: at('17:40') };
    const soon = renderDeadlineNotice({ ...input, kind: 'warn' }, t);
    assertDm(soon);
    expect(soon.text).toBe('До срока по нормативу 30 минут: локализовать аварию до 18:10\nГорячая вода, Дом 1\nМодельные данные');
    const expired = renderDeadlineNotice({ ...input, kind: 'breach', now: at('18:11') }, t);
    assertDm(expired);
    expect(expired.text.split('\n')[0]).toBe('Срок по нормативу истёк в 18:10: локализовать аварию');
    expect(expired.text).not.toMatch(/наруш|виноват|УК не/i);
    const answer = renderDeadlineNotice({ ...input, kind: 'breach', title: 'УК сообщит сроки работ', now: at('18:11') }, t);
    expect(answer.text.split('\n')[0]).toBe('Срок по нормативу истёк в 18:10: УК сообщит сроки работ');
  });
});

describe('закрытие и «Воды нет — что делать» (F07, F08)', () => {
  it('уведомление о закрытии: ссылка на итог; с расхождением — своя строка', () => {
    const closed = renderStatusNotice({ ...base, status: 'closed', statusAt: at('19:40') }, t);
    expect(closed.text).toBe('✅ Авария закрыта · горячая вода есть\nГорячая вода, Дом 1. Итог и перерасчёт — в «Подробнее»\nМодельные данные');
    expect(closed.keyboard[0]?.[0]).toMatchObject({ type: 'open_app', payload: 'r_K3f9QpZ2aB' });
    const disc = renderStatusNotice({ ...base, status: 'closed', unresolved: true }, t);
    expect(disc.text.split('\n')[0]).toBe('⚠️ Авария закрыта, восстановление подтвердили не все');
  });

  const nowater = {
    incidentPublicId: 'K3f9QpZ2aB',
    service: 'hot_water' as const,
    adsPhone: '+7 (000) 000-00-01',
    actNorms: { checkVisitMs: 2 * 3_600_000, actPersons: 2 },
    withAct: false,
    telLinks: false,
    isModel: true,
    botUsername: 'vsemdomom_bot',
  };

  it('инструкция ответившему «Нет»: АДС и акт, числа — из справочника норм', () => {
    const m = renderNoWater(nowater, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text).toMatchInlineSnapshot(`
      "**Воды нет — что делать**
      1. Повторно сообщите в АДС: +7 (000) 000-00-01
      2. Если через 2 ч проверки нет, акт могут составить 2 соседа и председатель совета (Правила № 354, пп. 108, 110(1))
      Модельные данные"
    `);
    expect(m.keyboard.map((r) => r.map((b) => `${b.type}:${b.text}`))).toEqual([['callback:Я сообщил в АДС'], ['clipboard:Скопировать номер АДС']]);
    expect(m.keyboard[0]?.[0]).toMatchObject({ payload: 'v1:ads_again:K3f9QpZ2aB' });
  });

  it('другая услуга, без норм акта, с кнопкой акта при готовой функции', () => {
    const m = renderNoWater({ ...nowater, service: 'heating', actNorms: null, withAct: true }, t);
    expect(m.text.split('\n')).toEqual(['**Нет отопления — что делать**', '1. Повторно сообщите в АДС: +7 (000) 000-00-01', 'Модельные данные']);
    expect(m.keyboard.at(-1)?.[0]).toMatchObject({ type: 'open_app', text: 'Как составить акт', payload: 'a_K3f9QpZ2aB' });
  });
});

describe('заявление в личку и формула расчёта (F09)', () => {
  it('заявление: текст как есть (разметка экранирована), пометка про ПДн, «Скопировать»', () => {
    const text = 'В УК «Модельная» от Иванова И. И., ул. Модельная, 1, кв. 57\nЗаявление *об изменении* размера платы';
    const m = renderStatement(text, t);
    expect(validateBotMessage(m)).toEqual([]);
    expect(m.text).toBe(
      [
        'Заявление на перерасчёт — текст ниже. Скопируйте и отправьте в УК',
        '',
        'В УК «Модельная» от Иванова И. И., ул. Модельная, 1, кв. 57',
        'Заявление \\*об изменении\\* размера платы',
        '',
        'ФИО и телефон не сохраняются на сервере',
      ].join('\n'),
    );
    expect(m.keyboard).toEqual([[{ type: 'clipboard', text: 'Скопировать', payload: text }]]);
    // Длинный текст не помещается в кнопку «Скопировать» (1024 символа) — кнопки нет.
    expect(renderStatement('а'.repeat(1500), t).keyboard).toEqual([]);
  });

  it('формула: часы × ставка × плата = сумма', () => {
    // Суммы и проценты — с неразрывными пробелами; для сравнения заменяем их обычными.
    const plain = (x: string) => x.replace(/\u00a0/g, ' ');
    expect(plain(formatRecalcFormula({ excessMinutes: 240, ratePercent: '0.15', monthlyChargeKopecks: 120_000, amountKopecks: 720 }, t))).toBe('4 ч × 0,15 % × 1 200 ₽ = 7,20 ₽');
    expect(plain(formatRecalcFormula({ excessMinutes: 220, ratePercent: '0.15', monthlyChargeKopecks: 125_050, amountKopecks: 688 }, t))).toBe(
      '3 ч 40 мин × 0,15 % × 1 250,50 ₽ = 6,88 ₽',
    );
  });
});
