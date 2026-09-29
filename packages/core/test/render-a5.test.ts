import { describe, expect, it } from 'vitest';
import {
  checkMomentInRange,
  looksLikePhone,
  checkStartedAt,
  decodeCallback,
  parseLocalDateTime,
  participantCounts,
  renderAdsNumberError,
  renderAdsReminder,
  renderAskAdsNumber,
  renderCard,
  renderCheckQuestion,
  renderReportAskTime,
  renderReportConfirmOld,
  renderReportDone,
  renderReportTimeError,
  renderReportWhat,
  renderReportWhen,
  renderReportWhere,
  renderResult,
  startedAtFromPreset,
  validateBotMessage,
  type BotMessage,
  type CardDeadline,
  type CardInput,
  type IncidentStatus,
  type ServiceType,
} from '../src/index.ts';
import { t } from './helpers/i18n.ts';

const TZ = 'Europe/Moscow';
const now = new Date('2026-09-27T15:00:00Z'); // 18:00 по Москве
const at = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);

/** Сообщения в группу: без имён и номеров квартир, в лимитах MAX, все параметры подставлены. */
function assertGroupSafe(m: BotMessage): void {
  expect(m.text).not.toMatch(/кв\.\s*\d/);
  assertValid(m);
}

function assertValid(m: BotMessage): void {
  expect(validateBotMessage(m)).toEqual([]);
  expect(m.text).not.toMatch(/\{\w+\}/);
  for (const b of m.keyboard.flat()) {
    if (b.type === 'callback') expect(decodeCallback(b.payload), b.payload).not.toBeNull();
  }
}

const basis = { basisDoc: 'ПП № 416', basisPoint: 'п. 13' };
const deadlines: CardDeadline[] = [
  { kind: 'answer', status: 'pending', dueAt: at('18:10'), warnAt: at('17:40'), ...basis },
  { kind: 'localize', status: 'pending', dueAt: at('18:10'), warnAt: at('17:40'), ...basis },
  { kind: 'fix', status: 'pending', dueAt: at('17:40', '2026-09-30'), warnAt: at('17:10', '2026-09-30'), ...basis },
  { kind: 'single_limit', status: 'pending', dueAt: at('21:40'), warnAt: at('21:10'), ...basis },
];

function card(overrides: Partial<Omit<CardInput, 'incident'>> & { incident?: Partial<CardInput['incident']> } = {}): CardInput {
  const { incident, ...rest } = overrides;
  return {
    incident: {
      publicId: 'K3f9QpZ2aB',
      service: 'hot_water',
      status: 'open',
      discrepancyUnresolved: false,
      startedAt: at('17:40'),
      etaAt: null,
      brigadeOnSiteAt: null,
      localizedAt: null,
      resolvedAtUk: null,
      ...incident,
    },
    house: { entrances: 4, timezone: TZ, isModel: true },
    counts: participantCounts([
      ...Array.from({ length: 6 }, () => ({ entrance: 2, trustLevel: 1 as const, affected: true })),
      ...Array.from({ length: 3 }, () => ({ entrance: 3, trustLevel: 1 as const, affected: true })),
      ...Array.from({ length: 2 }, () => ({ entrance: 3, trustLevel: 0 as const, affected: true })),
      { entrance: 1, trustLevel: 1, affected: false },
    ]),
    deadlines,
    discrepancyFlats: 0,
    overNorm: null,
    unconfirmedRestoreFlats: 0,
    mergedIntoPublicId: null,
    brigadeConfirm: true,
    discrepancyMaxHours: 72,
    updatedAt: at('17:58'),
    botUsername: 'vsemdomom_bot',
    now,
    ...rest,
  };
}

describe('счётчики карточки', () => {
  it('только «у меня тоже», подъезды по порядку, не подтверждены — уровень 0', () => {
    expect(card().counts).toEqual({
      residents: 11,
      byEntrance: [
        { entrance: 2, count: 6 },
        { entrance: 3, count: 5 },
      ],
      unconfirmed: 2,
    });
  });
});

describe('C02 — карточка аварии', () => {
  it('«Открыта»: первая строка — статус УК, вторая — срок ответа по нормативу', () => {
    const m = renderCard(card(), t);
    assertGroupSafe(m);
    expect(m.text).toMatchInlineSnapshot(`
      "**🔴 Нет горячей воды · УК ещё не ответила**
      Срок ответа УК по нормативу — до 18:10 (ПП № 416, п. 13)
      С 17:40 · отметились 11 жителей: подъезд 2 — 6, подъезд 3 — 5
      Из них не подтверждены: 2
      У вас тоже нет воды? Нажмите свой подъезд:
      Обновлено 17:58 · Модельные данные"
    `);
    expect(m.keyboard.map((row) => row.map((b) => b.text))).toEqual([
      ['1', '2', '3', '4'],
      ['Не знаю подъезд', 'Не у меня'],
      ['Подробнее и сроки'],
    ]);
    expect(m.keyboard[0]?.[1]).toMatchObject({ type: 'callback', payload: 'v1:join:K3f9QpZ2aB:2' });
    expect(m.keyboard[1]?.[0]).toMatchObject({ payload: 'v1:join:K3f9QpZ2aB:0' });
    expect(m.keyboard[1]?.[1]).toMatchObject({ payload: 'v1:notme:K3f9QpZ2aB' });
    expect(m.keyboard[2]?.[0]).toMatchObject({ type: 'open_app', webApp: 'vsemdomom_bot', payload: 'i_K3f9QpZ2aB' });
  });

  it('«Открыта», срок ответа истёк', () => {
    const m = renderCard(card({ now: at('18:20') }), t);
    assertGroupSafe(m);
    expect(m.text.split('\n').slice(0, 2)).toEqual([
      '**🔴 Нет горячей воды · УК ещё не ответила**',
      'Срок ответа по нормативу истёк в 18:10 · телефон АДС в «Подробнее»',
    ]);
  });

  const states: [string, IncidentStatus, Partial<CardInput['incident']>, Partial<Omit<CardInput, 'incident'>>, string[]][] = [
    [
      'Принята',
      'accepted',
      { etaAt: at('18:00') },
      {},
      ['**🟠 Нет горячей воды · УК приняла, ориентир 18:00**', 'Локализовать до 18:10 · устранить до 30.09 17:40 (ПП № 416, п. 13)'],
    ],
    [
      'Бригада на месте',
      'brigade_on_site',
      { etaAt: at('18:00'), brigadeOnSiteAt: at('17:55') },
      {},
      ['**🟠 Нет горячей воды · бригада на месте с 17:55**', 'Ориентир УК 18:00'],
    ],
    [
      'Локализована',
      'localized',
      { etaAt: at('19:00'), localizedAt: at('17:59') },
      {},
      ['**🟠 Нет горячей воды · авария локализована в 17:59**', 'Ориентир УК 19:00'],
    ],
    [
      'Проверяем',
      'checking',
      { resolvedAtUk: at('17:50') },
      {},
      ['**🔵 Горячая вода · УК отметила устранение в 17:50**', 'Ответьте на вопрос ниже: есть ли у вас вода'],
    ],
    [
      'Расхождение',
      'discrepancy',
      { resolvedAtUk: at('17:50') },
      { discrepancyFlats: 3 },
      ['**⚠️ Горячая вода · у 3 квартир воды нет**', 'УК отметила устранение в 17:50. Им пришла подсказка в личку'],
    ],
  ];

  it.each(states)('«%s»: меняются только первые две строки', (_name, status, incident, rest, expected) => {
    const m = renderCard(card({ incident: { status, ...incident }, ...rest }), t);
    assertGroupSafe(m);
    const rows = m.text.split('\n');
    expect(rows.slice(0, 2)).toEqual(expected);
    expect(rows.slice(2)).toEqual([
      'С 17:40 · отметились 11 жителей: подъезд 2 — 6, подъезд 3 — 5',
      'Из них не подтверждены: 2',
      'У вас тоже нет воды? Нажмите свой подъезд:',
      'Обновлено 17:58 · Модельные данные',
    ]);
  });

  it('«Бригада на месте»: ряд «Подтверждаю / Бригады нет» только при включённом флаге', () => {
    const on = renderCard(card({ incident: { status: 'brigade_on_site', brigadeOnSiteAt: at('17:55') } }), t);
    expect(on.keyboard.map((r) => r.map((b) => b.text))).toContainEqual(['Подтверждаю', 'Бригады нет']);
    const off = renderCard(card({ incident: { status: 'brigade_on_site', brigadeOnSiteAt: at('17:55') }, brigadeConfirm: false }), t);
    expect(off.keyboard.flat().map((b) => b.text)).not.toContain('Подтверждаю');
    const accepted = renderCard(card({ incident: { status: 'accepted', etaAt: at('18:00') } }), t);
    expect(accepted.keyboard.flat().map((b) => b.text)).not.toContain('Подтверждаю');
  });

  it('«Закрыта в норматив»: строки 3 и 6 остаются, клавиатура — «Итог и перерасчёт»', () => {
    const m = renderCard(card({ incident: { status: 'closed', resolvedAtUk: at('19:10') }, now: at('20:00') }), t);
    assertGroupSafe(m);
    expect(m.text).toBe(
      [
        '**✅ Закрыта · горячая вода есть**',
        '1 ч 30 мин по отметке УК, в пределах нормы. Итог ниже',
        'С 17:40 · отметились 11 жителей: подъезд 2 — 6, подъезд 3 — 5',
        'Обновлено 17:58 · Модельные данные',
      ].join('\n'),
    );
    expect(m.keyboard).toEqual([[{ type: 'open_app', text: 'Итог и перерасчёт', webApp: 'vsemdomom_bot', payload: 'r_K3f9QpZ2aB' }]]);
  });

  it('«Закрыта сверх нормы» и «Закрыта с расхождением»', () => {
    const over = renderCard(
      card({ incident: { status: 'closed', resolvedAtUk: at('19:10') }, overNorm: { flats: 3, durationMs: (5 * 60 + 40) * 60_000 } }),
      t,
    );
    expect(over.text.split('\n')[1]).toBe('У 3 квартир за месяц до 5 ч 40 мин перерывов — сверх месячной нормы. Итог ниже');
    const disc = renderCard(card({ incident: { status: 'closed', discrepancyUnresolved: true, resolvedAtUk: at('19:10') }, unconfirmedRestoreFlats: 2 }), t);
    assertGroupSafe(disc);
    expect(disc.text.split('\n').slice(0, 2)).toEqual([
      '**⚠️ Закрыта · у 2 квартир восстановление не подтверждено**',
      'За 72 ч ответа «есть вода» не пришло. Итог ниже',
    ]);
  });

  it('«Объединена»: ссылка на актуальную карточку', () => {
    const m = renderCard(card({ incident: { status: 'merged' }, mergedIntoPublicId: 'Zx8Wq2Lm4N' }), t);
    assertGroupSafe(m);
    expect(m.text).toBe(['**🔗 Эта авария объединена с другой**', 'Сроки и отметки — в актуальной карточке', 'Обновлено 17:58 · Модельные данные'].join('\n'));
    expect(m.keyboard).toEqual([[{ type: 'open_app', text: 'Открыть актуальную', webApp: 'vsemdomom_bot', payload: 'i_Zx8Wq2Lm4N' }]]);
  });

  it('больше 7 подъездов — одна кнопка «У меня тоже»', () => {
    const m = renderCard(card({ house: { entrances: 9, timezone: TZ, isModel: true } }), t);
    assertGroupSafe(m);
    expect(m.text).toContain('У вас тоже нет горячей воды? Нажмите «У меня тоже»');
    expect(m.keyboard[0]?.map((b) => b.text)).toEqual(['У меня тоже', 'Не у меня']);
  });

  const services: [ServiceType, string, string][] = [
    ['heating', 'У вас тоже нет отопления? Нажмите свой подъезд:', '**✅ Закрыта · отопление есть**'],
    ['electricity', 'У вас тоже нет света? Нажмите свой подъезд:', '**✅ Закрыта · свет есть**'],
    ['sewerage', 'У вас тоже не работает канализация? Нажмите свой подъезд:', '**✅ Закрыта · канализация работает**'],
    ['leak', 'У вас тоже протечка? Нажмите свой подъезд:', '**✅ Закрыта · протечки нет**'],
  ];

  it.each(services)('%s: тексты по виду услуги', (service, ask, closed) => {
    const open = renderCard(card({ incident: { service } }), t);
    assertGroupSafe(open);
    expect(open.text).toContain(ask);
    const done = renderCard(card({ incident: { service, status: 'closed', resolvedAtUk: at('19:10') } }), t);
    expect(done.text.split('\n')[0]).toBe(closed);
    const disc = renderCard(card({ incident: { service, status: 'discrepancy', resolvedAtUk: at('17:50') }, discrepancyFlats: 2 }), t);
    expect(disc.text).not.toContain('воды');
  });

  it('без модельных данных, без отметок, норма не установлена', () => {
    const m = renderCard(
      card({ house: { entrances: 2, timezone: TZ, isModel: false }, counts: participantCounts([]), deadlines: [], incident: { service: 'gas' } }),
      t,
    );
    assertGroupSafe(m);
    expect(m.text).toBe(
      ['**🔴 Нет газа · УК ещё не ответила**', 'Срок по нормативу не установлен', 'С 17:40', 'У вас тоже нет газа? Нажмите свой подъезд:', 'Обновлено 17:58'].join('\n'),
    );
  });

  it('отметки без подъезда: только общее число', () => {
    const m = renderCard(card({ counts: participantCounts([{ entrance: null, trustLevel: 1, affected: true }]) }), t);
    expect(m.text).toContain('С 17:40 · отметился 1 житель\n');
  });

  it('срок локализации истёк после «Принято»', () => {
    const m = renderCard(card({ incident: { status: 'accepted', etaAt: at('19:00') }, now: at('18:30') }), t);
    expect(m.text.split('\n')[1]).toBe('Срок локализации по нормативу истёк в 18:10 · устранить до 30.09 17:40 (ПП № 416, п. 13)');
  });
});

describe('C03 — вопрос о восстановлении', () => {
  const base = { incidentPublicId: 'K3f9QpZ2aB', resolvedAt: at('19:10'), recheck: false, house: { timezone: TZ, isModel: true }, now: at('19:11') };

  it('вода: три кнопки, «плохая» — отдельным рядом', () => {
    const m = renderCheckQuestion({ ...base, service: 'hot_water' }, t);
    assertGroupSafe(m);
    expect(m.text).toMatchInlineSnapshot(`
      "**Горячая вода вернулась?**
      УК отметила устранение в 19:10. Ответ поможет увидеть, у всех ли всё в порядке.
      Модельные данные"
    `);
    expect(m.keyboard.map((r) => r.map((b) => (b.type === 'callback' ? `${b.text}=${b.payload}` : b.text)))).toEqual([
      ['Да, есть=v1:restore:K3f9QpZ2aB:yes', 'Нет=v1:restore:K3f9QpZ2aB:no'],
      ['Есть, но плохая=v1:restore:K3f9QpZ2aB:weak'],
    ]);
  });

  it('отопление и свет — свои подписи; канализация — без третьей кнопки; повторная проверка', () => {
    expect(renderCheckQuestion({ ...base, service: 'heating' }, t).keyboard[1]?.[0]?.text).toBe('Чуть тёплые');
    expect(renderCheckQuestion({ ...base, service: 'electricity' }, t).keyboard[1]?.[0]?.text).toBe('Мигает');
    const sewer = renderCheckQuestion({ ...base, service: 'sewerage' }, t);
    expect(sewer.keyboard).toHaveLength(1);
    expect(sewer.text.split('\n')[0]).toBe('**Канализация работает?**');
    const again = renderCheckQuestion({ ...base, service: 'hot_water', recheck: true, resolvedAt: at('21:05'), now: at('21:06') }, t);
    expect(again.text.split('\n')[1]).toBe('Повторная проверка, УК: 21:05');
  });

  it('авария закрыта — вопрос без кнопок: ответы больше не принимаются', () => {
    const closed = renderCheckQuestion({ ...base, service: 'hot_water', closedAt: at('19:40'), now: at('19:41') }, t);
    assertGroupSafe(closed);
    expect(closed.keyboard).toEqual([]);
    expect(closed.text.split('\n')[1]).toBe('Проверка закончена в 19:40. Итог — ответом на карточку');
  });
});

describe('C04 — итог', () => {
  const base = {
    incidentPublicId: 'K3f9QpZ2aB',
    service: 'hot_water' as ServiceType,
    house: { label: '1', timezone: TZ, isModel: true },
    startedAt: at('17:40'),
    resolvedAt: at('19:10'),
    flats: 11,
    botUsername: 'vsemdomom_bot',
    now: at('23:30'),
  };

  it('с поздним восстановлением и превышением месячной нормы', () => {
    const m = renderResult(
      { ...base, late: { flats: 3, lastAt: at('23:20') }, overNorm: { flats: 3, month: 9, totalMs: (11 * 60 + 40) * 60_000, limitMs: 8 * 3_600_000 } },
      t,
    );
    assertGroupSafe(m);
    expect(m.text).toMatchInlineSnapshot(`
      "**Итог: горячая вода, Дом 1**
      По отметке УК: 17:40–19:10, 1 ч 30 мин
      Отметились 11 квартир. У 3 вода вернулась позже, в 23:20
      У 3 квартир за сентябрь до 11 ч 40 мин перерывов при норме 8 ч
      Им можно подать заявление на перерасчёт
      Копию акта о нарушении качества выдают по запросу за 3 рабочих дня (ПП № 416, п. 34)
      Это расчёт по нормам · Модельные данные"
    `);
    expect(m.keyboard).toEqual([[{ type: 'open_app', text: 'Оформить перерасчёт', webApp: 'vsemdomom_bot', payload: 'r_K3f9QpZ2aB' }]]);
  });

  it('одна квартира сверх нормы — единственное число', () => {
    const m = renderResult({ ...base, late: { flats: 1, lastAt: at('23:20') }, overNorm: { flats: 1, month: 9, totalMs: 10 * 3_600_000, limitMs: 8 * 3_600_000 } }, t);
    expect(m.text.split('\n').slice(3, 5)).toEqual(['У 1 квартиры за сентябрь 10 ч перерывов при норме 8 ч', 'Её жители могут подать заявление на перерасчёт']);
  });

  it('без превышения — «перерасчёт не положен»; другая услуга — без слова «вода»', () => {
    const m = renderResult({ ...base, service: 'electricity', late: { flats: 1, lastAt: at('20:00') }, overNorm: null }, t);
    assertGroupSafe(m);
    expect(m.text).toContain('Отметились 11 квартир. У 1 восстановление позже, в 20:00');
    expect(m.text).toContain('Перерывы в пределах нормы — перерасчёт не положен');
    expect(m.keyboard[0]?.[0]?.text).toBe('Подробнее об итоге');
    expect(m.text).not.toContain('вода');
    const plain = renderResult({ ...base, house: { ...base.house, isModel: false }, late: null, overNorm: null }, t);
    expect(plain.text.split('\n').at(-1)).toBe('Это расчёт по нормам');
    expect(plain.text).toContain('Отметились 11 квартир\n');
    const single = renderResult({ ...base, flats: 1, late: null, overNorm: null }, t);
    expect(single.text).toContain('Отметилась 1 квартира\n');
  });
});

describe('C05 — «Сообщить об аварии» в личке', () => {
  it('что → когда → где: кнопки в лимитах, payload разбираются', () => {
    const what = renderReportWhat('dom1model1', t);
    assertValid(what);
    expect(what.keyboard.map((r) => r.length)).toEqual([2, 2, 2, 2]);
    expect(what.keyboard[0]?.[1]).toMatchObject({ text: 'Горячая вода', payload: 'v1:rep_service:dom1model1:hot_water' });
    expect(what.keyboard[3]?.[1]?.text).toBe('Отмена');

    const when = renderReportWhen({ housePublicId: 'dom1model1', service: 'hot_water' }, t);
    assertValid(when);
    expect(when.text).toBe('С какого времени нет горячей воды?');
    expect(when.keyboard.flat().map((b) => b.text)).toEqual(['Сейчас', '1 ч назад', '3 ч назад', '12 ч назад', 'Указать время', 'Отмена']);
    expect(when.keyboard[1]?.[1]).toMatchObject({ payload: 'v1:rep_when:dom1model1:12h' });

    const where = renderReportWhere({ housePublicId: 'dom1model1', service: 'leak' }, t);
    assertValid(where);
    expect(where.text).toBe('Где протечка?');
    expect(where.keyboard[0]?.map((b) => b.type === 'callback' && b.payload)).toEqual([
      'v1:rep_where:dom1model1:flat',
      'v1:rep_where:dom1model1:entrance',
      'v1:rep_where:dom1model1:house',
    ]);
    for (const m of [renderReportAskTime(t), renderReportTimeError('format', t), renderReportTimeError('future', t), renderAskAdsNumber(t), renderAdsNumberError('format', t)]) {
      assertValid(m);
    }
    const old = renderReportConfirmOld({ housePublicId: 'dom1model1', startedAt: at('09:00', '2026-09-25'), timezone: TZ, now }, t);
    assertValid(old);
    expect(old.text).toBe('Авария началась больше суток назад? Проверьте дату\nНачало: 25.09 09:00');
  });

  const ads = {
    incidentPublicId: 'K3f9QpZ2aB',
    service: 'hot_water' as ServiceType,
    startedAt: at('17:40'),
    house: { address: 'ул. Модельная, 1', timezone: TZ, isModel: true },
    flatNo: 57,
    adsPhone: '+7 (000) 000-00-01',
    telLinks: false,
    botUsername: 'vsemdomom_bot',
    now,
  };

  it('после создания — инструкция АДС: номер текстом и кнопкой «Скопировать», без tel: до проверки', () => {
    const m = renderReportDone({ ...ads, outcome: 'created', adsRegistered: false }, t);
    assertValid(m);
    expect(m.text).toMatchInlineSnapshot(`
      "Авария отмечена. Соседи видят карточку в чате дома
      Сообщите в аварийно-диспетчерскую службу (АДС) — так аварию зарегистрируют официально
      Телефон: +7 (000) 000-00-01
      Назовите ФИО, адрес «ул. Модельная, 1, кв. 57» и «нет горячей воды с 17:40». Вам скажут номер заявки
      Модельные данные"
    `);
    expect(m.keyboard.map((r) => r.map((b) => `${b.type}:${b.text}`))).toEqual([
      ['clipboard:Скопировать номер АДС'],
      ['callback:Ввести номер заявки'],
      ['callback:Не дозвонился'],
      ['open_app:Подробнее'],
    ]);
    const withTel = renderReportDone({ ...ads, telLinks: true, outcome: 'created', adsRegistered: false }, t);
    expect(withTel.keyboard[0]?.[0]).toEqual({ type: 'link', text: 'Позвонить', url: 'tel:+70000000001' });
  });

  it('варианты: только квартира, чат не подключён, уже есть авария, АДС уже известна; напоминание', () => {
    expect(renderReportDone({ ...ads, outcome: 'created_flat', adsRegistered: false }, t).text.split('\n')[0]).toBe(
      'Авария видна УК и вам. В чат дома она не попадёт',
    );
    expect(renderReportDone({ ...ads, outcome: 'created_no_chat', adsRegistered: false }, t).text).toContain('чат дома пока не подключён');
    const joined = renderReportDone({ ...ads, outcome: 'joined_existing', adsRegistered: true }, t);
    assertValid(joined);
    expect(joined.text).toBe(
      'В доме уже есть авария: нет горячей воды с 17:40. Мы отметили вас в ней\nАварию уже зарегистрировали в АДС. Статусы УК придут сюда\nМодельные данные',
    );
    const reminder = renderAdsReminder(ads, t);
    assertValid(reminder);
    expect(reminder.keyboard.flat().map((b) => b.text)).not.toContain('Не дозвонился');
  });
});

describe('начало аварии', () => {
  it('быстрые варианты и проверки', () => {
    expect(startedAtFromPreset('now', now)).toEqual(now);
    expect(startedAtFromPreset('12h', now)).toEqual(new Date('2026-09-27T03:00:00Z'));
    const options = { futureSkewMs: 60_000, confirmOldAfterMs: 24 * 3_600_000 };
    expect(checkStartedAt(new Date(now.getTime() + 30_000), now, options)).toBe('ok');
    expect(checkStartedAt(new Date(now.getTime() + 120_000), now, options)).toBe('future');
    expect(checkStartedAt(new Date(now.getTime() - 25 * 3_600_000), now, options)).toBe('old');
    const bounded = { ...options, maxAgeMs: 31 * 24 * 3_600_000 };
    expect(checkStartedAt(new Date(now.getTime() - 30 * 24 * 3_600_000), now, bounded)).toBe('old');
    expect(checkStartedAt(new Date(now.getTime() - 32 * 24 * 3_600_000), now, bounded)).toBe('too_old');
    expect(checkStartedAt(new Date('0001-01-01T00:00:00Z'), now, bounded)).toBe('too_old');
  });

  it('момент события — не раньше начала и не в будущем', () => {
    const range = { notBefore: new Date(now.getTime() - 3_600_000), futureSkewMs: 60_000 };
    expect(checkMomentInRange(new Date(now.getTime() - 60_000), now, range)).toBe('ok');
    expect(checkMomentInRange(new Date(now.getTime() - 2 * 3_600_000), now, range)).toBe('before');
    expect(checkMomentInRange(new Date(now.getTime() + 120_000), now, range)).toBe('future');
    expect(checkMomentInRange(new Date('9999-12-31T00:00:00Z'), now, range)).toBe('future');
  });

  it('номер заявки не похож на телефон', () => {
    for (const phone of ['89161234567', '+7 916 123-45-67', '8 (916) 123 45 67', '9161234567']) expect(looksLikePhone(phone), phone).toBe(true);
    for (const ok of ['4127', 'А-5123', '2026/0927-15', '123456789']) expect(looksLikePhone(ok), ok).toBe(false);
    expect(renderAdsNumberError('phone', t).text).toBe('Похоже на номер телефона — номер заявки видят соседи. Напишите номер заявки АДС');
  });

  it('тексты ошибок времени: «слишком давно» и «раньше начала»', () => {
    expect(renderReportTimeError('too_old', t, { days: 31 }).text).toBe('Так давно не получится: укажите начало в пределах 31 дня');
    expect(renderAdsNumberError('before', t).text).toBe('Это время раньше начала аварии. Проверьте и напишите ещё раз');
  });

  it('время текстом — в поясе дома', () => {
    expect(parseLocalDateTime('17:40', now, TZ)).toEqual(at('17:40'));
    expect(parseLocalDateTime(' 9.05 ', now, TZ)).toEqual(at('09:05'));
    expect(parseLocalDateTime('26.09 23:15', now, TZ)).toEqual(at('23:15', '2026-09-26'));
    expect(parseLocalDateTime('01.03.2026 08:00', now, TZ)).toEqual(new Date('2026-03-01T05:00:00Z'));
    // «Сегодня» — по часам дома: 00:30 по Москве 28.09 — это ещё 27.09 по UTC.
    expect(parseLocalDateTime('00:10', new Date('2026-09-27T21:30:00Z'), TZ)).toEqual(new Date('2026-09-27T21:10:00Z'));
    for (const bad of ['24:00', '17:60', '31.02 10:00', 'вчера', '1740', '']) expect(parseLocalDateTime(bad, now, TZ), bad).toBeNull();
  });
});
