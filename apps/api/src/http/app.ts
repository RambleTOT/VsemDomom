import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { registerDevChat } from '../dev/sim-chat.ts';
import { registerWebhookRoute } from '../webhook/route.ts';
import { registerAuth } from './auth.ts';
import { registerDocs } from './docs.ts';
import { ApiError, sendProblem } from './problem.ts';
import { DEFAULT_RATE_LIMITS, registerRateLimit } from './rate-limit.ts';
import { registerApiRoutes } from './routes/index.ts';
import { registerSystemRoutes } from './routes/system.ts';
import type { AppDeps } from './types.ts';

export type { AppDeps, ReadinessCheck } from './types.ts';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const QUIET_ROUTES = new Set(['/health', '/api/v1/health', '/ready']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // pino.Logger совместим с FastifyBaseLogger; приведение фиксирует тип логгера у экземпляра.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    loggerInstance: deps.log as FastifyBaseLogger,
    // Перед API ровно один прокси — Caddy; доверяем только ему (первому звену X-Forwarded-For).
    trustProxy: (_address: string, hop: number) => hop < 1,
    bodyLimit: 256 * 1024,
    // Стандартный лог запросов пишет полный URL (в нём бывают одноразовые токены) и IP клиента — свой ниже.
    logController: new LogController({ disableRequestLogging: true }),
    // X-Request-Id от прокси принимаем, если он похож на идентификатор; иначе создаём свой.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
  });

  // Ответы API зависят от пользователя: не кешировать ни в браузере, ни в прокси.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/v1/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // Журнал запросов: шаблон маршрута вместо URL (без токенов и ID), без IP; проверки живости не пишем.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'не найден';
    if (QUIET_ROUTES.has(route) || route.startsWith('/api/docs')) return;
    req.log.info({ method: req.method, route, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'запрос');
  });

  // Заголовки безопасности для API. CSP мини-приложения задаёт Caddy (статика).
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } });

  app.setErrorHandler((error: FastifyError | ApiError, req, reply) => {
    if (error instanceof ApiError) {
      return sendProblem(req, reply, error.status, error.code, error.title, error.message, error.extra);
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err: error }, 'необработанная ошибка');
      return sendProblem(req, reply, 500, 'internal', 'Внутренняя ошибка сервиса');
    }
    if (error.validation) {
      return sendProblem(req, reply, 400, 'validation_error', 'Неверный формат запроса', error.message);
    }
    return sendProblem(req, reply, status, error.code || 'bad_request', 'Неверный запрос', error.message);
  });

  app.setNotFoundHandler((req, reply) => sendProblem(req, reply, 404, 'not_found', 'Не найдено'));

  const limits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
  if (deps.api) {
    registerAuth(app, deps.config, deps.api.clock);
    await registerRateLimit(app, limits);
  }
  registerSystemRoutes(app, deps);
  if (deps.webhook) registerWebhookRoute(app, deps.config, deps.webhook);
  if (deps.api) {
    registerApiRoutes(app, { config: deps.config, ctx: deps.api, limits });
    await registerDocs(app, deps.config);
    // Симулятор чата — только MAX_MODE=simulator (иначе маршрутов нет и /dev/chat отвечает 404).
    if (deps.webhook) registerDevChat(app, { config: deps.config, ctx: deps.api, ingest: deps.webhook });
  }
  return app;
}
