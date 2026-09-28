/**
 * Swagger UI на /api/docs: контракт docs/api/openapi.yaml — тот же файл, что генерируется из zod-схем
 * и сверяется в CI. «Try it out» ходит в этот же API; авторизация — Bearer (сессия или тестовый токен).
 */
import { dirname } from 'node:path';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.ts';
import { findUp } from '../util/paths.ts';

export const DOCS_PREFIX = '/api/docs';

export async function registerDocs(app: FastifyInstance, config: Pick<AppConfig, 'openapiFile'>): Promise<boolean> {
  const file = config.openapiFile ?? findUp('docs/api/openapi.yaml');
  if (!file) {
    app.log.warn('openapi.yaml не найден — документация /api/docs выключена');
    return false;
  }
  await app.register(swagger, { mode: 'static', specification: { path: file, baseDir: dirname(file) } });
  await app.register(swaggerUi, {
    routePrefix: DOCS_PREFIX,
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: true, displayRequestDuration: true, tryItOutEnabled: false },
  });
  return true;
}
