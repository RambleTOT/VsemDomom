import { z } from 'zod';

/** Публичный ID сущности: nanoid из 10 символов A-Za-z0-9. Внутренние числовые ID наружу не отдаём. */
export const PublicId = z
  .string()
  .regex(/^[A-Za-z0-9]{10}$/)
  .meta({ id: 'PublicId', description: 'Публичный идентификатор (10 символов A-Za-z0-9)', example: 'K3f9QpZ2aB' });

/** Дата и время ISO 8601 с часовым поясом. Ответы API — в UTC (Z). */
export const DateTime = z.iso
  .datetime({ offset: true })
  .meta({ id: 'DateTime', description: 'Дата и время ISO 8601 с часовым поясом', example: '2026-09-27T14:40:00Z' });

/** Ошибка в формате application/problem+json (RFC 9457). */
export const Problem = z
  .object({
    type: z.string().meta({ example: 'urn:vsemdomom:problem:not_found' }),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    code: z.string().meta({ description: 'Машинный код ошибки', example: 'not_found' }),
    traceId: z.string().meta({ description: 'Идентификатор запроса (совпадает с X-Request-Id)' }),
  })
  .catchall(z.unknown())
  .meta({ id: 'Problem', description: 'Ошибка API (RFC 9457)' });
export type Problem = z.infer<typeof Problem>;
