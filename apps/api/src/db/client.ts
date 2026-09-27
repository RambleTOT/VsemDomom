import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

export function createDb(databaseUrl: string, options: { max?: number; applicationName?: string } = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'vsemdomom',
  });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    close: () => pool.end(),
  };
}

/** Запросы, которые одинаково выполняются в пуле и внутри транзакции. */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Нарушение уникальности PostgreSQL (23505) по конкретному ограничению; drizzle кладёт ошибку pg в cause. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const pgError = e as Error & { code?: string; constraint?: string };
    if (pgError.code === '23505') return pgError.constraint === constraint;
  }
  return false;
}
