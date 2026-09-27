/**
 * Уровень доверия 1 — членство в чате дома: GET /chats/{chatId}/members?user_ids= (нужны права
 * администратора), кэш 10 минут. Без прав администратора уровень 1 — только по событию user_added.
 * Уровень 2 (подтверждён) проверкой членства не снижается.
 */
import { trustLevel, type TrustLevel } from '@vsemdomom/core';
import { and, eq, sql } from 'drizzle-orm';
import { chatOfHouse, type ResidencyRow } from '../db/queries.ts';
import { PARAMS } from '../config/params.ts';
import { residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';

const MS_PER_MINUTE = 60_000;

export async function refreshMembership(ctx: JobContext, row: ResidencyRow, options: { force?: boolean } = {}): Promise<{ trust: TrustLevel; inChat: boolean | null }> {
  if (row.trustLevel === 2) return { trust: 2, inChat: null };
  const chat = await chatOfHouse(ctx.db, row.houseId);
  if (!chat?.botIsAdmin) return { trust: row.trustLevel, inChat: null };
  const fresh = row.membershipCheckedAt && ctx.clock.now().getTime() - row.membershipCheckedAt.getTime() < PARAMS.membershipCacheMin * MS_PER_MINUTE;
  if (fresh && !options.force) return { trust: row.trustLevel, inChat: row.trustLevel >= 1 };
  let inChat: boolean;
  try {
    const members = await ctx.max.getChatMembers(chat.chatId, [row.userId]);
    inChat = members.some((m) => m.user_id === row.userId);
  } catch (err) {
    ctx.log.warn({ err }, 'проверка членства в чате не удалась');
    return { trust: row.trustLevel, inChat: null };
  }
  const next = trustLevel({ registered: true, inHouseChat: inChat, confirmed: false });
  await ctx.db
    .update(residency)
    .set({ trustLevel: next, membershipCheckedAt: ctx.clock.now(), updatedAt: ctx.clock.now() })
    .where(and(eq(residency.id, row.id), sql`${residency.trustLevel} < 2`));
  return { trust: next, inChat };
}
