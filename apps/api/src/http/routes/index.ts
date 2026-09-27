/** Эндпоинты /api/v1 (кроме системных). Реализованные операции контракта — см. IMPLEMENTED_OPERATIONS. */
import type { FastifyInstance } from 'fastify';
import type { ApiDeps, OperationId } from '../api-route.ts';
import { registerAuthRoutes } from './auth.ts';
import { registerHouseRoutes } from './houses.ts';
import { registerIncidentRoutes } from './incidents.ts';
import { registerMeRoutes } from './me.ts';
import { registerNormRoutes } from './norms.ts';
import { registerOwnerRoutes } from './owner.ts';
import { registerUkRoutes } from './uk.ts';

export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerHouseRoutes(app, deps);
  registerNormRoutes(app, deps);
  registerIncidentRoutes(app, deps);
  registerUkRoutes(app, deps);
  registerOwnerRoutes(app, deps);
}

/** Операции контракта, которые ещё не реализованы, и задача, в которой появятся (docs/STREAM_A.md). */
export const PENDING_OPERATIONS: Partial<Record<OperationId, string>> = {
  demoUkRole: 'A10',
  actReady: 'A13',
  ukHeatmap: 'A13',
  ukStartHeatingPoll: 'A13',
  ukListResidents: 'A11',
  ukConfirmResident: 'A11',
  ukRejectResident: 'A11',
  demoNeighbours: 'A10',
  demoTimeShift: 'A10',
  demoReset: 'A10',
  sandboxReset: 'A12',
};
