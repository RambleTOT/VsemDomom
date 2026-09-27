/**
 * Генерация docs/api/openapi.yaml (OpenAPI 3.1) из zod-схем и таблицы маршрутов.
 * pnpm openapi:gen — записать файл; pnpm openapi:check — сравнить с закоммиченным (CI).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { stringify } from 'yaml';
import { z } from 'zod';
import { apiRoutes, ERROR_DESCRIPTIONS, Problem, type ApiRoute, type RouteResponse } from '../src/index.ts';

// Схемы в src описаны через .meta(); .openapi() нужен библиотеке только в этом скрипте.
extendZodWithOpenApi(z);

const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'api', 'openapi.yaml');


function toRouteConfig(route: ApiRoute): RouteConfig {
  const responses: RouteConfig['responses'] = {};
  const all: Record<number, RouteResponse> = {};
  for (const code of route.errors ?? []) all[code] = { description: ERROR_DESCRIPTIONS[code] ?? 'Ошибка' };
  Object.assign(all, route.responses);
  for (const [code, res] of Object.entries(all)) {
    const status = Number(code);
    const contentType = res.contentType ?? (status < 400 ? 'application/json' : 'application/problem+json');
    const schema = res.schema ?? (status >= 400 ? Problem : undefined);
    responses[code] = {
      description: res.description,
      headers: {
        'X-Request-Id': { description: 'Идентификатор запроса', schema: { type: 'string' } },
      },
      ...(schema ? { content: { [contentType]: { schema } } } : {}),
    };
  }
  const security =
    route.auth === 'none' || route.auth === 'webhook' ? [] : [{ bearerAuth: [] as string[] }];
  const description = [
    route.description,
    route.feature ? `Функция за флагом \`${route.feature}\`: при выключенном флаге — 404.` : undefined,
    route.auth === 'webhook' ? 'Заголовок `X-Max-Bot-Api-Secret` обязателен.' : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    operationId: route.operationId,
    method: route.method,
    path: route.path,
    summary: route.summary,
    ...(description ? { description } : {}),
    tags: route.tags,
    security,
    request: {
      ...(route.params ? { params: route.params } : {}),
      ...(route.query ? { query: route.query } : {}),
      ...(route.headers ? { headers: route.headers } : {}),
      ...(route.body ? { body: { required: true, content: { 'application/json': { schema: route.body } } } } : {}),
    },
    responses,
  };
}

export function buildDocument(): string {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Сессия мини-приложения (JWT, POST /api/v1/auth/max) или тестовый токен роли CHECKER_TOKEN_* (при CHECKER_API_ENABLED=true).',
  });
  for (const route of apiRoutes) registry.registerPath(toRouteConfig(route));

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Всем домом API',
      version: '0.1.0',
      description: [
        'REST API мини-приложения «Всем домом» и webhook бота MAX.',
        '',
        '- Префикс `/api/v1`, JSON, даты — ISO 8601 с часовым поясом (ответы — в UTC).',
        '- Авторизация: `Authorization: Bearer <session JWT>` или `Bearer <CHECKER_TOKEN_*>`.',
        '- Ошибки — `application/problem+json` (RFC 9457): `type`, `title`, `status`, `detail`, `code`, `traceId`.',
        '- Каждый ответ содержит заголовок `X-Request-Id`.',
        '- `Idempotency-Key` на создании аварии и расчёте — необязательный; повтор возвращает первый ответ.',
        '- `If-Match: <version>` на смене статуса УК — необязательный; устаревшая версия → 409 `version_conflict`.',
        '- Дома, УК и телефоны АДС — модельные данные.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Тот же хост, что и мини-приложение' }],
    tags: [
      { name: 'system', description: 'Проверки и версия' },
    ],
  });
  return stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

async function main(): Promise<void> {
  const generated = buildDocument();
  if (process.argv.includes('--check')) {
    const current = await readFile(OUT, 'utf8').catch(() => '');
    if (current !== generated) {
      process.stderr.write('docs/api/openapi.yaml устарел: выполните pnpm openapi:gen и закоммитьте результат\n');
      process.exit(1);
    }
    process.stdout.write('docs/api/openapi.yaml актуален\n');
    return;
  }
  await writeFile(OUT, generated);
  process.stdout.write(`записан ${OUT}\n`);
}

await main();
