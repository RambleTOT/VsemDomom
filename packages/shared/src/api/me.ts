import { z } from 'zod';
import { DateTime, PublicId } from './common.ts';
import { HouseChatInfoSchema, HouseSummarySchema } from './houses.ts';
import {
  AppRoleSchema,
  ResidencyReviewStatusSchema,
  ResidencyRoleSchema,
  StaffRoleSchema,
  TrustLevelSchema,
} from './enums.ts';
import { FeatureFlagsSchema } from './system.ts';

export const ResidencySchema = z
  .object({
    id: PublicId,
    house: HouseSummarySchema,
    chat: HouseChatInfoSchema.nullable(),
    flatNo: z.int().positive(),
    role: ResidencyRoleSchema,
    trustLevel: TrustLevelSchema,
    reviewStatus: ResidencyReviewStatusSchema,
    inHouseChat: z.boolean().nullable().meta({ description: 'Состоит в чате дома; null — не проверено (бот не админ)' }),
  })
  .meta({ id: 'Residency' });

export const StaffInfoSchema = z
  .object({
    uk: z.object({ id: PublicId, name: z.string(), isModel: z.boolean() }),
    role: StaffRoleSchema,
    isDemo: z.boolean().meta({ description: 'Роль выдана по демо-коду — плашка «Демо-роль»' }),
    isChecker: z.boolean().meta({ description: 'Тестовый пользователь проверяющих (дом-песочница)' }),
  })
  .meta({ id: 'StaffInfo' });

export const MeSchema = z
  .object({
    userId: z.int().meta({ description: 'Идентификатор пользователя MAX' }),
    consent: z.object({ version: z.string(), at: DateTime }).nullable(),
    consentRequired: z.boolean().meta({ description: 'Нужно (заново) дать согласие на обработку ПДн' }),
    currentConsentVersion: z.string(),
    roles: z.array(AppRoleSchema).meta({ description: 'resident — житель; uk — сотрудник УК' }),
    residencies: z.array(ResidencySchema),
    staff: StaffInfoSchema.nullable(),
    settings: z.object({ notifyDefault: z.boolean() }),
    dialogActive: z.boolean().meta({ description: 'Пользователь начал диалог с ботом — бот может писать в личку' }),
    botLink: z.url().meta({ description: 'Ссылка на бота: https://max.ru/<бот>' }),
    demoMode: z.boolean(),
    features: FeatureFlagsSchema,
  })
  .meta({ id: 'Me' });
export type Me = z.infer<typeof MeSchema>;

export const AuthMaxRequestSchema = z
  .object({ initData: z.string().min(1).meta({ description: 'window.WebApp.initData как есть' }) })
  .meta({ id: 'AuthMaxRequest' });

export const AuthDevRequestSchema = z
  .object({
    userId: z.int().positive(),
    role: AppRoleSchema,
    startParam: z.string().regex(/^[A-Za-z0-9_-]{0,512}$/).optional(),
  })
  .meta({ id: 'AuthDevRequest', description: 'Только при DEV_AUTH=true (локально); иначе 404' });

export const SessionResponseSchema = z
  .object({
    token: z.string().meta({ description: 'JWT для Authorization: Bearer; срок — 12 часов' }),
    expiresAt: DateTime,
    user: MeSchema,
    startParam: z.string().nullable().meta({ description: 'Payload запуска: n_, i_, h_, r_, a_, o_, c_' }),
    devAuth: z.boolean().meta({ description: 'Вход в режиме разработки — показать баннер' }),
  })
  .meta({ id: 'SessionResponse' });

export const ConsentRequestSchema = z
  .object({ version: z.string().min(1).meta({ description: 'Должна совпадать с currentConsentVersion' }) })
  .meta({ id: 'ConsentRequest' });

export const ResidencyRequestSchema = z
  .object({
    houseId: PublicId,
    flatNo: z.int().positive(),
    role: ResidencyRoleSchema,
  })
  .meta({ id: 'ResidencyRequest', description: 'Квартира вне диапазона дома → 422 flat_out_of_range; смена квартиры сбрасывает уровень доверия до 0' });

export const ResidencyResponseSchema = z
  .object({
    residency: ResidencySchema,
    trustReset: z.boolean().meta({ description: 'Квартира сменилась — уровень доверия сброшен' }),
  })
  .meta({ id: 'ResidencyResponse' });

export const DemoUkRoleRequestSchema = z
  .object({ code: z.string().min(1).max(64) })
  .meta({ id: 'DemoUkRoleRequest', description: 'Только при DEMO_MODE=true; неверный код → 403 demo_code_invalid' });

export const SettingsPatchSchema = z
  .object({ notifyDefault: z.boolean() })
  .meta({ id: 'SettingsPatch', description: '«Уведомления» в профиле: значение по умолчанию для новых аварий' });

export const SettingsResponseSchema = z.object({ notifyDefault: z.boolean() }).meta({ id: 'SettingsResponse' });
