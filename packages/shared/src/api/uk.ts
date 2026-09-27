import { z } from 'zod';
import { DateTime, PublicId } from './common.ts';
import { HouseChatInfoSchema, HouseMonthSummarySchema, MonthServiceSchema } from './houses.ts';
import { IncidentDetailSchema, IncidentSummarySchema } from './incidents.ts';
import { ResidencyRoleSchema, ResidencySourceSchema, TrustLevelSchema } from './enums.ts';
import { NormBasisSchema } from './norms.ts';

// ---------- Аварии (U01, U02) ----------

export const UkIncidentsQuerySchema = z.object({
  status: z
    .enum(['open', 'expired', 'closed'])
    .optional()
    .meta({ description: 'open — открытые; expired — открытые с истёкшим сроком; closed — закрытые и объединённые. По умолчанию open' }),
  houseId: PublicId.optional(),
});

export const UkIncidentsResponseSchema = z
  .object({
    items: z.array(IncidentSummarySchema).meta({
      description: 'Сортировка: срок истёк → срок подходит → новые → остальные',
    }),
    counts: z.object({ open: z.int(), expired: z.int(), closed: z.int() }),
    houses: z.array(
      z.object({ id: PublicId, label: z.string(), address: z.string(), openCount: z.int().nonnegative() }),
    ),
  })
  .meta({ id: 'UkIncidentsResponse' });

export const UkActionSchema = z
  .enum(['accept', 'brigade_on_site', 'localize', 'resolve', 'merge'])
  .meta({ id: 'UkAction' });

export const EntranceFloorGridSchema = z
  .object({
    entrances: z.int().positive(),
    floors: z.int().positive(),
    cells: z.array(z.object({ entrance: z.int(), floor: z.int(), count: z.int().positive() })).meta({
      description: 'Только непустые ячейки «подъезд × этаж»',
    }),
    unknownFloor: z.array(z.object({ entrance: z.int(), count: z.int().positive() })),
    unknownEntrance: z.int().nonnegative(),
  })
  .meta({ id: 'EntranceFloorGrid' });

export const UkIncidentDetailSchema = IncidentDetailSchema.extend({
  grid: EntranceFloorGridSchema,
  people: z.object({
    total: z.int().nonnegative(),
    confirmed: z.int().nonnegative().meta({ description: 'Уровни доверия 1–2' }),
    unconfirmed: z.int().nonnegative(),
    notMe: z.int().nonnegative(),
    answers: z.object({ yes: z.int(), no: z.int(), weak: z.int() }),
  }),
  allowedActions: z.array(UkActionSchema).meta({ description: 'Допустимые переходы из текущего статуса' }),
  nextAction: UkActionSchema.nullable().meta({ description: 'Главная кнопка — следующий шаг' }),
  mergeCandidates: z.array(IncidentSummarySchema).meta({ description: 'Открытые аварии того же вида в доме' }),
  cardUpdate: z
    .enum(['queued', 'none'])
    .meta({ description: 'queued — правка карточки в чате поставлена в очередь; none — у аварии нет карточки' }),
}).meta({ id: 'UkIncidentDetail' });

export const UkStatusRequestSchema = z
  .object({
    status: z
      .enum(['accepted', 'brigade_on_site', 'localized', 'resolved'])
      .meta({ description: 'resolved — «Устранено»: авария переходит в checking (в песочнице — сразу closed)' }),
    eta: DateTime.optional().meta({ description: 'Ориентир УК; обязателен для accepted' }),
  })
  .meta({ id: 'UkStatusRequest' });

export const IfMatchHeaders = z.object({
  'if-match': z
    .string()
    .optional()
    .meta({ description: 'Версия аварии (поле version). Устаревшая → 409 version_conflict. Мини-приложение передаёт всегда' }),
});

export const IdempotencyHeaders = z.object({
  'idempotency-key': z
    .string()
    .min(8)
    .max(128)
    .optional()
    .meta({ description: 'Повтор с тем же ключом возвращает первый ответ' }),
});

export const UkMergeRequestSchema = z.object({ intoId: PublicId }).meta({ id: 'UkMergeRequest' });

// ---------- Дома (U03, U05, U06) ----------

export const UkHouseSchema = z
  .object({
    id: PublicId,
    label: z.string(),
    address: z.string(),
    entrances: z.int(),
    floors: z.int(),
    flatFrom: z.int(),
    flatTo: z.int(),
    isModel: z.boolean(),
    isSandbox: z.boolean().meta({ description: 'Дом-песочница API: виден только checker-УК' }),
    chat: HouseChatInfoSchema.extend({ botIsAdmin: z.boolean() }).nullable(),
    activeIncidents: z.int().nonnegative(),
    pendingResidents: z.int().nonnegative(),
  })
  .meta({ id: 'UkHouse' });

export const UkHousesResponseSchema = z.object({ items: z.array(UkHouseSchema) }).meta({ id: 'UkHousesResponse' });

export const MonthlySummarySchema = z
  .object({
    month: z.string(),
    incidents: z.int().nonnegative(),
    inNorm: z.int().nonnegative().meta({ description: 'Устранено в норматив' }),
    avgAcceptMinutes: z.int().nonnegative().nullable().meta({ description: 'Среднее время до «Принято»' }),
    discrepancies: z.int().nonnegative(),
    services: z.array(MonthServiceSchema),
  })
  .meta({ id: 'MonthlySummary' });

export const UkHouseDetailSchema = UkHouseSchema.extend({
  timezone: z.string(),
  month: HouseMonthSummarySchema,
  monthlySummary: MonthlySummarySchema.nullable().meta({ description: 'U06; null при выключенном флаге monthlySummary' }),
  demo: z
    .object({ activeIncidentId: PublicId.nullable() })
    .nullable()
    .meta({ description: 'Блок демо-инструментов: только DEMO_MODE, модельный дом и демо-роль' }),
}).meta({ id: 'UkHouseDetail' });

export const ChatBindingInfoSchema = z
  .object({
    chatTitle: z.string().nullable(),
    status: z.enum(['active', 'used', 'expired']),
    expiresAt: DateTime,
  })
  .meta({ id: 'ChatBindingInfo' });

export const ChatBindingRequestSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), houseId: PublicId })
  .meta({ id: 'ChatBindingRequest', description: 'Одноразовый токен из payload c_<токен>' });

export const ChatBindingResponseSchema = z
  .object({
    house: UkHouseSchema,
    panelPublished: z.boolean(),
    pinned: z.boolean().meta({ description: 'false — бот не администратор, панель опубликована без закрепа' }),
  })
  .meta({ id: 'ChatBindingResponse' });

export const HeatMapSchema = z
  .object({
    houseId: PublicId,
    poll: z.object({ startedAt: DateTime, closedAt: DateTime.nullable() }).nullable(),
    entrances: z.int(),
    floors: z.int(),
    cells: z.array(
      z.object({
        entrance: z.int(),
        floor: z.int(),
        warm: z.int().nonnegative(),
        luke: z.int().nonnegative(),
        cold: z.int().nonnegative(),
      }),
    ),
    answered: z.int().nonnegative(),
    totalFlats: z.int().nonnegative(),
    norm: NormBasisSchema.nullable().meta({ description: 'Температура в квартире — прил. 1, п. 15' }),
  })
  .meta({ id: 'HeatMap' });

export const HeatingPollResponseSchema = z
  .object({ startedAt: DateTime })
  .meta({ id: 'HeatingPollResponse', description: '202: опрос поставлен в очередь (в тихие часы — отложен)' });

// ---------- Подтверждение жильцов (U04) ----------

export const ResidentsQuerySchema = z.object({
  status: z.enum(['pending']).optional(),
  houseId: PublicId.optional(),
});

export const ResidentRequestSchema = z
  .object({
    id: PublicId,
    house: z.object({ id: PublicId, label: z.string(), address: z.string() }),
    flatNo: z.int(),
    role: ResidencyRoleSchema,
    trustLevel: TrustLevelSchema,
    source: ResidencySourceSchema.nullable(),
    createdAt: DateTime,
  })
  .meta({ id: 'ResidentRequest', description: 'Без имён: сервис их не хранит' });

export const ResidentsResponseSchema = z
  .object({ items: z.array(ResidentRequestSchema) })
  .meta({ id: 'ResidentsResponse' });

export const ResidentDecisionResponseSchema = z
  .object({ id: PublicId, trustLevel: TrustLevelSchema, reviewStatus: z.enum(['confirmed', 'rejected']) })
  .meta({ id: 'ResidentDecisionResponse' });

// ---------- Демо-инструменты ----------

export const DemoNeighboursResponseSchema = z
  .object({ incidentId: PublicId, added: z.int().nonnegative() })
  .meta({ id: 'DemoNeighboursResponse' });

export const DemoResetResponseSchema = z
  .object({ houseId: PublicId, removedIncidents: z.int().nonnegative() })
  .meta({ id: 'DemoResetResponse' });

export const HouseIdParams = z.object({ id: PublicId });
export const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/) });

