/**
 * События чата дома для уровня доверия 1: user_added / user_removed меняют уровень сразу
 * (проверка по запросу — services/membership.ts). Уровень 2 не снижается.
 */
import { and, eq, sql } from 'drizzle-orm';
import { panelLater } from '../chat/panel.ts';
import { houseChat, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import type { NormalizedUpdate } from '../max/update.ts';
import { houseOfChat } from '../db/queries.ts';

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
  await panelLater(ctx.queue, bound.house.id);
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
  await panelLater(ctx.queue, bound.house.id);
}
