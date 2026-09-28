/** Процесс api: REST для мини-приложения, webhook MAX, проверки /health и /ready. */
import { keywordMatcher } from '@vsemdomom/core';
import { ruTranslator } from '@vsemdomom/shared';
import { ConfigError, loadConfig } from './config/env.ts';
import { KEYWORD_PHRASES } from './config/params.ts';
import { createDb } from './db/client.ts';
import { dbCheck, migrationsCheck } from './db/readiness.ts';
import { buildApp } from './http/app.ts';
import { createBoss, PgBossQueue } from './jobs/queue.ts';
import { createLogger } from './logger.ts';
import { createMaxApi } from './max/factory.ts';
import { maxCheck } from './max/readiness.ts';
import { systemClock } from './util/clock.ts';
import { resolveDataDir } from './util/paths.ts';
import { userUpdateThrottle } from './webhook/ingest.ts';

const STOP_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel, 'api');
  const handle = createDb(config.databaseUrl, { applicationName: 'vsemdomom-api' });
  const migrationsFolder = resolveDataDir(process.env.MIGRATIONS_DIR, 'db/migrations');
  // api только ставит задачи: обслуживание очередей и расписания — в worker.
  const boss = createBoss({ databaseUrl: config.databaseUrl, sendOnly: true, log, applicationName: 'vsemdomom-api-boss' });
  await boss.start();
  const queue = new PgBossQueue(boss);
  const max = createMaxApi(config, { db: handle.db, log, clock: systemClock });

  const app = await buildApp({
    config,
    log,
    readiness: [dbCheck(handle), migrationsCheck(handle, migrationsFolder), maxCheck(max)],
    webhook: {
      db: handle.db,
      queue,
      keywordMatcher: config.features.keywordReply ? keywordMatcher(KEYWORD_PHRASES) : null,
      throttle: userUpdateThrottle(log),
    },
    api: { config, db: handle.db, queue, max, log, clock: systemClock, i18n: ruTranslator },
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'остановка api');
    await app.close();
    await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.httpPort });
  log.info({ port: config.httpPort, maxMode: config.max.mode, max: max.kind, commit: config.build.commit }, 'api запущен');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
