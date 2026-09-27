import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { runSeeds } from '../src/db/seed.ts';
import { freshDb, seedsDir, testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const log = pino({ level: 'silent' });

describe.skipIf(!url)('миграции и сиды (PostgreSQL)', () => {
  let handle: DbHandle;
  const now = new Date('2026-09-27T10:00:00Z');

  beforeAll(async () => {
    handle = await freshDb(url!);
  });
  afterAll(async () => {
    await handle?.close();
  });

  const count = async (table: string) =>
    (await handle.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`))).rows[0]!.n;

  it('сиды применяются и повторный запуск ничего не дублирует', async () => {
    const first = await runSeeds(handle.db, { seedsDir, staffMaxIds: [123, 456], now, log });
    expect(first).toMatchObject({ companies: 1, houses: 5, history: 3, checkers: 3, staff: 2 });
    const snapshot = {
      norm: await count('norm'),
      house: await count('house'),
      incident: await count('incident'),
      residency: await count('residency'),
      staff: await count('staff'),
      max_user: await count('max_user'),
    };
    await runSeeds(handle.db, { seedsDir, staffMaxIds: [123, 456], now, log });
    expect({
      norm: await count('norm'),
      house: await count('house'),
      incident: await count('incident'),
      residency: await count('residency'),
      staff: await count('staff'),
      max_user: await count('max_user'),
    }).toEqual(snapshot);
    expect(snapshot.norm).toBeGreaterThan(30);
  });

  it('дом-песочница помечен и без чата; модельные дома помечены', async () => {
    const rows = await handle.db.execute<{ public_id: string; is_sandbox: boolean; is_model: boolean }>(
      sql`select public_id, is_sandbox, is_model from house order by public_id`,
    );
    expect(rows.rows.filter((r) => r.is_sandbox).map((r) => r.public_id)).toEqual(['dom5sandbx']);
    expect(rows.rows.every((r) => r.is_model)).toBe(true);
    expect(await count('house_chat')).toBe(0);
  });

  it('история ГВС в доме 1 — 6 часов в текущем месяце', async () => {
    const r = await handle.db.execute<{ minutes: number }>(
      sql`select extract(epoch from (resolved_at_uk - started_at))::int / 60 as minutes from incident where public_id = 'hist1gvs06'`,
    );
    expect(r.rows[0]?.minutes).toBe(360);
  });

  it('частичный уникальный индекс не даёт открыть вторую аварию того же вида в доме', async () => {
    const house = (await handle.db.execute<{ id: number }>(sql`select id from house where public_id = 'dom1model1'`)).rows[0]!.id;
    const insert = (publicId: string, scope: string) =>
      handle.db.execute(sql`
        insert into incident (public_id, house_id, service_type, scope, status, started_at, started_source)
        values (${publicId}, ${house}, 'cold_water', ${scope}, 'open', now(), 'now')`);
    await insert('dupTest001', 'house');
    await expect(insert('dupTest002', 'entrance')).rejects.toThrow();
    // «только в моей квартире» дублем не считается
    await insert('dupTest003', 'flat');
    await handle.db.execute(sql`delete from incident where public_id like 'dupTest%'`);
  });

  it('в таблицах нет колонок для имён и телефонов', async () => {
    const cols = await handle.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const forbidden of ['first_name', 'last_name', 'phone', 'full_name', 'fio', 'statement', 'application_text']) {
      expect(names).not.toContain(forbidden);
    }
  });
});
