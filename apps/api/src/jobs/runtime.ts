/**
 * Рабочий цикл worker: регистрирует обработчики очередей, расписания служебных задач
 * и (в режиме polling) цикл получения событий.
 */
import type { PgBoss, WorkOptions } from 'pg-boss';
import type { JobContext } from './context.ts';
import { cleanup, FailedJobsMonitor, watchdog } from './maintenance.ts';
import { processUpdate, type UpdateHandlers } from './process-update.ts';
import { QUEUES, type QueueName } from './queue.ts';
import type { UpdateJob } from '../webhook/ingest.ts';

export type JobHandler = (data: never, ctx: JobContext) => Promise<unknown>;
export type JobHandlers = Partial<Record<QueueName, JobHandler>>;

/** Параметры выборки: события и ответы нажавшим — быстро и параллельно. */
const WORK_OPTIONS: Partial<Record<QueueName, WorkOptions>> = {
  [QUEUES.update]: { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 0.5 },
  [QUEUES.callbackAnswer]: { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 0.5 },
  [QUEUES.outbound]: { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 0.5 },
  [QUEUES.cardRender]: { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 0.5 },
};
const DEFAULT_WORK: WorkOptions = { batchSize: 1, pollingIntervalSeconds: 1 };

/** Сторож подписки — раз в 10 минут; чистка — ночью; итог месяца — раз в час (F15). */
export const SCHEDULES: { queue: QueueName; cron: string }[] = [
  { queue: QUEUES.watchdog, cron: '*/10 * * * *' },
  { queue: QUEUES.cleanup, cron: '17 3 * * *' },
  { queue: QUEUES.monthly, cron: '5 * * * *' },
];

export async function startWorkers(boss: PgBoss, ctx: JobContext, updateHandlers: UpdateHandlers, extra: JobHandlers = {}): Promise<void> {
  const failed = new FailedJobsMonitor();
  const handlers: JobHandlers = {
    [QUEUES.update]: (data: UpdateJob) => processUpdate(data, updateHandlers, ctx),
    [QUEUES.watchdog]: () => watchdog(ctx),
    [QUEUES.cleanup]: () => cleanup(ctx),
    ...extra,
  };

  for (const [queue, handler] of Object.entries(handlers) as [QueueName, JobHandler][]) {
    await boss.work<object>(queue, WORK_OPTIONS[queue] ?? DEFAULT_WORK, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data as never, ctx);
      }
    });
  }
  await boss.work<object>(QUEUES.failed, DEFAULT_WORK, async (jobs) => {
    for (const job of jobs) await failed.onFailed(ctx, { queue: job.name, id: job.id });
  });
  for (const s of SCHEDULES) await boss.schedule(s.queue, s.cron, null, { tz: 'UTC' });
}
