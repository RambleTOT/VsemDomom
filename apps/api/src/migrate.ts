/**
 * Процесс migrate (однократный): миграции drizzle, схема очереди pg-boss и очереди,
 * идемпотентные сиды. Каталоги: MIGRATIONS_DIR и SEEDS_DIR, по умолчанию — поиск вверх.
 */
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ConfigError, loadMigrateConfig } from './config/env.ts';
import { createDb } from './db/client.ts';
import { runSeeds } from './db/seed.ts';
import { createBoss, ensureQueues } from './jobs/queue.ts';
import { createLogger } from './logger.ts';
import { resolveDataDir } from './util/paths.ts';

async function main(): Promise<void> {
  const config = loadMigrateConfig();
  const log = createLogger(config.logLevel, 'migrate');
  const migrationsFolder = resolveDataDir(process.env.MIGRATIONS_DIR, 'db/migrations');
  const seedsDir = resolveDataDir(process.env.SEEDS_DIR, 'seeds');
  const handle = createDb(config.databaseUrl, { max: 2, applicationName: 'vsemdomom-migrate' });
  try {
    await migrate(handle.db, { migrationsFolder });
    log.info({ migrationsFolder }, 'миграции применены');
    // Схема pg-boss ставится здесь, чтобы api и worker стартовали на готовой очереди.
    const boss = createBoss({ databaseUrl: config.databaseUrl, sendOnly: true, log, applicationName: 'vsemdomom-migrate-boss' });
    await boss.start();
    await ensureQueues(boss);
    await boss.stop({ graceful: false });
    log.info('очереди pg-boss готовы');
    await runSeeds(handle.db, { seedsDir, staffMaxIds: config.seedStaffMaxIds, log });
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(`migrate: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  }
  process.exit(1);
});
