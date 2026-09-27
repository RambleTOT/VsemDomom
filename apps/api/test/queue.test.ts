import { sql } from 'drizzle-orm';
import { pino } from 'pino';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { inboundUpdate } from '../src/db/schema.ts';
import { BOSS_SCHEMA, createBoss, ensureQueues, PgBossQueue, QUEUES } from '../src/jobs/queue.ts';
import { freshDb, testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();

describe.skipIf(!url)('очередь pg-boss в той же транзакции (PostgreSQL)', () => {
  let handle: DbHandle;
  let boss: PgBoss;
  let queue: PgBossQueue;

  beforeAll(async () => {
    handle = await freshDb(url!);
    await handle.db.execute(sql.raw(`drop schema if exists ${BOSS_SCHEMA} cascade`));
    boss = createBoss({ databaseUrl: url!, sendOnly: true, log: pino({ level: 'silent' }), applicationName: 'test' });
    await boss.start();
    await ensureQueues(boss);
    await ensureQueues(boss); // идемпотентно
    queue = new PgBossQueue(boss);
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await handle?.close();
  });

  const jobsWith = async (marker: string) => {
    const r = await handle.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${BOSS_SCHEMA}.job where data->>'marker' = '${marker}'`));
    return r.rows[0]?.n ?? 0;
  };

  it('задача видна после коммита транзакции', async () => {
    await handle.db.transaction(async (tx) => {
      await tx.insert(inboundUpdate).values({ dedupeKey: 'k1', updateType: 't' });
      await queue.send(QUEUES.update, { marker: 'commit' }, { tx });
    });
    expect(await jobsWith('commit')).toBe(1);
  });

  it('откат транзакции убирает и данные, и задачу', async () => {
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(inboundUpdate).values({ dedupeKey: 'k2', updateType: 't' });
        await queue.send(QUEUES.update, { marker: 'rollback' }, { tx });
        throw new Error('откат');
      }),
    ).rejects.toThrow('откат');
    expect(await jobsWith('rollback')).toBe(0);
    const rows = await handle.db.execute<{ n: number }>(sql`select count(*)::int as n from inbound_update where dedupe_key = 'k2'`);
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('отложенная задача и задача с ключом-одиночкой', async () => {
    const at = new Date(Date.now() + 3_600_000);
    await queue.send(QUEUES.deadline, { marker: 'later' }, { startAfter: at, singletonKey: 'deadline:1:due' });
    expect(await jobsWith('later')).toBe(1);
    await queue.sendDebounced(QUEUES.cardRender, { marker: 'card' }, 2, 'card:1');
    await queue.sendDebounced(QUEUES.cardRender, { marker: 'card' }, 2, 'card:1');
    expect(await jobsWith('card')).toBeLessThanOrEqual(2);
  });
});
