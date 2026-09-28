/**
 * F13: сообщение в чате дома с ключевыми словами («нет воды» и т. п.) → ответ C06 с кнопками
 * «Присоединиться к аварии» и «Сообщить об аварии». Не чаще раза в PARAMS.keywordReplyCooldownMin
 * на чат; словарь — KEYWORD_PHRASES, без LLM. В задачу из webhook попадает только признак
 * «найдено ключевое слово» — текст группы не хранится. Только при FEATURE_KEYWORD_REPLY.
 */
import { MS_PER_MINUTE, OPEN_STATUSES, renderKeywordReply } from '@vsemdomom/core';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { house, houseChat, incident, outboundMessage } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import type { NormalizedUpdate } from '../max/update.ts';
import type { UpdateMeta } from './types.ts';

const KEY_PREFIX = 'keyword';

export async function onKeywordHit(u: NormalizedUpdate, ctx: JobContext, _meta: UpdateMeta): Promise<void> {
  const chatId = u.chatId;
  if (!ctx.config.features.keywordReply || chatId === null) return;
  const now = ctx.clock.now();
  await ctx.db.transaction(async (tx) => {
    const [bound] = await tx.select({ house }).from(houseChat).innerJoin(house, eq(house.id, houseChat.houseId)).where(eq(houseChat.chatId, chatId));
    if (!bound) return;
    // Один ответ на чат за окно — и при параллельной обработке событий.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY_PREFIX}), hashtext(${String(chatId)}))`);
    const [last] = await tx
      .select({ key: outboundMessage.idempotencyKey })
      .from(outboundMessage)
      .where(and(eq(outboundMessage.kind, 'keyword_reply'), eq(outboundMessage.chatId, chatId)))
      .orderBy(desc(outboundMessage.id))
      .limit(1);
    const lastAt = last ? Number(last.key.split(':').at(-1)) : Number.NaN;
    if (Number.isFinite(lastAt) && now.getTime() - lastAt < PARAMS.keywordReplyCooldownMin * MS_PER_MINUTE) return;
    const [open] = await tx
      .select({ publicId: incident.publicId, service: incident.serviceType })
      .from(incident)
      .where(and(eq(incident.houseId, bound.house.id), inArray(incident.status, [...OPEN_STATUSES]), ne(incident.scope, 'flat')))
      .orderBy(desc(incident.createdAt))
      .limit(1);
    const message = renderKeywordReply(
      { housePublicId: bound.house.publicId, incident: open ?? null, isModel: bound.house.isModel, botUsername: ctx.config.max.botUsername },
      ctx.i18n,
    );
    await enqueueOutbound(tx, ctx.queue, {
      kind: 'keyword_reply',
      idempotencyKey: `${KEY_PREFIX}:${chatId}:${now.getTime()}`,
      target: { chatId },
      message: u.mid ? { ...message, replyToMid: u.mid } : message,
    });
  });
}
