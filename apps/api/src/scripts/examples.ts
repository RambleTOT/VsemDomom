/**
 * Примеры сообщений бота для README: те же функции рендера, что у бота, модельные входные данные.
 *   pnpm examples            — пишет docs/EXAMPLES.md
 *   pnpm examples --check    — сверяет файл с текущим кодом (для CI и перед коммитом)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  participantCounts,
  renderActOffer,
  renderCard,
  renderCheckQuestion,
  renderKeywordReply,
  renderMonthlySummary,
  renderPanel,
  renderPoll,
  renderResult,
  renderStatusNotice,
  type BotMessage,
  type CardDeadline,
  type CardInput,
} from '@vsemdomom/core';
import { ruTranslator as t } from '@vsemdomom/shared';
import { resolveDataDir } from '../util/paths.ts';

const TZ = 'Europe/Moscow';
const H = 3_600_000;
const MIN = 60_000;
const BOT = 'vsemdomom_bot';
const ID = 'K3f9QpZ2aB';
const at = (hhmm: string, day = '2026-09-27') => new Date(`${day}T${hhmm}:00+03:00`);
const house = { publicId: 'dom1model1', label: '1', address: 'ул. Модельная, 1', timezone: TZ, isModel: true };

const basis = { basisDoc: 'ПП № 416', basisPoint: 'п. 13' };
const deadlines: CardDeadline[] = [
  { kind: 'answer', status: 'pending', dueAt: at('18:10'), warnAt: at('17:40'), ...basis },
  { kind: 'localize', status: 'pending', dueAt: at('18:10'), warnAt: at('17:40'), ...basis },
  { kind: 'fix', status: 'pending', dueAt: at('17:40', '2026-09-30'), warnAt: at('17:10', '2026-09-30'), ...basis },
];

function card(overrides: Partial<Omit<CardInput, 'incident'>> & { incident?: Partial<CardInput['incident']> } = {}): CardInput {
  const { incident, ...rest } = overrides;
  return {
    incident: {
      publicId: ID,
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
      ...Array.from({ length: 5 }, () => ({ entrance: 3, trustLevel: 1 as const, affected: true })),
    ]),
    deadlines,
    discrepancyFlats: 0,
    overNorm: null,
    unconfirmedRestoreFlats: 0,
    mergedIntoPublicId: null,
    brigadeConfirm: true,
    discrepancyMaxHours: 72,
    updatedAt: at('17:58'),
    botUsername: BOT,
    now: at('18:00'),
    ...rest,
  };
}

function block(title: string, m: BotMessage): string {
  const buttons = m.keyboard.map((row) => row.map((b) => `[${b.text}]`).join(' ')).join('\n');
  return [`### ${title}`, '', '```', m.text.replace(/\*\*/g, ''), ...(buttons ? ['', buttons] : []), '```', ''].join('\n');
}

export function examplesMarkdown(): string {
  const met = deadlines.map((d) => (d.kind === 'answer' ? { ...d, status: 'met' as const } : d));
  const parts = [
    '# Примеры сообщений бота',
    '',
    'Файл собирается командой `pnpm examples` из тех же функций рендера, что использует бот (`packages/core/src/render`), на модельных данных. Жирный текст MAX (`**…**`) здесь показан без разметки, кнопки — в квадратных скобках. Время — по часовому поясу дома.',
    '',
    '## Чат дома',
    '',
    block('C01 · Панель дома в закрепе', renderPanel({ house, active: { service: 'hot_water', startedAt: at('17:40'), count: 1 }, lastResult: { closedAt: at('12:30', '2026-09-02'), service: 'hot_water', inNorm: false }, membersCount: 312, botUsername: BOT, now: at('18:00') }, t)),
    block('C02 · Карточка: открыта', renderCard(card(), t)),
    block('C02 · Карточка: УК приняла', renderCard(card({ incident: { status: 'accepted', etaAt: at('21:00') }, deadlines: met }), t)),
    block('C02 · Карточка: бригада на месте', renderCard(card({ incident: { status: 'brigade_on_site', etaAt: at('21:00'), brigadeOnSiteAt: at('18:40') }, deadlines: met, now: at('18:45'), updatedAt: at('18:40') }), t)),
    block('C02 · Карточка: локализована', renderCard(card({ incident: { status: 'localized', etaAt: at('21:00'), localizedAt: at('19:10') }, deadlines: met, now: at('19:15'), updatedAt: at('19:10') }), t)),
    block('C02 · Карточка: проверяем после «Устранено»', renderCard(card({ incident: { status: 'checking', resolvedAtUk: at('20:30') }, deadlines: met, now: at('20:31'), updatedAt: at('20:30') }), t)),
    block('C03 · Вопрос о восстановлении (второе новое сообщение)', renderCheckQuestion({ incidentPublicId: ID, service: 'hot_water', resolvedAt: at('20:30'), recheck: false, house: { timezone: TZ, isModel: true }, now: at('20:31') }, t)),
    block('C02 · Карточка: расхождение', renderCard(card({ incident: { status: 'discrepancy', resolvedAtUk: at('20:30') }, deadlines: met, discrepancyFlats: 1, now: at('20:40'), updatedAt: at('20:40') }), t)),
    block('C02 · Карточка: закрыта сверх нормы', renderCard(card({ incident: { status: 'closed', resolvedAtUk: at('20:30') }, deadlines: met, overNorm: { flats: 3, durationMs: 10 * H + 40 * MIN }, now: at('21:00'), updatedAt: at('21:00') }), t)),
    block('C04 · Итог ответом на карточку (третье новое сообщение)', renderResult({ incidentPublicId: ID, service: 'hot_water', house: { label: '1', timezone: TZ, isModel: true }, startedAt: at('17:40'), resolvedAt: at('20:30'), flats: 11, late: { flats: 1, lastAt: at('21:40') }, overNorm: { flats: 1, month: 9, totalMs: 10 * H, limitMs: 8 * H }, botUsername: BOT, now: at('21:45') }, t)),
    block('C06 · Ответ на «нет воды» (F13, флаг выключен по умолчанию)', renderKeywordReply({ housePublicId: house.publicId, incident: { publicId: ID, service: 'hot_water' }, isModel: true, botUsername: BOT }, t)),
    block('C07 · Опрос «Как вода сейчас?» (F14)', renderPoll({ type: 'water_quality', refId: ID, house: { label: '1', entrances: 4, isModel: true }, answered: 7, closed: false }, t)),
    block('C08 · Итог месяца (F15)', renderMonthlySummary({ housePublicId: house.publicId, house: { label: '1', isModel: true }, month: 9, incidents: 3, inNorm: 2, avgAcceptMs: 25 * MIN, overNorm: [{ service: 'hot_water', totalMs: 10 * H + 40 * MIN, limitMs: 8 * H, doc: 'Правила № 354', point: 'прил. 1, п. 4' }], botUsername: BOT }, t)),
    '## Личка с ботом',
    '',
    block('C05 · Статус изменился', renderStatusNotice({ incidentPublicId: ID, service: 'hot_water', status: 'accepted', eta: at('21:00'), statusAt: at('18:05'), localize: { dueAt: at('18:10'), ...basis }, house: { label: '1', timezone: TZ, isModel: true }, botUsername: BOT, now: at('18:05') }, t)),
    block('S09 · Акт без исполнителя', renderActOffer({ incidentPublicId: ID, checkVisitMs: 2 * H, visitBasis: { doc: 'Правила № 354', point: 'п. 108' }, persons: 2, actBasis: { doc: 'Правила № 354', point: 'п. 110(1)' }, readyCount: 1, myReady: false, introOptIn: false, withTemplate: true, botUsername: BOT, isModel: true }, t)),
  ];
  return parts.join('\n');
}

if (process.argv[1]?.endsWith('examples.ts')) {
  const target = `${resolveDataDir(undefined, 'docs')}/EXAMPLES.md`;
  const text = examplesMarkdown();
  if (process.argv.includes('--check')) {
    const current = readFileSync(target, 'utf8');
    if (current !== text) {
      process.stderr.write('docs/EXAMPLES.md устарел: pnpm examples\n');
      process.exit(1);
    }
    process.stdout.write('docs/EXAMPLES.md актуален\n');
  } else {
    writeFileSync(target, text);
    process.stdout.write(`записано: ${target}\n`);
  }
}
