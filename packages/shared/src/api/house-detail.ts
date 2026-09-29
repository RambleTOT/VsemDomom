import { z } from 'zod';
import { HouseChatInfoSchema, HouseMonthSummarySchema, HouseSummarySchema } from './houses.ts';
import { IncidentSummarySchema } from './incidents.ts';
import { ResidencySchema } from './me.ts';

/** Закрытая авария в «Последних итогах»: сколько квартир вышли за месячную норму (могут оформить перерасчёт). */
export const RecentResultSchema = IncidentSummarySchema.extend({
  overNormFlats: z.int().nonnegative().meta({ description: 'Квартиры участников сверх месячной нормы — могут оформить перерасчёт' }),
}).meta({ id: 'RecentResult' });
export type RecentResult = z.infer<typeof RecentResultSchema>;

/** Главная жителя (S03): дом, активные аварии, последние итоги, месяц против лимита, чат. */
export const HouseDetailSchema = HouseSummarySchema.extend({
  uk: z.object({ name: z.string(), adsPhone: z.string(), isModel: z.boolean() }),
  chat: HouseChatInfoSchema.nullable(),
  activeIncidents: z.array(IncidentSummarySchema),
  recentResults: z.array(RecentResultSchema).meta({ description: 'Последние закрытые аварии (до 3)' }),
  month: HouseMonthSummarySchema,
  myResidency: ResidencySchema.nullable(),
}).meta({ id: 'HouseDetail' });
export type HouseDetail = z.infer<typeof HouseDetailSchema>;
