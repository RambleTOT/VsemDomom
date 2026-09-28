/**
 * C05. «Сообщить об аварии» в личке — пошагово кнопками (F01): что → с какого времени → где;
 * после создания — инструкция АДС: номер телефона, что сказать, «Ввести номер заявки».
 */
import { SERVICE_TYPES, STARTED_PRESET_I18N_KEY, type IncidentScope, type ServiceType, type StartedPreset } from '../domain/enums.ts';
import { formatChatTime } from '../format/time.ts';
import type { Translator } from '../i18n/translator.ts';
import { encodeCallback, encodeStartApp } from '../payloads/codec.ts';
import type { BotMessage, Keyboard, KeyboardButton } from './message.ts';
import { escapeMarkdown, lines, lowerFirst, serviceName, serviceNo } from './text.ts';

const msg = (text: string, keyboard: Keyboard = []): BotMessage => ({ text, format: 'markdown', keyboard });
const cancel = (t: Translator): KeyboardButton => ({ type: 'callback', text: t.t('bot.dm.btn.cancel'), payload: encodeCallback('cancel', null) });
const noLower = (t: Translator, service: ServiceType) => lowerFirst(serviceNo(t, service));

/** Подписи услуг длиннее 12 символов — по две в ряд (ряд из двух — до 18 символов). */
const SERVICES_PER_ROW = 2;

/** Шаг 1: услуги по две в ряд, «Отмена» — в последнем ряду. */
export function renderReportWhat(housePublicId: string, t: Translator): BotMessage {
  const buttons: KeyboardButton[] = SERVICE_TYPES.map((s) => ({
    type: 'callback',
    text: serviceName(t, s),
    payload: encodeCallback('rep_service', housePublicId, s),
  }));
  buttons.push(cancel(t));
  const rows: Keyboard = [];
  for (let i = 0; i < buttons.length; i += SERVICES_PER_ROW) rows.push(buttons.slice(i, i + SERVICES_PER_ROW));
  return msg(lines(t.t('bot.dm.report.what'), t.t('bot.dm.report.what.sub')), rows);
}

/** Вопрос шага — один текст для сообщения с кнопками и для «отвеченного» шага. */
export function reportQuestion(step: 'what' | 'when' | 'where', service: ServiceType | null, t: Translator): string {
  if (step === 'what' || !service) return t.t('bot.dm.report.what');
  return t.t(step === 'when' ? 'bot.dm.report.when' : 'bot.dm.report.where', { service_no_lower: noLower(t, service) });
}

/** Шаг 2: «Сейчас», «1 ч назад», «3 ч назад», «12 ч назад», «Указать время». */
export function renderReportWhen(input: { housePublicId: string; service: ServiceType }, t: Translator): BotMessage {
  const btn = (preset: StartedPreset): KeyboardButton => ({
    type: 'callback',
    text: t.t(`since.${STARTED_PRESET_I18N_KEY[preset]}`),
    payload: encodeCallback('rep_when', input.housePublicId, preset),
  });
  return msg(reportQuestion('when', input.service, t), [
    [btn('now'), btn('1h')],
    [btn('3h'), btn('12h')],
    [btn('custom'), cancel(t)],
  ]);
}

export function renderReportAskTime(t: Translator): BotMessage {
  return msg(t.t('bot.dm.report.time.ask'), [[cancel(t)]]);
}

const TIME_ERROR_KEY = { format: 'bot.dm.report.time.error', future: 'bot.dm.report.time.future', too_old: 'bot.dm.report.time.too_old' } as const;

export function renderReportTimeError(kind: keyof typeof TIME_ERROR_KEY, t: Translator, limits: { days: number } = { days: 0 }): BotMessage {
  const text = kind === 'too_old' ? t.t(TIME_ERROR_KEY.too_old, { days: limits.days, days_word: t.plural(limits.days, 'days_gen') }) : t.t(TIME_ERROR_KEY[kind]);
  return msg(text, [[cancel(t)]]);
}

/** Начало раньше суток назад — подтверждение. */
export function renderReportConfirmOld(input: { housePublicId: string; startedAt: Date; timezone: string; now: Date }, t: Translator): BotMessage {
  return msg(
    lines(t.t('screen.S04.step2.confirm.old'), t.t('bot.dm.report.time.old', { time: formatChatTime(input.startedAt, input.now, input.timezone) })),
    [
      [
        { type: 'callback', text: t.t('bot.dm.btn.confirm_old'), payload: encodeCallback('rep_when', input.housePublicId, 'old_ok') },
        { type: 'callback', text: t.t('bot.dm.btn.change_time'), payload: encodeCallback('rep_when', input.housePublicId, 'custom') },
      ],
      [cancel(t)],
    ],
  );
}

/** Шаг 3: где — квартира, подъезд или дом. */
export function renderReportWhere(input: { housePublicId: string; service: ServiceType }, t: Translator): BotMessage {
  const btn = (scope: IncidentScope, key: string): KeyboardButton => ({
    type: 'callback',
    text: t.t(key),
    payload: encodeCallback('rep_where', input.housePublicId, scope),
  });
  return msg(reportQuestion('where', input.service, t), [
    [btn('flat', 'bot.dm.btn.flat'), btn('entrance', 'bot.dm.btn.entrance'), btn('house', 'bot.dm.btn.house')],
    [cancel(t)],
  ]);
}

export interface AdsBlockInput {
  incidentPublicId: string;
  service: ServiceType;
  startedAt: Date;
  house: { address: string; timezone: string; isModel: boolean };
  flatNo: number;
  adsPhone: string;
  /** Кнопка «Позвонить» (link tel:) — только если проверено на живом MAX (22.15). */
  telLinks: boolean;
  botUsername: string;
  now: Date;
}

function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function adsLines(input: AdsBlockInput, t: Translator): string[] {
  return [
    t.t('bot.dm.ads.l1'),
    t.t('bot.dm.ads.phone', { phone: escapeMarkdown(input.adsPhone) }),
    t.t('bot.dm.ads.say', {
      address: escapeMarkdown(input.house.address),
      flat: input.flatNo,
      service_no_lower: noLower(t, input.service),
      time: formatChatTime(input.startedAt, input.now, input.house.timezone),
    }),
  ];
}

function adsKeyboard(input: AdsBlockInput, t: Translator, withFail: boolean): Keyboard {
  const id = input.incidentPublicId;
  const rows: Keyboard = [];
  if (input.telLinks) rows.push([{ type: 'link', text: t.t('bot.dm.btn.call'), url: telUrl(input.adsPhone) }]);
  rows.push([{ type: 'clipboard', text: t.t('report.ads.copy'), payload: input.adsPhone }]);
  rows.push([{ type: 'callback', text: t.t('bot.dm.btn.ads_number'), payload: encodeCallback('ads_number', id) }]);
  if (withFail) rows.push([{ type: 'callback', text: t.t('bot.dm.btn.ads_fail'), payload: encodeCallback('ads_fail', id) }]);
  rows.push([{ type: 'open_app', text: t.t('bot.dm.btn.details'), webApp: input.botUsername, payload: encodeStartApp('i', id) }]);
  return rows;
}

export type ReportOutcome = 'created' | 'created_flat' | 'created_no_chat' | 'joined_existing';

/** После шага «где»: авария создана (или житель отмечен в уже открытой) + инструкция АДС. */
export function renderReportDone(input: AdsBlockInput & { outcome: ReportOutcome; adsRegistered: boolean }, t: Translator): BotMessage {
  const head: Record<ReportOutcome, string> = {
    created: t.t('report.created'),
    created_flat: t.t('report.done.flat'),
    created_no_chat: t.t('bot.dm.report.created.no_chat'),
    joined_existing: t.t('bot.dm.report.joined_existing', {
      service_no_lower: noLower(t, input.service),
      time: formatChatTime(input.startedAt, input.now, input.house.timezone),
    }),
  };
  if (input.adsRegistered) {
    return msg(lines(head[input.outcome], t.t('bot.dm.report.ads_known'), input.house.isModel ? t.t('bot.footer') : null), [
      [{ type: 'open_app', text: t.t('bot.dm.btn.details'), webApp: input.botUsername, payload: encodeStartApp('i', input.incidentPublicId) }],
    ]);
  }
  return msg(lines(head[input.outcome], ...adsLines(input, t), input.house.isModel ? t.t('bot.footer') : null), adsKeyboard(input, t, true));
}

/** Одно напоминание через 30 минут, если номер заявки не введён. */
export function renderAdsReminder(input: AdsBlockInput, t: Translator): BotMessage {
  return msg(
    lines(
      t.t('bot.dm.ads.reminder', {
        service_no_lower: noLower(t, input.service),
        time: formatChatTime(input.startedAt, input.now, input.house.timezone),
      }),
      t.t('bot.dm.ads.phone', { phone: escapeMarkdown(input.adsPhone) }),
      input.house.isModel ? t.t('bot.footer') : null,
    ),
    adsKeyboard(input, t, false),
  );
}

export function renderAskAdsNumber(t: Translator): BotMessage {
  return msg(t.t('bot.dm.ads.number.ask'), [[cancel(t)]]);
}

const ADS_ERROR_KEY = {
  format: 'bot.dm.ads.number.error',
  future: 'bot.dm.report.time.future',
  before: 'bot.dm.ads.time.before',
  phone: 'bot.dm.ads.number.phone',
} as const;

export function renderAdsNumberError(kind: keyof typeof ADS_ERROR_KEY, t: Translator): BotMessage {
  return msg(t.t(ADS_ERROR_KEY[kind]), [[cancel(t)]]);
}
