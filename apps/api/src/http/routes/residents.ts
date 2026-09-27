/**
 * Очередь подтверждения жильцов (U04, флаг trustLevels): заявки уровня 0–1 в домах УК сотрудника,
 * «Подтвердить» (уровень 2) и «Отклонить» (уровень не меняется). При выключенном флаге — 404.
 */
import type { FastifyInstance } from 'fastify';
import type { Principal } from '../../auth/principal.ts';
import { decideResident, pendingResidents, residencyByPublicId } from '../../services/residents.ts';
import { assertStaffAny, assertStaffOf, loadViewer, notFound, staffHouses } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';

export function registerResidentRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx } = deps;

  registerApiRoute(app, deps, 'ukListResidents', async ({ principal, query }) => {
    const viewer = await loadViewer(ctx.db, principal);
    assertStaffAny(viewer);
    const houses = await staffHouses(ctx.db, viewer);
    const scope = query.houseId ? houses.filter((h) => h.publicId === query.houseId) : houses;
    return { status: 200, body: { items: await pendingResidents(ctx.db, scope) } };
  });

  const decide = async (principal: Principal, publicId: string, decision: 'confirmed' | 'rejected') => {
    const viewer = await loadViewer(ctx.db, principal);
    const found = await residencyByPublicId(ctx.db, publicId);
    if (!found) throw notFound('Заявка не найдена');
    assertStaffOf(viewer, found.house);
    const result = await decideResident(ctx, { residencyId: found.residency.id, house: found.house, staffUserId: principal.userId, decision });
    if (!result) throw notFound('Заявка не найдена');
    return { status: 200, body: { id: found.residency.publicId, ...result } };
  };

  registerApiRoute(app, deps, 'ukConfirmResident', ({ principal, params }) => decide(principal, params.id, 'confirmed'));
  registerApiRoute(app, deps, 'ukRejectResident', ({ principal, params }) => decide(principal, params.id, 'rejected'));
}
