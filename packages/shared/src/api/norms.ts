import { z } from 'zod';
import {
  CalcStrategySchema,
  NormEventSchema,
  NormUnitSchema,
  RoundModeSchema,
  ServiceTypeSchema,
} from './enums.ts';

const IsoDate = z.iso.date().meta({ example: '2026-09-23' });

/** Основание числа: документ, пункт, формулировка и редакция (шторка S06). */
export const NormBasisSchema = z
  .object({
    code: z.string().meta({ description: 'Код нормы в справочнике', example: 'pp416.p13.localize.hot_water' }),
    title: z.string().meta({ example: 'Локализовать аварию' }),
    doc: z.string().meta({ example: 'ПП № 416' }),
    point: z.string().meta({ example: 'п. 13' }),
    textPlain: z.string().meta({ description: 'Формулировка простыми словами' }),
    quote: z.string().nullable().meta({ description: 'Цитата из первоисточника' }),
    edition: IsoDate.meta({ description: 'Дата редакции документа' }),
    validFrom: IsoDate,
    validTo: IsoDate.nullable(),
    checkedAt: IsoDate.nullable().meta({ description: 'Когда норма сверена с первоисточником' }),
    sourceUrl: z.url(),
  })
  .meta({ id: 'NormBasis' });
export type NormBasis = z.infer<typeof NormBasisSchema>;

export const NormSchema = z
  .object({
    code: z.string(),
    service: ServiceTypeSchema.nullable().meta({ description: 'null — норма для любой услуги' }),
    event: NormEventSchema,
    title: z.string(),
    value: z.number().meta({ description: 'Значение в единицах unit', example: 30 }),
    unit: NormUnitSchema,
    ratePercent: z.number().nullable().meta({ description: 'Снижение платы, % за час сверх нормы', example: 0.15 }),
    calcStrategy: CalcStrategySchema.nullable(),
    round: RoundModeSchema.nullable().meta({ description: 'Округление неполного часа' }),
    regionCode: z.string().nullable().meta({ description: 'null — федеральная норма' }),
    condition: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .nullable()
      .meta({ description: 'Условие применения по параметрам дома', example: { power_sources: 2 } }),
    basis: NormBasisSchema,
  })
  .meta({ id: 'Norm' });
export type Norm = z.infer<typeof NormSchema>;

export const NormsQuerySchema = z.object({
  service: ServiceTypeSchema.optional(),
  region: z.string().optional().meta({ description: 'Код региона; без него — федеральные нормы' }),
});

export const NormsResponseSchema = z.array(NormSchema).meta({ id: 'NormsResponse' });
