/**
 * Процесс worker: очередь задач, таймеры, отправка в MAX, сторож подписки.
 * Пока — каркас: проверка БД и файл-пульс для healthcheck в compose.
 */
import { writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { ConfigError, loadConfig } from './config/env.ts';
import { createDb } from './db/client.ts';
import { createLogger } from './logger.ts';

const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/vsemdomom-worker.alive';
const HEARTBEAT_EVERY_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel, 'worker');
  const handle = createDb(config.databaseUrl, { max: 5, applicationName: 'vsemdomom-worker' });

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

  const stop = async (signal: string) => {
    log.info({ signal }, 'остановка worker');
    clearInterval(timer);
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  log.info({ maxMode: config.max.mode }, 'worker запущен');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
