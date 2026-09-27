/**
 * Демо-инструменты для проверяющих: роль сотрудника «УК Модельная» по демо-коду (профиль),
 * модельные соседи, сдвиг начала аварии и сброс демо-данных дома (блок в U03).
 * Только при DEMO_MODE=true; инструменты дома — только демо-роли и только в модельных домах.
 */
import type { FastifyInstance } from 'fastify';
import { addDemoNeighbours, demoCodeMatches, grantDemoRole, resetDemoHouse, shiftIncidentStart } from '../../services/demo.ts';
import { incidentByPublicId } from '../../services/incidents.ts';
import { loadMe } from '../../services/me.ts';
import { resolveDataDir } from '../../util/paths.ts';
import { assertDemoStaff, eventSource, houseById, loadViewer, notFound, visibleHouse } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { ApiError } from '../problem.ts';
import { ukDetailFor } from './uk.ts';

const demoDisabled = () => new ApiError(403, 'forbidden', 'Демо-режим выключен');

export function registerDemoRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx, config } = deps;

  registerApiRoute(
    app,
    deps,
    'demoUkRole',
    async ({ principal, body }) => {
      if (!config.demo.enabled) throw demoDisabled();
      // Тестовые токены проверяющих живут в песочнице: демо-роль им не нужна.
      if (principal.kind === 'checker') throw new ApiError(403, 'forbidden', 'Недоступно тестовым токенам');
      if (!demoCodeMatches(body.code, config.demo.ukCode)) {
        throw new ApiError(403, 'demo_code_invalid', 'Код не подошёл', 'Проверьте код и введите его ещё раз');
      }
      if (!(await grantDemoRole(ctx, principal.userId))) throw new ApiError(403, 'forbidden', 'Модельная УК не найдена');
      return { status: 200, body: await loadMe(ctx, principal.userId) };
    },
    { codeInput: true },
  );

  registerApiRoute(app, deps, 'demoNeighbours', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.id);
    assertDemoStaff(viewer, h, config);
    const result = await addDemoNeighbours(ctx, { house: h, staffUserId: principal.userId, source: eventSource(viewer) });
    if (result.status === 'no_active_incident') {
      throw new ApiError(409, 'incident_not_open', 'В доме нет открытой аварии', 'Сначала сообщите об аварии в этом доме');
    }
    return { status: 200, body: { incidentId: result.incident.publicId, added: result.added } };
  });

  registerApiRoute(app, deps, 'demoTimeShift', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const inc = await incidentByPublicId(ctx.db, params.id);
    if (!inc) throw notFound('Авария не найдена');
    assertDemoStaff(viewer, await houseById(ctx.db, inc.houseId), config);
    const result = await shiftIncidentStart(ctx, { incidentId: inc.id, staffUserId: principal.userId, source: eventSource(viewer) });
    if (result.status === 'not_found') throw notFound('Авария не найдена');
    if (result.status === 'not_open') {
      throw new ApiError(409, 'incident_not_open', 'Авария уже не открыта', 'Сдвинуть начало можно только у открытой аварии', result.mergedInto ? { mergedInto: result.mergedInto } : {});
    }
    return { status: 200, body: await ukDetailFor(deps, viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'demoReset', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const h = await visibleHouse(ctx.db, viewer, params.id);
    assertDemoStaff(viewer, h, config);
    const result = await resetDemoHouse(ctx, { house: h, staffUserId: principal.userId, seedsDir: resolveDataDir(config.seedsDir, 'seeds') });
    return { status: 200, body: { houseId: h.publicId, removedIncidents: result.removedIncidents } };
  });
}
