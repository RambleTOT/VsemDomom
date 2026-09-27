/**
 * «Отправить себе в чат» (F09): бот присылает заявление в личку синхронным вызовом MAX
 * (тайм-аут клиента 10 с, одна повторная попытка). Текст с ФИО и телефоном не попадает
 * ни в очередь, ни в таблицы, ни в журналы: вызов помечен sensitive, ошибки логируются без тела.
 */
import { MAX_LIMITS, renderStatement } from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { userById } from '../db/queries.ts';
import { maxUser } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { MaxApiError } from '../max/types.ts';

export type StatementResult = 'sent' | 'dialog_not_started' | 'max_unavailable' | 'text_too_long';

/** Всего попыток: первая и одна повторная. */
const ATTEMPTS = 2;

export async function sendStatementToDm(ctx: JobContext, userId: number, text: string): Promise<StatementResult> {
  const user = await userById(ctx.db, userId);
  if (!user?.dialogActive) return 'dialog_not_started';
  const message = renderStatement(text, ctx.i18n);
  if (message.text.length > MAX_LIMITS.messageText) return 'text_too_long';
  try {
    await ctx.max.sendMessage({ userId }, message, { sensitive: true, attempts: ATTEMPTS });
    return 'sent';
  } catch (err) {
    if (err instanceof MaxApiError && err.kind === 'forbidden') {
      // Бот остановлен — писать в личку нельзя, пока житель снова не нажмёт «Старт».
      await ctx.db.update(maxUser).set({ dialogActive: false }).where(eq(maxUser.id, userId));
      return 'dialog_not_started';
    }
    ctx.log.warn({ kind: err instanceof MaxApiError ? err.kind : 'error' }, 'заявление не отправлено в личку');
    return 'max_unavailable';
  }
}
