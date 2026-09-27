import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { ApiError, sendProblem } from './problem.ts';
import { registerWebhookRoute } from '../webhook/route.ts';
import { registerSystemRoutes } from './routes/system.ts';
import type { AppDeps } from './types.ts';

export type { AppDeps, ReadinessCheck } from './types.ts';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    // pino.Logger совместим с FastifyBaseLogger; приведение фиксирует тип логгера у экземпляра.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    loggerInstance: deps.log as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 256 * 1024,
    // X-Request-Id от прокси принимаем, если он похож на идентификатор; иначе создаём свой.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
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

  registerSystemRoutes(app, deps);
  if (deps.webhook) registerWebhookRoute(app, deps.config, deps.webhook);
  return app;
}
