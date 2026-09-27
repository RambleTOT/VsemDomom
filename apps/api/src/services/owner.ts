/**
 * Приглашение собственника (F09, F10): жилец, у которого лицевой счёт не на нём, пересылает ссылку
 * o_<токен> собственнику. Собственник видит квартиру и роль жильца (без имени — его нет в сервисе)
 * и итог аварии; подтверждение даёт жильцу уровень доверия 2, «Не знаю этого человека» уровень не меняет.
 * Токен одноразовый, 7 дней, в БД — только хеш.
 */
import { encodeStartApp, lowerFirst, renderText, serviceNo, startAppLink } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import type { Executor } from '../db/client.ts';
import type { HouseRow, ResidencyRow } from '../db/queries.ts';
import { house, incident, maxUser, ownerInvite, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { hashToken, newToken } from '../util/tokens.ts';

type Reader = Pick<Executor, 'select'>;
type IncidentRow = typeof incident.$inferSelect;
type InviteRow = typeof ownerInvite.$inferSelect;

const MS_PER_DAY = 86_400_000;

export async function createOwnerInvite(
  ctx: JobContext,
  input: { incident: IncidentRow; house: HouseRow; residency: ResidencyRow },
): Promise<{ link: string; shareText: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(ctx.clock.now().getTime() + PARAMS.ownerInviteTtlDays * MS_PER_DAY);
  await ctx.db.insert(ownerInvite).values({ tokenHash: hashToken(token), incidentId: input.incident.id, residencyId: input.residency.id, expiresAt });
  return {
    link: startAppLink(ctx.config.max.botUsername, encodeStartApp('o', token)),
    shareText: ctx.i18n.t('owner.share.text', {
      flat: input.residency.flatNo,
      address: input.house.address,
      service_no_lower: lowerFirst(serviceNo(ctx.i18n, input.incident.serviceType)),
    }),
    expiresAt,
  };
}

export interface InviteBundle {
  invite: InviteRow;
  residency: ResidencyRow;
  house: HouseRow;
  incident: IncidentRow;
}

export async function inviteByToken(db: Reader, token: string): Promise<InviteBundle | null> {
  const [row] = await db
    .select({ invite: ownerInvite, residency, house, incident })
    .from(ownerInvite)
    .innerJoin(residency, eq(residency.id, ownerInvite.residencyId))
    .innerJoin(house, eq(house.id, residency.houseId))
    .innerJoin(incident, eq(incident.id, ownerInvite.incidentId))
    .where(eq(ownerInvite.tokenHash, hashToken(token)));
  return row ?? null;
}

export function inviteStatus(invite: InviteRow): 'pending' | 'confirmed' | 'rejected' {
  return invite.result === 'confirmed' ? 'confirmed' : invite.result === 'rejected' ? 'rejected' : 'pending';
}

export type DecisionError = 'not_found' | 'token_used' | 'token_expired' | 'self';

/** Решение собственника; подтверждение — уровень 2 и сообщение жильцу в личку (если диалог начат). */
export async function decideOwnerInvite(
  ctx: JobContext,
  input: { token: string; ownerUserId: number; decision: 'confirmed' | 'rejected' },
): Promise<{ bundle: InviteBundle; trustLevel: ResidencyRow['trustLevel'] } | DecisionError> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const found = await inviteByToken(tx, input.token);
    if (!found) return 'not_found';
    const [invite] = await tx.select().from(ownerInvite).where(eq(ownerInvite.tokenHash, found.invite.tokenHash)).for('update');
    if (!invite) return 'not_found';
    if (invite.usedAt) return 'token_used';
    if (invite.expiresAt.getTime() < now.getTime()) return 'token_expired';
    if (found.residency.userId === input.ownerUserId) return 'self';
    await tx.update(ownerInvite).set({ usedAt: now, result: input.decision }).where(eq(ownerInvite.tokenHash, invite.tokenHash));
    let trustLevel = found.residency.trustLevel;
    if (input.decision === 'confirmed') {
      trustLevel = 2;
      await tx
        .update(residency)
        .set({ trustLevel: 2, reviewStatus: 'confirmed', confirmedAt: now, confirmedBy: `owner:${input.ownerUserId}`, updatedAt: now })
        .where(eq(residency.id, found.residency.id));
      const [tenant] = await tx.select({ dialogActive: maxUser.dialogActive }).from(maxUser).where(eq(maxUser.id, found.residency.userId));
      if (tenant?.dialogActive) {
        await enqueueOutbound(tx, ctx.queue, {
          kind: 'dm',
          idempotencyKey: `owner:confirmed:${invite.tokenHash}`,
          target: { userId: found.residency.userId },
          message: renderText('bot.dm.owner.confirmed', ctx.i18n, { flat: found.residency.flatNo }),
        });
      }
    }
    return { bundle: { ...found, invite: { ...invite, usedAt: now, result: input.decision } }, trustLevel };
  });
}
