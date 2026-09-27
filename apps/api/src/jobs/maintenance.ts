/**
 * Служебные задачи worker: сторож подписки webhook, чистка старых записей, алерты
 * о задачах, не выполненных после всех попыток.
 */
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { apiIdempotency, fakeMaxCall, inboundUpdate, incident, incidentParticipant } from '../db/schema.ts';
import { sendAlert } from '../bot/alerts.ts';
import { SUBSCRIBED_UPDATE_TYPES } from '../max/update.ts';
import type { JobContext } from './context.ts';

const MS_PER_DAY = 86_400_000;
const FAILED_WINDOW_MS = 10 * 60_000;
const FAILED_ALERT_THRESHOLD = 5;

export function webhookUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl}/webhook/max`;
}

/** Сторож подписки: если нашего URL нет среди подписок — подписаться заново и сообщить команде. */
export async function watchdog(ctx: JobContext): Promise<'ok' | 'restored' | 'skipped'> {
  if (ctx.config.max.mode !== 'webhook') return 'skipped';
  const url = webhookUrl(ctx.config.publicBaseUrl);
  const subscriptions = await ctx.max.listSubscriptions();
  if (subscriptions.some((s) => s.url === url)) return 'ok';
  try {
    await ctx.max.subscribe({ url, updateTypes: [...SUBSCRIBED_UPDATE_TYPES], secret: ctx.config.max.webhookSecret ?? '' });
    await sendAlert(ctx, ctx.i18n.t('bot.alert.subscription_restored', { url }));
    return 'restored';
  } catch (err) {
    await sendAlert(ctx, ctx.i18n.t('bot.alert.subscription_failed', { error: err instanceof Error ? err.message : 'ошибка' }));
    throw err;
  }
}

/** Чистка: события старше недели, журнал симулятора, ключи идемпотентности, незарегистрированные участники. */
export async function cleanup(ctx: JobContext): Promise<Record<string, number>> {
  const now = ctx.clock.now().getTime();
  const ago = (days: number) => new Date(now - days * MS_PER_DAY);
  const inbound = await ctx.db.delete(inboundUpdate).where(lt(inboundUpdate.receivedAt, ago(PARAMS.inboundUpdateRetentionDays))).returning();
  const fake = await ctx.db.delete(fakeMaxCall).where(lt(fakeMaxCall.createdAt, ago(PARAMS.inboundUpdateRetentionDays))).returning();
  const idem = await ctx.db.delete(apiIdempotency).where(lt(apiIdempotency.createdAt, ago(1))).returning();
  // Незарегистрированные участники удаляются через 30 дней после закрытия аварии.
  const closedLongAgo = ctx.db
    .select({ id: incident.id })
    .from(incident)
    .where(and(isNotNull(incident.closedAt), lt(incident.closedAt, ago(PARAMS.unregisteredRetentionDays))));
  const unregistered = await ctx.db
    .delete(incidentParticipant)
    .where(and(isNull(incidentParticipant.residencyId), eq(incidentParticipant.isModel, false), inArray(incidentParticipant.incidentId, closedLongAgo)))
    .returning();
  const result = { inbound: inbound.length, fakeCalls: fake.length, idempotency: idem.length, unregistered: unregistered.length };
  ctx.log.info(result, 'чистка выполнена');
  return result;
}

/** Задачи, упавшие после всех попыток: лог и алерт, если их больше 5 за 10 минут. */
export class FailedJobsMonitor {
  private readonly times: number[] = [];
  private lastAlert = 0;

  async onFailed(ctx: JobContext, info: { queue: string; id: string }): Promise<void> {
    ctx.log.error(info, 'задача не выполнена после всех попыток');
    const now = ctx.clock.now().getTime();
    this.times.push(now);
    while (this.times.length > 0 && (this.times[0] ?? now) < now - FAILED_WINDOW_MS) this.times.shift();
    if (this.times.length > FAILED_ALERT_THRESHOLD && now - this.lastAlert > FAILED_WINDOW_MS) {
      this.lastAlert = now;
      await sendAlert(ctx, ctx.i18n.t('bot.alert.jobs_failed', { count: this.times.length }));
    }
  }
}
