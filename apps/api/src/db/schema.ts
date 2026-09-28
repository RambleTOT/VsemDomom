/**
 * Схема БД (drizzle). Все времена — timestamptz в UTC; показываются в часовом поясе дома.
 * ПДн: храним только идентификатор MAX, дом, квартиру и роль — без имён, телефонов
 * и текстов заявлений.
 */
import {
  ACTOR_TYPES,
  CALC_STRATEGIES,
  DEADLINE_KINDS,
  DEADLINE_STATUSES,
  EVENT_SOURCES,
  INCIDENT_EVENT_TYPES,
  INCIDENT_KINDS,
  INCIDENT_SCOPES,
  INCIDENT_STATUSES,
  NORM_EVENTS,
  NORM_UNITS,
  OPEN_STATUSES,
  OUTBOUND_KINDS,
  OUTBOUND_STATUSES,
  POLL_TYPES,
  RESIDENCY_REVIEW_STATUSES,
  RESIDENCY_ROLES,
  RESIDENCY_SOURCES,
  RESTORED_ANSWERS,
  RESTORED_SOURCES,
  ROUND_MODES,
  SERVICE_TYPES,
  STAFF_ROLES,
  type ActorType,
  type CalcStrategy,
  type DeadlineKind,
  type DeadlineStatus,
  type EventSource,
  type IncidentEventType,
  type IncidentKind,
  type IncidentScope,
  type IncidentStatus,
  type NormEvent,
  type NormUnit,
  type OutboundKind,
  type OutboundStatus,
  type PollType,
  type ResidencyReviewStatus,
  type ResidencyRole,
  type ResidencySource,
  type RestoredAnswer,
  type RestoredSource,
  type RoundMode,
  type ServiceType,
  type StaffRole,
  type TrustLevel,
} from '@vsemdomom/core';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** CHECK column IN (...) по списку констант перечисления (значения — наши литералы). */
function oneOf(column: AnyPgColumn, values: readonly (string | number)[]): SQL {
  const list = values.map((v) => (typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`)).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const maxId = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => tstz('created_at').notNull().defaultNow();

export const managementCompany = pgTable(
  'management_company',
  {
    id: id(),
    publicId: text('public_id').notNull().unique(),
    name: text('name').notNull(),
    adsPhone: text('ads_phone').notNull(),
    regionCode: text('region_code'),
    isModel: boolean('is_model').notNull().default(false),
    createdAt: createdAt(),
  },
);

export const house = pgTable(
  'house',
  {
    id: id(),
    publicId: text('public_id').notNull().unique(),
    ukId: bigint('uk_id', { mode: 'number' })
      .notNull()
      .references(() => managementCompany.id),
    /** Короткое имя для сообщений: «Дом {label}». */
    label: text('label').notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    /** Часовой пояс IANA, например Europe/Moscow. */
    timezone: text('timezone').notNull(),
    /** Код региона для региональных редакций норм; null — федеральные. */
    regionCode: text('region_code'),
    entrances: integer('entrances').notNull(),
    floors: integer('floors').notNull(),
    flatsPerFloor: integer('flats_per_floor').notNull(),
    flatFrom: integer('flat_from').notNull(),
    flatTo: integer('flat_to').notNull(),
    powerSources: smallint('power_sources').notNull().default(2),
    hotWaterDeadEnd: boolean('hot_water_dead_end').notNull().default(false),
    isModel: boolean('is_model').notNull().default(false),
    isSandbox: boolean('is_sandbox').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check('house_flat_range', sql`${t.flatFrom} <= ${t.flatTo}`),
    check('house_entrances_positive', sql`${t.entrances} >= 1 and ${t.floors} >= 1 and ${t.flatsPerFloor} >= 1`),
    check('house_power_sources', oneOf(t.powerSources, [1, 2])),
  ],
);

export const houseChat = pgTable(
  'house_chat',
  {
    houseId: bigint('house_id', { mode: 'number' })
      .primaryKey()
      .references(() => house.id, { onDelete: 'cascade' }),
    chatId: maxId('chat_id').notNull().unique(),
    title: text('title'),
    inviteLink: text('invite_link'),
    botIsAdmin: boolean('bot_is_admin').notNull().default(false),
    botPermissions: text('bot_permissions').array(),
    panelMid: text('panel_mid'),
    panelRenderHash: text('panel_render_hash'),
    panelPinned: boolean('panel_pinned').notNull().default(false),
    panelEditedAt: tstz('panel_edited_at'),
    participantsCount: integer('participants_count'),
    boundAt: tstz('bound_at').notNull().defaultNow(),
    boundBy: maxId('bound_by'),
  },
);

export const maxUser = pgTable('max_user', {
  /** Идентификатор пользователя MAX (user_id). Имя и телефон не храним. */
  id: maxId('id').primaryKey(),
  locale: text('locale'),
  consentVersion: text('consent_version'),
  consentAt: tstz('consent_at'),
  dialogActive: boolean('dialog_active').notNull().default(false),
  /** Шаг и черновик диалога в личке (без ПДн); живёт 24 часа. */
  dialogState: jsonb('dialog_state').$type<Record<string, unknown>>(),
  dialogStateAt: tstz('dialog_state_at'),
  notifyDefault: boolean('notify_default').notNull().default(true),
  isModel: boolean('is_model').notNull().default(false),
  createdAt: createdAt(),
  deletedAt: tstz('deleted_at'),
});

export const residency = pgTable(
  'residency',
  {
    id: id(),
    /** Публичный ID для API (очередь подтверждения, приглашение собственника); выдаётся базой. */
    publicId: text('public_id')
      .notNull()
      .unique()
      .default(sql`substr(md5(random()::text || clock_timestamp()::text), 1, 10)`),
    userId: maxId('user_id')
      .notNull()
      .references(() => maxUser.id, { onDelete: 'cascade' }),
    houseId: bigint('house_id', { mode: 'number' })
      .notNull()
      .references(() => house.id, { onDelete: 'cascade' }),
    flatNo: integer('flat_no').notNull(),
    role: text('role').$type<ResidencyRole>().notNull(),
    trustLevel: smallint('trust_level').$type<TrustLevel>().notNull().default(0),
    reviewStatus: text('review_status').$type<ResidencyReviewStatus>().notNull().default('pending'),
    source: text('source').$type<ResidencySource>(),
    confirmedBy: text('confirmed_by'),
    confirmedAt: tstz('confirmed_at'),
    /** Последняя проверка членства в чате дома (кэш уровня 1). */
    membershipCheckedAt: tstz('membership_checked_at'),
    isModel: boolean('is_model').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('residency_user_house').on(t.userId, t.houseId),
    index('residency_house_flat').on(t.houseId, t.flatNo),
    check('residency_role', oneOf(t.role, RESIDENCY_ROLES)),
    check('residency_trust_level', oneOf(t.trustLevel, [0, 1, 2])),
    check('residency_review_status', oneOf(t.reviewStatus, RESIDENCY_REVIEW_STATUSES)),
    check('residency_source', sql`${t.source} is null or ${oneOf(t.source, RESIDENCY_SOURCES)}`),
  ],
);

export const staff = pgTable(
  'staff',
  {
    id: id(),
    userId: maxId('user_id')
      .notNull()
      .references(() => maxUser.id, { onDelete: 'cascade' }),
    ukId: bigint('uk_id', { mode: 'number' })
      .notNull()
      .references(() => managementCompany.id, { onDelete: 'cascade' }),
    role: text('role').$type<StaffRole>().notNull(),
    /** Роль выдана по демо-коду: помечается «Демо-роль». */
    isDemo: boolean('is_demo').notNull().default(false),
    /** Тестовый пользователь проверяющих (checker-токен). */
    isChecker: boolean('is_checker').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [unique('staff_user_uk').on(t.userId, t.ukId), check('staff_role', oneOf(t.role, STAFF_ROLES))],
);

export const norm = pgTable(
  'norm',
  {
    id: id(),
    code: text('code').notNull(),
    /** null — норма для любой услуги. */
    serviceType: text('service_type').$type<ServiceType>(),
    event: text('event').$type<NormEvent>().notNull(),
    title: text('title').notNull(),
    value: numeric('value').notNull(),
    unit: text('unit').$type<NormUnit>().notNull(),
    ratePercent: numeric('rate_percent'),
    calcStrategy: text('calc_strategy').$type<CalcStrategy>(),
    round: text('round').$type<RoundMode>(),
    /** null — федеральная норма. */
    regionCode: text('region_code'),
    /** Условие применения по параметрам дома, например {"power_sources": 2}. */
    condition: jsonb('condition').$type<Record<string, string | number | boolean>>(),
    basisDoc: text('basis_doc').notNull(),
    basisPoint: text('basis_point').notNull(),
    basisQuote: text('basis_quote'),
    textPlain: text('text_plain').notNull(),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    checkedAt: date('checked_at', { mode: 'string' }),
    sourceUrl: text('source_url').notNull(),
    note: text('note'),
  },
  (t) => [
    unique('norm_code_region_valid_from').on(t.code, t.regionCode, t.validFrom).nullsNotDistinct(),
    index('norm_service_event').on(t.serviceType, t.event),
    check('norm_service_type', sql`${t.serviceType} is null or ${oneOf(t.serviceType, SERVICE_TYPES)}`),
    check('norm_event', oneOf(t.event, NORM_EVENTS)),
    check('norm_unit', oneOf(t.unit, NORM_UNITS)),
    check('norm_calc_strategy', sql`${t.calcStrategy} is null or ${oneOf(t.calcStrategy, CALC_STRATEGIES)}`),
    check('norm_round', sql`${t.round} is null or ${oneOf(t.round, ROUND_MODES)}`),
  ],
);

export const incident = pgTable(
  'incident',
  {
    id: id(),
    publicId: text('public_id').notNull().unique(),
    houseId: bigint('house_id', { mode: 'number' })
      .notNull()
      .references(() => house.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<IncidentKind>().notNull().default('outage'),
    serviceType: text('service_type').$type<ServiceType>().notNull(),
    scope: text('scope').$type<IncidentScope>().notNull(),
    /** Подъезд для масштаба «подъезд». */
    entrance: integer('entrance'),
    status: text('status').$type<IncidentStatus>().notNull().default('open'),
    startedAt: tstz('started_at').notNull(),
    /** Как указано начало: now, 1h, 3h, 12h, custom. */
    startedSource: text('started_source').notNull(),
    createdAt: createdAt(),
    adsRegNumber: text('ads_reg_number'),
    adsRegAt: tstz('ads_reg_at'),
    etaAt: tstz('eta_at'),
    overdue: boolean('overdue').notNull().default(false),
    singleLimitExceeded: boolean('single_limit_exceeded').notNull().default(false),
    discrepancyUnresolved: boolean('discrepancy_unresolved').notNull().default(false),
    /** Автор (MAX user id); обезличивается при удалении данных. */
    createdBy: maxId('created_by'),
    mergedIntoId: bigint('merged_into_id', { mode: 'number' }).references((): AnyPgColumn => incident.id),
    brigadeOnSiteAt: tstz('brigade_on_site_at'),
    localizedAt: tstz('localized_at'),
    resolvedAtUk: tstz('resolved_at_uk'),
    checkStartedAt: tstz('check_started_at'),
    discrepancyAt: tstz('discrepancy_at'),
    closedAt: tstz('closed_at'),
    version: integer('version').notNull().default(1),
    isModel: boolean('is_model').notNull().default(false),
    isSandbox: boolean('is_sandbox').notNull().default(false),
  },
  (t) => [
    // Защита от двух одинаковых аварий при гонке: одна открытая авария вида X в доме,
    // если масштаб не «только квартира».
    uniqueIndex('incident_active_house_service')
      .on(t.houseId, t.serviceType)
      .where(sql`${oneOf(t.status, OPEN_STATUSES)} and ${t.scope} <> 'flat'`),
    index('incident_house_status').on(t.houseId, t.status),
    index('incident_house_service_started').on(t.houseId, t.serviceType, t.startedAt),
    check('incident_kind', oneOf(t.kind, INCIDENT_KINDS)),
    check('incident_service_type', oneOf(t.serviceType, SERVICE_TYPES)),
    check('incident_scope', oneOf(t.scope, INCIDENT_SCOPES)),
    check('incident_status', oneOf(t.status, INCIDENT_STATUSES)),
    check('incident_entrance_scope', sql`${t.scope} <> 'entrance' or ${t.entrance} is not null`),
  ],
);

export const incidentParticipant = pgTable(
  'incident_participant',
  {
    id: id(),
    incidentId: bigint('incident_id', { mode: 'number' })
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    /** MAX user id; null после удаления данных пользователем. */
    userId: maxId('user_id'),
    /** null — участник не зарегистрирован (уровень «не подтверждён»). */
    residencyId: bigint('residency_id', { mode: 'number' }).references(() => residency.id, { onDelete: 'set null' }),
    /** false — ответил «Не у меня». */
    affected: boolean('affected').notNull().default(true),
    entrance: integer('entrance'),
    floor: integer('floor'),
    trustLevelAtJoin: smallint('trust_level_at_join').$type<TrustLevel>().notNull().default(0),
    notify: boolean('notify').notNull().default(true),
    restoredAnswer: text('restored_answer').$type<RestoredAnswer>(),
    restoredAnswerAt: tstz('restored_answer_at'),
    restoredAt: tstz('restored_at'),
    restoredSource: text('restored_source').$type<RestoredSource>(),
    /** Повторное сообщение в АДС после «Нет» (номер заявки не является ПДн). */
    adsRereportNumber: text('ads_rereport_number'),
    adsRereportAt: tstz('ads_rereport_at'),
    brigadeSeen: boolean('brigade_seen'),
    brigadeSeenAt: tstz('brigade_seen_at'),
    readyToSign: boolean('ready_to_sign').notNull().default(false),
    shareContactConsent: boolean('share_contact_consent').notNull().default(false),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
    isModel: boolean('is_model').notNull().default(false),
  },
  (t) => [
    unique('incident_participant_incident_user').on(t.incidentId, t.userId),
    index('incident_participant_user').on(t.userId),
    check('incident_participant_trust', oneOf(t.trustLevelAtJoin, [0, 1, 2])),
    check('incident_participant_answer', sql`${t.restoredAnswer} is null or ${oneOf(t.restoredAnswer, RESTORED_ANSWERS)}`),
    check('incident_participant_source', sql`${t.restoredSource} is null or ${oneOf(t.restoredSource, RESTORED_SOURCES)}`),
  ],
);

export const incidentEvent = pgTable(
  'incident_event',
  {
    id: id(),
    incidentId: bigint('incident_id', { mode: 'number' })
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    type: text('type').$type<IncidentEventType>().notNull(),
    actorType: text('actor_type').$type<ActorType>().notNull(),
    /** MAX user id; null для системы и после удаления данных. */
    actorId: maxId('actor_id'),
    source: text('source').$type<EventSource>().notNull(),
    /** Данные события без ПДн. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('incident_event_incident_time').on(t.incidentId, t.occurredAt),
    check('incident_event_type', oneOf(t.type, INCIDENT_EVENT_TYPES)),
    check('incident_event_actor', oneOf(t.actorType, ACTOR_TYPES)),
    check('incident_event_source', oneOf(t.source, EVENT_SOURCES)),
  ],
);

export const deadline = pgTable(
  'deadline',
  {
    id: id(),
    incidentId: bigint('incident_id', { mode: 'number' })
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    normId: bigint('norm_id', { mode: 'number' })
      .notNull()
      .references(() => norm.id),
    kind: text('kind').$type<DeadlineKind>().notNull(),
    dueAt: tstz('due_at').notNull(),
    warnAt: tstz('warn_at').notNull(),
    status: text('status').$type<DeadlineStatus>().notNull().default('pending'),
    warnedAt: tstz('warned_at'),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    unique('deadline_incident_norm').on(t.incidentId, t.normId),
    index('deadline_pending_due').on(t.status, t.dueAt),
    check('deadline_kind', oneOf(t.kind, DEADLINE_KINDS)),
    check('deadline_status', oneOf(t.status, DEADLINE_STATUSES)),
  ],
);

export const chatCard = pgTable('chat_card', {
  incidentId: bigint('incident_id', { mode: 'number' })
    .primaryKey()
    .references(() => incident.id, { onDelete: 'cascade' }),
  chatId: maxId('chat_id').notNull(),
  mid: text('mid'),
  renderHash: text('render_hash'),
  lastEditedAt: tstz('last_edited_at'),
  /** Вопрос о восстановлении (C03): при повторной проверке правится, а не пишется заново. */
  checkMid: text('check_mid'),
  checkRenderHash: text('check_render_hash'),
  resultMid: text('result_mid'),
});

export const ownerInvite = pgTable(
  'owner_invite',
  {
    tokenHash: text('token_hash').primaryKey(),
    incidentId: bigint('incident_id', { mode: 'number' })
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    residencyId: bigint('residency_id', { mode: 'number' })
      .notNull()
      .references(() => residency.id, { onDelete: 'cascade' }),
    /** Квартира жильца на момент приглашения: сменил квартиру — ссылка недействительна. */
    flatNo: integer('flat_no'),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    result: text('result'),
    createdAt: createdAt(),
  },
  (t) => [check('owner_invite_result', sql`${t.result} is null or ${t.result} in ('confirmed', 'rejected')`)],
);

export const poll = pgTable(
  'poll',
  {
    id: id(),
    type: text('type').$type<PollType>().notNull(),
    houseId: bigint('house_id', { mode: 'number' })
      .notNull()
      .references(() => house.id, { onDelete: 'cascade' }),
    incidentId: bigint('incident_id', { mode: 'number' }).references(() => incident.id, { onDelete: 'cascade' }),
    mid: text('mid'),
    startedAt: tstz('started_at').notNull().defaultNow(),
    closedAt: tstz('closed_at'),
    isModel: boolean('is_model').notNull().default(false),
  },
  (t) => [check('poll_type', oneOf(t.type, POLL_TYPES)), index('poll_house_started').on(t.houseId, t.startedAt)],
);

export const pollAnswer = pgTable(
  'poll_answer',
  {
    pollId: bigint('poll_id', { mode: 'number' })
      .notNull()
      .references(() => poll.id, { onDelete: 'cascade' }),
    userId: maxId('user_id').notNull(),
    value: text('value').notNull(),
    entrance: integer('entrance'),
    floor: integer('floor'),
    answeredAt: tstz('answered_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'poll_answer_pk', columns: [t.pollId, t.userId] })],
);

export const inboundUpdate = pgTable(
  'inbound_update',
  {
    /** cb:<callback_id>, msg:<mid> или <update_type>:<chat_id>:<user_id>:<timestamp>. Тело события не храним. */
    dedupeKey: text('dedupe_key').primaryKey(),
    updateType: text('update_type').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    processedAt: tstz('processed_at'),
    error: text('error'),
  },
  (t) => [index('inbound_update_received').on(t.receivedAt)],
);

export const outboundMessage = pgTable(
  'outbound_message',
  {
    id: id(),
    kind: text('kind').$type<OutboundKind>().notNull(),
    incidentId: bigint('incident_id', { mode: 'number' }).references(() => incident.id, { onDelete: 'set null' }),
    chatId: maxId('chat_id'),
    userId: maxId('user_id'),
    /** Тело запроса до отправки; после отправки обнуляется. Заявления сюда не попадают. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: text('status').$type<OutboundStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    mid: text('mid'),
    /** Например card:create:<incidentId> — одно сообщение не уходит дважды. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    error: text('error'),
    createdAt: createdAt(),
    sentAt: tstz('sent_at'),
  },
  (t) => [
    index('outbound_message_incident_kind').on(t.incidentId, t.kind),
    check('outbound_message_kind', oneOf(t.kind, OUTBOUND_KINDS)),
    check('outbound_message_status', oneOf(t.status, OUTBOUND_STATUSES)),
    check('outbound_message_target', sql`${t.chatId} is not null or ${t.userId} is not null or ${t.kind} = 'callback_answer'`),
  ],
);

export const chatBindToken = pgTable('chat_bind_token', {
  tokenHash: text('token_hash').primaryKey(),
  chatId: maxId('chat_id').notNull(),
  expiresAt: tstz('expires_at').notNull(),
  usedAt: tstz('used_at'),
  createdAt: createdAt(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    /** Кто: staff:<userId>, checker:<name>, system. */
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    at: tstz('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_at').on(t.at)],
);

/** Повторы запросов с Idempotency-Key: возвращаем первый ответ. */
export const apiIdempotency = pgTable(
  'api_idempotency',
  {
    userId: maxId('user_id').notNull(),
    route: text('route').notNull(),
    key: text('key').notNull(),
    statusCode: integer('status_code').notNull(),
    body: jsonb('body').$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ name: 'api_idempotency_pk', columns: [t.userId, t.route, t.key] })],
);

/** Журнал вызовов симулятора MAX (MAX_MODE=simulator). Тексты заявлений маскируются. */
export const fakeMaxCall = pgTable(
  'fake_max_call',
  {
    id: id(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    query: jsonb('query').$type<Record<string, unknown>>(),
    body: jsonb('body').$type<unknown>(),
    responseStatus: integer('response_status').notNull(),
    response: jsonb('response').$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [index('fake_max_call_created').on(t.createdAt)],
);
