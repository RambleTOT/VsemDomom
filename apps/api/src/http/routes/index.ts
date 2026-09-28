/** Эндпоинты /api/v1 (кроме системных). Реализованные операции контракта — см. IMPLEMENTED_OPERATIONS. */
import type { FastifyInstance } from 'fastify';
import type { ApiDeps, OperationId } from '../api-route.ts';
import { registerAuthRoutes } from './auth.ts';
import { registerDemoRoutes } from './demo.ts';
import { registerHouseRoutes } from './houses.ts';
import { registerIncidentRoutes } from './incidents.ts';
import { registerMeRoutes } from './me.ts';
import { registerNormRoutes } from './norms.ts';
import { registerOwnerRoutes } from './owner.ts';
import { registerResidentRoutes } from './residents.ts';
import { registerSandboxRoutes } from './sandbox.ts';
import { registerUkRoutes } from './uk.ts';

export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerHouseRoutes(app, deps);
  registerNormRoutes(app, deps);
  registerIncidentRoutes(app, deps);
  registerUkRoutes(app, deps);
  registerOwnerRoutes(app, deps);
  registerResidentRoutes(app, deps);
  registerDemoRoutes(app, deps);
  registerSandboxRoutes(app, deps);
}

/** Операции контракта, которые ещё не реализованы, и задача, в которой появятся (docs/STREAM_A.md). */
export const PENDING_OPERATIONS: Partial<Record<OperationId, string>> = {
  ukHeatmap: 'A13',
  ukStartHeatingPoll: 'A13',
};
