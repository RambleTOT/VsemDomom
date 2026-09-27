/**
 * Панель дома в закрепе (C01): публикуется при привязке чата и закрепляется без уведомления;
 * дальше только правится — не чаще раза в 10 секунд и только если текст или кнопки изменились.
 * Сообщение пропало — публикуется новая панель.
 */
import { createHash, randomUUID } from 'node:crypto';
import { OPEN_STATUSES, renderPanel, type BotMessage } from '@vsemdomom/core';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { house, houseChat, incident, outboundMessage } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type JobQueue, type TxLike } from '../jobs/queue.ts';
import { MaxApiError } from '../max/types.ts';
import { loadIncidentBundle } from '../services/incident-view.ts';
import { computeResult } from '../services/result.ts';

/** Правка панели — не чаще раза в окно на дом (F11). */
export async function panelLater(queue: JobQueue, houseId: number, tx?: TxLike): Promise<void> {
  const key = `panel:${houseId}`;
  if (tx) await queue.sendDebounced(QUEUES.panelRender, { houseId }, PARAMS.panelEditWindowSec, key, { tx });
  else await queue.sendDebounced(QUEUES.panelRender, { houseId }, PARAMS.panelEditWindowSec, key);
}

export function messageHash(message: Pick<BotMessage, 'text' | 'keyboard'>): string {
  return createHash('sha256').update(JSON.stringify({ text: message.text, keyboard: message.keyboard })).digest('hex');
}

export async function buildPanel(ctx: JobContext, houseId: number): Promise<BotMessage | null> {
  const [row] = await ctx.db.select({ house, chat: houseChat }).from(house).innerJoin(houseChat, eq(houseChat.houseId, house.id)).where(eq(house.id, houseId));
  if (!row) return null;
  const active = await ctx.db
    .select({ serviceType: incident.serviceType, startedAt: incident.startedAt })
    .from(incident)
    .where(and(eq(incident.houseId, houseId), inArray(incident.status, [...OPEN_STATUSES]), ne(incident.scope, 'flat')))
    .orderBy(asc(incident.startedAt));
  const [last] = await ctx.db
    .select({ id: incident.id, serviceType: incident.serviceType, closedAt: incident.closedAt, overdue: incident.overdue, single: incident.singleLimitExceeded })
    .from(incident)
    .where(and(eq(incident.houseId, houseId), eq(incident.status, 'closed'), ne(incident.scope, 'flat')))
    .orderBy(desc(incident.closedAt))
    .limit(1);
  const first = active[0];
  // «Устранено в норматив» — как в карточке и итоге: сроки УК, единовременный лимит и месячная норма квартир.
  let inNorm = false;
  if (last) {
    const bundle = last.overdue || last.single ? null : await loadIncidentBundle(ctx.db, last.id);
    inNorm = bundle !== null && (await computeResult(ctx.db, bundle, ctx.clock.now())).eligible === null;
  }
  return renderPanel(
    {
      house: { publicId: row.house.publicId, label: row.house.label, address: row.house.address, timezone: row.house.timezone, isModel: row.house.isModel },
      active: first ? { service: first.serviceType, startedAt: first.startedAt, count: active.length } : null,
      lastResult: last?.closedAt ? { closedAt: last.closedAt, service: last.serviceType, inNorm } : null,
      membersCount: row.chat.participantsCount,
      botUsername: ctx.config.max.botUsername,
      now: ctx.clock.now(),
    },
    ctx.i18n,
  );
}

export interface PanelJob {
  houseId: number;
  /** Закрепить панель, если ещё не закреплена и бот — администратор. */
  pin?: boolean;
}

export async function panelJob(ctx: JobContext, data: PanelJob): Promise<'created' | 'edited' | 'unchanged' | 'skipped'> {
  const [chat] = await ctx.db.select().from(houseChat).where(eq(houseChat.houseId, data.houseId));
  if (!chat) return 'skipped';
  const message = await buildPanel(ctx, data.houseId);
  if (!message) return 'skipped';
  const hash = messageHash(message);

  if (!chat.panelMid) {
    // Публикация: одна ожидающая отправки панель на чат.
    const created = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from ${houseChat} where ${houseChat.houseId} = ${data.houseId} for update`);
      const [pending] = await tx
        .select({ id: outboundMessage.id })
        .from(outboundMessage)
        .where(and(eq(outboundMessage.kind, 'panel_create'), eq(outboundMessage.chatId, chat.chatId), eq(outboundMessage.status, 'pending')));
      if (pending) return false;
      await tx.update(houseChat).set({ panelRenderHash: hash }).where(eq(houseChat.houseId, data.houseId));
      await enqueueOutbound(tx, ctx.queue, {
        kind: 'panel_create',
        // Повтор задачи защищён блокировкой и проверкой ожидающей панели; ключ — на каждую публикацию.
        idempotencyKey: `panel:create:${data.houseId}:${chat.chatId}:${randomUUID()}`,
        target: { chatId: chat.chatId },
        message: { ...message, notify: false },
        afterSend: { type: 'panel', houseId: data.houseId, chatId: chat.chatId },
      });
      return true;
    });
    return created ? 'created' : 'skipped';
  }

  if (data.pin && !chat.panelPinned && chat.botIsAdmin) {
    try {
      await ctx.max.pinMessage(chat.chatId, chat.panelMid, { notify: false });
      await ctx.db.update(houseChat).set({ panelPinned: true }).where(eq(houseChat.houseId, data.houseId));
    } catch (err) {
      if (!(err instanceof MaxApiError) || err.retryable) throw err;
      // Нет прав на закреп: панель остаётся обычным сообщением.
      await ctx.db.update(houseChat).set({ botIsAdmin: err.kind === 'forbidden' ? false : chat.botIsAdmin }).where(eq(houseChat.houseId, data.houseId));
      ctx.log.warn({ houseId: data.houseId, kind: err.kind }, 'панель не закреплена');
    }
  }

  if (hash === chat.panelRenderHash) return 'unchanged';
  try {
    await ctx.max.editMessage(chat.panelMid, { ...message, notify: false }, { chatId: chat.chatId });
    await ctx.db.update(houseChat).set({ panelRenderHash: hash, panelEditedAt: ctx.clock.now() }).where(eq(houseChat.houseId, data.houseId));
    return 'edited';
  } catch (err) {
    if (err instanceof MaxApiError && err.kind === 'not_found') {
      // Сообщение удалили — опубликуем новую панель.
      await ctx.db.update(houseChat).set({ panelMid: null, panelRenderHash: null, panelPinned: false }).where(eq(houseChat.houseId, data.houseId));
      return panelJob(ctx, { houseId: data.houseId, pin: true });
    }
    throw err;
  }
}
