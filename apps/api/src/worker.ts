/**
 * Процесс worker: очередь задач, таймеры, отправка в MAX, сторож подписки,
 * long polling (MAX_MODE=polling). Файл-пульс — для healthcheck в compose.
 */
import { writeFile } from 'node:fs/promises';
import { keywordMatcher } from '@vsemdomom/core';
import { ruTranslator } from '@vsemdomom/shared';
import { sql } from 'drizzle-orm';
import { botJobHandlers, botUpdateHandlers } from './bot/index.ts';
import { ConfigError, loadConfig } from './config/env.ts';
import { KEYWORD_PHRASES } from './config/params.ts';
import { createDb } from './db/client.ts';
import type { JobContext } from './jobs/context.ts';
import { createBoss, ensureQueues, PgBossQueue } from './jobs/queue.ts';
import { startWorkers } from './jobs/runtime.ts';
import { createLogger } from './logger.ts';
import { createMaxApi } from './max/factory.ts';
import { runPolling } from './max/polling.ts';
import { systemClock } from './util/clock.ts';
import { ingestUpdate } from './webhook/ingest.ts';

const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/vsemdomom-worker.alive';
const HEARTBEAT_EVERY_MS = 10_000;
const STOP_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel, 'worker');
  const handle = createDb(config.databaseUrl, { max: 8, applicationName: 'vsemdomom-worker' });
  const boss = createBoss({ databaseUrl: config.databaseUrl, sendOnly: false, log, applicationName: 'vsemdomom-worker-boss' });
  await boss.start();
  await ensureQueues(boss);
  const queue = new PgBossQueue(boss);
  const max = createMaxApi(config, { db: handle.db, log, clock: systemClock });
  const ctx: JobContext = { config, db: handle.db, queue, max, log, clock: systemClock, i18n: ruTranslator };

  await startWorkers(boss, ctx, botUpdateHandlers, botJobHandlers);

  const polling = new AbortController();
  if (config.max.mode === 'polling') {
    const matcher = config.features.keywordReply ? keywordMatcher(KEYWORD_PHRASES) : null;
    void runPolling({
      max,
      ingest: (u) => ingestUpdate({ db: handle.db, queue, keywordMatcher: matcher }, u),
      log,
      signal: polling.signal,
    });
  }

  const beat = async () => {
    try {
      await handle.db.execute(sql`select 1`);
      await writeFile(HEARTBEAT_FILE, new Date().toISOString());
    } catch (err) {
      log.error({ err }, 'пульс worker: БД недоступна');
    }
  };
  await beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_EVERY_MS);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'остановка worker');
    clearInterval(timer);
    polling.abort();
    await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  log.info({ maxMode: config.max.mode, max: max.kind }, 'worker запущен');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
