/**
 * Авария для API: сводка (списки) и подробности (S05, U02). Всё считается из БД и ядра:
 * сроки с основаниями, счётчики по подъездам, шаги статусов с пропущенными, хронология.
 * Хронология и участие — без ПДн: только события, подъезды и квартиры зарегистрированных.
 */
import {
  deadlineState,
  displayStatus,
  flatLocation,
  isActualAnswer,
  nextCheckDeadline,
  nextDeadline,
  participantCounts,
  type DeadlineKind,
} from '@vsemdomom/core';
import type { IncidentDetail, IncidentSummary } from '@vsemdomom/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { AppConfig } from '../config/env.ts';
import { PARAMS } from '../config/params.ts';
import type { Executor } from '../db/client.ts';
import type { HouseRow, ResidencyRow, UserRow } from '../db/queries.ts';
import { chatCard, deadline, house, incident, incidentEvent, incidentParticipant, managementCompany, norm, residency } from '../db/schema.ts';
import { actInfo, type ActNorms } from './act-info.ts';
import { checkWindowMs } from './policy.ts';
import { iso, isoOrNull, normBasis, type NormRow } from './views.ts';

type Reader = Pick<Executor, 'select'>;
type IncidentRow = typeof incident.$inferSelect;
type ParticipantRow = typeof incidentParticipant.$inferSelect;
type EventRow = typeof incidentEvent.$inferSelect;
type DeadlineRow = typeof deadline.$inferSelect;
type Deadline = IncidentDetail['deadlines'][number];

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

export interface IncidentBundle {
  incident: IncidentRow;
  house: HouseRow;
  uk: { adsPhone: string };
  participants: (ParticipantRow & { flatNo: number | null; trust: ResidencyRow['trustLevel'] | null })[];
  deadlines: (DeadlineRow & { norm: NormRow })[];
  events: EventRow[];
  hasCard: boolean;
  mergedIntoPublicId: string | null;
}

/** Кто смотрит: житель (его проживание в доме аварии) или сотрудник УК. */
export interface IncidentViewer {
  userId: number;
  residency: ResidencyRow | null;
  isStaff: boolean;
  user: UserRow | null;
}

export async function loadIncidentBundles(db: Reader, incidentIds: readonly number[]): Promise<IncidentBundle[]> {
  if (incidentIds.length === 0) return [];
  const ids = [...incidentIds];
  const rows = await db
    .select({ incident, house, adsPhone: managementCompany.adsPhone })
    .from(incident)
    .innerJoin(house, eq(house.id, incident.houseId))
    .innerJoin(managementCompany, eq(managementCompany.id, house.ukId))
    .where(inArray(incident.id, ids));
  const participants = await db
    .select({ p: incidentParticipant, flatNo: residency.flatNo, trust: residency.trustLevel })
    .from(incidentParticipant)
    .leftJoin(residency, eq(residency.id, incidentParticipant.residencyId))
    .where(inArray(incidentParticipant.incidentId, ids))
    .orderBy(asc(incidentParticipant.joinedAt));
  const deadlines = await db
    .select({ d: deadline, norm })
    .from(deadline)
    .innerJoin(norm, eq(norm.id, deadline.normId))
    .where(inArray(deadline.incidentId, ids))
    .orderBy(asc(deadline.dueAt), asc(deadline.id));
  const events = await db.select().from(incidentEvent).where(inArray(incidentEvent.incidentId, ids)).orderBy(desc(incidentEvent.occurredAt), desc(incidentEvent.id));
  const cards = await db.select({ incidentId: chatCard.incidentId }).from(chatCard).where(inArray(chatCard.incidentId, ids));
  const mergedIds = rows.map((r) => r.incident.mergedIntoId).filter((x): x is number => x !== null);
  const merged = mergedIds.length > 0 ? await db.select({ id: incident.id, publicId: incident.publicId }).from(incident).where(inArray(incident.id, mergedIds)) : [];

  const byId = new Map(rows.map((r) => [r.incident.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        incident: row.incident,
        house: row.house,
        uk: { adsPhone: row.adsPhone },
        participants: participants.filter((p) => p.p.incidentId === id).map((p) => ({ ...p.p, flatNo: p.flatNo, trust: p.trust })),
        deadlines: deadlines.filter((d) => d.d.incidentId === id).map((d) => ({ ...d.d, norm: d.norm })),
        events: events.filter((e) => e.incidentId === id),
        hasCard: cards.some((c) => c.incidentId === id),
        mergedIntoPublicId: merged.find((m) => m.id === row.incident.mergedIntoId)?.publicId ?? null,
      },
    ];
  });
}

export async function loadIncidentBundle(db: Reader, incidentId: number): Promise<IncidentBundle | null> {
  const [bundle] = await loadIncidentBundles(db, [incidentId]);
  return bundle ?? null;
}

// ---------- расчёты ----------

function anchorOf(kind: DeadlineKind, inc: IncidentRow): Deadline['anchor'] {
  if (kind === 'fix' || kind === 'single_limit') return 'started';
  return inc.adsRegAt ? 'ads_registration' : 'service_report';
}

function deadlineView(d: IncidentBundle['deadlines'][number], inc: IncidentRow, now: Date): Deadline {
  const state = deadlineState(d, now);
  const doneAt = d.status === 'met' ? d.resolvedAt : state === 'breached' ? (d.resolvedAt ?? d.dueAt) : null;
  return {
    kind: d.kind,
    title: d.norm.title,
    state,
    dueAt: iso(d.dueAt),
    warnAt: iso(d.warnAt),
    doneAt: isoOrNull(doneAt),
    anchor: anchorOf(d.kind, inc),
    norm: normBasis(d.norm),
  };
}

function affectedOf(b: IncidentBundle) {
  return b.participants.filter((p) => p.affected);
}

/** Квартиры с актуальным «Нет»: зарегистрированные — по квартирам, остальные — поштучно. */
function discrepancyFlats(b: IncidentBundle): number {
  const since = b.incident.checkStartedAt;
  if (!since) return 0;
  const no = affectedOf(b).filter((p) => p.restoredAnswer === 'no' && isActualAnswer({ answer: p.restoredAnswer, answeredAt: p.restoredAnswerAt }, since));
  return new Set(no.map((p) => (p.flatNo === null ? `u${p.id}` : `f${p.flatNo}`))).size;
}

function statusAt(inc: IncidentRow): Date | null {
  switch (inc.status) {
    case 'brigade_on_site':
      return inc.brigadeOnSiteAt;
    case 'localized':
      return inc.localizedAt;
    case 'checking':
    case 'discrepancy':
      return inc.resolvedAtUk;
    case 'closed':
      return inc.closedAt;
    case 'open':
    case 'accepted':
    case 'merged':
      return null;
  }
}

function headline(b: IncidentBundle, now: Date): IncidentSummary['headline'] {
  const inc = b.incident;
  const next = nextDeadline(b.deadlines, inc);
  const flats = discrepancyFlats(b);
  const closedDuration = inc.status === 'closed' && inc.resolvedAtUk ? Math.max(0, Math.floor((inc.resolvedAtUk.getTime() - inc.startedAt.getTime()) / MS_PER_MINUTE)) : null;
  return {
    displayStatus: displayStatus(inc.status, inc.discrepancyUnresolved),
    eta: isoOrNull(inc.etaAt),
    nextDeadline: next ? deadlineView(next, inc, now) : null,
    statusAt: isoOrNull(statusAt(inc)),
    discrepancyFlats: flats,
    unconfirmedRestoreFlats: inc.discrepancyUnresolved ? flats : 0,
    durationMinutes: closedDuration,
  };
}

function flatsCount(b: IncidentBundle): number {
  return new Set(affectedOf(b).flatMap((p) => (p.flatNo === null ? [] : [p.flatNo]))).size;
}

export function incidentSummary(b: IncidentBundle, viewer: IncidentViewer | null, now: Date): IncidentSummary {
  const inc = b.incident;
  const counts = participantCounts(b.participants.map((p) => ({ entrance: p.entrance, affected: p.affected, trustLevel: p.trust ?? 0 })));
  const mine = viewer ? b.participants.find((p) => p.userId === viewer.userId) : undefined;
  return {
    id: inc.publicId,
    house: { id: b.house.publicId, label: b.house.label, address: b.house.address, timezone: b.house.timezone, entrances: b.house.entrances, isModel: b.house.isModel },
    service: inc.serviceType,
    scope: inc.scope,
    entrance: inc.entrance,
    status: inc.status,
    displayStatus: displayStatus(inc.status, inc.discrepancyUnresolved),
    headline: headline(b, now),
    startedAt: iso(inc.startedAt),
    createdAt: iso(inc.createdAt),
    eta: isoOrNull(inc.etaAt),
    overdue: inc.overdue,
    singleLimitExceeded: inc.singleLimitExceeded,
    discrepancyUnresolved: inc.discrepancyUnresolved,
    participantsCount: counts.residents,
    flatsCount: flatsCount(b),
    byEntrance: counts.byEntrance,
    joined: viewer && (viewer.residency || !viewer.isStaff) ? (mine?.affected ?? false) : null,
    closedAt: isoOrNull(inc.closedAt),
    isModel: inc.isModel || b.house.isModel,
  };
}

const STEPS = ['reported', 'accepted', 'brigade_on_site', 'localized', 'resolved', 'closed'] as const;

function steps(b: IncidentBundle): IncidentDetail['steps'] {
  const inc = b.incident;
  const accepted = b.events.filter((e) => e.type === 'uk_accepted').at(-1)?.occurredAt ?? null;
  const at: Record<(typeof STEPS)[number], Date | null> = {
    reported: inc.createdAt,
    accepted,
    brigade_on_site: inc.brigadeOnSiteAt,
    localized: inc.localizedAt,
    resolved: inc.resolvedAtUk,
    closed: inc.closedAt,
  };
  const reached = STEPS.reduce((last, step, i) => (at[step] ? i : last), 0);
  return STEPS.map((step, i) => {
    const time = at[step];
    const state = i < reached ? (time ? 'done' : 'skipped') : i === reached ? (step === 'closed' || inc.status === 'merged' ? 'done' : 'current') : 'pending';
    return { step, state, at: isoOrNull(time) };
  });
}

function counters(b: IncidentBundle): IncidentDetail['counters'] {
  const affected = affectedOf(b);
  const counts = participantCounts(b.participants.map((p) => ({ entrance: p.entrance, affected: p.affected, trustLevel: p.trust ?? 0 })));
  const since = b.incident.checkStartedAt;
  const actual = since ? affected.filter((p) => isActualAnswer({ answer: p.restoredAnswer, answeredAt: p.restoredAnswerAt }, since)) : [];
  return {
    participants: counts.residents,
    flats: flatsCount(b),
    unconfirmed: counts.unconfirmed,
    byEntrance: counts.byEntrance,
    unknownEntrance: affected.filter((p) => p.entrance === null).length,
    notMe: b.participants.filter((p) => !p.affected).length,
    answers: {
      yes: actual.filter((p) => p.restoredAnswer === 'yes').length,
      no: actual.filter((p) => p.restoredAnswer === 'no').length,
      weak: actual.filter((p) => p.restoredAnswer === 'weak').length,
    },
    brigade: {
      confirmed: affected.filter((p) => p.brigadeSeen === true).length,
      absent: affected.filter((p) => p.brigadeSeen === false).length,
    },
  };
}

const BEFORE_RESOLVE = ['open', 'accepted', 'brigade_on_site', 'localized'];

function adsInfo(b: IncidentBundle): IncidentDetail['ads'] {
  const inc = b.incident;
  const notReached = b.events.some((e) => e.type === 'ads_not_reached');
  const pending = inc.adsRegNumber === null && BEFORE_RESOLVE.includes(inc.status);
  return {
    phone: b.uk.adsPhone,
    registration: inc.adsRegNumber !== null || notReached ? { number: inc.adsRegNumber, at: isoOrNull(inc.adsRegAt), notReached } : null,
    reminderAt: pending ? iso(new Date(inc.createdAt.getTime() + PARAMS.adsReminderMin * MS_PER_MINUTE)) : null,
  };
}

function checkInfo(b: IncidentBundle, config: AppConfig): IncidentDetail['check'] {
  const inc = b.incident;
  if (!inc.checkStartedAt) return null;
  const base = {
    checkStartedAt: inc.checkStartedAt,
    discrepancyAt: inc.discrepancyAt,
    checkWindowMs: checkWindowMs(config, b.house),
    discrepancyMaxMs: config.discrepancyMaxHours * MS_PER_HOUR,
  };
  return {
    askedAt: iso(inc.checkStartedAt),
    repeated: b.events.some((e) => e.type === 'check_repeated'),
    windowEndsAt: inc.status === 'checking' ? iso(nextCheckDeadline({ ...base, status: 'checking' })) : null,
    discrepancyDeadlineAt: inc.status === 'discrepancy' ? iso(nextCheckDeadline({ ...base, status: 'discrepancy' })) : null,
  };
}

function myParticipation(b: IncidentBundle, viewer: IncidentViewer | null): IncidentDetail['me'] {
  if (!viewer?.residency) return null;
  const p = b.participants.find((x) => x.userId === viewer.userId);
  const loc = flatLocation(b.house, viewer.residency.flatNo);
  return {
    joined: p?.affected ?? false,
    notMe: p ? !p.affected : false,
    entrance: p?.entrance ?? loc?.entrance ?? null,
    floor: p?.floor ?? loc?.floor ?? null,
    notify: p?.notify ?? viewer.user?.notifyDefault ?? true,
    restoredAnswer: p?.restoredAnswer ?? null,
    restoredAt: isoOrNull(p?.restoredAt),
    restoredSource: p?.restoredSource ?? null,
    adsRereport: p?.adsRereportAt ? { number: p.adsRereportNumber, at: iso(p.adsRereportAt) } : null,
    readyToSign: p?.readyToSign ?? false,
    introOptIn: p?.shareContactConsent ?? false,
    isAuthor: b.incident.createdBy === viewer.userId,
    trustLevel: viewer.residency.trustLevel,
  };
}

/** actNorms — нормы акта без исполнителя (S09); null — блок act не считается. */
export function incidentDetail(b: IncidentBundle, viewer: IncidentViewer | null, config: AppConfig, now: Date, actNorms: ActNorms | null = null): IncidentDetail {
  const inc = b.incident;
  return {
    ...incidentSummary(b, viewer, now),
    version: inc.version,
    ads: adsInfo(b),
    deadlines: b.deadlines.map((d) => deadlineView(d, inc, now)),
    counters: counters(b),
    steps: steps(b),
    timeline: b.events.map((e) => ({
      type: e.type,
      at: iso(e.occurredAt),
      actorType: e.actorType,
      source: e.source,
      mine: viewer !== null && e.actorId === viewer.userId,
      payload: e.payload ?? {},
    })),
    me: myParticipation(b, viewer),
    check: checkInfo(b, config),
    act: config.features.actTemplate ? actInfo(inc, b.participants, viewer?.userId ?? null, actNorms, now) : null,
    brigadeOnSiteAt: isoOrNull(inc.brigadeOnSiteAt),
    localizedAt: isoOrNull(inc.localizedAt),
    resolvedAtUk: isoOrNull(inc.resolvedAtUk),
    mergedInto: b.mergedIntoPublicId,
    cardInChat: b.hasCard,
  };
}

/** Аварии дома для главной жителя: открытые (кроме чужих «только квартира») и последние закрытые. */
export async function houseIncidentIds(db: Reader, houseId: number, viewerUserId: number | null): Promise<{ active: number[]; recent: number[] }> {
  const rows = await db
    .select({ id: incident.id, status: incident.status, scope: incident.scope, createdBy: incident.createdBy, closedAt: incident.closedAt })
    .from(incident)
    .where(and(eq(incident.houseId, houseId)))
    .orderBy(desc(incident.startedAt));
  const visible = rows.filter((r) => r.scope !== 'flat' || (viewerUserId !== null && r.createdBy === viewerUserId));
  const active = visible.filter((r) => r.status !== 'closed' && r.status !== 'merged').map((r) => r.id);
  const recent = visible
    .filter((r) => r.status === 'closed' && r.closedAt)
    .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
    .slice(0, RECENT_RESULTS)
    .map((r) => r.id);
  return { active, recent };
}

const RECENT_RESULTS = 3;
