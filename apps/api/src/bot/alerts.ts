import type { JobContext } from '../jobs/context.ts';

/** Алерт команде в личку ALERT_USER_ID. Не бросает ошибок: алерт не должен ронять задачу. */
export async function sendAlert(ctx: Pick<JobContext, 'config' | 'max' | 'log'>, text: string): Promise<void> {
  const userId = ctx.config.alertUserId;
  ctx.log.warn({ alert: text }, 'алерт');
  if (userId === undefined) return;
  try {
    await ctx.max.sendMessage({ userId }, { text, format: 'markdown', keyboard: [] });
  } catch (err) {
    ctx.log.error({ err }, 'алерт: не удалось отправить');
  }
}
