/** Справочник нормативов с основаниями (F16): действующие сегодня; без региона — федеральные. */
import type { FastifyInstance } from 'fastify';
import { asc } from 'drizzle-orm';
import { norm } from '../../db/schema.ts';
import { normView } from '../../services/views.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';

const DATE_LENGTH = 10;

export function registerNormRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx } = deps;
  registerApiRoute(app, deps, 'listNorms', async ({ query }) => {
    const today = ctx.clock.now().toISOString().slice(0, DATE_LENGTH);
    const rows = await ctx.db.select().from(norm).orderBy(asc(norm.code));
    const items = rows.filter(
      (n) =>
        (query.service === undefined || n.serviceType === null || n.serviceType === query.service) &&
        (n.regionCode === null || n.regionCode === query.region) &&
        n.validFrom <= today &&
        (n.validTo === null || today <= n.validTo),
    );
    return { status: 200, body: items.map(normView) };
  });
}
