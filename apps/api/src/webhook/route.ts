/**
 * POST /webhook/max: секрет X-Max-Bot-Api-Secret (сравнение за постоянное время),
 * дедупликация, постановка в очередь, ответ 200 сразу. БД недоступна → 503: MAX повторит.
 * Тело запроса не логируется.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.ts';
import { sendProblem } from '../http/problem.ts';
import { ingestUpdate, InvalidUpdateError, type IngestDeps } from './ingest.ts';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function secretMatches(expected: string, received: string | undefined): boolean {
  if (received === undefined) return false;
  return timingSafeEqual(digest(expected), digest(received));
}

export function registerWebhookRoute(app: FastifyInstance, config: AppConfig, deps: IngestDeps): void {
  // В режиме long polling события приходят не сюда.
  if (config.max.mode === 'polling') return;

  app.post('/webhook/max', { logLevel: 'warn' }, async (req, reply) => {
    const expected = config.max.webhookSecret;
    const header = req.headers['x-max-bot-api-secret'];
    const received = Array.isArray(header) ? header[0] : header;
    // Без настроенного секрета webhook открыт только в симуляторе (конфигурация требует секрет для webhook).
    if (expected ? !secretMatches(expected, received) : config.max.mode !== 'simulator') {
      req.log.warn({ reason: 'secret' }, 'webhook: отклонён запрос с неверным секретом');
      return sendProblem(req, reply, 401, 'unauthorized', 'Неверный секрет webhook');
    }
    try {
      const result = await ingestUpdate(deps, req.body);
      if (result === 'duplicate') req.log.debug('webhook: повтор события');
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof InvalidUpdateError) {
        return sendProblem(req, reply, 400, 'validation_error', 'Неверный формат события');
      }
      req.log.error({ err }, 'webhook: не удалось сохранить событие');
      return sendProblem(req, reply, 503, 'service_unavailable', 'Сервис временно недоступен');
    }
  });
}
