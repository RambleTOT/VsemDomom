import {
  ACTOR_TYPES,
  DEADLINE_KINDS,
  DEADLINE_STATES,
  DISPLAY_STATUSES,
  EVENT_SOURCES,
  INCIDENT_EVENT_TYPES,
  INCIDENT_SCOPES,
  INCIDENT_STATUSES,
  NORM_EVENTS,
  NORM_UNITS,
  CALC_STRATEGIES,
  RESIDENCY_REVIEW_STATUSES,
  RESIDENCY_ROLES,
  RESIDENCY_SOURCES,
  RESTORED_ANSWERS,
  RESTORED_SOURCES,
  ROUND_MODES,
  SERVICE_TYPES,
  STAFF_ROLES,
} from '@vsemdomom/core/enums';
import { z } from 'zod';

export const ServiceTypeSchema = z.enum(SERVICE_TYPES).meta({
  id: 'ServiceType',
  description:
    'Вид услуги: cold_water — холодная вода, hot_water — горячая вода, heating — отопление, electricity — свет, sewerage — канализация, gas — газ, leak — протечка',
});

export const IncidentScopeSchema = z.enum(INCIDENT_SCOPES).meta({
  id: 'IncidentScope',
  description: 'Где: flat — только в моей квартире (в чат не публикуется), entrance — подъезд, house — весь дом',
});

export const IncidentStatusSchema = z.enum(INCIDENT_STATUSES).meta({
  id: 'IncidentStatus',
  description: 'Статус аварии по машине состояний. Открытые: open…discrepancy; конечные: closed, merged',
});

export const DisplayStatusSchema = z.enum(DISPLAY_STATUSES).meta({
  id: 'DisplayStatus',
  description:
    'Статус для показа (девять названий): closed_with_discrepancy — «Закрыта с расхождением» (closed с флагом discrepancyUnresolved)',
});

export const IncidentEventTypeSchema = z.enum(INCIDENT_EVENT_TYPES).meta({ id: 'IncidentEventType' });
export const ActorTypeSchema = z.enum(ACTOR_TYPES).meta({ id: 'ActorType' });
export const EventSourceSchema = z.enum(EVENT_SOURCES).meta({ id: 'EventSource' });

export const ResidencyRoleSchema = z.enum(RESIDENCY_ROLES).meta({
  id: 'ResidencyRole',
  description: 'Кто житель в квартире: owner — собственник, social_tenant — соцнаём, renter — снимает, family — член семьи',
});

export const TrustLevelSchema = z
  .union([z.literal(0), z.literal(1), z.literal(2)])
  .meta({ id: 'TrustLevel', description: '0 — заявлено, 1 — состоит в чате дома, 2 — подтверждён собственником или УК' });

export const ResidencyReviewStatusSchema = z.enum(RESIDENCY_REVIEW_STATUSES).meta({ id: 'ResidencyReviewStatus' });
export const ResidencySourceSchema = z.enum(RESIDENCY_SOURCES).meta({ id: 'ResidencySource' });
export const StaffRoleSchema = z.enum(STAFF_ROLES).meta({ id: 'StaffRole' });

export const DeadlineKindSchema = z.enum(DEADLINE_KINDS).meta({
  id: 'DeadlineKind',
  description:
    'answer — УК сообщит сроки работ; localize — локализовать; clog — устранить засор; fix — устранить аварию; single_limit — допустимый перерыв единовременно',
});

export const DeadlineStateSchema = z.enum(DEADLINE_STATES).meta({
  id: 'DeadlineState',
  description: 'pending — срок идёт; soon — до срока меньше 30 минут; met — выполнено; breached — срок истёк; cancelled — отменён',
});

export const RestoredAnswerSchema = z.enum(RESTORED_ANSWERS).meta({
  id: 'RestoredAnswer',
  description: 'Ответ на вопрос о восстановлении: yes — есть, no — нет, weak — есть, но плохая (считается восстановлением)',
});

export const RestoredSourceSchema = z.enum(RESTORED_SOURCES).meta({
  id: 'RestoredSource',
  description: 'Откуда время восстановления: uk_mark — отметка УК, resident_answer — ответ жителя, ads_report — сообщение в АДС',
});

export const NormEventSchema = z.enum(NORM_EVENTS).meta({ id: 'NormEvent' });
export const NormUnitSchema = z.enum(NORM_UNITS).meta({ id: 'NormUnit' });
export const CalcStrategySchema = z.enum(CALC_STRATEGIES).meta({ id: 'CalcStrategy' });
export const RoundModeSchema = z.enum(ROUND_MODES).meta({ id: 'RoundMode' });

/** Роль пользователя в мини-приложении. */
export const AppRoleSchema = z.enum(['resident', 'uk']).meta({ id: 'AppRole' });
