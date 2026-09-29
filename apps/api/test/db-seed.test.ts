import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { refreshModelHistory, runSeeds } from '../src/db/seed.ts';
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
    expect(first).toMatchObject({ companies: 1, houses: 5, history: 6, checkers: 3, staff: 2 });
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

  it('история: авария в доме 2 — в норматив, в доме 3 — сверх норматива (сроки из справочника)', async () => {
    const rows = await handle.db.execute<{ public_id: string; overdue: boolean; single: boolean; statuses: string }>(sql`
      select i.public_id, i.overdue, i.single_limit_exceeded as single,
             string_agg(d.kind || ':' || d.status, ',' order by d.kind) as statuses
      from incident i join deadline d on d.incident_id = i.id
      where i.public_id in ('hist2hvs01', 'hist3gvs11')
      group by i.public_id, i.overdue, i.single_limit_exceeded
      order by i.public_id`);
    expect(rows.rows).toEqual([
      { public_id: 'hist2hvs01', overdue: false, single: false, statuses: 'answer:met,fix:met,localize:met,single_limit:met' },
      { public_id: 'hist3gvs11', overdue: true, single: true, statuses: 'answer:breached,fix:met,localize:breached,single_limit:breached' },
    ]);
  });

  it('история дома 4 для эксперта: ГВС 6 ч во всём доме, ХВС 1 ч 10 мин в подъезде 2, свет 50 мин', async () => {
    const r = await handle.db.execute<{ public_id: string; scope: string; entrance: number | null; minutes: number }>(
      sql`select i.public_id, i.scope, i.entrance, extract(epoch from (i.resolved_at_uk - i.started_at))::int / 60 as minutes
          from incident i join house h on h.id = i.house_id where h.public_id = 'dom4model4' order by i.public_id`,
    );
    expect(r.rows).toEqual([
      { public_id: 'hist4ele01', scope: 'house', entrance: null, minutes: 50 },
      { public_id: 'hist4gvs06', scope: 'house', entrance: null, minutes: 360 },
      { public_id: 'hist4xvs01', scope: 'entrance', entrance: 2, minutes: 70 },
    ]);
  });

  it('история переезжает в текущий месяц раз в час: после смены месяца и пока в начале месяца она укорочена', async () => {
    const started = async () =>
      (await handle.db.execute<{ at: string; minutes: number }>(
        sql`select to_char(started_at at time zone 'Europe/Moscow', 'MM-DD HH24:MI') as at, extract(epoch from (resolved_at_uk - started_at))::int / 60 as minutes from incident where public_id = 'hist1gvs06'`,
      )).rows[0];
    // В том же месяце история уже на своих местах — ничего не пересоздаётся.
    expect(await refreshModelHistory(handle.db, { seedsDir, now: new Date('2026-09-27T11:00:00Z'), log })).toBe(0);
    // 1 октября, 06:00 по Москве: история прошлого месяца переезжает; места пока мало — ГВС сдвинута к началу месяца и укорочена.
    expect(await refreshModelHistory(handle.db, { seedsDir, now: new Date('2026-10-01T03:00:00Z'), log })).toBe(4);
    expect(await started()).toEqual({ at: '10-01 00:00', minutes: 355 });
    // Через час ГВС дома 1 помещается целиком — 6 ч (дома 1, 3 и 4 пересозданы: их история была укорочена).
    expect(await refreshModelHistory(handle.db, { seedsDir, now: new Date('2026-10-01T04:00:00Z'), log })).toBe(3);
    expect(await started()).toEqual({ at: '10-01 00:55', minutes: 360 });
    // 5 октября: история на плановых местах (2-е число, 08:00, 6 ч); у дома 4 аварии 9-го и 17-го пока стоят раньше и не пересоздаются каждый час.
    expect(await refreshModelHistory(handle.db, { seedsDir, now: new Date('2026-10-05T10:00:00Z'), log })).toBe(4);
    expect(await started()).toEqual({ at: '10-02 08:00', minutes: 360 });
    expect(await refreshModelHistory(handle.db, { seedsDir, now: new Date('2026-10-05T11:00:00Z'), log })).toBe(0);
    // Сиды других тестов в этом файле идут от сентября — вернём историю на место.
    await runSeeds(handle.db, { seedsDir, staffMaxIds: [123, 456], now, log });
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
