/** Дома: поиск для регистрации, краткие сведения, главная жителя (S03), месяц против лимита. */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ilike, or } from 'drizzle-orm';
import { chatOfHouse } from '../../db/queries.ts';
import { house, managementCompany } from '../../db/schema.ts';
import { houseIncidentIds, incidentSummary, loadIncidentBundles } from '../../services/incident-view.ts';
import { monthDetail, monthSummary } from '../../services/month.ts';
import { computeResult } from '../../services/result.ts';
import { chatInfo, houseSummary, residencyView } from '../../services/views.ts';
import { assertHouseAccess, incidentViewer, loadViewer, residencyIn, visibleHouse } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';

/** Экранирование % и _ для ILIKE. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function registerHouseRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx } = deps;

  registerApiRoute(app, deps, 'searchHouses', async ({ principal, query }) => {
    const q = query.q?.trim();
    const sandbox = principal.kind === 'checker';
    const rows = await ctx.db
      .select()
      .from(house)
      .where(and(eq(house.isSandbox, sandbox), q ? or(ilike(house.address, likePattern(q)), ilike(house.label, likePattern(q))) : undefined))
      .orderBy(asc(house.label));
    return { status: 200, body: { items: rows.map(houseSummary) } };
  });

  registerApiRoute(app, deps, 'getHouseSummary', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    return { status: 200, body: houseSummary(await visibleHouse(ctx.db, viewer, params.houseId)) };
  });

  registerApiRoute(app, deps, 'getHouse', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.houseId);
    assertHouseAccess(viewer, h);
    const now = ctx.clock.now();
    const [uk] = await ctx.db.select().from(managementCompany).where(eq(managementCompany.id, h.ukId));
    const chat = await chatOfHouse(ctx.db, h.id);
    const myResidency = residencyIn(viewer, h.id);
    const ids = await houseIncidentIds(ctx.db, h.id, viewer.userId);
    const bundles = await loadIncidentBundles(ctx.db, [...ids.active, ...ids.recent]);
    const iv = incidentViewer(viewer, h);
    const bundlesOf = (list: number[]) => list.flatMap((id) => bundles.filter((b) => b.incident.id === id));
    const pick = (list: number[]) => bundlesOf(list).map((b) => incidentSummary(b, iv, now));
    // Итог: квартиры сверх месячной нормы — тот же расчёт, что в итоге в чате и на экране итога.
    const recentResults = await Promise.all(
      bundlesOf(ids.recent).map(async (b) => ({ ...incidentSummary(b, iv, now), overNormFlats: (await computeResult(ctx.db, b, now)).eligible?.flats ?? 0 })),
    );
    return {
      status: 200,
      body: {
        ...houseSummary(h),
        uk: { name: uk?.name ?? '', adsPhone: uk?.adsPhone ?? '', isModel: uk?.isModel ?? h.isModel },
        chat: chatInfo(chat),
        activeIncidents: pick(ids.active),
        recentResults,
        month: await monthSummary(ctx.db, h, myResidency, now),
        myResidency: myResidency ? residencyView(myResidency, h, chat) : null,
      },
    };
  });

  registerApiRoute(app, deps, 'getHouseMonth', async ({ principal, params, query }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.houseId);
    assertHouseAccess(viewer, h);
    return { status: 200, body: await monthDetail(ctx.db, h, query.service, query.month, residencyIn(viewer, h.id), ctx.clock.now()) };
  });
}
