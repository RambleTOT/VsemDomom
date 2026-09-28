/**
 * Экраны УК (F05, F11): аварии своих домов (срок истёк — сверху), авария с сеткой «подъезд × этаж»,
 * статус и ориентир (If-Match), объединение дублей, дома с чатами и правами бота, привязка чата.
 */
import { isOpenStatus, OPEN_STATUSES } from '@vsemdomom/core';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { bindChatWithToken, bindingInfo } from '../../bot/binding.ts';
import { chatOfHouse } from '../../db/queries.ts';
import { incident } from '../../db/schema.ts';
import { incidentSummary, loadIncidentBundle, loadIncidentBundles, type IncidentBundle } from '../../services/incident-view.ts';
import { activeDemoIncident } from '../../services/demo.ts';
import { demoAllowed } from '../../services/demo-answers.ts';
import { loadActNorms } from '../../services/act.ts';
import { incidentByPublicId } from '../../services/incidents.ts';
import { monthSummary } from '../../services/month.ts';
import { heatmapView, startHeatingPoll } from '../../services/polls.ts';
import { applyUkStatus, mergeIncident } from '../../services/uk-status.ts';
import {
  isExpired,
  mergeCandidateIds,
  monthlySummaryView,
  nextDueAt,
  ukHouseView,
  ukIncidentDetail,
  urgency,
  type UkIncidentDetail,
} from '../../services/uk-view.ts';
import { iso } from '../../services/views.ts';
import {
  assertStaffAny,
  assertStaffOf,
  eventSource,
  hasDemoRole,
  houseById,
  incidentViewer,
  loadViewer,
  notFound,
  staffHouses,
  visibleHouse,
  type Viewer,
} from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { parseIfMatch } from '../if-match.ts';
import { ApiError, fromServiceError } from '../problem.ts';

/** Закрытые в списке УК: последние. */
const CLOSED_LIMIT = 50;

/** Авария глазами УК (U02): сетка, сроки, хронология и кандидаты на объединение. */
export async function ukDetailFor(deps: ApiDeps, viewer: Viewer, incidentId: number): Promise<UkIncidentDetail> {
  const { ctx, config } = deps;
  const b = await loadIncidentBundle(ctx.db, incidentId);
  if (!b) throw notFound('Авария не найдена');
  const open = await ctx.db
    .select({ id: incident.id })
    .from(incident)
    .where(and(eq(incident.houseId, b.house.id), eq(incident.serviceType, b.incident.serviceType), inArray(incident.status, [...OPEN_STATUSES])));
  const others = await loadIncidentBundles(ctx.db, open.map((r) => r.id));
  const iv = incidentViewer(viewer, b.house);
  const now = ctx.clock.now();
  const candidates = mergeCandidateIds(others, b).flatMap((id) => others.filter((x) => x.incident.id === id)).map((x) => incidentSummary(x, iv, now));
  const actNorms = config.features.actTemplate ? await loadActNorms(ctx.db, b.house, b.incident, now) : null;
  return ukIncidentDetail(b, iv, config, now, candidates, actNorms);
}

export function registerUkRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx, config } = deps;
  const detail = (viewer: Viewer, incidentId: number) => ukDetailFor(deps, viewer, incidentId);

  const staffIncident = async (viewer: Viewer, publicId: string) => {
    const inc = await incidentByPublicId(ctx.db, publicId);
    if (!inc) throw notFound('Авария не найдена');
    assertStaffOf(viewer, await houseById(ctx.db, inc.houseId));
    return inc;
  };

  registerApiRoute(app, deps, 'ukListIncidents', async ({ principal, query }) => {
    const viewer = await loadViewer(ctx.db, principal);
    assertStaffAny(viewer);
    const houses = await staffHouses(ctx.db, viewer);
    const scope = query.houseId ? houses.filter((h) => h.publicId === query.houseId) : houses;
    if (query.houseId && scope.length === 0) throw notFound('Дом не найден');
    const rows = scope.length > 0 ? await ctx.db.select({ id: incident.id }).from(incident).where(inArray(incident.houseId, scope.map((h) => h.id))) : [];
    const bundles = await loadIncidentBundles(ctx.db, rows.map((r) => r.id));
    const now = ctx.clock.now();
    const open = bundles.filter((b) => isOpenStatus(b.incident.status));
    const expired = open.filter((b) => isExpired(b, now));
    const closed = bundles
      .filter((b) => !isOpenStatus(b.incident.status))
      .sort((a, b) => (b.incident.closedAt ?? b.incident.createdAt).getTime() - (a.incident.closedAt ?? a.incident.createdAt).getTime());
    const byUrgency = (list: IncidentBundle[]) =>
      [...list].sort((a, b) => urgency(a, now) - urgency(b, now) || nextDueAt(a) - nextDueAt(b) || b.incident.startedAt.getTime() - a.incident.startedAt.getTime());
    const status = query.status ?? 'open';
    const chosen = status === 'open' ? byUrgency(open) : status === 'expired' ? byUrgency(expired) : closed.slice(0, CLOSED_LIMIT);
    return {
      status: 200,
      body: {
        items: chosen.map((b) => incidentSummary(b, incidentViewer(viewer, b.house), now)),
        counts: { open: open.length, expired: expired.length, closed: closed.length },
        houses: scope.map((h) => ({ id: h.publicId, label: h.label, address: h.address, openCount: open.filter((b) => b.house.id === h.id).length })),
      },
    };
  });

  registerApiRoute(app, deps, 'ukGetIncident', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const inc = await staffIncident(viewer, params.id);
    return { status: 200, body: await detail(viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'ukSetStatus', async ({ principal, params, headers, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const inc = await staffIncident(viewer, params.id);
    const expectedVersion = parseIfMatch(headers['if-match']);
    await applyUkStatus(ctx, {
      incidentId: inc.id,
      staffUserId: principal.userId,
      status: body.status,
      eta: body.eta ? new Date(body.eta) : null,
      expectedVersion,
      source: eventSource(viewer),
    }).catch(fromServiceError);
    return { status: 200, body: await detail(viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'ukMerge', async ({ principal, params, headers, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const inc = await staffIncident(viewer, params.id);
    const target = await mergeIncident(ctx, {
      incidentId: inc.id,
      intoPublicId: body.intoId,
      staffUserId: principal.userId,
      expectedVersion: parseIfMatch(headers['if-match']),
      source: eventSource(viewer),
    }).catch(fromServiceError);
    return { status: 200, body: await detail(viewer, target.id) };
  });

  registerApiRoute(app, deps, 'ukListHouses', async ({ principal }) => {
    const viewer = await loadViewer(ctx.db, principal);
    assertStaffAny(viewer);
    const houses = await staffHouses(ctx.db, viewer);
    const items = [];
    for (const h of houses) items.push(await ukHouseView(ctx.db, h, await chatOfHouse(ctx.db, h.id)));
    return { status: 200, body: { items } };
  });

  registerApiRoute(app, deps, 'ukGetHouse', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.id);
    assertStaffOf(viewer, h);
    const now = ctx.clock.now();
    const demo = demoAllowed(ctx, h) && hasDemoRole(viewer, h) ? { activeIncidentId: (await activeDemoIncident(ctx.db, h.id))?.publicId ?? null } : null;
    return {
      status: 200,
      body: {
        ...(await ukHouseView(ctx.db, h, await chatOfHouse(ctx.db, h.id))),
        timezone: h.timezone,
        month: await monthSummary(ctx.db, h, null, now),
        monthlySummary: config.features.monthlySummary ? await monthlySummaryView(ctx.db, h, now) : null,
        demo,
      },
    };
  });

  registerApiRoute(app, deps, 'ukHeatmap', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.id);
    assertStaffOf(viewer, h);
    return { status: 200, body: await heatmapView(ctx.db, h) };
  });

  registerApiRoute(app, deps, 'ukStartHeatingPoll', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.id);
    assertStaffOf(viewer, h);
    const started = await startHeatingPoll(ctx, { house: h, staffUserId: principal.userId });
    if (started.status === 'no_chat') throw new ApiError(409, 'invalid_transition', 'Чат дома не привязан', 'Опрос отправляется в чат дома — сначала привяжите чат');
    if (started.status === 'already') throw new ApiError(409, 'invalid_transition', 'Опрос уже был в этом сезоне', '«Тепло ли у вас?» запускается один раз за отопительный сезон');
    return { status: 202, body: { startedAt: iso(started.startedAt) } };
  });

  registerApiRoute(app, deps, 'ukGetChatBinding', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    assertStaffAny(viewer);
    const info = await bindingInfo(ctx, params.token);
    if (!info) throw notFound('Ссылка привязки не найдена');
    let chatTitle: string | null = null;
    try {
      chatTitle = (await ctx.max.getChat(info.chatId)).title ?? null;
    } catch (err) {
      ctx.log.warn({ err }, 'привязка: название чата не получено');
    }
    return { status: 200, body: { chatTitle, status: info.status, expiresAt: iso(info.expiresAt) } };
  });

  registerApiRoute(app, deps, 'ukBindChat', async ({ principal, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    assertStaffAny(viewer);
    const h = await visibleHouse(ctx.db, viewer, body.houseId);
    if (h.isSandbox) throw new ApiError(409, 'invalid_transition', 'Дом-песочница не привязывается к чатам');
    const result = await bindChatWithToken(ctx, { token: body.token, housePublicId: h.publicId, staffUserId: principal.userId });
    if (typeof result === 'string') {
      switch (result) {
        case 'token_not_found':
          throw notFound('Ссылка привязки не найдена');
        case 'house_not_found':
          throw notFound('Дом не найден');
        case 'forbidden':
          throw new ApiError(403, 'not_staff', 'Нет прав на привязку', 'Дом другой УК или вы не участник этого чата');
        case 'token_used':
          throw new ApiError(410, 'token_used', 'Ссылка привязки уже использована');
        case 'token_expired':
          throw new ApiError(410, 'token_expired', 'Ссылка привязки устарела');
        case 'already_bound':
          throw new ApiError(409, 'already_bound', 'Дом или чат уже привязан', 'Демо-роль привязывает только свободный дом к свободному чату');
      }
    }
    return {
      status: 200,
      body: { house: await ukHouseView(ctx.db, h, await chatOfHouse(ctx.db, h.id)), panelPublished: true, pinned: result.botIsAdmin },
    };
  });
}
