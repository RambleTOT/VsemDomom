import { FEATURE_FLAGS } from '@vsemdomom/core';
import { z } from 'zod';

export const HealthResponse = z.object({ status: z.literal('ok') }).meta({ id: 'HealthResponse' });

export const ReadyResponse = z
  .object({
    status: z.enum(['ok', 'fail']),
    checks: z.record(z.string(), z.string()).meta({ description: 'Результат по каждой зависимости: ok или причина' }),
  })
  .meta({ id: 'ReadyResponse' });

export const FeatureFlagsSchema = z
  .object(Object.fromEntries(FEATURE_FLAGS.map((f) => [f, z.boolean()])) as Record<(typeof FEATURE_FLAGS)[number], z.ZodBoolean>)
  .meta({ id: 'FeatureFlags', description: 'Флаги функций волн 2–3: что включено в этой версии' });

export const VersionResponse = z
  .object({
    commit: z.string().meta({ example: 'a1b2c3d' }),
    builtAt: z.string().nullable(),
    maxMode: z.enum(['simulator', 'polling', 'webhook']),
    demoMode: z.boolean(),
    features: FeatureFlagsSchema,
    botLink: z.string().meta({ description: 'Ссылка на бота в MAX — для экрана «Откройте приложение в MAX» вне MAX', example: 'https://max.ru/vsemdomom_bot' }),
  })
  .meta({ id: 'VersionResponse' });
export type VersionResponse = z.infer<typeof VersionResponse>;
