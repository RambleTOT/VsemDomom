import { STARTED_PRESETS } from '@vsemdomom/core/enums';
import { z } from 'zod';
import { DateTime, PublicId } from './common.ts';
import {
  ActorTypeSchema,
  DeadlineKindSchema,
  DeadlineStateSchema,
  DisplayStatusSchema,
  EventSourceSchema,
  IncidentEventTypeSchema,
  IncidentScopeSchema,
  IncidentStatusSchema,
  RestoredAnswerSchema,
  RestoredSourceSchema,
  RoundModeSchema,
  ServiceTypeSchema,
  TrustLevelSchema,
} from './enums.ts';
import { NormBasisSchema } from './norms.ts';

// ---------- Составные части аварии ----------

export const DeadlineSchema = z
  .object({
    kind: DeadlineKindSchema,
    title: z.string().meta({ example: 'Локализовать аварию' }),
    state: DeadlineStateSchema,
    dueAt: DateTime,
    warnAt: DateTime,
    doneAt: DateTime.nullable().meta({ description: 'Когда срок выполнен (для met) или истёк (для breached)' }),
    anchor: z.enum(['ads_registration', 'service_report', 'started']).meta({
      description:
        'От чего отсчитан срок: ads_registration — от регистрации в АДС; service_report — от сообщения в сервисе (подпись «от регистрации в сервисе»); started — от начала аварии',
    }),
    norm: NormBasisSchema,
  })
  .meta({ id: 'Deadline' });
export type Deadline = z.infer<typeof DeadlineSchema>;

/** Первая строка карточки и экрана: знает ли УК и когда (IncidentHeadline). */
export const HeadlineSchema = z
  .object({
    displayStatus: DisplayStatusSchema,
    eta: DateTime.nullable().meta({ description: 'Ориентир УК' }),
    nextDeadline: DeadlineSchema.nullable().meta({ description: 'Ближайший невыполненный срок по нормативу' }),
    statusAt: DateTime.nullable().meta({
      description: 'Время текущего статуса: бригада на месте, локализована, устранена или закрыта',
    }),
    discrepancyFlats: z.int().nonnegative().meta({ description: 'Сколько квартир ответили «Нет» (актуально)' }),
    unconfirmedRestoreFlats: z
      .int()
      .nonnegative()
      .meta({ description: 'Закрыта с расхождением: у скольких квартир восстановление не подтверждено' }),
    durationMinutes: z.int().nonnegative().nullable().meta({ description: 'Для закрытой: длительность по отметке УК' }),
  })
  .meta({ id: 'Headline' });

export const EntranceCountSchema = z
  .object({ entrance: z.int().positive(), count: z.int().nonnegative() })
  .meta({ id: 'EntranceCount' });

export const IncidentHouseRefSchema = z
  .object({
    id: PublicId,
    label: z.string(),
    address: z.string(),
    timezone: z.string(),
    entrances: z.int().positive(),
    isModel: z.boolean(),
  })
  .meta({ id: 'IncidentHouseRef' });

export const IncidentSummarySchema = z
  .object({
    id: PublicId,
    house: IncidentHouseRefSchema,
    service: ServiceTypeSchema,
    scope: IncidentScopeSchema,
    entrance: z.int().positive().nullable().meta({ description: 'Подъезд для масштаба entrance' }),
    status: IncidentStatusSchema,
    displayStatus: DisplayStatusSchema,
    headline: HeadlineSchema,
    startedAt: DateTime,
    createdAt: DateTime,
    eta: DateTime.nullable(),
    overdue: z.boolean().meta({ description: 'Истёк хотя бы один срок по нормативу' }),
    singleLimitExceeded: z.boolean(),
    discrepancyUnresolved: z.boolean(),
    participantsCount: z.int().nonnegative().meta({ description: 'Отметились «у меня тоже» (жители, включая не подтверждённых)' }),
    flatsCount: z.int().nonnegative().meta({ description: 'Квартиры зарегистрированных участников' }),
    byEntrance: z.array(EntranceCountSchema),
    joined: z.boolean().nullable().meta({ description: 'Текущий пользователь отметился; null — для сотрудника УК' }),
    closedAt: DateTime.nullable(),
    isModel: z.boolean(),
  })
  .meta({ id: 'IncidentSummary' });
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

export const CountersSchema = z
  .object({
    participants: z.int().nonnegative(),
    flats: z.int().nonnegative(),
    unconfirmed: z.int().nonnegative().meta({ description: 'Уровень доверия 0 или не зарегистрированы' }),
    byEntrance: z.array(EntranceCountSchema),
    unknownEntrance: z.int().nonnegative().meta({ description: '«Не знаю подъезд»' }),
    notMe: z.int().nonnegative().meta({ description: 'Ответили «Не у меня»' }),
    answers: z
      .object({ yes: z.int().nonnegative(), no: z.int().nonnegative(), weak: z.int().nonnegative() })
      .meta({ description: 'Актуальные ответы на вопрос о восстановлении' }),
    brigade: z
      .object({ confirmed: z.int().nonnegative(), absent: z.int().nonnegative() })
      .meta({ description: 'Отметки жителей «Подтверждаю» / «Бригады нет»' }),
  })
  .meta({ id: 'Counters' });

export const StatusStepSchema = z
  .object({
    step: z.enum(['reported', 'accepted', 'brigade_on_site', 'localized', 'resolved', 'closed']),
    state: z.enum(['done', 'skipped', 'current', 'pending']),
    at: DateTime.nullable(),
  })
  .meta({ id: 'StatusStep' });

export const TimelineEventSchema = z
  .object({
    type: IncidentEventTypeSchema,
    at: DateTime,
    actorType: ActorTypeSchema,
    source: EventSourceSchema,
    mine: z.boolean().meta({ description: 'Событие текущего пользователя' }),
    payload: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Данные события без ПДн: подъезд, ориентир, номер заявки АДС, пропущенные шаги и т. п.' }),
  })
  .meta({ id: 'TimelineEvent' });

export const MyParticipationSchema = z
  .object({
    joined: z.boolean(),
    notMe: z.boolean().meta({ description: 'Ответил «Не у меня»' }),
    entrance: z.int().positive().nullable(),
    floor: z.int().positive().nullable(),
    notify: z.boolean().meta({ description: '«Уведомлять меня»: личные сообщения о смене статуса и сроков' }),
    restoredAnswer: RestoredAnswerSchema.nullable(),
    restoredAt: DateTime.nullable(),
    restoredSource: RestoredSourceSchema.nullable(),
    adsRereport: z.object({ number: z.string().nullable(), at: DateTime }).nullable(),
    readyToSign: z.boolean(),
    introOptIn: z.boolean(),
    isAuthor: z.boolean(),
    trustLevel: TrustLevelSchema.nullable().meta({ description: 'null — не зарегистрирован' }),
  })
  .meta({ id: 'MyParticipation' });

export const AdsInfoSchema = z
  .object({
    phone: z.string().meta({ description: 'Телефон АДС (модельные данные)' }),
    registration: z
      .object({
        number: z.string().nullable(),
        at: DateTime.nullable(),
        notReached: z.boolean().meta({ description: '«Не дозвонился» — записано как попытка' }),
      })
      .nullable(),
    reminderAt: DateTime.nullable().meta({ description: 'Когда напомнить ввести номер заявки (если пропущен)' }),
  })
  .meta({ id: 'AdsInfo' });

export const CheckInfoSchema = z
  .object({
    askedAt: DateTime,
    repeated: z.boolean().meta({ description: 'Повторная проверка после повторного «Устранено»' }),
    windowEndsAt: DateTime.nullable().meta({ description: 'Когда истечёт окно проверки (закрытие без «Нет»)' }),
    discrepancyDeadlineAt: DateTime.nullable().meta({ description: 'Предельный срок расхождения' }),
  })
  .meta({ id: 'CheckInfo' });

export const ActInfoSchema = z
  .object({
    available: z.boolean().meta({ description: 'Можно готовить акт без исполнителя: проверка не пришла в срок' }),
    checkDueAt: DateTime.nullable().meta({ description: 'Срок проверки по сообщению в АДС (п. 108)' }),
    requiredConsumers: z.int().positive().meta({ description: 'Сколько потребителей нужно (из справочника норм)' }),
    readyCount: z.int().nonnegative(),
    myReady: z.boolean(),
    introOptIn: z.boolean(),
    norm: NormBasisSchema,
  })
  .meta({ id: 'ActInfo' });

export const IncidentDetailSchema = IncidentSummarySchema.extend({
  version: z.int().positive().meta({ description: 'Версия для If-Match' }),
  ads: AdsInfoSchema,
  deadlines: z.array(DeadlineSchema),
  counters: CountersSchema,
  steps: z.array(StatusStepSchema).meta({ description: 'Шаги для StatusStepper с пропущенными' }),
  timeline: z.array(TimelineEventSchema).meta({ description: 'Хронология, новые сверху' }),
  me: MyParticipationSchema.nullable(),
  check: CheckInfoSchema.nullable(),
  act: ActInfoSchema.nullable().meta({ description: 'null, если функция выключена или акт не нужен' }),
  brigadeOnSiteAt: DateTime.nullable(),
  localizedAt: DateTime.nullable(),
  resolvedAtUk: DateTime.nullable(),
  mergedInto: PublicId.nullable(),
  cardInChat: z.boolean().meta({ description: 'У аварии есть карточка в чате дома' }),
}).meta({ id: 'IncidentDetail' });
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

export const IncidentIdParams = z.object({ id: PublicId });

// ---------- Запросы жителя ----------

export const StartedPresetSchema = z
  .enum(STARTED_PRESETS)
  .meta({ id: 'StartedPreset', description: 'Быстрый выбор начала: «сейчас», «1 ч назад», «3 ч назад», «12 ч назад» или своё время' });

export const CreateIncidentRequestSchema = z
  .object({
    houseId: PublicId,
    service: ServiceTypeSchema,
    scope: IncidentScopeSchema,
    entrance: z.int().positive().optional().meta({ description: 'Подъезд автора; обязателен для scope=entrance' }),
    floor: z.int().positive().optional(),
    startedPreset: StartedPresetSchema.optional().meta({ description: 'По умолчанию now; для custom нужен startedAt' }),
    startedAt: DateTime.optional(),
    confirmOld: z.boolean().optional().meta({ description: 'Подтверждение, что начало раньше чем 24 часа назад' }),
  })
  .meta({ id: 'CreateIncidentRequest' });
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequestSchema>;

export const JoinRequestSchema = z
  .object({ entrance: z.int().positive().optional(), floor: z.int().positive().optional() })
  .meta({ id: 'JoinRequest' });

export const JoinResponseSchema = IncidentDetailSchema.extend({
  joinResult: z.enum(['joined', 'already_joined', 'updated']).meta({
    description: 'already_joined — «Вы уже отметились», счётчики не менялись; updated — изменён подъезд или этаж',
  }),
}).meta({ id: 'JoinResponse' });

export const AdsRegistrationRequestSchema = z
  .object({
    number: z.string().trim().min(1).max(64).optional().meta({ description: 'Номер заявки АДС' }),
    registeredAt: DateTime.optional().meta({ description: 'Время регистрации; по умолчанию — сейчас' }),
    notReached: z.boolean().optional().meta({ description: '«Не дозвонился»' }),
    remindLater: z.boolean().optional().meta({ description: '«Заполню позже» — одно напоминание через 30 минут' }),
  })
  .meta({
    id: 'AdsRegistrationRequest',
    description:
      'До устранения — регистрация аварии в АДС (дедлайны пересчитываются от её времени). После ответа «Нет» — повторное сообщение в АДС (п. 108, таймер проверки).',
  });

export const ObservationRequestSchema = z
  .object({
    kind: z.enum(['brigade_confirmed', 'brigade_absent', 'restored_yes', 'restored_no', 'restored_weak']).meta({
      description:
        'brigade_* — «Подтверждаю» / «Бригады нет» (только в статусе brigade_on_site, флаг brigadeConfirm); restored_* — ответ на вопрос о восстановлении (checking, discrepancy), действует последний',
    }),
    viaAds: z
      .object({ number: z.string().trim().min(1).max(64).optional(), at: DateTime.optional() })
      .optional()
      .meta({ description: 'Для restored_yes: восстановление подтверждено сообщением в АДС' }),
  })
  .meta({ id: 'ObservationRequest' });

export const ParticipationPatchSchema = z.object({ notify: z.boolean() }).meta({ id: 'ParticipationPatch' });
export const ParticipationResponseSchema = z.object({ notify: z.boolean() }).meta({ id: 'ParticipationResponse' });

// ---------- Итог, расчёт, заявление ----------

export const ResultSchema = z
  .object({
    incidentId: PublicId,
    service: ServiceTypeSchema,
    house: IncidentHouseRefSchema,
    displayStatus: DisplayStatusSchema,
    startedAt: DateTime,
    uk: z
      .object({ resolvedAt: DateTime, durationMinutes: z.int().nonnegative() })
      .meta({ description: 'По отметке УК «Устранено»' }),
    my: z
      .object({
        flatNo: z.int().positive(),
        restoredAt: DateTime,
        durationMinutes: z.int().nonnegative(),
        source: RestoredSourceSchema,
      })
      .nullable()
      .meta({ description: 'Для квартиры пользователя; null — пользователь не житель этого дома' }),
    single: z
      .object({ limitMinutes: z.int(), longestMinutes: z.int(), exceeded: z.boolean(), norm: NormBasisSchema })
      .nullable()
      .meta({ description: 'Единовременный лимит — флаг, на сумму не влияет' }),
    month: z
      .object({
        month: z.string(),
        totalMinutes: z.int().nonnegative(),
        limitMinutes: z.int(),
        excessMinutes: z.int().nonnegative(),
        withinNorm: z.boolean(),
        norm: NormBasisSchema,
      })
      .nullable()
      .meta({ description: 'Месячный лимит, от него зависят деньги; null — норматив не установлен' }),
    flatsCount: z.int().nonnegative(),
    lateFlats: z
      .object({ count: z.int().nonnegative(), lastRestoredAt: DateTime.nullable() })
      .meta({ description: 'Квартиры с более поздним восстановлением, чем отметка УК' }),
    eligibleFlats: z.int().nonnegative().meta({ description: 'Сколько квартир могут оформить перерасчёт (сверх месячной нормы)' }),
    actCopyNorm: NormBasisSchema.nullable().meta({ description: 'Копия акта о нарушении качества — ПП № 416, п. 34' }),
    disclaimer: z.string().meta({ example: 'Это расчёт по нормам, итог определяет исполнитель услуги' }),
  })
  .meta({ id: 'IncidentResult' });

export const RecalculationRequestSchema = z
  .object({
    monthlyCharge: z.number().positive().meta({ description: 'Плата за услугу за месяц из квитанции, ₽', example: 1200 }),
  })
  .meta({ id: 'RecalculationRequest', description: 'Сумма ≤ 0 или не число → 422 monthly_charge_invalid' });

export const RecalculationResponseSchema = z
  .object({
    incidentId: PublicId,
    service: ServiceTypeSchema,
    month: z.string().meta({ example: '2026-09' }),
    preliminary: z.boolean().meta({ description: 'Авария ещё не закрыта: расчёт на текущий момент' }),
    monthlyCharge: z.number(),
    totalMinutes: z.int().nonnegative(),
    limitMinutes: z.int().nullable(),
    excessMinutes: z.int().nonnegative(),
    excessHours: z.number().nonnegative().meta({ description: 'Часы сверх нормы после округления по справочнику', example: 4 }),
    round: RoundModeSchema,
    ratePercent: z.number().nonnegative().meta({ example: 0.15 }),
    amount: z.number().nonnegative().meta({ description: 'Сумма, ₽ (банковское округление до копеек); 0 — перерасчёт не положен', example: 7.2 }),
    withinNorm: z.boolean(),
    singleLimitExceeded: z.boolean(),
    formula: z.string().meta({ example: '4 ч × 0,15 % × 1 200 ₽ = 7,20 ₽' }),
    norm: NormBasisSchema.nullable(),
    disclaimer: z.string(),
  })
  .meta({ id: 'RecalculationResponse' });

export const SendToDmRequestSchema = z
  .object({
    text: z.string().min(1).max(4000).meta({ description: 'Текст заявления; на сервере не сохраняется и не логируется' }),
  })
  .meta({ id: 'SendToDmRequest' });

export const SendToDmResponseSchema = z.object({ sent: z.literal(true) }).meta({ id: 'SendToDmResponse' });

export const ActReadyRequestSchema = z
  .object({
    ready: z.boolean().meta({ description: '«Я готов подписать»' }),
    introOptIn: z.boolean().optional().meta({ description: '«Познакомить меня с другими, кто готов подписать»' }),
  })
  .meta({ id: 'ActReadyRequest' });
