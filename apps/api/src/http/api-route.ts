/**
 * Регистрация эндпоинтов строго по контракту packages/shared (тот же источник, что openapi.yaml):
 * метод и путь, разбор параметров, запроса, заголовков и тела zod-схемами (ошибка → 400),
 * вход (401), флаг функции (404 feature_disabled), лимиты запросов. Вне production ответ
 * сверяется со схемой — расхождение с контрактом ловят тесты.
 */
import { apiRoutes, type ApiRoute } from '@vsemdomom/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Principal } from '../auth/principal.ts';
import type { AppConfig } from '../config/env.ts';
import type { JobContext } from '../jobs/context.ts';
import { ApiError, sendProblem } from './problem.ts';
import { authRateLimit, type RateLimits } from './rate-limit.ts';

type AnyRoute = (typeof apiRoutes)[number];
export type OperationId = AnyRoute['operationId'];
type RouteOf<Id extends OperationId> = Extract<AnyRoute, { operationId: Id }>;
type Part = 'params' | 'query' | 'body' | 'headers';
type Parsed<R, K extends Part> = R extends Record<K, infer S> ? (S extends z.ZodType ? z.output<S> : undefined) : undefined;
type PrincipalFor<R> = R extends { auth: 'none' } ? Principal | null : Principal;

export interface ApiDeps {
  config: AppConfig;
  ctx: JobContext;
  limits: RateLimits;
}

export interface RouteInput<Id extends OperationId> {
  req: FastifyRequest;
  principal: PrincipalFor<RouteOf<Id>>;
  params: Parsed<RouteOf<Id>, 'params'>;
  query: Parsed<RouteOf<Id>, 'query'>;
  body: Parsed<RouteOf<Id>, 'body'>;
  headers: Parsed<RouteOf<Id>, 'headers'>;
}

export interface RouteResult {
  status: number;
  body?: unknown;
}

export type RouteHandler<Id extends OperationId> = (input: RouteInput<Id>) => Promise<RouteResult>;

export interface RouteOptions {
  /** Своя ошибка для неверного тела (по контракту: сумма ≤ 0 или не число → 422 monthly_charge_invalid). */
  bodyError?: () => ApiError;
}

export function findRoute<Id extends OperationId>(operationId: Id): RouteOf<Id> {
  const route = apiRoutes.find((r) => r.operationId === operationId);
  if (!route) throw new Error(`в контракте нет операции ${operationId}`);
  return route as RouteOf<Id>;
}

/** /api/v1/incidents/{id} → /api/v1/incidents/:id */
export function fastifyPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

function issues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

function parsePart(schema: z.ZodType | undefined, value: unknown, part: Part): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(part === 'body' ? (value ?? {}) : value);
  if (!result.success) {
    throw new ApiError(400, 'validation_error', 'Неверный формат запроса', `${part}: ${result.error.issues[0]?.message ?? 'ошибка'}`, {
      errors: issues(result.error),
    });
  }
  return result.data;
}

function parseBody(schema: z.ZodType | undefined, value: unknown, options: RouteOptions): unknown {
  try {
    return parsePart(schema, value, 'body');
  } catch (err) {
    if (options.bodyError && err instanceof ApiError && err.code === 'validation_error') throw options.bodyError();
    throw err;
  }
}

const AUTH_PROBLEM = {
  missing: { code: 'unauthorized', title: 'Нужен вход' },
  invalid: { code: 'unauthorized', title: 'Неверная авторизация' },
  expired: { code: 'session_expired', title: 'Сессия истекла. Откройте приложение заново из чата' },
} as const;

export function registerApiRoute<Id extends OperationId>(
  app: FastifyInstance,
  deps: ApiDeps,
  operationId: Id,
  handler: RouteHandler<Id>,
  options: RouteOptions = {},
): void {
  const route: ApiRoute = findRoute(operationId);
  const rateLimit = route.tags.includes('auth') ? authRateLimit(deps.limits) : undefined;
  app.route({
    method: route.method.toUpperCase(),
    url: fastifyPath(route.path),
    config: rateLimit ? { rateLimit } : {},
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (route.feature && !deps.config.features[route.feature]) {
        return sendProblem(req, reply, 404, 'feature_disabled', 'Функция выключена');
      }
      if (route.auth !== 'none' && !req.principal) {
        const problem = AUTH_PROBLEM[req.authProblem ?? 'missing'];
        return sendProblem(req, reply, 401, problem.code, problem.title);
      }
      const input = {
        req,
        principal: req.principal,
        params: parsePart(route.params, req.params, 'params'),
        query: parsePart(route.query, req.query, 'query'),
        headers: parsePart(route.headers, req.headers, 'headers'),
        body: parseBody(route.body, req.body, options),
      } as RouteInput<Id>;
      const result = await handler(input);
      const declared = route.responses[result.status];
      if (declared?.schema && deps.config.nodeEnv !== 'production') {
        const check = declared.schema.safeParse(result.body);
        if (!check.success) {
          req.log.error({ operationId, errors: issues(check.error) }, 'ответ не соответствует контракту');
          throw new Error(`ответ ${operationId} не соответствует контракту: ${JSON.stringify(issues(check.error).slice(0, 3))}`);
        }
      }
      if (result.body === undefined) return reply.status(result.status).send();
      return reply.status(result.status).send(result.body);
    },
  });
}
