/**
 * Обработка события MAX из очереди: диспетчер по типу события. Обработчики функций
 * (регистрация, карточка, привязка чата…) подключаются в registry; здесь — жизненный цикл
 * диалога с ботом. Повтор задачи безопасен: обработчики идемпотентны.
 */
import { eq, sql } from 'drizzle-orm';
import { inboundUpdate, maxUser } from '../db/schema.ts';
import type { UpdateJob } from '../webhook/ingest.ts';
import type { NormalizedUpdate } from '../max/update.ts';
import type { JobContext } from './context.ts';

export type UpdateHandler = (update: NormalizedUpdate, ctx: JobContext) => Promise<void>;
export type UpdateHandlers = Partial<Record<string, UpdateHandler[]>>;

/** Пользователь начал диалог — боту можно писать в личку. */
export const markDialogStarted: UpdateHandler = async (u, ctx) => {
  if (u.userId === null) return;
  await ctx.db
    .insert(maxUser)
    .values({ id: u.userId, dialogActive: true, locale: u.locale ?? null })
    .onConflictDoUpdate({
      target: maxUser.id,
      set: { dialogActive: true, locale: sql`coalesce(${u.locale ?? null}, ${maxUser.locale})` },
    });
};

/** Бот остановлен или диалог удалён — писать в личку нельзя. */
export const markDialogStopped: UpdateHandler = async (u, ctx) => {
  if (u.userId === null) return;
  await ctx.db.update(maxUser).set({ dialogActive: false }).where(eq(maxUser.id, u.userId));
};

export const baseHandlers: UpdateHandlers = {
  bot_started: [markDialogStarted],
  bot_stopped: [markDialogStopped],
  dialog_removed: [markDialogStopped],
};

/** Склеить наборы обработчиков: для одного типа события выполняются по порядку. */
export function mergeHandlers(...sets: UpdateHandlers[]): UpdateHandlers {
  const merged: UpdateHandlers = {};
  for (const set of sets) {
    for (const [type, list] of Object.entries(set)) merged[type] = [...(merged[type] ?? []), ...(list ?? [])];
  }
  return merged;
}

export async function processUpdate(job: UpdateJob, handlers: UpdateHandlers, ctx: JobContext): Promise<void> {
  const list = handlers[job.update.type] ?? [];
  try {
    for (const handler of list) await handler(job.update, ctx);
    await ctx.db
      .update(inboundUpdate)
      .set({ processedAt: ctx.clock.now(), error: null })
      .where(eq(inboundUpdate.dedupeKey, job.dedupeKey));
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : 'error';
    await ctx.db.update(inboundUpdate).set({ error: message }).where(eq(inboundUpdate.dedupeKey, job.dedupeKey));
    throw err;
  }
}
