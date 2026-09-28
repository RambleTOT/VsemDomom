/**
 * Демо-пульт УК в личке (только DEMO_MODE) — чтобы сценарий проходился в MAX и без мини-приложения:
 *   /democode <код> — демо-роль сотрудника «УК Модельная» (тот же код и та же роль, что в профиле);
 *   /uk — открытые аварии домов сотрудника с кнопками следующих статусов.
 * Статусы ставятся тем же сервисом, что REST УК (ориентир «Принято» — через 2 часа).
 */
import { isOneOf, MS_PER_HOUR, MS_PER_MINUTE, OPEN_STATUSES, renderText, renderUkConsoleIncident, statusText, UK_CONSOLE_STATUSES } from '@vsemdomom/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { houseById, staffOf } from '../db/queries.ts';
import { house, incident } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { demoCodeMatches, grantDemoRole } from '../services/demo.ts';
import { ServiceError } from '../services/errors.ts';
import { incidentByPublicId } from '../services/incidents.ts';
import { applyUkStatus } from '../services/uk-status.ts';
import { FailureWindow } from '../util/limits.ts';
import { sendDm } from './dm.ts';
import type { CallbackHandler, UpdateMeta } from './types.ts';

/** Сколько аварий показывать в пульте (самые новые). */
const CONSOLE_LIMIT = 5;
/** Ориентир для «Принято» из пульта. */
const ETA_AHEAD_MS = 2 * MS_PER_HOUR;

async function reply(ctx: JobContext, userId: number, key: string, meta: UpdateMeta, suffix: string, params?: Record<string, string | number>): Promise<void> {
  await ctx.db.transaction(async (tx) => sendDm(tx, ctx, userId, renderText(key, ctx.i18n, params), `${meta.dedupeKey}:${suffix}`));
}

async function staffUkIds(ctx: JobContext, userId: number): Promise<number[]> {
  return (await staffOf(ctx.db, userId)).map((s) => s.uk.id);
}

/** Против перебора демо-кода: после PARAMS.demoCodeAttempts неверных кодов ввод закрыт до конца окна. */
const demoCodeFailures = new FailureWindow(PARAMS.demoCodeAttempts, PARAMS.demoCodeWindowMin * MS_PER_MINUTE);

export async function onDemoCodeCommand(ctx: JobContext, userId: number, arg: string | null, meta: UpdateMeta): Promise<void> {
  if (!ctx.config.demo.enabled) return reply(ctx, userId, 'bot.dm.uk.off', meta, 'democode');
  const now = ctx.clock.now().getTime();
  if (demoCodeFailures.blocked(userId, now)) {
    return reply(ctx, userId, 'bot.dm.democode.too_many', meta, 'democode', { minutes: PARAMS.demoCodeWindowMin });
  }
  if (!arg || !demoCodeMatches(arg, ctx.config.demo.ukCode)) {
    demoCodeFailures.fail(userId, now);
    return reply(ctx, userId, 'bot.dm.democode.bad', meta, 'democode');
  }
  demoCodeFailures.reset(userId);
  if (!(await grantDemoRole(ctx, userId))) return reply(ctx, userId, 'bot.dm.democode.bad', meta, 'democode');
  await reply(ctx, userId, 'bot.dm.democode.ok', meta, 'democode');
}

export async function onUkCommand(ctx: JobContext, userId: number, _arg: string | null, meta: UpdateMeta): Promise<void> {
  if (!ctx.config.demo.enabled) return reply(ctx, userId, 'bot.dm.uk.off', meta, 'uk');
  const ukIds = await staffUkIds(ctx, userId);
  if (ukIds.length === 0) return reply(ctx, userId, 'bot.dm.uk.not_staff', meta, 'uk');
  const rows = await ctx.db
    .select({ incident, house })
    .from(incident)
    .innerJoin(house, eq(house.id, incident.houseId))
    .where(and(inArray(house.ukId, ukIds), eq(house.isSandbox, false), inArray(incident.status, [...OPEN_STATUSES])))
    .orderBy(desc(incident.createdAt))
    .limit(CONSOLE_LIMIT);
  if (rows.length === 0) return reply(ctx, userId, 'bot.dm.uk.none', meta, 'uk');
  const now = ctx.clock.now();
  await ctx.db.transaction(async (tx) => {
    await sendDm(tx, ctx, userId, renderText('bot.dm.uk.title', ctx.i18n), `${meta.dedupeKey}:uk`);
    for (const [i, r] of rows.entries()) {
      const message = renderUkConsoleIncident(
        {
          publicId: r.incident.publicId,
          houseLabel: r.house.label,
          service: r.incident.serviceType,
          status: r.incident.status,
          startedAt: r.incident.startedAt,
          timezone: r.house.timezone,
          isModel: r.house.isModel,
          now,
        },
        ctx.i18n,
      );
      await sendDm(tx, ctx, userId, message, `${meta.dedupeKey}:uk:${i}`);
    }
  });
}

/** Кнопка пульта: следующий статус аварии — только сотруднику УК этого дома. */
export const onUkStatus: CallbackHandler = async (e, ctx) => {
  const target = e.payload.arg;
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!ctx.config.demo.enabled || !inc || !isOneOf(UK_CONSOLE_STATUSES, target)) return ctx.i18n.t('bot.answer.expired');
  const h = await houseById(ctx.db, inc.houseId);
  if (!h || h.isSandbox || !(await staffUkIds(ctx, e.userId)).includes(h.ukId)) return ctx.i18n.t('bot.answer.uk.not_staff');
  try {
    const updated = await applyUkStatus(ctx, {
      incidentId: inc.id,
      staffUserId: e.userId,
      status: target,
      eta: target === 'accepted' ? new Date(ctx.clock.now().getTime() + ETA_AHEAD_MS) : null,
      expectedVersion: null,
      source: 'bot',
    });
    return ctx.i18n.t('bot.answer.uk.done', { status: statusText(updated.status, updated.discrepancyUnresolved, ctx.i18n) });
  } catch (err) {
    if (err instanceof ServiceError) return ctx.i18n.t('bot.answer.uk.failed', { reason: err.message });
    throw err;
  }
};
