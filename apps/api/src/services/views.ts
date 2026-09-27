/**
 * Представления для API: строки БД → объекты контракта (packages/shared). Даты — ISO 8601 в UTC,
 * наружу — только публичные ID. Имён и телефонов жителей здесь нет и быть не может: их нет в БД.
 */
import { botLink } from '@vsemdomom/core';
import type { HouseChatInfoSchema, HouseSummary, Me, NormBasis, Norm } from '@vsemdomom/shared';
import type { z } from 'zod';
import type { AppConfig } from '../config/env.ts';
import { PARAMS } from '../config/params.ts';
import type { HouseChatRow, HouseRow, ResidencyRow, UserRow } from '../db/queries.ts';
import type { norm } from '../db/schema.ts';

export type NormRow = typeof norm.$inferSelect;
type HouseChatInfo = z.infer<typeof HouseChatInfoSchema>;

export const iso = (at: Date): string => at.toISOString();
export const isoOrNull = (at: Date | null | undefined): string | null => (at ? at.toISOString() : null);

export function houseSummary(h: HouseRow): HouseSummary {
  return {
    id: h.publicId,
    label: h.label,
    address: h.address,
    city: h.city,
    timezone: h.timezone,
    entrances: h.entrances,
    floors: h.floors,
    flatFrom: h.flatFrom,
    flatTo: h.flatTo,
    isModel: h.isModel,
  };
}

export function chatInfo(chat: HouseChatRow | null): HouseChatInfo | null {
  if (!chat) return null;
  return { bound: true, title: chat.title, inviteLink: chat.inviteLink, participantsCount: chat.participantsCount };
}

/** Состоит ли в чате дома: известно, только если членство проверялось; уровень 2 проверкой не меняется. */
export function inHouseChat(res: ResidencyRow): boolean | null {
  if (!res.membershipCheckedAt || res.trustLevel === 2) return null;
  return res.trustLevel === 1;
}

export function residencyView(res: ResidencyRow, h: HouseRow, chat: HouseChatRow | null): Me['residencies'][number] {
  return {
    id: res.publicId,
    house: houseSummary(h),
    chat: chatInfo(chat),
    flatNo: res.flatNo,
    role: res.role,
    trustLevel: res.trustLevel,
    reviewStatus: res.reviewStatus,
    inHouseChat: inHouseChat(res),
  };
}

export function normBasis(row: NormRow): NormBasis {
  return {
    code: row.code,
    title: row.title,
    doc: row.basisDoc,
    point: row.basisPoint,
    textPlain: row.textPlain,
    quote: row.basisQuote,
    edition: row.editionDate,
    validFrom: row.validFrom,
    validTo: row.validTo,
    checkedAt: row.checkedAt,
    sourceUrl: row.sourceUrl,
  };
}

export function normView(row: NormRow): Norm {
  return {
    code: row.code,
    service: row.serviceType,
    event: row.event,
    title: row.title,
    value: Number(row.value),
    unit: row.unit,
    ratePercent: row.ratePercent === null ? null : Number(row.ratePercent),
    calcStrategy: row.calcStrategy,
    round: row.round,
    regionCode: row.regionCode,
    condition: row.condition,
    basis: normBasis(row),
  };
}

export interface MeParts {
  userId: number;
  user: UserRow | null;
  residencies: { residency: ResidencyRow; house: HouseRow; chat: HouseChatRow | null }[];
  staff: { role: NonNullable<Me['staff']>['role']; isDemo: boolean; isChecker: boolean; uk: { publicId: string; name: string; isModel: boolean } } | null;
}

export function meView(parts: MeParts, config: AppConfig): Me {
  const { user } = parts;
  const consent = user?.consentVersion && user.consentAt ? { version: user.consentVersion, at: iso(user.consentAt) } : null;
  const roles: Me['roles'] = [];
  if (parts.residencies.length > 0) roles.push('resident');
  if (parts.staff) roles.push('uk');
  return {
    userId: parts.userId,
    consent,
    consentRequired: user?.consentVersion !== PARAMS.consentVersion,
    currentConsentVersion: PARAMS.consentVersion,
    roles,
    residencies: parts.residencies.map((r) => residencyView(r.residency, r.house, r.chat)),
    staff: parts.staff
      ? {
          uk: { id: parts.staff.uk.publicId, name: parts.staff.uk.name, isModel: parts.staff.uk.isModel },
          role: parts.staff.role,
          isDemo: parts.staff.isDemo,
          isChecker: parts.staff.isChecker,
        }
      : null,
    settings: { notifyDefault: user?.notifyDefault ?? true },
    dialogActive: user?.dialogActive ?? false,
    botLink: botLink(config.max.botUsername),
    demoMode: config.demo.enabled,
    features: config.features,
  };
}
