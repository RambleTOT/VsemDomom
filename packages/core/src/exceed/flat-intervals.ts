/**
 * Интервалы перерывов услуги для конкретной квартиры: аварии масштаба «дом»,
 * аварии масштаба «подъезд» с её подъездом и аварии, где квартира — участник.
 * Объединённые аварии не учитываются.
 */
import type { IncidentScope, IncidentStatus, RestoredAnswer, ServiceType } from '../domain/enums.ts';
import type { Interval } from './interruption.ts';

export interface IntervalParticipant {
  flatNo: number | null;
  affected: boolean;
  restoredAt: Date | null;
  restoredAnswer: RestoredAnswer | null;
}

export interface IntervalIncident {
  id: string;
  serviceType: ServiceType;
  scope: IncidentScope;
  entrance: number | null;
  status: IncidentStatus;
  startedAt: Date;
  resolvedAtUk: Date | null;
  participants: readonly IntervalParticipant[];
}

export interface FlatRef {
  flatNo: number;
  entrance: number | null;
}

export interface FlatInterval extends Interval {
  incidentId: string;
  /** Для этой квартиры перерыв ещё идёт: конец — «сейчас». */
  ongoing: boolean;
}

const BEFORE_RESOLVE: readonly IncidentStatus[] = ['open', 'accepted', 'brigade_on_site', 'localized'];

function affectsFlat(incident: IntervalIncident, flat: FlatRef, participant: IntervalParticipant | undefined): boolean {
  if (participant) return participant.affected;
  if (incident.scope === 'house') return true;
  return incident.scope === 'entrance' && flat.entrance !== null && incident.entrance === flat.entrance;
}

/**
 * Конец перерыва для квартиры: время её восстановления, иначе отметка УК «Устранено»;
 * для открытой аварии и для квартиры, ответившей «Нет» во время проверки, — «сейчас».
 */
function endFor(incident: IntervalIncident, participant: IntervalParticipant | undefined, now: Date): { end: Date; ongoing: boolean } {
  if (BEFORE_RESOLVE.includes(incident.status) || incident.resolvedAtUk === null) return { end: now, ongoing: true };
  if (participant?.restoredAt) return { end: participant.restoredAt, ongoing: false };
  const stillMissing =
    (incident.status === 'checking' || incident.status === 'discrepancy') && participant?.restoredAnswer === 'no';
  if (stillMissing) return { end: now, ongoing: true };
  return { end: incident.resolvedAtUk, ongoing: false };
}

export function flatIntervals(
  incidents: readonly IntervalIncident[],
  service: ServiceType,
  flat: FlatRef,
  now: Date,
): FlatInterval[] {
  const result: FlatInterval[] = [];
  for (const incident of incidents) {
    if (incident.serviceType !== service || incident.status === 'merged') continue;
    const participant = incident.participants.find((p) => p.flatNo === flat.flatNo);
    if (!affectsFlat(incident, flat, participant)) continue;
    const { end, ongoing } = endFor(incident, participant, now);
    if (end.getTime() <= incident.startedAt.getTime()) continue;
    result.push({ incidentId: incident.id, start: incident.startedAt, end, ongoing });
  }
  return result;
}

/** Интервалы дома в целом: аварии масштаба «дом», конец — отметка УК или «сейчас». */
export function houseIntervals(incidents: readonly IntervalIncident[], service: ServiceType, now: Date): FlatInterval[] {
  return incidents
    .filter((i) => i.serviceType === service && i.status !== 'merged' && i.scope === 'house')
    .map((i) => {
      const ongoing = BEFORE_RESOLVE.includes(i.status) || i.resolvedAtUk === null;
      return { incidentId: i.id, start: i.startedAt, end: ongoing ? now : (i.resolvedAtUk ?? now), ongoing };
    })
    .filter((i) => i.end.getTime() > i.start.getTime());
}
