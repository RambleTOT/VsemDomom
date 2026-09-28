/**
 * Сроки по нормативам (F04). Точка отсчёта — время регистрации в АДС, если оно известно,
 * иначе время сообщения в сервисе (подпись «от регистрации в сервисе»); для устранения
 * и единовременного лимита — начало аварии.
 */
import type { DeadlineKind, DeadlineState, DeadlineStatus, NormEvent, ServiceType } from '../domain/enums.ts';
import { normDurationMs, selectNorm, type NormHouseContext, type NormRecord } from '../norms/select.ts';

export type DeadlineAnchor = 'ads_registration' | 'service_report' | 'started';

/** Какие сроки строятся и от чего отсчитываются. */
const DEADLINE_SPECS: readonly { kind: DeadlineKind; event: NormEvent; fromStart: boolean }[] = [
  { kind: 'answer', event: 'uk_eta', fromStart: false },
  { kind: 'localize', event: 'localize', fromStart: false },
  { kind: 'clog', event: 'clog_clear', fromStart: false },
  { kind: 'fix', event: 'fix', fromStart: true },
  { kind: 'single_limit', event: 'interruption_single', fromStart: true },
];

export interface DeadlineIncidentInput {
  serviceType: ServiceType;
  startedAt: Date;
  /** Время сообщения в сервисе. */
  createdAt: Date;
  adsRegAt: Date | null;
}

export interface DeadlinePlan {
  kind: DeadlineKind;
  norm: NormRecord;
  anchor: DeadlineAnchor;
  dueAt: Date;
  warnAt: Date;
}

/**
 * Сроки аварии по справочнику. Нормы для вида нет — срок не создаётся
 * (интерфейс пишет «норматив не установлен»).
 */
export function computeDeadlines(
  incident: DeadlineIncidentInput,
  norms: readonly NormRecord[],
  house: NormHouseContext,
  options: { warnBeforeMs: number },
): DeadlinePlan[] {
  const plans: DeadlinePlan[] = [];
  for (const spec of DEADLINE_SPECS) {
    const norm = selectNorm(norms, { service: incident.serviceType, event: spec.event, house, at: incident.createdAt });
    if (!norm) continue;
    const duration = normDurationMs(norm);
    if (duration === null) continue;
    const anchor: DeadlineAnchor = spec.fromStart ? 'started' : incident.adsRegAt ? 'ads_registration' : 'service_report';
    const from = spec.fromStart ? incident.startedAt : (incident.adsRegAt ?? incident.createdAt);
    const dueAt = new Date(from.getTime() + duration);
    const warnAt = new Date(Math.max(from.getTime(), dueAt.getTime() - options.warnBeforeMs));
    plans.push({ kind: spec.kind, norm, anchor, dueAt, warnAt });
  }
  return plans;
}

export interface DeadlineRow {
  kind: DeadlineKind;
  status: DeadlineStatus;
  dueAt: Date;
  warnAt: Date;
}

/** Состояние для показа: soon — до срока меньше порога предупреждения; истёкший pending — breached. */
export function deadlineState(d: DeadlineRow, now: Date): DeadlineState {
  if (d.status !== 'pending') return d.status;
  if (now.getTime() >= d.dueAt.getTime()) return 'breached';
  if (now.getTime() >= d.warnAt.getTime()) return 'soon';
  return 'pending';
}

/** Что УК уже сделала по аварии — по отметкам в самой аварии. */
export interface DeadlineProgress {
  etaAt: Date | null;
  localizedAt: Date | null;
  resolvedAtUk: Date | null;
}

/**
 * Срок выполнен, пусть и после истечения: истёкший по таймеру срок остаётся «истёк»,
 * но УК уже назвала ориентир, локализовала или отметила устранение.
 */
export function deadlineDone(kind: DeadlineKind, p: DeadlineProgress): boolean {
  switch (kind) {
    case 'answer':
      return p.etaAt !== null;
    case 'localize':
      return p.localizedAt !== null || p.resolvedAtUk !== null;
    case 'clog':
    case 'fix':
    case 'single_limit':
      return p.resolvedAtUk !== null;
  }
}

/**
 * Ближайший невыполненный срок УК — в том числе уже истёкший («срок по нормативу истёк в 18:10»).
 * Истёкший, но уже выполненный срок (progress) не показываем. Единовременный лимит — не срок УК.
 */
export function nextDeadline<T extends DeadlineRow>(deadlines: readonly T[], progress?: DeadlineProgress): T | null {
  const open = deadlines
    .filter((d) => d.kind !== 'single_limit' && (d.status === 'pending' || (d.status === 'breached' && !(progress && deadlineDone(d.kind, progress)))))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  return open[0] ?? null;
}

/** Нарушение срока ставит флаг overdue; единовременный лимит — флаг single_limit_exceeded. */
export function breachFlag(kind: DeadlineKind): 'overdue' | 'single_limit_exceeded' {
  return kind === 'single_limit' ? 'single_limit_exceeded' : 'overdue';
}

/**
 * Итог по сроку при отметке УК: выполнен, если отмечено до срока; иначе срок уже истёк
 * (таймер мог не успеть — тогда breached по времени).
 */
export function resolveDeadlineAt(d: DeadlineRow, at: Date): DeadlineStatus {
  if (d.status !== 'pending') return d.status;
  return at.getTime() <= d.dueAt.getTime() ? 'met' : 'breached';
}
