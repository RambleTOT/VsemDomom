/**
 * Исходящие сообщения бота через журнал outbound_message:
 * - строка с уникальным idempotency_key ставится в той же транзакции, что и изменение данных,
 *   поэтому повтор задачи не отправит сообщение второй раз;
 * - после отправки payload обнуляется, сохраняется mid;
 * - после отправки выполняется действие по виду: сохранить mid панели, карточки и т.п.
 * Заявления (ПДн) сюда не попадают: их отправляет API синхронно.
 */
import { INCIDENT_BUDGET_KINDS, type OutboundKind } from '@vsemdomom/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { chatCard, houseChat, maxUser, outboundMessage } from '../db/schema.ts';
import { MaxApiError, type MaxTarget, type OutgoingMessage } from '../max/types.ts';
import type { JobContext } from './context.ts';
import { QUEUES, type JobQueue, type TxLike } from './queue.ts';

/** Что сделать после успешной отправки. */
export type AfterSend =
  | { type: 'panel'; houseId: number; chatId: number }
  | { type: 'card'; incidentId: number }
  | { type: 'check_question'; incidentId: number }
  | { type: 'result'; incidentId: number }
  | { type: 'none' };

export interface OutboundInput {
  kind: OutboundKind;
  idempotencyKey: string;
  target: MaxTarget;
  message: OutgoingMessage;
  incidentId?: number | null;
  afterSend?: AfterSend;
}

interface StoredPayload {
  message: OutgoingMessage;
  afterSend: AfterSend;
}

type Tx = Pick<Db, 'insert' | 'select'> & TxLike;

/** Бюджет новых сообщений в чат на аварию: создание, вопрос, итог. */
export const INCIDENT_MESSAGE_BUDGET = INCIDENT_BUDGET_KINDS.length;

export class OutboundBudgetError extends Error {
  constructor(incidentId: number) {
    super(`бюджет новых сообщений аварии ${incidentId} исчерпан`);
    this.name = 'OutboundBudgetError';
  }
}

/**
 * Поставить сообщение в журнал и очередь. Повтор с тем же ключом ничего не делает.
 * Превышение бюджета аварии — ошибка, а не молчаливая отправка.
 */
export async function enqueueOutbound(tx: Tx, queue: JobQueue, input: OutboundInput): Promise<number | null> {
  if (input.incidentId && (INCIDENT_BUDGET_KINDS as readonly string[]).includes(input.kind)) {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(outboundMessage)
      .where(and(eq(outboundMessage.incidentId, input.incidentId), inArray(outboundMessage.kind, [...INCIDENT_BUDGET_KINDS])));
    const existing = await tx
      .select({ id: outboundMessage.id })
      .from(outboundMessage)
      .where(eq(outboundMessage.idempotencyKey, input.idempotencyKey));
    if (existing.length === 0 && (row?.n ?? 0) >= INCIDENT_MESSAGE_BUDGET) throw new OutboundBudgetError(input.incidentId);
  }
  const payload: StoredPayload = { message: input.message, afterSend: input.afterSend ?? { type: 'none' } };
  const [inserted] = await tx
    .insert(outboundMessage)
    .values({
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      incidentId: input.incidentId ?? null,
      chatId: 'chatId' in input.target ? input.target.chatId : null,
      userId: 'userId' in input.target ? input.target.userId : null,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
    })
    .onConflictDoNothing()
    .returning({ id: outboundMessage.id });
  if (!inserted) return null;
  await queue.send(QUEUES.outbound, { id: inserted.id }, { tx });
  return inserted.id;
}

/** Ошибки, при которых повтор бесполезен. */
function isPermanent(err: MaxApiError): boolean {
  return err.kind === 'bad_request' || err.kind === 'forbidden' || err.kind === 'not_found' || err.kind === 'unauthorized';
}

export async function sendOutbound(ctx: JobContext, data: { id: number }): Promise<'sent' | 'skipped' | 'failed'> {
  const [row] = await ctx.db.select().from(outboundMessage).where(eq(outboundMessage.id, data.id));
  if (!row || row.status === 'sent' || row.status === 'skipped' || !row.payload) return 'skipped';
  const payload = row.payload as unknown as StoredPayload;
  const target: MaxTarget | null = row.chatId !== null ? { chatId: row.chatId } : row.userId !== null ? { userId: row.userId } : null;
  if (!target) {
    await ctx.db.update(outboundMessage).set({ status: 'skipped', payload: null }).where(eq(outboundMessage.id, row.id));
    return 'skipped';
  }
  try {
    const { mid } = await ctx.max.sendMessage(target, payload.message);
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(outboundMessage)
        .set({ status: 'sent', mid, payload: null, sentAt: ctx.clock.now(), attempts: row.attempts + 1, error: null })
        .where(eq(outboundMessage.id, row.id));
      await afterSend(tx, ctx, payload.afterSend, mid);
    });
    return 'sent';
  } catch (err) {
    const error = err instanceof MaxApiError ? err : new MaxApiError('network', err instanceof Error ? err.message : 'error');
    const permanent = isPermanent(error);
    await ctx.db
      .update(outboundMessage)
      .set({ attempts: row.attempts + 1, error: `${error.kind}: ${error.message}`.slice(0, 300), ...(permanent ? { status: 'failed' as const, payload: null } : {}) })
      .where(eq(outboundMessage.id, row.id));
    // Бот не может писать пользователю — диалог остановлен.
    if (error.kind === 'forbidden' && 'userId' in target) {
      await ctx.db.update(maxUser).set({ dialogActive: false }).where(eq(maxUser.id, target.userId));
    }
    if (permanent) {
      ctx.log.warn({ outboundId: row.id, kind: row.kind, error: error.kind }, 'исходящее сообщение не отправлено');
      return 'failed';
    }
    throw error;
  }
}

async function afterSend(tx: Pick<Db, 'update' | 'insert'>, ctx: JobContext, action: AfterSend, mid: string): Promise<void> {
  switch (action.type) {
    case 'panel':
      await tx
        .update(houseChat)
        .set({ panelMid: mid, panelEditedAt: ctx.clock.now() })
        .where(and(eq(houseChat.houseId, action.houseId), eq(houseChat.chatId, action.chatId)));
      await ctx.queue.send(QUEUES.panelRender, { houseId: action.houseId, pin: true }, { tx: tx as unknown as TxLike });
      return;
    case 'card':
      await tx.update(chatCard).set({ mid, lastEditedAt: ctx.clock.now() }).where(eq(chatCard.incidentId, action.incidentId));
      return;
    case 'check_question':
      await tx.update(chatCard).set({ checkMid: mid }).where(eq(chatCard.incidentId, action.incidentId));
      return;
    case 'result':
      await tx.update(chatCard).set({ resultMid: mid }).where(eq(chatCard.incidentId, action.incidentId));
      return;
    case 'none':
      return;
  }
}
