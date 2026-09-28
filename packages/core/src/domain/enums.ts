/**
 * Канонические перечисления домена. Один список для БД (CHECK-ограничения),
 * API (zod-схемы в packages/shared) и DATA-API.
 */

/** Вид услуги. */
export const SERVICE_TYPES = [
  'cold_water',
  'hot_water',
  'heating',
  'electricity',
  'sewerage',
  'gas',
  'leak',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Масштаб аварии: только квартира, подъезд или весь дом. */
export const INCIDENT_SCOPES = ['flat', 'entrance', 'house'] as const;
export type IncidentScope = (typeof INCIDENT_SCOPES)[number];

/** Вид карточки. Плановые отключения — следующий этап, поле уже есть. */
export const INCIDENT_KINDS = ['outage'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** Статусы аварии (машина состояний). */
export const INCIDENT_STATUSES = [
  'open',
  'accepted',
  'brigade_on_site',
  'localized',
  'checking',
  'discrepancy',
  'closed',
  'merged',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Открытые статусы: авария ещё не завершена. */
export const OPEN_STATUSES = [
  'open',
  'accepted',
  'brigade_on_site',
  'localized',
  'checking',
  'discrepancy',
] as const satisfies readonly IncidentStatus[];
export type OpenStatus = (typeof OPEN_STATUSES)[number];

/** Конечные статусы. */
export const FINAL_STATUSES = ['closed', 'merged'] as const satisfies readonly IncidentStatus[];
export type FinalStatus = (typeof FINAL_STATUSES)[number];

/**
 * Статус для показа: девять названий. «Закрыта с расхождением» — не отдельное
 * состояние, а closed с флагом discrepancy_unresolved.
 */
export const DISPLAY_STATUSES = [
  'open',
  'accepted',
  'brigade_on_site',
  'localized',
  'checking',
  'discrepancy',
  'closed',
  'closed_with_discrepancy',
  'merged',
] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

/** Типы событий хронологии (incident_event.type). */
export const INCIDENT_EVENT_TYPES = [
  'reported',
  'joined',
  'left',
  'ads_registered',
  'ads_not_reached',
  'uk_accepted',
  'uk_brigade_on_site',
  'residents_brigade_confirmed',
  'residents_no_brigade',
  'uk_localized',
  'uk_resolved',
  'skipped_steps',
  'check_asked',
  'check_repeated',
  'restored_yes',
  'restored_no',
  'restored_weak',
  'ads_rereported',
  'discrepancy',
  'act_ready',
  'deadline_warned',
  'deadline_met',
  'deadline_breached',
  'closed',
  'merged',
  'demo_time_shift',
  'demo_neighbours_added',
] as const;
export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number];

/** Кто совершил действие. */
export const ACTOR_TYPES = ['resident', 'uk', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Откуда пришло действие. */
export const EVENT_SOURCES = ['bot', 'miniapp', 'api', 'system'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Кто житель в квартире. */
export const RESIDENCY_ROLES = ['owner', 'social_tenant', 'renter', 'family'] as const;
export type ResidencyRole = (typeof RESIDENCY_ROLES)[number];

/** Уровень доверия: 0 — заявлено, 1 — из чата дома, 2 — подтверждён. */
export const TRUST_LEVELS = [0, 1, 2] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** Состояние заявки жильца в очереди подтверждения УК. */
export const RESIDENCY_REVIEW_STATUSES = ['pending', 'confirmed', 'rejected'] as const;
export type ResidencyReviewStatus = (typeof RESIDENCY_REVIEW_STATUSES)[number];

/** Откуда житель пришёл в сервис. */
export const RESIDENCY_SOURCES = ['chat', 'qr', 'dm', 'miniapp', 'owner_link'] as const;
export type ResidencySource = (typeof RESIDENCY_SOURCES)[number];

/** Роль сотрудника УК. */
export const STAFF_ROLES = ['dispatcher', 'curator', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Ответ жителя на вопрос о восстановлении (действует последний). */
export const RESTORED_ANSWERS = ['yes', 'no', 'weak'] as const;
export type RestoredAnswer = (typeof RESTORED_ANSWERS)[number];

/** Откуда взято время восстановления для квартиры. */
export const RESTORED_SOURCES = ['uk_mark', 'resident_answer', 'ads_report'] as const;
export type RestoredSource = (typeof RESTORED_SOURCES)[number];

/** Вид срока по нормативу. single_limit — допустимый единовременный перерыв. */
export const DEADLINE_KINDS = ['answer', 'localize', 'clog', 'fix', 'single_limit'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

/** Состояние срока в БД. */
export const DEADLINE_STATUSES = ['pending', 'met', 'breached', 'cancelled'] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

/** Состояние срока для показа: soon — до срока меньше порога предупреждения. */
export const DEADLINE_STATES = ['pending', 'soon', 'met', 'breached', 'cancelled'] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

/** Событие, которое описывает норма справочника. */
export const NORM_EVENTS = [
  'ads_answer',
  'uk_eta',
  'localize',
  'clog_clear',
  'fix',
  'inform_causes',
  'check_visit',
  'act_without_executor',
  'act_copy',
  'interruption_single',
  'interruption_monthly',
  'quality_temperature',
] as const;
export type NormEvent = (typeof NORM_EVENTS)[number];

/** Единица значения нормы. */
export const NORM_UNITS = ['min', 'h', 'day', 'workday', 'person', 'celsius'] as const;
export type NormUnit = (typeof NORM_UNITS)[number];

/** Как считать часы для денег (поле справочника, меняется без кода). */
export const CALC_STRATEGIES = ['monthly_total', 'max_of_single_and_monthly'] as const;
export type CalcStrategy = (typeof CALC_STRATEGIES)[number];

/** Округление неполного часа (поле справочника). */
export const ROUND_MODES = ['ceil', 'floor', 'exact'] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

/** Виды опросов. */
export const POLL_TYPES = ['water_quality', 'heating'] as const;
export type PollType = (typeof POLL_TYPES)[number];

/** Ответы опроса «Как вода сейчас?»: нормально, ржавая, слабый напор. */
export const WATER_POLL_VALUES = ['ok', 'rust', 'low'] as const;
export type WaterPollValue = (typeof WATER_POLL_VALUES)[number];

/** Ответы опроса «Тепло ли у вас?»: тепло, чуть тёплые, холодные. */
export const HEAT_POLL_VALUES = ['warm', 'luke', 'cold'] as const;
export type HeatPollValue = (typeof HEAT_POLL_VALUES)[number];

/** Статус исходящего сообщения в журнале outbound_message. */
export const OUTBOUND_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

/**
 * Виды исходящих сообщений. Бюджет «не больше трёх новых сообщений на аварию»
 * считается по card_create, check_question и result.
 */
export const OUTBOUND_KINDS = [
  'card_create',
  'card_replace',
  'card_edit',
  'check_question',
  'check_edit',
  'result',
  'panel_create',
  'panel_edit',
  'panel_pin',
  'bind_invite',
  'callback_answer',
  'dm',
  'keyword_reply',
  'poll',
  'monthly_summary',
  'alert',
] as const;
export type OutboundKind = (typeof OUTBOUND_KINDS)[number];

/** Новые сообщения в чат, которые входят в бюджет аварии. */
export const INCIDENT_BUDGET_KINDS = ['card_create', 'check_question', 'result'] as const satisfies readonly OutboundKind[];

/** Быстрый выбор начала аварии: «сейчас», «1 ч назад», «3 ч назад», «12 ч назад» или своё время. */
export const STARTED_PRESETS = ['now', '1h', '3h', '12h', 'custom'] as const;
export type StartedPreset = (typeof STARTED_PRESETS)[number];

/** Сколько часов назад для быстрых вариантов (не норматив — варианты интерфейса). */
export const STARTED_PRESET_HOURS: Record<Exclude<StartedPreset, 'custom'>, number> = { now: 0, '1h': 1, '3h': 3, '12h': 12 };

/** Суффикс ключей словаря для быстрого выбора начала: since.<key>. */
export const STARTED_PRESET_I18N_KEY: Record<StartedPreset, string> = { now: 'now', '1h': '1h', '3h': '3h', '12h': '12h', custom: 'custom' };

/** Флаги функций волн 2–3. */
export const FEATURE_FLAGS = [
  'keywordReply',
  'brigadeConfirm',
  'trustLevels',
  'joinChat',
  'polls',
  'monthlySummary',
  'actTemplate',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

/** Проверка принадлежности значения перечислению. */
export function isOneOf<const T extends readonly unknown[]>(values: T, value: unknown): value is T[number] {
  return (values as readonly unknown[]).includes(value);
}

export function isOpenStatus(status: IncidentStatus): status is OpenStatus {
  return isOneOf(OPEN_STATUSES, status);
}

/** Суффикс ключей словаря для вида услуги: service.<key>, service_gen.<key>, restore.question.<key>. */
export const SERVICE_I18N_KEY: Record<ServiceType, string> = {
  cold_water: 'cold',
  hot_water: 'hot',
  heating: 'heat',
  electricity: 'power',
  sewerage: 'sewer',
  gas: 'gas',
  leak: 'leak',
};

/** Суффикс ключей словаря для роли в квартире: role.<key>. */
export const RESIDENCY_ROLE_I18N_KEY: Record<ResidencyRole, string> = {
  owner: 'owner',
  social_tenant: 'social',
  renter: 'rent',
  family: 'family',
};

/** Суффикс ключей словаря для статуса: status.<key>. */
export const DISPLAY_STATUS_I18N_KEY: Record<DisplayStatus, string> = {
  open: 'open',
  accepted: 'accepted',
  brigade_on_site: 'brigade',
  localized: 'localized',
  checking: 'checking',
  discrepancy: 'discrepancy',
  closed: 'closed',
  closed_with_discrepancy: 'closed_disc',
  merged: 'merged',
};
