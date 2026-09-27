import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { ReadinessCheck } from '../http/types.ts';
import type { DbHandle } from './client.ts';

export function dbCheck(handle: DbHandle): ReadinessCheck {
  return {
    name: 'db',
    async check() {
      await handle.db.execute(sql`select 1`);
      return { ok: true };
    },
  };
}

/** Все миграции из журнала drizzle применены. */
export function migrationsCheck(handle: DbHandle, migrationsFolder: string): ReadinessCheck {
  let expected: number | null = null;
  return {
    name: 'migrations',
    async check() {
      if (expected === null) {
        const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
          entries: unknown[];
        };
        expected = journal.entries.length;
      }
      const res = await handle.db.execute<{ n: number }>(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      const applied = res.rows[0]?.n ?? 0;
      return applied >= expected ? { ok: true } : { ok: false, detail: `применено ${applied} из ${expected}` };
    },
  };
}
