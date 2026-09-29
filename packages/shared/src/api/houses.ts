import { z } from 'zod';
import { DateTime, PublicId } from './common.ts';
import { ServiceTypeSchema } from './enums.ts';
import { NormBasisSchema } from './norms.ts';

/** Краткие сведения о доме — доступны любому вошедшему пользователю (выбор дома на S02). */
export const HouseSummarySchema = z
  .object({
    id: PublicId,
    label: z.string().meta({ description: 'Короткое имя для текстов: «Дом {label}»', example: '1' }),
    address: z.string().meta({ example: 'ул. Садовая, 1' }),
    city: z.string(),
    timezone: z.string().meta({ description: 'Часовой пояс IANA; все времена показываются в нём', example: 'Europe/Moscow' }),
    entrances: z.int().positive(),
    floors: z.int().positive(),
    flatFrom: z.int().positive(),
    flatTo: z.int().positive(),
    isModel: z.boolean().meta({ description: 'Модельные данные — показывать плашку' }),
  })
  .meta({ id: 'HouseSummary' });
export type HouseSummary = z.infer<typeof HouseSummarySchema>;

export const HouseSearchQuerySchema = z.object({
  q: z.string().max(100).optional().meta({ description: 'Часть адреса; пусто — все модельные дома' }),
});

export const HouseSearchResponseSchema = z
  .object({ items: z.array(HouseSummarySchema) })
  .meta({ id: 'HouseSearchResponse' });

export const HouseChatInfoSchema = z
  .object({
    bound: z.boolean().meta({ description: 'Чат дома привязан к сервису' }),
    title: z.string().nullable(),
    inviteLink: z.string().nullable().meta({ description: 'Ссылка на чат (поле link объекта чата MAX)' }),
    participantsCount: z.int().nullable(),
  })
  .meta({ id: 'HouseChatInfo' });

/** Перерывы услуги за календарный месяц против лимита (S03 «Этот месяц», U06). */
export const MonthServiceSchema = z
  .object({
    service: ServiceTypeSchema,
    totalMinutes: z.int().nonnegative(),
    limitMinutes: z.int().nullable().meta({ description: 'null — норматив не установлен' }),
    excessMinutes: z.int().nonnegative(),
    norm: NormBasisSchema.nullable(),
  })
  .meta({ id: 'MonthService' });

export const HouseMonthSummarySchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/).meta({ example: '2026-09' }),
    scope: z.enum(['flat', 'house']).meta({ description: 'flat — по квартире пользователя, house — по авариям всего дома' }),
    services: z.array(MonthServiceSchema).meta({ description: 'Только услуги с перерывами в этом месяце' }),
  })
  .meta({ id: 'HouseMonthSummary' });

export const HouseMonthQuerySchema = z.object({
  service: ServiceTypeSchema,
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .meta({ description: 'Месяц YYYY-MM в часовом поясе дома; по умолчанию текущий' }),
});

export const HouseMonthResponseSchema = z
  .object({
    month: z.string(),
    service: ServiceTypeSchema,
    scope: z.enum(['flat', 'house']),
    timezone: z.string(),
    intervals: z.array(
      z.object({
        incidentId: PublicId,
        from: DateTime,
        to: DateTime,
        minutes: z.int().nonnegative(),
        ongoing: z.boolean().meta({ description: 'Авария ещё идёт: конец — «сейчас»' }),
      }),
    ),
    totalMinutes: z.int().nonnegative().meta({ description: 'Объединение интервалов: пересечения не складываются дважды' }),
    single: z
      .object({ limitMinutes: z.int(), longestMinutes: z.int(), exceeded: z.boolean(), norm: NormBasisSchema })
      .nullable(),
    monthly: z
      .object({ limitMinutes: z.int(), excessMinutes: z.int().nonnegative(), norm: NormBasisSchema })
      .nullable(),
  })
  .meta({ id: 'HouseMonthResponse' });
