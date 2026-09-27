/**
 * Песочница для проверок DATA-API: POST /sandbox/reset — только тестовый токен УК
 * (CHECKER_TOKEN_UK при CHECKER_API_ENABLED=true). Сообщений в чаты нет.
 */
import type { FastifyInstance } from 'fastify';
import { resetSandbox } from '../../services/sandbox.ts';
import { notFound } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { ApiError } from '../problem.ts';

export function registerSandboxRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx, config } = deps;

  registerApiRoute(app, deps, 'sandboxReset', async ({ principal }) => {
    if (!config.checker.enabled) throw notFound();
    if (principal.kind !== 'checker' || principal.role !== 'uk') throw new ApiError(403, 'forbidden', 'Доступно только тестовому токену УК');
    await resetSandbox(ctx, { staffUserId: principal.userId });
    return { status: 204 };
  });
}
