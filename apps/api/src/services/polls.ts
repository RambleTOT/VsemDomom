/**
 * F14. Опросы в чате дома: «Как вода сейчас?» через WATER_QUALITY_POLL_DELAY_HOURS после закрытия
 * аварии с водой и «Тепло ли у вас?» по запуску УК (раз за сезон; результаты — тепловая карта U05).
 * Не больше одного опроса в сутки на дом, не в тихие часы. Ответы видит только УК, в чате — общий
 * счётчик правкой сообщения. Бюджет опросов отдельный от бюджета сообщений аварии.
 */
import { TZDate } from '@date-fns/tz';
import {
  afterQuietHours,
  flatLocation,
  isQuietTime,
  MS_PER_HOUR,
  renderPoll,
  type HeatPollValue,
  type PollType,
  type WaterPollValue,
} from '@vsemdomom/core';
import type { HeatMapSchema } from '@vsemdomom/shared';
import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { PARAMS } from '../config/params.ts';
import type { Executor } from '../db/client.ts';
import { loadNorms } from '../db/norms.ts';
import { chatOfHouse, type HouseRow } from '../db/queries.ts';
import { house, incident, poll, pollAnswer, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type TxLike } from '../jobs/queue.ts';
import { MaxApiError } from '../max/types.ts';
import { audit, staffActor } from './audit.ts';
import { basisOf } from './month.ts';
import { iso } from './views.ts';

type Tx = Executor & TxLike;
type Reader = Pick<Executor, 'select'>;
type IncidentRow = typeof incident.$inferSelect;
type PollRow = typeof poll.$inferSelect;
type HeatMap = z.infer<typeof HeatMapSchema>;

export type PollJob =
  | { kind: 'water'; incidentId: number }
  | { kind: 'post'; pollId: number }
  | { kind: 'render'; pollId: number }
  | { kind: 'close'; pollId: number };

const WATER_SERVICES: readonly IncidentRow['serviceType'][] = ['cold_water', 'hot_water'];
/** Норма температуры в квартире для тепловой карты (Правила № 354, прил. 1, п. 15). */
const ROOM_TEMPERATURE_NORM = 'pr354.app1.p15.room_temperature';

const openUntil = (p: Pick<PollRow, 'startedAt'>) => new Date(p.startedAt.getTime() + PARAMS.pollOpenHours * MS_PER_HOUR);

/** Опрос «Как вода сейчас?» — после закрытия аварии с холодной или горячей водой (не «только квартира»). */
export async function scheduleWaterPoll(ctx: JobContext, tx: TxLike, inc: IncidentRow, closedAt: Date): Promise<void> {
  if (!ctx.config.features.polls || !WATER_SERVICES.includes(inc.serviceType) || inc.scope === 'flat') return;
  const at = new Date(closedAt.getTime() + ctx.config.waterQualityPollDelayHours * MS_PER_HOUR);
  await ctx.queue.send(QUEUES.poll, { kind: 'water', incidentId: inc.id } satisfies PollJob, { startAfter: at, tx });
}

/** Последний опрос дома (по времени начала, в том числе запланированный). */
async function lastPoll(db: Reader, houseId: number): Promise<PollRow | null> {
  const [row] = await db.select().from(poll).where(eq(poll.houseId, houseId)).orderBy(desc(poll.startedAt)).limit(1);
  return row ?? null;
}

/** Ближайший момент, когда дому можно отправить опрос: бюджет «раз в сутки» и тихие часы. */
function nextSlot(ctx: JobContext, h: HouseRow, last: PollRow | null, now: Date): Date {
  const budget = last ? new Date(last.startedAt.getTime() + PARAMS.pollBudgetHours * MS_PER_HOUR) : now;
  return afterQuietHours(budget.getTime() > now.getTime() ? budget : now, h.timezone, ctx.config.quietHours);
}

async function answersCount(db: Reader, pollId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(pollAnswer).where(eq(pollAnswer.pollId, pollId));
  return row?.n ?? 0;
}

async function refOf(db: Reader, p: PollRow, h: HouseRow): Promise<string | null> {
  if (p.type === 'heating') return h.publicId;
  if (p.incidentId === null) return null;
  const [inc] = await db.select({ publicId: incident.publicId }).from(incident).where(eq(incident.id, p.incidentId));
  return inc?.publicId ?? null;
}

async function pollMessage(ctx: JobContext, db: Reader, p: PollRow, h: HouseRow, closed: boolean) {
  const ref = await refOf(db, p, h);
  if (!ref) return null;
  return renderPoll({ type: p.type, refId: ref, house: { label: h.label, entrances: h.entrances, isModel: h.isModel }, answered: await answersCount(db, p.id), closed }, ctx.i18n);
}

/** Отправить опрос в чат дома; закрытие — через PARAMS.pollOpenHours. */
async function post(ctx: JobContext, tx: Tx, p: PollRow, h: HouseRow, chatId: number): Promise<void> {
  const message = await pollMessage(ctx, tx, p, h, false);
  if (!message) return;
  await enqueueOutbound(tx, ctx.queue, { kind: 'poll', idempotencyKey: `poll:${p.id}`, target: { chatId }, message: { ...message, notify: false }, afterSend: { type: 'poll', pollId: p.id } });
  await ctx.queue.send(QUEUES.poll, { kind: 'close', pollId: p.id } satisfies PollJob, { startAfter: openUntil(p), tx });
}

async function waterJob(ctx: JobContext, incidentId: number): Promise<string> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, incidentId));
    if (inc?.status !== 'closed') return 'skipped';
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    const chat = h ? await chatOfHouse(tx, h.id) : null;
    if (!h || !chat) return 'skipped';
    if (isQuietTime(now, h.timezone, ctx.config.quietHours)) {
      await ctx.queue.send(QUEUES.poll, { kind: 'water', incidentId } satisfies PollJob, { startAfter: afterQuietHours(now, h.timezone, ctx.config.quietHours), tx });
      return 'waiting';
    }
    const [existing] = await tx.select({ id: poll.id }).from(poll).where(and(eq(poll.incidentId, inc.id), eq(poll.type, 'water_quality')));
    if (existing) return 'skipped';
    // «Как вода сейчас?» нужен сразу после аварии: если сутки дома уже заняты опросом — не отправляем.
    const last = await lastPoll(tx, h.id);
    if (last && now.getTime() - last.startedAt.getTime() < PARAMS.pollBudgetHours * MS_PER_HOUR) return 'skipped';
    const [created] = await tx.insert(poll).values({ type: 'water_quality', houseId: h.id, incidentId: inc.id, startedAt: now, isModel: h.isModel }).returning();
    if (!created) return 'skipped';
    await post(ctx, tx, created, h, chat.chatId);
    return 'posted';
  });
}

async function postJob(ctx: JobContext, pollId: number): Promise<string> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(poll).where(eq(poll.id, pollId));
    if (!p || p.mid || p.closedAt) return 'skipped';
    const [h] = await tx.select().from(house).where(eq(house.id, p.houseId));
    const chat = h ? await chatOfHouse(tx, h.id) : null;
    if (!h || !chat) return 'skipped';
    if (isQuietTime(now, h.timezone, ctx.config.quietHours)) {
      await ctx.queue.send(QUEUES.poll, { kind: 'post', pollId } satisfies PollJob, { startAfter: afterQuietHours(now, h.timezone, ctx.config.quietHours), tx });
      return 'waiting';
    }
    await post(ctx, tx, p, h, chat.chatId);
    return 'posted';
  });
}

/** Правка сообщения опроса: счётчик ответов или завершение (без кнопок). */
async function editJob(ctx: JobContext, pollId: number, close: boolean): Promise<string> {
  const now = ctx.clock.now();
  const [p] = await ctx.db.select().from(poll).where(eq(poll.id, pollId));
  if (!p) return 'skipped';
  if (close && !p.closedAt) await ctx.db.update(poll).set({ closedAt: now }).where(and(eq(poll.id, p.id), isNull(poll.closedAt)));
  const [h] = await ctx.db.select().from(house).where(eq(house.id, p.houseId));
  const chat = h ? await chatOfHouse(ctx.db, h.id) : null;
  if (!h || !chat || !p.mid) return 'skipped';
  const message = await pollMessage(ctx, ctx.db, p, h, close || p.closedAt !== null);
  if (!message) return 'skipped';
  try {
    await ctx.max.editMessage(p.mid, message, { chatId: chat.chatId });
    return 'edited';
  } catch (err) {
    // Сообщение опроса удалили в чате — править нечего.
    if (err instanceof MaxApiError && err.kind === 'not_found') return 'skipped';
    throw err;
  }
}

export async function pollJob(ctx: JobContext, job: PollJob): Promise<string> {
  if (!ctx.config.features.polls) return 'skipped';
  switch (job.kind) {
    case 'water':
      return waterJob(ctx, job.incidentId);
    case 'post':
      return postJob(ctx, job.pollId);
    case 'render':
      return editJob(ctx, job.pollId, false);
    case 'close':
      return editJob(ctx, job.pollId, true);
  }
}

// ---------- ответы ----------

export type PollAnswerResult = { status: 'saved'; needEntrance: boolean } | { status: 'closed' } | { status: 'not_found' };

async function openPollFor(db: Reader, where: { type: PollType; houseId?: number; incidentId?: number }, now: Date): Promise<PollRow | null | 'closed'> {
  const [p] = await db
    .select()
    .from(poll)
    .where(
      and(
        eq(poll.type, where.type),
        where.incidentId === undefined ? undefined : eq(poll.incidentId, where.incidentId),
        where.houseId === undefined ? undefined : eq(poll.houseId, where.houseId),
      ),
    )
    .orderBy(desc(poll.startedAt))
    .limit(1);
  if (!p?.mid) return null;
  if (p.closedAt || openUntil(p).getTime() <= now.getTime()) return 'closed';
  return p;
}

/** Ответ на опрос из чата дома: последний ответ жителя действует. Подъезд и этаж — по квартире жителя. */
export async function answerPoll(
  ctx: JobContext,
  input: { house: HouseRow; incidentId?: number; type: PollType; userId: number; value: WaterPollValue | HeatPollValue },
): Promise<PollAnswerResult> {
  const now = ctx.clock.now();
  const p = await openPollFor(ctx.db, { type: input.type, houseId: input.house.id, ...(input.incidentId === undefined ? {} : { incidentId: input.incidentId }) }, now);
  if (p === 'closed') return { status: 'closed' };
  if (!p) return { status: 'not_found' };
  const [res] = await ctx.db.select().from(residency).where(and(eq(residency.userId, input.userId), eq(residency.houseId, input.house.id)));
  const loc = res ? flatLocation(input.house, res.flatNo) : null;
  const [saved] = await ctx.db
    .insert(pollAnswer)
    .values({ pollId: p.id, userId: input.userId, value: input.value, entrance: loc?.entrance ?? null, floor: loc?.floor ?? null, answeredAt: now })
    .onConflictDoUpdate({
      target: [pollAnswer.pollId, pollAnswer.userId],
      set: { value: input.value, answeredAt: now, ...(loc ? { entrance: loc.entrance, floor: loc.floor } : {}) },
    })
    .returning({ entrance: pollAnswer.entrance });
  await ctx.queue.sendDebounced(QUEUES.poll, { kind: 'render', pollId: p.id } satisfies PollJob, PARAMS.cardEditWindowSec, `poll:${p.id}`);
  return { status: 'saved', needEntrance: input.type === 'heating' && (saved?.entrance ?? null) === null };
}

/** Подъезд к ответу «Тепло ли у вас?» — для тех, чья квартира сервису неизвестна. */
export async function answerHeatEntrance(ctx: JobContext, input: { house: HouseRow; userId: number; entrance: number }): Promise<'saved' | 'first' | 'closed' | 'not_found'> {
  if (!Number.isInteger(input.entrance) || input.entrance < 1 || input.entrance > input.house.entrances) return 'not_found';
  const p = await openPollFor(ctx.db, { type: 'heating', houseId: input.house.id }, ctx.clock.now());
  if (p === 'closed') return 'closed';
  if (!p) return 'not_found';
  const updated = await ctx.db
    .update(pollAnswer)
    .set({ entrance: input.entrance })
    .where(and(eq(pollAnswer.pollId, p.id), eq(pollAnswer.userId, input.userId), isNull(pollAnswer.floor)))
    .returning({ pollId: pollAnswer.pollId });
  if (updated.length > 0) return 'saved';
  const [answer] = await ctx.db.select().from(pollAnswer).where(and(eq(pollAnswer.pollId, p.id), eq(pollAnswer.userId, input.userId)));
  // Житель с квартирой: подъезд уже известен.
  return answer ? 'saved' : 'first';
}

// ---------- УК: запуск «Тепло ли у вас?» и тепловая карта ----------

/** Начало отопительного сезона по времени дома: 1-е число PARAMS.heatingSeasonStartMonth. */
function seasonStart(now: Date, timezone: string): Date {
  const local = new TZDate(now.getTime(), timezone);
  const startMonth = PARAMS.heatingSeasonStartMonth - 1;
  const year = local.getMonth() >= startMonth ? local.getFullYear() : local.getFullYear() - 1;
  return new Date(new TZDate(year, startMonth, 1, 0, 0, 0, timezone).getTime());
}

export type HeatingPollStart = { status: 'queued'; startedAt: Date } | { status: 'no_chat' } | { status: 'already' };

export async function startHeatingPoll(ctx: JobContext, input: { house: HouseRow; staffUserId: number }): Promise<HeatingPollStart> {
  const now = ctx.clock.now();
  const h = input.house;
  return ctx.db.transaction(async (tx) => {
    if (!(await chatOfHouse(tx, h.id))) return { status: 'no_chat' };
    const [existing] = await tx
      .select({ id: poll.id })
      .from(poll)
      .where(and(eq(poll.houseId, h.id), eq(poll.type, 'heating'), gte(poll.startedAt, seasonStart(now, h.timezone))));
    if (existing) return { status: 'already' };
    const startedAt = nextSlot(ctx, h, await lastPoll(tx, h.id), now);
    const [created] = await tx.insert(poll).values({ type: 'heating', houseId: h.id, startedAt, isModel: h.isModel }).returning();
    if (!created) return { status: 'no_chat' };
    await ctx.queue.send(QUEUES.poll, { kind: 'post', pollId: created.id } satisfies PollJob, { startAfter: startedAt, tx });
    await audit(tx, { actor: staffActor(input.staffUserId), action: 'heating_poll', entity: 'house', entityId: h.publicId, at: now });
    return { status: 'queued', startedAt };
  });
}

/** U05: последний опрос «Тепло ли у вас?» дома по сетке «подъезд × этаж». */
export async function heatmapView(db: Reader, h: HouseRow): Promise<HeatMap> {
  const [p] = await db.select().from(poll).where(and(eq(poll.houseId, h.id), eq(poll.type, 'heating'))).orderBy(desc(poll.startedAt)).limit(1);
  const answers = p ? await db.select().from(pollAnswer).where(eq(pollAnswer.pollId, p.id)) : [];
  const cells = new Map<string, { entrance: number; floor: number; warm: number; luke: number; cold: number }>();
  for (const a of answers) {
    if (a.entrance === null || a.floor === null || (a.value !== 'warm' && a.value !== 'luke' && a.value !== 'cold')) continue;
    const key = `${a.entrance}:${a.floor}`;
    const cell = cells.get(key) ?? { entrance: a.entrance, floor: a.floor, warm: 0, luke: 0, cold: 0 };
    cell[a.value] += 1;
    cells.set(key, cell);
  }
  const norm = (await loadNorms(db)).find((n) => n.code === ROOM_TEMPERATURE_NORM);
  return {
    houseId: h.publicId,
    poll: p ? { startedAt: iso(p.startedAt), closedAt: p.closedAt ? iso(p.closedAt) : null } : null,
    entrances: h.entrances,
    floors: h.floors,
    cells: [...cells.values()].sort((a, b) => a.entrance - b.entrance || a.floor - b.floor),
    answered: answers.length,
    totalFlats: h.flatTo - h.flatFrom + 1,
    norm: norm ? basisOf(norm) : null,
  };
}
