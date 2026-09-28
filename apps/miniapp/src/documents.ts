/**
 * Тексты документов без React: заявление на перерасчёт, образец акта, хронология для копирования.
 * ФИО и телефон живут только на экране и в этом тексте — на сервер не сохраняются.
 */
import type { ActInfo, IncidentDetail, Result } from '@vsemdomom/shared';
import { dateIn, fullDateIn, minutesText, monthOfKey, timeIn } from './format.ts';
import { serviceGen, serviceKey, serviceName, t } from './i18n.ts';
import { eventText } from './texts.ts';

/** Пустое место для подписи, пока ФИО не введено. */
const BLANK = '________________';
const MAX_CHARGE = 1_000_000;

/** «1 250,50» → 1250.5; не число или не больше нуля → null. */
export function parseCharge(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value > 0 && value <= MAX_CHARGE ? value : null;
}

export const serviceAcc = (s: Result['service']): string => t(`service_acc.${serviceKey(s)}`);

interface StatementInput {
  result: Result;
  incident: IncidentDetail;
  ukName: string;
  fio: string;
  phone: string;
}

/** Текст заявления по шаблону словаря: хронология квартиры и пункты норм. */
export function statementText({ result, incident, ukName, fio, phone }: StatementInput): string {
  const tz = result.house.timezone;
  const my = result.my;
  const month = result.month;
  if (!my || !month) return '';
  const sameDay = fullDateIn(result.startedAt, tz) === fullDateIn(my.restoredAt, tz);
  const ads = [incident.ads.registration?.number, incident.me?.adsRereport?.number].filter((n): n is string => typeof n === 'string' && n.length > 0);
  const params = {
    uk: ukName,
    fio: fio.trim() || BLANK,
    address: result.house.address,
    flat: my.flatNo,
    date: fullDateIn(result.startedAt, tz),
    service_gen: serviceGen(result.service),
    from: timeIn(result.startedAt, tz),
    to: sameDay ? timeIn(my.restoredAt, tz) : `${fullDateIn(my.restoredAt, tz)} ${timeIn(my.restoredAt, tz)}`,
    ads: ads.join(', '),
    month: monthOfKey(month.month),
    total: minutesText(month.totalMinutes),
    limit: minutesText(month.limitMinutes),
    norm: `${month.norm.doc}, ${month.norm.point}`,
    service_acc: serviceAcc(result.service),
  };
  const body = t(ads.length > 0 ? 'screen.S08.doc.template' : 'screen.S08.doc.template.no_ads', params);
  return phone.trim() ? `${body}\n${t('screen.S08.doc.phone', { phone: phone.trim() })}` : body;
}

/** Образец акта: адрес, услуга, начало перерыва, заявки в АДС; подписи — пустые строки. */
export function actTemplateText(incident: IncidentDetail, act: ActInfo): string {
  const tz = incident.house.timezone;
  const at = (iso: string) => `${fullDateIn(iso, tz)} ${timeIn(iso, tz)}`;
  const reg = incident.ads.registration;
  const rereport = incident.me?.adsRereport ?? null;
  return t('act.template', {
    address: incident.house.address,
    service: serviceName(incident.service),
    from: at(incident.startedAt),
    ads: reg?.number ? t('act.template.ads', { number: reg.number, time: reg.at ? at(reg.at) : '—' }) : '—',
    rereport: rereport ? t('act.template.ads', { number: rereport.number ?? '—', time: at(rereport.at) }) : '—',
    act_basis: `${act.norm.doc}, ${act.norm.point}`,
  });
}

/** Хронология для копирования: по порядку, со временем в часовом поясе дома. */
export function timelineText(incident: IncidentDetail): string {
  const tz = incident.house.timezone;
  const events = [...incident.timeline].reverse().map((e) => `${dateIn(e.at, tz)} ${timeIn(e.at, tz)} — ${eventText(e, tz)}`);
  return [`${serviceName(incident.service)} · ${t('screen.S03.title', { house: incident.house.label })} · ${incident.house.address}`, ...events].join('\n');
}
