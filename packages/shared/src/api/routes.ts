import { HealthResponse, ReadyResponse, VersionResponse } from './system.ts';
import { defineRoutes } from './route.ts';

export const systemRoutes = defineRoutes([
  {
    operationId: 'health',
    method: 'get',
    path: '/health',
    summary: 'Процесс жив',
    tags: ['system'],
    auth: 'none',
    responses: { 200: { description: 'Процесс жив', schema: HealthResponse } },
  },
  {
    operationId: 'healthV1',
    method: 'get',
    path: '/api/v1/health',
    summary: 'Процесс жив (путь с базой /api/v1)',
    tags: ['system'],
    auth: 'none',
    responses: { 200: { description: 'Процесс жив', schema: HealthResponse } },
  },
  {
    operationId: 'ready',
    method: 'get',
    path: '/ready',
    summary: 'Готовность: БД, миграции, MAX',
    tags: ['system'],
    auth: 'none',
    responses: {
      200: { description: 'Все зависимости готовы', schema: ReadyResponse },
      503: { description: 'Какая-то зависимость не готова', schema: ReadyResponse, contentType: 'application/json' },
    },
  },
  {
    operationId: 'version',
    method: 'get',
    path: '/api/v1/version',
    summary: 'Версия сборки и включённые функции',
    tags: ['system'],
    auth: 'none',
    responses: { 200: { description: 'Версия', schema: VersionResponse } },
  },
]);

export const apiRoutes = [...systemRoutes];
