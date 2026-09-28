/** Отправка в личку через журнал исходящих и ответы на нажатия. */
import type { BotMessage } from '@vsemdomom/core';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { maxUser, outboundMessage } from '../db/schema.ts';
import { MaxApiError } from '../max/types.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { QUEUES, type TxLike } from '../jobs/queue.ts';
import type { DialogState } from './types.ts';

type Tx = Pick<Db, 'insert' | 'select' | 'update'> & TxLike;

/** Сообщение в личку; key — стабильный ключ идемпотентности (от события). */
export async function sendDm(tx: Tx, ctx: JobContext, userId: number, message: BotMessage, key: string): Promise<void> {
  await enqueueOutbound(tx, ctx.queue, { kind: 'dm', idempotencyKey: `dm:${userId}:${key}`, target: { userId }, message });
}

/**
 * Сообщение-просьба в личке («Напишите номер заявки») после ответа текстом правится в «вопрос — ответ»:
 * его «Отмена» больше не нужна. Лучшее усилие: не нашли или MAX не дал править — сообщение просто остаётся.
 */
export async function answerDmPrompt(ctx: JobContext, userId: number, promptKey: string, message: BotMessage): Promise<void> {
  const [row] = await ctx.db
    .select({ mid: outboundMessage.mid })
    .from(outboundMessage)
    .where(and(eq(outboundMessage.idempotencyKey, `dm:${userId}:${promptKey}`), isNotNull(outboundMessage.mid)));
  if (!row?.mid) return;
  try {
    await ctx.max.editMessage(row.mid, message);
  } catch (err) {
    if (!(err instanceof MaxApiError)) throw err;
    ctx.log.warn({ kind: err.kind }, 'просьба в личке не исправлена');
  }
}

export interface CallbackAnswerJob {
  callbackId: string;
  chatId: number | null;
  notification: string;
  /** Новая версия сообщения с нажатой кнопкой (MAX заменит его). */
  message?: BotMessage;
}

export async function answerCallbackLater(tx: TxLike, ctx: JobContext, job: CallbackAnswerJob): Promise<void> {
  await ctx.queue.send(QUEUES.callbackAnswer, job, { tx, priority: 10 });
}

export async function setDialogState(tx: Pick<Db, 'update'>, ctx: JobContext, userId: number, state: DialogState | null): Promise<void> {
  await tx
    .update(maxUser)
    .set({ dialogState: state, dialogStateAt: state ? ctx.clock.now() : null })
    .where(eq(maxUser.id, userId));
}

const DAY_MS = 86_400_000;

/** Черновик диалога живёт сутки. */
export function activeDialogState(
  row: { dialogState: Record<string, unknown> | null; dialogStateAt: Date | null },
  now: Date,
  ttlHours: number,
): DialogState | null {
  if (!row.dialogState || !row.dialogStateAt) return null;
  if (now.getTime() - row.dialogStateAt.getTime() > (ttlHours * DAY_MS) / 24) return null;
  return row.dialogState as unknown as DialogState;
}
