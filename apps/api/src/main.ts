/** Процесс api: REST для мини-приложения, webhook MAX, проверки /health и /ready. */
import { ConfigError, loadConfig } from './config/env.ts';
import { createDb } from './db/client.ts';
import { dbCheck, migrationsCheck } from './db/readiness.ts';
import { buildApp } from './http/app.ts';
import { createLogger } from './logger.ts';
import { resolveDataDir } from './util/paths.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel, 'api');
  const handle = createDb(config.databaseUrl, { applicationName: 'vsemdomom-api' });
  const migrationsFolder = resolveDataDir(process.env.MIGRATIONS_DIR, 'db/migrations');
  const app = await buildApp({
    config,
    log,
    readiness: [dbCheck(handle), migrationsCheck(handle, migrationsFolder)],
  });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'остановка api');
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.httpPort });
  log.info({ port: config.httpPort, maxMode: config.max.mode, commit: config.build.commit }, 'api запущен');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof ConfigError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
