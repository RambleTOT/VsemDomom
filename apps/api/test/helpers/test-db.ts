import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { resolveDataDir } from '../../src/util/paths.ts';

/**
 * База для интеграционных тестов. Берётся из TEST_DATABASE_URL; имя базы обязано
 * заканчиваться на _test — тест пересоздаёт схемы и не должен попасть в рабочую базу.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) throw new Error(`TEST_DATABASE_URL должен указывать на базу *_test, а не «${name}»`);
  return url;
}

export const migrationsFolder = resolveDataDir(undefined, 'db/migrations');
export const seedsDir = resolveDataDir(undefined, 'seeds');

/** Чистая схема + миграции. */
export async function freshDb(url: string): Promise<DbHandle> {
  const handle = createDb(url, { max: 4, applicationName: 'vsemdomom-test' });
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await migrate(handle.db, { migrationsFolder });
  return handle;
}
