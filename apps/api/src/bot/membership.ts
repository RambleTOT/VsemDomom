/**
 * Уровень доверия 1 — членство в чате дома: GET /chats/{chatId}/members?user_ids= (нужны права
 * администратора), кэш 10 минут; события user_added/user_removed обновляют уровень сразу.
 * Уровень 2 (подтверждён) проверкой членства не снижается.
 */
import { trustLevel, type TrustLevel } from '@vsemdomom/core';
import { and, eq, sql } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { houseChat, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { QUEUES } from '../jobs/queue.ts';
import type { NormalizedUpdate } from '../max/update.ts';
import { chatOfHouse, houseOfChat, type ResidencyRow } from './queries.ts';

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

async function panelLater(ctx: JobContext, houseId: number): Promise<void> {
  await ctx.queue.sendDebounced(QUEUES.panelRender, { houseId }, PARAMS.panelEditWindowSec, `panel:${houseId}`);
}

/** Участник вошёл в чат дома (в том числе по ссылке). */
export async function onUserAdded(u: NormalizedUpdate, ctx: JobContext): Promise<void> {
  if (u.chatId === null || u.userId === null || u.isChannel) return;
  const bound = await houseOfChat(ctx.db, u.chatId);
  if (!bound) return;
  await ctx.db
    .update(houseChat)
    .set({ participantsCount: sql`coalesce(${houseChat.participantsCount}, 0) + 1` })
    .where(eq(houseChat.chatId, u.chatId));
  await ctx.db
    .update(residency)
    .set({ trustLevel: 1, membershipCheckedAt: ctx.clock.now(), updatedAt: ctx.clock.now() })
    .where(and(eq(residency.userId, u.userId), eq(residency.houseId, bound.house.id), eq(residency.trustLevel, 0)));
  await panelLater(ctx, bound.house.id);
}

/** Участник вышел или удалён из чата дома. */
export async function onUserRemoved(u: NormalizedUpdate, ctx: JobContext): Promise<void> {
  if (u.chatId === null || u.userId === null || u.isChannel) return;
  const bound = await houseOfChat(ctx.db, u.chatId);
  if (!bound) return;
  await ctx.db
    .update(houseChat)
    .set({ participantsCount: sql`greatest(coalesce(${houseChat.participantsCount}, 1) - 1, 0)` })
    .where(eq(houseChat.chatId, u.chatId));
  await ctx.db
    .update(residency)
    .set({ trustLevel: 0, membershipCheckedAt: ctx.clock.now(), updatedAt: ctx.clock.now() })
    .where(and(eq(residency.userId, u.userId), eq(residency.houseId, bound.house.id), eq(residency.trustLevel, 1)));
  await panelLater(ctx, bound.house.id);
}
