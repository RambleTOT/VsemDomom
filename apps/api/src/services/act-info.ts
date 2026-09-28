/**
 * S09: можно ли готовить акт без исполнителя. Житель ответил «Нет», повторно сообщил в АДС (п. 108) —
 * если проверки нет в срок нормы check_visit, акт доступен. Проверкой считается повторное «Устранено»
 * от УК после повторного сообщения. Потребителей для акта — норма act_without_executor (п. 110(1)).
 * Чистый расчёт: нормы и участники приходят снаружи.
 */
import { normDurationMs, selectNorm, type IncidentStatus, type NormRecord, type RestoredAnswer, type ServiceType } from '@vsemdomom/core';
import type { IncidentDetail } from '@vsemdomom/shared';
import type { HouseRow } from '../db/queries.ts';
import { basisOf } from './month.ts';
import { iso } from './views.ts';

export interface ActNorms {
  visit: NormRecord;
  visitMs: number;
  act: NormRecord;
  /** Сколько потребителей нужно для акта. */
  persons: number;
}

export interface ActParticipant {
  userId: number | null;
  affected: boolean;
  restoredAnswer: RestoredAnswer | null;
  adsRereportAt: Date | null;
  readyToSign: boolean;
  shareContactConsent: boolean;
}

export interface ActIncident {
  status: IncidentStatus;
  resolvedAtUk: Date | null;
}

export type ActInfo = NonNullable<IncidentDetail['act']>;

export function actNormsFor(norms: readonly NormRecord[], h: HouseRow, service: ServiceType, at: Date): ActNorms | null {
  const house = { regionCode: h.regionCode, timezone: h.timezone, powerSources: h.powerSources, hotWaterDeadEnd: h.hotWaterDeadEnd };
  const visit = selectNorm(norms, { service, event: 'check_visit', house, at });
  const act = selectNorm(norms, { service, event: 'act_without_executor', house, at });
  const visitMs = visit ? normDurationMs(visit) : null;
  if (!visit || !act || visitMs === null || act.value < 1) return null;
  return { visit, visitMs, act, persons: act.value };
}

/** Участник ждёт проверку: «Нет», повторное сообщение в АДС, и УК после него не отмечала устранение. */
export function awaitingCheck(inc: ActIncident, p: ActParticipant): p is ActParticipant & { adsRereportAt: Date } {
  if (!p.affected || p.restoredAnswer !== 'no' || !p.adsRereportAt) return false;
  return !(inc.resolvedAtUk && inc.resolvedAtUk.getTime() > p.adsRereportAt.getTime());
}

export const checkDueAt = (p: { adsRereportAt: Date }, norms: ActNorms): Date => new Date(p.adsRereportAt.getTime() + norms.visitMs);

/** Блок act карточки аварии; null — функция выключена, нормы нет или повторных сообщений в АДС не было. */
export function actInfo(
  inc: ActIncident,
  participants: readonly ActParticipant[],
  viewerUserId: number | null,
  norms: ActNorms | null,
  now: Date,
): ActInfo | null {
  if (!norms || (inc.status !== 'checking' && inc.status !== 'discrepancy')) return null;
  if (!participants.some((p) => p.affected && p.restoredAnswer === 'no' && p.adsRereportAt)) return null;
  const waiting = participants.filter((p): p is ActParticipant & { adsRereportAt: Date } => awaitingCheck(inc, p));
  const dues = waiting.map((p) => checkDueAt(p, norms).getTime());
  const me = viewerUserId === null ? undefined : participants.find((p) => p.userId === viewerUserId);
  return {
    available: dues.some((due) => due <= now.getTime()),
    checkDueAt: dues.length > 0 ? iso(new Date(Math.min(...dues))) : null,
    requiredConsumers: norms.persons,
    readyCount: participants.filter((p) => p.affected && p.readyToSign).length,
    myReady: me?.readyToSign ?? false,
    introOptIn: me?.shareContactConsent ?? false,
    norm: basisOf(norms.act),
  };
}
