/**
 * Страница «Симулятор чата» /dev/chat — только при MAX_MODE=simulator. Показывает чат модельного
 * дома и лички трёх модельных жителей так, как их показал бы MAX (по журналу симулятора
 * fake_max_call), и отправляет события от их имени тем же путём, что webhook. Действия УК —
 * от демо-диспетчера модельной УК через те же сервисы, что REST. Жители и диспетчер —
 * синтетические пользователи с отрицательными ID (не пересекаются с MAX); всё — модельные данные.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DISPLAY_STATUS_I18N_KEY, displayStatus, OPEN_STATUSES, SERVICE_I18N_KEY } from '@vsemdomom/core';
import { ruDictionary } from '@vsemdomom/shared';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config/env.ts';
import { houseByPublicId, type HouseRow } from '../db/queries.ts';
import { fakeMaxCall, house, houseChat, incident, residency } from '../db/schema.ts';
import { ipKey } from '../http/rate-limit.ts';
import type { JobContext } from '../jobs/context.ts';
import { SIMULATOR_CHATS } from '../max/factory.ts';
import { addDemoNeighbours, grantDemoRole, resetDemoHouse, shiftIncidentStart } from '../services/demo.ts';
import { ServiceError } from '../services/errors.ts';
import { applyUkStatus, type UkStatusTarget } from '../services/uk-status.ts';
import { resolveDataDir } from '../util/paths.ts';
import { ingestUpdate, type IngestDeps } from '../webhook/ingest.ts';
import { buildFeed, buildNotices, sentMid, simCallbackId, type JournalRow, type SimTarget } from './sim-feed.ts';

export const DEV_CHAT_PATH = '/dev/chat';

/** Модельные жители симулятора и демо-диспетчер УК. */
export const SIM_RESIDENT_IDS = [-9001, -9002, -9003] as const;
export const SIM_UK_USER_ID = -9100;

/** Сколько последних сообщений показывать в ленте и уведомлений на нажатия. */
const FEED_LIMIT = 60;
const NOTICE_LIMIT = 5;
const ANSWERS_SCAN = 400;
/** Ориентир «Принято» из симулятора: через 2 часа (в REST его задаёт сотрудник). */
const ETA_AHEAD_MS = 2 * 3_600_000;
/** Лимиты на IP: опрос состояния раз в 1–2 с и нажатия. */
const STATE_PER_MINUTE = 120;
const ACTION_PER_MINUTE = 60;
const TEXT_MAX = 200;
const PAYLOAD_MAX = 1024;

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const chatSchema = z.coerce.number().int().refine((id) => SIMULATOR_CHATS.some((c) => c.chatId === id), 'неизвестный чат симулятора');
const userSchema = z.coerce.number().int().refine((id) => (SIM_RESIDENT_IDS as readonly number[]).includes(id), 'неизвестный житель симулятора');
const textSchema = z.string().trim().min(1).max(TEXT_MAX);
const publicIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,32}$/);

const stateQuerySchema = z.object({ chat: chatSchema, user: userSchema });

const residentActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), chat: chatSchema, user: userSchema }),
  z.object({ kind: z.literal('dm_text'), chat: chatSchema, user: userSchema, text: textSchema }),
  z.object({ kind: z.literal('chat_text'), chat: chatSchema, user: userSchema, text: textSchema }),
  z.object({
    kind: z.literal('callback'),
    chat: chatSchema,
    user: userSchema,
    where: z.enum(['chat', 'dm']),
    mid: z.string().min(1).max(200).regex(/^\S+$/),
    payload: z.string().min(1).max(PAYLOAD_MAX),
  }),
]);

const UK_STATUSES = ['accepted', 'brigade_on_site', 'localized', 'resolved'] as const satisfies readonly UkStatusTarget[];

const ukActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bind'), chat: chatSchema }),
  z.object({ kind: z.literal('status'), chat: chatSchema, incident: publicIdSchema, status: z.enum(UK_STATUSES) }),
  z.object({ kind: z.literal('neighbours'), chat: chatSchema }),
  z.object({ kind: z.literal('shift'), chat: chatSchema, incident: publicIdSchema }),
  z.object({ kind: z.literal('reset'), chat: chatSchema }),
]);

export interface DevChatDeps {
  config: AppConfig;
  ctx: JobContext;
  ingest: IngestDeps;
}

/** Тексты страницы — из общего словаря (ключи dev.chat.*). */
function pageTexts(): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(ruDictionary)) {
    if (key.startsWith('dev.chat.') && typeof value === 'string') texts[key] = value;
  }
  return texts;
}

interface PageAssets {
  html: string;
  js: string;
  css: string;
}

function loadAssets(): PageAssets | null {
  const dir = new URL('../../public/dev-chat/', import.meta.url);
  try {
    return {
      html: readFileSync(new URL('index.html', dir), 'utf8'),
      js: readFileSync(new URL('app.js', dir), 'utf8'),
      css: readFileSync(new URL('app.css', dir), 'utf8'),
    };
  } catch {
    return null;
  }
}

// ---------- события MAX от имени жителей ----------

const dialogChatId = (userId: number) => 1_000_000 + Math.abs(userId);
const sender = (userId: number) => ({ user_id: userId, first_name: 'Житель (симулятор)', is_bot: false });
const nonce = () => randomBytes(6).toString('hex');

function residentUpdate(action: z.infer<typeof residentActionSchema>, housePublicId: string): object {
  const now = Date.now();
  switch (action.kind) {
    case 'start':
      return { update_type: 'bot_started', timestamp: now, chat_id: dialogChatId(action.user), user: sender(action.user), payload: `h_${housePublicId}`, user_locale: 'ru' };
    case 'dm_text':
      return {
        update_type: 'message_created',
        timestamp: now,
        message: { sender: sender(action.user), recipient: { chat_id: dialogChatId(action.user), chat_type: 'dialog' }, timestamp: now, body: { mid: `mid.sim.${randomUUID()}`, seq: now, text: action.text } },
      };
    case 'chat_text':
      return {
        update_type: 'message_created',
        timestamp: now,
        message: { sender: sender(action.user), recipient: { chat_id: action.chat, chat_type: 'chat' }, timestamp: now, body: { mid: `mid.sim.${randomUUID()}`, seq: now, text: action.text } },
      };
    case 'callback': {
      const recipient = action.where === 'chat' ? { chat_id: action.chat, chat_type: 'chat' } : { chat_id: dialogChatId(action.user), chat_type: 'dialog' };
      return {
        update_type: 'message_callback',
        timestamp: now,
        callback: { callback_id: simCallbackId(action.user, action.mid, nonce()), payload: action.payload, user: sender(action.user), timestamp: now },
        message: { recipient, timestamp: now, body: { mid: action.mid, seq: now } },
      };
    }
  }
}

const staffText = (chatId: number, text: string) => {
  const now = Date.now();
  return {
    update_type: 'message_created',
    timestamp: now,
    message: { sender: { user_id: SIM_UK_USER_ID, first_name: 'Диспетчер (симулятор)', is_bot: false }, recipient: { chat_id: chatId, chat_type: 'chat' }, timestamp: now, body: { mid: `mid.sim.${randomUUID()}`, seq: now, text } },
  };
};

// ---------- чтение журнала ----------

async function journal(ctx: JobContext, target: SimTarget): Promise<JournalRow[]> {
  const [key, value] = 'chatId' in target ? ['chat_id', String(target.chatId)] : ['user_id', String(target.userId)];
  const sent = await ctx.db
    .select()
    .from(fakeMaxCall)
    .where(and(eq(fakeMaxCall.method, 'POST'), eq(fakeMaxCall.path, '/messages'), eq(fakeMaxCall.responseStatus, 200), sql`${fakeMaxCall.query} ->> ${key} = ${value}`))
    .orderBy(desc(fakeMaxCall.id))
    .limit(FEED_LIMIT);
  const mids = sent.map(sentMid).filter((mid): mid is string => mid !== null);
  const rows: JournalRow[] = [...sent];
  if (mids.length > 0) {
    rows.push(
      ...(await ctx.db
        .select()
        .from(fakeMaxCall)
        .where(and(eq(fakeMaxCall.path, '/messages'), inArray(fakeMaxCall.method, ['PUT', 'DELETE']), inArray(sql<string>`${fakeMaxCall.query} ->> 'message_id'`, mids)))),
    );
  }
  if ('chatId' in target) {
    rows.push(
      ...(await ctx.db
        .select()
        .from(fakeMaxCall)
        .where(and(eq(fakeMaxCall.method, 'PUT'), eq(fakeMaxCall.path, `/chats/${target.chatId}/pin`), eq(fakeMaxCall.responseStatus, 200)))
        .orderBy(desc(fakeMaxCall.id))
        .limit(1)),
    );
  }
  return rows;
}

/** Ответы бота на нажатия со страницы (callback_id вида sim.*). */
async function answers(ctx: JobContext): Promise<JournalRow[]> {
  return ctx.db
    .select()
    .from(fakeMaxCall)
    .where(and(eq(fakeMaxCall.method, 'POST'), eq(fakeMaxCall.path, '/answers'), like(sql<string>`${fakeMaxCall.query} ->> 'callback_id'`, 'sim.%')))
    .orderBy(desc(fakeMaxCall.id))
    .limit(ANSWERS_SCAN);
}

// ---------- дом чата ----------

async function chatHouse(ctx: JobContext, chatId: number): Promise<{ house: HouseRow | null; bound: boolean }> {
  const [bound] = await ctx.db.select({ house }).from(houseChat).innerJoin(house, eq(house.id, houseChat.houseId)).where(eq(houseChat.chatId, chatId));
  if (bound) return { house: bound.house, bound: true };
  const fallback = SIMULATOR_CHATS.find((c) => c.chatId === chatId)?.housePublicId;
  return { house: fallback ? await houseByPublicId(ctx.db, fallback) : null, bound: false };
}

function label(key: string): string {
  const value = ruDictionary[key];
  return typeof value === 'string' ? value : key;
}

async function ukIncidents(ctx: JobContext, houseId: number) {
  const rows = await ctx.db
    .select()
    .from(incident)
    .where(and(eq(incident.houseId, houseId), inArray(incident.status, [...OPEN_STATUSES])))
    .orderBy(desc(incident.createdAt))
    .limit(10);
  return rows.map((r) => ({
    id: r.publicId,
    service: label(`service.${SERVICE_I18N_KEY[r.serviceType]}`),
    status: r.status,
    statusText: label(`status.${DISPLAY_STATUS_I18N_KEY[displayStatus(r.status, r.discrepancyUnresolved)]}`),
    scope: r.scope,
    entrance: r.entrance,
    version: r.version,
  }));
}

// ---------- маршруты ----------

class DevChatError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof DevChatError) return reply.code(err.status).send({ ok: false, error: err.message });
  if (err instanceof ServiceError) return reply.code(409).send({ ok: false, error: err.message, code: err.code });
  if (err instanceof z.ZodError) return reply.code(400).send({ ok: false, error: err.issues.map((i) => i.message).join('; ') });
  throw err;
}

export function registerDevChat(app: FastifyInstance, deps: DevChatDeps): boolean {
  const { config, ctx, ingest } = deps;
  if (config.max.mode !== 'simulator') return false;
  const assets = loadAssets();
  if (!assets) {
    ctx.log.warn('симулятор чата: нет файлов страницы (public/dev-chat) — страница не подключена');
    return false;
  }
  const texts = pageTexts();
  // Общий лимит /api/v1 сюда не относится: свой лимит на IP.
  const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute', keyGenerator: ipKey, allowList: () => false } });

  const page = (reply: FastifyReply, type: string, body: string) =>
    reply
      .type(type)
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex')
      .header('content-security-policy', PAGE_CSP)
      .send(body);

  app.get(DEV_CHAT_PATH, { config: limit(STATE_PER_MINUTE) }, async (_req, reply) => page(reply, 'text/html; charset=utf-8', assets.html));
  app.get(`${DEV_CHAT_PATH}/app.js`, { config: limit(STATE_PER_MINUTE) }, async (_req, reply) => page(reply, 'text/javascript; charset=utf-8', assets.js));
  app.get(`${DEV_CHAT_PATH}/app.css`, { config: limit(STATE_PER_MINUTE) }, async (_req, reply) => page(reply, 'text/css; charset=utf-8', assets.css));

  app.get(`${DEV_CHAT_PATH}/state`, { config: limit(STATE_PER_MINUTE) }, async (req, reply) => {
    try {
      const q = stateQuerySchema.parse(req.query);
      const { house: h, bound } = await chatHouse(ctx, q.chat);
      const answered = await answers(ctx);
      const chatRows = [...(await journal(ctx, { chatId: q.chat })), ...answered];
      const dmRows = [...(await journal(ctx, { userId: q.user })), ...answered];
      const [home] = h
        ? await ctx.db
            .select({ flatNo: residency.flatNo, trustLevel: residency.trustLevel, role: residency.role })
            .from(residency)
            .where(and(eq(residency.userId, q.user), eq(residency.houseId, h.id)))
        : [];
      return reply.header('cache-control', 'no-store').send({
        texts,
        chats: SIMULATOR_CHATS.map((c) => ({ chatId: c.chatId, title: c.title })),
        residents: SIM_RESIDENT_IDS.map((id, i) => ({ id, n: i + 1 })),
        timezone: h?.timezone ?? 'Europe/Moscow',
        demo: config.demo.enabled,
        chat: {
          chatId: q.chat,
          bound,
          house: h ? { id: h.publicId, label: h.label, address: h.address } : null,
          messages: buildFeed(chatRows, { chatId: q.chat }),
        },
        dm: {
          userId: q.user,
          residency: home ?? null,
          messages: buildFeed(dmRows, { userId: q.user }),
          notices: buildNotices(answered, q.user, NOTICE_LIMIT),
        },
        uk: { incidents: h && bound ? await ukIncidents(ctx, h.id) : [] },
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post(`${DEV_CHAT_PATH}/resident`, { config: limit(ACTION_PER_MINUTE) }, async (req, reply) => {
    try {
      const action = residentActionSchema.parse(req.body);
      const { house: h } = await chatHouse(ctx, action.chat);
      if (!h) throw new DevChatError(404, 'Дом чата не найден');
      const result = await ingestUpdate(ingest, residentUpdate(action, h.publicId));
      return reply.send({ ok: true, result });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post(`${DEV_CHAT_PATH}/uk`, { config: limit(ACTION_PER_MINUTE) }, async (req, reply) => {
    try {
      const action = ukActionSchema.parse(req.body);
      const { house: h, bound } = await chatHouse(ctx, action.chat);
      if (!h?.isModel) throw new DevChatError(404, 'Модельный дом чата не найден');
      await grantDemoRole(ctx, SIM_UK_USER_ID);

      if (action.kind === 'bind') {
        if (bound) return reply.send({ ok: true, result: 'already_bound' });
        // Тот же путь, что в MAX: бота добавили в чат (приглашение C09), затем /connect <код дома>.
        await ingestUpdate(ingest, { update_type: 'bot_added', timestamp: Date.now(), chat_id: action.chat, user: { user_id: SIM_UK_USER_ID }, is_channel: false });
        await ingestUpdate(ingest, staffText(action.chat, `/connect ${h.publicId}`));
        return reply.send({ ok: true, result: 'queued' });
      }
      if (!bound) throw new DevChatError(409, 'Сначала привяжите чат к дому');

      if (action.kind === 'status' || action.kind === 'shift') {
        const [row] = await ctx.db.select().from(incident).where(and(eq(incident.publicId, action.incident), eq(incident.houseId, h.id)));
        if (!row) throw new DevChatError(404, 'Авария не найдена в этом доме');
        if (action.kind === 'status') {
          const eta = action.status === 'accepted' ? new Date(ctx.clock.now().getTime() + ETA_AHEAD_MS) : null;
          await applyUkStatus(ctx, { incidentId: row.id, staffUserId: SIM_UK_USER_ID, status: action.status, eta, expectedVersion: null, source: 'miniapp' });
          return reply.send({ ok: true });
        }
        if (!config.demo.enabled) throw new DevChatError(403, 'Демо-режим выключен');
        const shifted = await shiftIncidentStart(ctx, { incidentId: row.id, staffUserId: SIM_UK_USER_ID, source: 'miniapp' });
        return reply.send({ ok: shifted.status === 'shifted', result: shifted.status });
      }

      if (!config.demo.enabled) throw new DevChatError(403, 'Демо-режим выключен');
      if (action.kind === 'neighbours') {
        const result = await addDemoNeighbours(ctx, { house: h, staffUserId: SIM_UK_USER_ID, source: 'miniapp' });
        return reply.send({ ok: result.status === 'added', result: result.status });
      }
      const result = await resetDemoHouse(ctx, { house: h, staffUserId: SIM_UK_USER_ID, seedsDir: resolveDataDir(config.seedsDir, 'seeds') });
      return reply.send({ ok: true, result: { removedIncidents: result.removedIncidents } });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  ctx.log.info({ path: DEV_CHAT_PATH }, 'симулятор чата подключён');
  return true;
}
