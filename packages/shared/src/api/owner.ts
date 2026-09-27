import { z } from 'zod';
import { DateTime, PublicId } from './common.ts';
import { ResidencyRoleSchema, TrustLevelSchema } from './enums.ts';
import { ResultSchema } from './incidents.ts';

export const OwnerInviteCreateRequestSchema = z
  .object({ incidentId: PublicId })
  .meta({ id: 'OwnerInviteCreateRequest', description: '«Лицевой счёт не на мне» → ссылка собственнику' });

export const OwnerInviteCreateResponseSchema = z
  .object({
    link: z.url().meta({ description: 'https://max.ru/<бот>?startapp=o_<токен>' }),
    shareText: z.string().meta({ description: 'Текст для shareMaxContent и :share' }),
    expiresAt: DateTime,
  })
  .meta({ id: 'OwnerInviteCreateResponse' });

export const OwnerInviteViewSchema = z
  .object({
    status: z.enum(['pending', 'confirmed', 'rejected']),
    flatNo: z.int().meta({ description: 'Квартира жильца; имени нет — сервис его не хранит' }),
    tenantRole: ResidencyRoleSchema,
    house: z.object({ id: PublicId, label: z.string(), address: z.string() }),
    result: ResultSchema.nullable().meta({ description: 'Итог аварии для собственника; null, пока авария не закрыта' }),
    incidentId: PublicId,
    expiresAt: DateTime,
  })
  .meta({ id: 'OwnerInviteView' });

export const OwnerInviteDecisionResponseSchema = z
  .object({
    status: z.enum(['confirmed', 'rejected']),
    tenantTrustLevel: TrustLevelSchema,
    incidentId: PublicId,
  })
  .meta({ id: 'OwnerInviteDecisionResponse' });
