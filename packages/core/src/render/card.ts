/**
 * C02. Карточка аварии — одно сообщение, которое бот правит (F02, F03).
 * Первая строка во всех состояниях отвечает на вопрос «знает ли УК и когда»;
 * без имён и номеров квартир; время абсолютное, в поясе дома.
 */
import { MAX_LIMITS } from '../constants/max-limits.ts';
import { deadlineState, type DeadlineRow } from '../deadlines/deadlines.ts';
import type { DeadlineKind, IncidentStatus, ServiceType } from '../domain/enums.ts';
import { formatChatTime, formatDuration } from '../format/time.ts';
import type { ParticipantCounts } from '../incident/counts.ts';
import { displayStatus } from '../incident/state-machine.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback, encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage, Keyboard, KeyboardButton } from './message.ts';
import { bold, escapeMarkdown, lines, lowerFirst, serviceName, serviceNo, serviceOk } from './text.ts';

/** До стольких подъездов — кнопки с номерами; больше — одна «У меня тоже» (ограничение ряда MAX). */
export const CARD_MAX_ENTRANCE_BUTTONS = MAX_LIMITS.buttonsPerRow;

export interface CardDeadline extends DeadlineRow {
  basisDoc: string;
  basisPoint: string;
}

export interface CardInput {
  incident: {
    publicId: string;
    service: ServiceType;
    status: IncidentStatus;
    discrepancyUnresolved: boolean;
    startedAt: Date;
    etaAt: Date | null;
    brigadeOnSiteAt: Date | null;
    localizedAt: Date | null;
    resolvedAtUk: Date | null;
  };
  house: { entrances: number; timezone: string; isModel: boolean };
  counts: ParticipantCounts;
  deadlines: readonly CardDeadline[];
  /** Расхождение: квартиры с актуальным ответом «Нет». */
  discrepancyFlats: number;
  /** Закрытие: квартиры с перерывом сверх месячной нормы. */
  overNorm: { flats: number; durationMs: number } | null;
  /** Закрыта с расхождением: квартиры, где восстановление не подтверждено. */
  unconfirmedRestoreFlats: number;
  mergedIntoPublicId: string | null;
  /** FEATURE_BRIGADE_CONFIRM: кнопки «Подтверждаю» / «Бригады нет». */
  brigadeConfirm: boolean;
  /** DISCREPANCY_MAX_HOURS — для текста «За 72 ч … не пришло». */
  discrepancyMaxHours: number;
  /** Время последнего изменения (не «сейчас»: иначе каждая правка отличалась бы). */
  updatedAt: Date;
  botUsername: string;
  now: Date;
}

const WATER: readonly ServiceType[] = ['cold_water', 'hot_water'];

const MARKER: Record<ReturnType<typeof displayStatus>, string> = {
  open: 'open',
  accepted: 'work',
  brigade_on_site: 'work',
  localized: 'work',
  checking: 'checking',
  discrepancy: 'discrepancy',
  closed: 'closed',
  closed_with_discrepancy: 'discrepancy',
  merged: 'merged',
};

function deadlineOf(input: CardInput, kind: DeadlineKind): CardDeadline | null {
  return input.deadlines.find((d) => d.kind === kind && d.status !== 'cancelled') ?? null;
}

function isExpired(d: CardDeadline, now: Date): boolean {
  return deadlineState(d, now) === 'breached';
}

/** Вторая строка для шагов УК после «Принято»: ориентир УК, иначе срок устранения. */
function etaOrFix(input: CardInput, t: Translator, time: (at: Date) => string): string {
  const fix = deadlineOf(input, 'fix');
  if (fix && isExpired(fix, input.now)) return t.t('bot.card.l2.fix_expired', { time: time(fix.dueAt) });
  if (input.incident.etaAt) return t.t('bot.card.l2.eta', { eta: time(input.incident.etaAt) });
  if (fix) return t.t('bot.card.l2.accepted_fix', { fix: time(fix.dueAt), doc: escapeMarkdown(fix.basisDoc), point: escapeMarkdown(fix.basisPoint) });
  return t.t('bot.card.l2.no_norm');
}

function statusLines(input: CardInput, t: Translator): [string, string] {
  const { incident, now } = input;
  const tz = input.house.timezone;
  const time = (at: Date) => formatChatTime(at, now, tz);
  const status = displayStatus(incident.status, incident.discrepancyUnresolved);
  const marker = t.t(`bot.marker.${MARKER[status]}`);
  const water = WATER.includes(incident.service);
  const vars = {
    marker,
    service: serviceName(t, incident.service),
    service_no: serviceNo(t, incident.service),
    service_no_lower: lowerFirst(serviceNo(t, incident.service)),
    service_ok: serviceOk(t, incident.service),
  };
  const resolvedAt = incident.resolvedAtUk ?? now;

  switch (status) {
    case 'open': {
      const answer = deadlineOf(input, 'answer');
      const l2 = !answer
        ? t.t('bot.card.l2.no_norm')
        : isExpired(answer, now)
          ? t.t('bot.card.l2.open_expired', { time: time(answer.dueAt) })
          : t.t('bot.card.l2.open', { time: time(answer.dueAt), doc: escapeMarkdown(answer.basisDoc), point: escapeMarkdown(answer.basisPoint) });
      return [t.t('bot.card.status.open', vars), l2];
    }
    case 'accepted': {
      const l1 = incident.etaAt
        ? t.t('bot.card.status.accepted', { ...vars, eta: time(incident.etaAt) })
        : t.t('bot.card.status.accepted_no_eta', vars);
      const localize = deadlineOf(input, 'localize');
      const fix = deadlineOf(input, 'fix');
      if (localize && fix && localize.status !== 'met') {
        const key = isExpired(localize, now) ? 'bot.card.l2.localize_expired' : 'bot.card.l2.accepted';
        return [l1, t.t(key, { time: time(localize.dueAt), fix: time(fix.dueAt), doc: escapeMarkdown(fix.basisDoc), point: escapeMarkdown(fix.basisPoint) })];
      }
      return [l1, etaOrFix(input, t, time)];
    }
    case 'brigade_on_site':
      return [t.t('bot.card.status.brigade', { ...vars, time: time(incident.brigadeOnSiteAt ?? now) }), etaOrFix(input, t, time)];
    case 'localized':
      return [t.t('bot.card.status.localized', { ...vars, time: time(incident.localizedAt ?? now) }), etaOrFix(input, t, time)];
    case 'checking':
      return [
        t.t('bot.card.status.checking', { ...vars, time: time(resolvedAt) }),
        t.t(water ? 'bot.card.l2.checking' : 'bot.card.l2.checking.other'),
      ];
    case 'discrepancy': {
      // «у 3 квартир» — родительный падеж.
      const flats = { count: input.discrepancyFlats, flats: t.plural(input.discrepancyFlats, 'flats_gen') };
      return [
        t.t(water ? 'bot.card.status.discrepancy' : 'bot.card.status.discrepancy.other', { ...vars, ...flats }),
        t.t('bot.card.l2.discrepancy', { time: time(resolvedAt) }),
      ];
    }
    case 'closed': {
      const duration = formatDuration(resolvedAt.getTime() - incident.startedAt.getTime());
      const over = input.overNorm && input.overNorm.flats > 0 ? input.overNorm : null;
      const l2 = over
        ? // Сумма перерывов за месяц (у нескольких квартир — наибольшая), а не длина этой аварии.
          t.t(over.flats > 1 ? 'bot.card.l2.closed_over.many' : 'bot.card.l2.closed_over', {
            count: over.flats,
            flats: t.plural(over.flats, 'flats_gen'),
            duration: formatDuration(over.durationMs),
          })
        : t.t('bot.card.l2.closed_ok', { duration });
      return [t.t('bot.card.status.closed', vars), l2];
    }
    case 'closed_with_discrepancy': {
      const n = input.unconfirmedRestoreFlats;
      return [
        t.t('bot.card.status.closed_disc', { ...vars, count: n, flats: t.plural(n, 'flats_gen') }),
        t.t(water ? 'bot.card.l2.closed_disc' : 'bot.card.l2.closed_disc.other', { hours: input.discrepancyMaxHours }),
      ];
    }
    case 'merged':
      return [t.t('bot.card.status.merged', vars), t.t('bot.card.l2.merged')];
  }
}

function sinceLine(input: CardInput, t: Translator): string {
  const time = formatChatTime(input.incident.startedAt, input.now, input.house.timezone);
  const { residents, byEntrance } = input.counts;
  if (residents === 0) return t.t('bot.card.since.none', { time });
  // «отметился 1 житель», «отметились 2 жителя»: глагол согласуется с числом.
  const base = { time, count: residents, residents: t.plural(residents, 'residents'), joined: t.plural(residents, 'joined') };
  if (byEntrance.length === 0) return t.t('bot.card.since.short', base);
  const list = byEntrance.map((e) => t.t('bot.card.entrance_count', { entrance: e.entrance, count: e.count })).join(', ');
  return t.t('bot.card.since', { ...base, by_entrance: list });
}

function joinKeyboard(input: CardInput, t: Translator): Keyboard {
  const id = input.incident.publicId;
  const notMe: KeyboardButton = { type: 'callback', text: t.t('bot.card.btn.not_me'), payload: encodeCallback('notme', id) };
  const rows: Keyboard = [];
  if (input.house.entrances <= CARD_MAX_ENTRANCE_BUTTONS) {
    rows.push(
      Array.from({ length: input.house.entrances }, (_, i) => ({
        type: 'callback' as const,
        text: String(i + 1),
        payload: encodeCallback('join', id, i + 1),
      })),
    );
    rows.push([{ type: 'callback', text: t.t('bot.card.btn.dont_know'), payload: encodeCallback('join', id, 0) }, notMe]);
  } else {
    rows.push([{ type: 'callback', text: t.t('bot.card.btn.me_too'), payload: encodeCallback('join', id, 0) }, notMe]);
  }
  if (input.incident.status === 'brigade_on_site' && input.brigadeConfirm) {
    rows.push([
      { type: 'callback', text: t.t('bot.card.btn.crew_yes'), payload: encodeCallback('crew_yes', id) },
      { type: 'callback', text: t.t('bot.card.btn.crew_no'), payload: encodeCallback('crew_no', id) },
    ]);
  }
  rows.push([{ type: 'open_app', text: t.t('bot.card.btn.details'), webApp: input.botUsername, payload: encodeStartApp('i', id) }]);
  return rows;
}

export function renderCard(input: CardInput, t: Translator): BotMessage {
  const { incident } = input;
  const [l1, l2] = statusLines(input, t);
  const updated = formatChatTime(input.updatedAt, input.now, input.house.timezone);
  const footer = input.house.isModel ? t.t('bot.footer.updated', { time: updated }) : t.t('bot.card.updated', { time: updated });

  if (incident.status === 'merged') {
    const keyboard: Keyboard = input.mergedIntoPublicId
      ? [[{ type: 'open_app', text: t.t('bot.card.btn.open_actual'), webApp: input.botUsername, payload: encodeStartApp('i', input.mergedIntoPublicId) }]]
      : [];
    return { text: lines(bold(l1), l2, footer), format: 'markdown', keyboard };
  }
  if (incident.status === 'closed') {
    return {
      text: lines(bold(l1), l2, sinceLine(input, t), footer),
      format: 'markdown',
      keyboard: [[{ type: 'open_app', text: t.t('bot.card.btn.result'), webApp: input.botUsername, payload: encodeStartApp('r', incident.publicId) }]],
    };
  }
  const water = WATER.includes(incident.service);
  const ask =
    input.house.entrances > CARD_MAX_ENTRANCE_BUTTONS
      ? t.t('bot.card.ask.single', { service_no_lower: lowerFirst(serviceNo(t, incident.service)) })
      : water
        ? t.t('bot.card.ask')
        : t.t('bot.card.ask.other', { service_no_lower: lowerFirst(serviceNo(t, incident.service)) });
  const unconfirmed = input.counts.unconfirmed > 0 ? t.t('bot.card.unconfirmed', { count: input.counts.unconfirmed }) : null;
  return {
    text: lines(bold(l1), l2, sinceLine(input, t), unconfirmed, ask, footer),
    format: 'markdown',
    keyboard: joinKeyboard(input, t),
  };
}
