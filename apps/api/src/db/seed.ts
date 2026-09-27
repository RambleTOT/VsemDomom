/**
 * Идемпотентные сиды: УК, дома, нормы, сотрудники, пользователи проверяющих и история
 * модельных домов. Повторный запуск обновляет записи по public_id / code и пересчитывает
 * даты истории от текущего месяца в часовом поясе дома.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TZDate } from '@date-fns/tz';
import {
  flatLocation,
  NORM_EVENTS,
  NORM_UNITS,
  RESIDENCY_ROLES,
  SERVICE_TYPES,
  STAFF_ROLES,
  CALC_STRATEGIES,
  ROUND_MODES,
  INCIDENT_SCOPES,
  type IncidentEventType,
} from '@vsemdomom/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import { PARAMS } from '../config/params.ts';
import type { Db } from './client.ts';
import * as t from './schema.ts';

const ukSeed = z.array(
  z.object({
    publicId: z.string().regex(/^[A-Za-z0-9]{10}$/),
    name: z.string(),
    adsPhone: z.string(),
    regionCode: z.string().nullable(),
    isModel: z.boolean(),
  }),
);

const housesSeed = z.object({
  city: z.string(),
  timezone: z.string(),
  houses: z.array(
    z.object({
      publicId: z.string().regex(/^[A-Za-z0-9]{10}$/),
      ukPublicId: z.string(),
      label: z.string().regex(/^\d+$/),
      address: z.string(),
      entrances: z.number().int().positive(),
      floors: z.number().int().positive(),
      flatsPerFloor: z.number().int().positive(),
      flatFrom: z.number().int().positive(),
      flatTo: z.number().int().positive(),
      powerSources: z.union([z.literal(1), z.literal(2)]),
      hotWaterDeadEnd: z.boolean(),
      isSandbox: z.boolean(),
    }),
  ),
});

const normsSeed = z.array(
  z.object({
    code: z.string(),
    serviceType: z.enum(SERVICE_TYPES).nullable(),
    event: z.enum(NORM_EVENTS),
    title: z.string(),
    value: z.string().regex(/^\d+(\.\d+)?$/),
    unit: z.enum(NORM_UNITS),
    ratePercent: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
    calcStrategy: z.enum(CALC_STRATEGIES).nullable(),
    round: z.enum(ROUND_MODES).nullable(),
    regionCode: z.string().nullable(),
    condition: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
    basisDoc: z.string(),
    basisPoint: z.string(),
    basisQuote: z.string().nullable(),
    textPlain: z.string(),
    editionDate: z.iso.date(),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable(),
    checkedAt: z.iso.date().nullable(),
    sourceUrl: z.url(),
    note: z.string().nullable(),
  }),
);

const historySeed = z.object({
  incidents: z.array(
    z.object({
      publicId: z.string().regex(/^[A-Za-z0-9]{10}$/),
      housePublicId: z.string(),
      serviceType: z.enum(SERVICE_TYPES),
      scope: z.enum(INCIDENT_SCOPES),
      entrance: z.number().int().positive().optional(),
      monthDay: z.number().int().min(1).max(28),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      steps: z.object({
        acceptedMin: z.number().int().positive(),
        localizedMin: z.number().int().positive(),
        resolvedMin: z.number().int().positive(),
      }),
      participantFlats: z.array(z.number().int().positive()),
    }),
  ),
});

const checkerSeed = z.object({
  sandboxHousePublicId: z.string(),
  ukPublicId: z.string(),
  users: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        name: z.string(),
        tokenEnv: z.string(),
        maxUserId: z.number().int().negative(),
        kind: z.literal('resident'),
        flatNo: z.number().int().positive(),
        role: z.enum(RESIDENCY_ROLES),
      }),
      z.object({
        name: z.string(),
        tokenEnv: z.string(),
        maxUserId: z.number().int().negative(),
        kind: z.literal('uk'),
        staffRole: z.enum(STAFF_ROLES),
      }),
    ]),
  ),
});

async function readSeed<T>(dir: string, file: string, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = JSON.parse(await readFile(join(dir, file), 'utf8'));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`seeds/${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

/** Синтетические пользователи модельных домов: отрицательные ID не пересекаются с MAX. */
export function modelUserId(houseLabel: string, flatNo: number): number {
  const HOUSE_BASE = 100_000;
  return -(Number(houseLabel) * HOUSE_BASE + flatNo);
}

export interface SeedOptions {
  seedsDir: string;
  staffMaxIds: number[];
  now?: Date;
  log: Logger;
}

export interface SeedSummary {
  companies: number;
  houses: number;
  norms: number;
  staff: number;
  checkers: number;
  history: number;
}

export async function runSeeds(db: Db, options: SeedOptions): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const { seedsDir, log } = options;
  const [uks, houses, norms, history, checkers] = await Promise.all([
    readSeed(seedsDir, 'uk.json', ukSeed),
    readSeed(seedsDir, 'houses.json', housesSeed),
    readSeed(seedsDir, 'norms.json', normsSeed),
    readSeed(seedsDir, 'history.json', historySeed),
    readSeed(seedsDir, 'checker.json', checkerSeed),
  ]);

  return db.transaction(async (tx) => {
    // УК
    for (const uk of uks) {
      await tx
        .insert(t.managementCompany)
        .values(uk)
        .onConflictDoUpdate({
          target: t.managementCompany.publicId,
          set: { name: uk.name, adsPhone: uk.adsPhone, regionCode: uk.regionCode, isModel: uk.isModel },
        });
    }
    const ukRows = await tx.select().from(t.managementCompany);
    const ukId = new Map(ukRows.map((r) => [r.publicId, r.id]));

    // Дома
    for (const h of houses.houses) {
      const uk = ukId.get(h.ukPublicId);
      if (uk === undefined) throw new Error(`houses.json: неизвестная УК ${h.ukPublicId}`);
      const values = {
        publicId: h.publicId,
        ukId: uk,
        label: h.label,
        address: h.address,
        city: houses.city,
        timezone: houses.timezone,
        entrances: h.entrances,
        floors: h.floors,
        flatsPerFloor: h.flatsPerFloor,
        flatFrom: h.flatFrom,
        flatTo: h.flatTo,
        powerSources: h.powerSources,
        hotWaterDeadEnd: h.hotWaterDeadEnd,
        isModel: true,
        isSandbox: h.isSandbox,
      };
      const { publicId: _publicId, ...update } = values;
      await tx.insert(t.house).values(values).onConflictDoUpdate({ target: t.house.publicId, set: update });
    }
    const houseRows = await tx.select().from(t.house);
    const houseByPublicId = new Map(houseRows.map((r) => [r.publicId, r]));

    // Нормы: upsert по (code, region_code, valid_from) — уникальность с NULLS NOT DISTINCT
    for (const n of norms) {
      const { code: _code, regionCode: _regionCode, validFrom: _validFrom, ...rest } = n;
      await tx
        .insert(t.norm)
        .values(n)
        .onConflictDoUpdate({
          target: [t.norm.code, t.norm.regionCode, t.norm.validFrom],
          set: rest,
        });
    }

    // Сотрудники модельной УК (MAX ID команды)
    const modelUk = ukId.get(checkers.ukPublicId);
    if (modelUk === undefined) throw new Error(`checker.json: неизвестная УК ${checkers.ukPublicId}`);
    for (const userId of options.staffMaxIds) {
      await tx.insert(t.maxUser).values({ id: userId }).onConflictDoNothing();
      await tx
        .insert(t.staff)
        .values({ userId, ukId: modelUk, role: 'curator', isDemo: false })
        .onConflictDoNothing();
    }

    // Пользователи проверяющих (checker-токены): только дом-песочница
    const sandbox = houseByPublicId.get(checkers.sandboxHousePublicId);
    if (!sandbox?.isSandbox) throw new Error('checker.json: дом-песочница не найден или не помечен is_sandbox');
    for (const u of checkers.users) {
      await tx
        .insert(t.maxUser)
        .values({ id: u.maxUserId, consentVersion: PARAMS.consentVersion, consentAt: now, isModel: true })
        .onConflictDoUpdate({ target: t.maxUser.id, set: { consentVersion: PARAMS.consentVersion, isModel: true } });
      if (u.kind === 'resident') {
        if (flatLocation(sandbox, u.flatNo) === null) throw new Error(`checker.json: квартира ${u.flatNo} вне дома-песочницы`);
        await tx
          .insert(t.residency)
          .values({
            userId: u.maxUserId,
            houseId: sandbox.id,
            flatNo: u.flatNo,
            role: u.role,
            trustLevel: 1,
            reviewStatus: 'confirmed',
            source: 'miniapp',
            isModel: true,
          })
          .onConflictDoUpdate({
            target: [t.residency.userId, t.residency.houseId],
            set: { flatNo: u.flatNo, role: u.role, trustLevel: 1, reviewStatus: 'confirmed' },
          });
      } else {
        await tx
          .insert(t.staff)
          .values({ userId: u.maxUserId, ukId: modelUk, role: u.staffRole, isChecker: true })
          .onConflictDoUpdate({ target: [t.staff.userId, t.staff.ukId], set: { role: u.staffRole, isChecker: true } });
      }
    }

    // История модельных домов: пересоздаётся при каждом запуске
    const historyIds = history.incidents.map((i) => i.publicId);
    await tx.delete(t.incident).where(inArray(t.incident.publicId, historyIds));
    let created = 0;
    for (const h of history.incidents) {
      const home = houseByPublicId.get(h.housePublicId);
      if (!home) throw new Error(`history.json: неизвестный дом ${h.housePublicId}`);
      const window = historyWindow(h, home.timezone, now);
      if (!window) {
        log.warn({ incident: h.publicId }, 'история: в текущем месяце ещё нет места для интервала, пропущено');
        continue;
      }
      const { start, end } = window;
      const at = (minutes: number) => new Date(Math.min(start.getTime() + minutes * 60_000, end.getTime()));
      const reportedAt = at(PARAMS.historyReportDelayMin);
      const closedAt = new Date(Math.min(end.getTime() + PARAMS.historyCheckMin * 60_000, now.getTime() - 60_000));
      const [row] = await tx
        .insert(t.incident)
        .values({
          publicId: h.publicId,
          houseId: home.id,
          serviceType: h.serviceType,
          scope: h.scope,
          entrance: h.scope === 'entrance' ? (h.entrance ?? null) : null,
          status: 'closed',
          startedAt: start,
          startedSource: 'custom',
          createdAt: reportedAt,
          etaAt: end,
          brigadeOnSiteAt: null,
          localizedAt: at(h.steps.localizedMin),
          resolvedAtUk: end,
          checkStartedAt: end,
          closedAt,
          version: 6,
          isModel: true,
        })
        .returning({ id: t.incident.id });
      if (!row) throw new Error('не удалось создать аварию истории');

      const events: { type: IncidentEventType; at: Date; actorType: 'resident' | 'uk' | 'system'; actorId?: number | null; payload?: Record<string, unknown> }[] = [];
      events.push({ type: 'reported', at: reportedAt, actorType: 'resident', payload: { scope: h.scope, service: h.serviceType } });

      for (const flatNo of h.participantFlats) {
        const loc = flatLocation(home, flatNo);
        if (!loc) throw new Error(`history.json: квартира ${flatNo} вне дома ${home.label}`);
        const userId = modelUserId(home.label, flatNo);
        await tx
          .insert(t.maxUser)
          .values({ id: userId, consentVersion: PARAMS.consentVersion, consentAt: start, isModel: true })
          .onConflictDoNothing();
        const [res] = await tx
          .insert(t.residency)
          .values({
            userId,
            houseId: home.id,
            flatNo,
            role: 'owner',
            trustLevel: 1,
            reviewStatus: 'confirmed',
            source: 'chat',
            isModel: true,
          })
          .onConflictDoUpdate({
            target: [t.residency.userId, t.residency.houseId],
            set: { flatNo, trustLevel: 1 },
          })
          .returning({ id: t.residency.id });
        await tx.insert(t.incidentParticipant).values({
          incidentId: row.id,
          userId,
          residencyId: res?.id ?? null,
          entrance: loc.entrance,
          floor: loc.floor,
          trustLevelAtJoin: 1,
          restoredAnswer: 'yes',
          restoredAnswerAt: at(h.steps.resolvedMin + PARAMS.historyAnswerDelayMin),
          restoredAt: end,
          restoredSource: 'uk_mark',
          joinedAt: reportedAt,
          isModel: true,
        });
        events.push({ type: 'joined', at: reportedAt, actorType: 'resident', actorId: userId, payload: { entrance: loc.entrance } });
      }
      events.push(
        { type: 'uk_accepted', at: at(h.steps.acceptedMin), actorType: 'uk', payload: { eta: end.toISOString() } },
        { type: 'uk_localized', at: at(h.steps.localizedMin), actorType: 'uk' },
        { type: 'uk_resolved', at: end, actorType: 'uk' },
        { type: 'check_asked', at: end, actorType: 'system' },
        { type: 'closed', at: closedAt, actorType: 'system', payload: { reason: 'all_confirmed' } },
      );
      await tx.insert(t.incidentEvent).values(
        events.map((e) => ({
          incidentId: row.id,
          type: e.type,
          actorType: e.actorType,
          actorId: e.actorId ?? null,
          source: e.actorType === 'uk' ? ('miniapp' as const) : e.actorType === 'system' ? ('system' as const) : ('bot' as const),
          payload: { ...e.payload, model: true },
          occurredAt: e.at,
        })),
      );
      created += 1;
    }

    const staffCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t.staff)
      .where(and(eq(t.staff.ukId, modelUk), eq(t.staff.isChecker, false)));

    const summary: SeedSummary = {
      companies: uks.length,
      houses: houses.houses.length,
      norms: norms.length,
      staff: staffCount[0]?.n ?? 0,
      checkers: checkers.users.length,
      history: created,
    };
    log.info(summary, 'сиды применены');
    return summary;
  });
}

/**
 * Интервал аварии истории в текущем месяце (часовой пояс дома). Если до «сейчас»
 * места не хватает — интервал сдвигается к началу месяца и при необходимости укорачивается.
 */
export function historyWindow(
  h: { monthDay: number; startTime: string; steps: { resolvedMin: number } },
  timezone: string,
  now: Date,
): { start: Date; end: Date } | null {
  const local = new TZDate(now.getTime(), timezone);
  const monthStart = new TZDate(local.getFullYear(), local.getMonth(), 1, 0, 0, 0, timezone);
  const [hh, mm] = h.startTime.split(':').map(Number) as [number, number];
  let start = new TZDate(local.getFullYear(), local.getMonth(), h.monthDay, hh, mm, 0, timezone).getTime();
  const duration = h.steps.resolvedMin * 60_000;
  const latestEnd = now.getTime() - PARAMS.historyReserveMin * 60_000;
  let end = start + duration;
  if (end > latestEnd) {
    start = Math.max(monthStart.getTime(), latestEnd - duration);
    end = Math.min(start + duration, latestEnd);
  }
  if (end <= start) return null;
  return { start: new Date(start), end: new Date(end) };
}
