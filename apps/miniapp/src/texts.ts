/** Тексты аварии без React: первая строка «знает ли УК и когда» и строки хронологии. */
import type { IncidentSummary, TimelineEvent } from '@vsemdomom/shared';
import { minutesText, whenIn } from './format.ts';
import { has, plural, restoreQuestion, serviceGen, serviceNo, t } from './i18n.ts';

/** Текст первой строки по статусу: ответ на вопрос «знает ли УК и когда». */
export function headlineText(inc: Pick<IncidentSummary, 'displayStatus' | 'headline' | 'service' | 'house'>, now: Date = new Date()): { title: string; sub: string | null } {
  const tz = inc.house.timezone;
  const h = inc.headline;
  const at = (iso: string | null) => (iso ? whenIn(iso, tz, now) : '');
  switch (inc.displayStatus) {
    case 'open':
      return { title: `${serviceNo(inc.service)} · ${t('incident.headline.no_answer')}`, sub: null };
    case 'accepted':
      return { title: h.eta ? t('incident.headline.accepted', { eta: at(h.eta) }) : t('incident.headline.accepted.no_eta'), sub: serviceNo(inc.service) };
    case 'brigade_on_site':
      return {
        title: h.eta ? t('incident.headline.brigade', { time: at(h.statusAt), eta: at(h.eta) }) : t('incident.headline.brigade.no_eta', { time: at(h.statusAt) }),
        sub: serviceNo(inc.service),
      };
    case 'localized':
      return {
        title: h.eta ? t('incident.headline.localized', { time: at(h.statusAt), eta: at(h.eta) }) : t('incident.headline.localized.no_eta', { time: at(h.statusAt) }),
        sub: serviceNo(inc.service),
      };
    case 'checking':
      return { title: t('incident.headline.checking', { restore_question: restoreQuestion(inc.service) }), sub: h.statusAt ? t('screen.S05.restore.meta', { time: at(h.statusAt) }) : null };
    case 'discrepancy':
      return {
        title: t('incident.headline.discrepancy', { count: h.discrepancyFlats, flats: plural(h.discrepancyFlats, 'flats_gen'), service_gen: serviceGen(inc.service) }),
        sub: h.statusAt ? t('incident.headline.discrepancy.sub', { time: at(h.statusAt) }) : null,
      };
    case 'closed':
      return { title: t('incident.headline.closed', { duration: minutesText(h.durationMinutes ?? 0) }), sub: null };
    case 'closed_with_discrepancy':
      return { title: t('incident.headline.closed_disc', { count: h.unconfirmedRestoreFlats, flats: plural(h.unconfirmedRestoreFlats, 'flats_gen') }), sub: null };
    case 'merged':
      return { title: t('incident.headline.merged'), sub: null };
  }
}

function deadlineName(kind: unknown): string {
  return typeof kind === 'string' && has(`deadline.title.${kind}`) ? t(`deadline.title.${kind}`) : t('screen.S05.deadlines');
}

/** Текст события хронологии по типу и данным (без ПДн). */
export function eventText(e: TimelineEvent, timezone: string): string {
  const p = e.payload;
  const str = (k: string): string | null => {
    const v = p[k];
    return typeof v === 'string' && v ? v : null;
  };
  const num = (k: string): number | null => {
    const v = p[k];
    return typeof v === 'number' ? v : null;
  };
  switch (e.type) {
    case 'joined': {
      const entrance = num('entrance');
      return entrance ? t('timeline.event.joined.entrance', { entrance }) : t('timeline.event.joined');
    }
    case 'ads_registered': {
      const number = str('number');
      return number ? t('timeline.event.ads_registered.number', { number }) : t('timeline.event.ads_registered');
    }
    case 'ads_rereported': {
      const number = str('number');
      return number ? t('timeline.event.ads_rereported.number', { number }) : t('timeline.event.ads_rereported');
    }
    case 'uk_accepted': {
      const eta = str('eta');
      return eta ? t('timeline.event.uk_accepted.eta', { eta: whenIn(eta, timezone) }) : t('timeline.event.uk_accepted');
    }
    case 'skipped_steps': {
      const steps = Array.isArray(p.steps) ? (p.steps as unknown[]).filter((s): s is string => typeof s === 'string') : [];
      return steps.length ? steps.map((s) => t('timeline.skipped', { step: has(`stepper.step.${s}`) ? t(`stepper.step.${s}`) : s })).join('; ') : t('timeline.event.skipped_steps');
    }
    case 'deadline_warned':
    case 'deadline_met':
    case 'deadline_breached':
      return t(`timeline.event.${e.type}`, { deadline: deadlineName(p.kind) });
    case 'demo_time_shift':
      return t('timeline.event.demo_time_shift', { hours: num('hours') ?? 0 });
    default:
      return has(`timeline.event.${e.type}`) ? t(`timeline.event.${e.type}`) : e.type;
  }
}
