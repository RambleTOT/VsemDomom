import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { incident, outboundMessage } from '../src/db/schema.ts';
import { enqueueOutbound, INCIDENT_MESSAGE_BUDGET, OutboundBudgetError, sendOutbound } from '../src/jobs/outbound.ts';
import { QUEUES } from '../src/jobs/queue.ts';
import { MaxApiError } from '../src/max/types.ts';
import { createHarness, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const message = (text: string) => ({ text, format: 'markdown' as const, keyboard: [] });

describe.skipIf(!url)('журнал исходящих сообщений (PostgreSQL + симулятор)', () => {
  let h: Harness;
  let incidentId = 0;

  beforeAll(async () => {
    h = await createHarness(url!);
    const [row] = await h.handle.db.select({ id: incident.id }).from(incident).where(eq(incident.publicId, 'hist1gvs06'));
    incidentId = row!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  const enqueue = (kind: 'card_create' | 'check_question' | 'result' | 'dm', key: string) =>
    h.handle.db.transaction((tx) =>
      enqueueOutbound(tx, h.queue, { kind, idempotencyKey: key, target: { chatId: CHAT }, message: message(key), incidentId }),
    );

  it('один ключ — одна строка и одна задача', async () => {
    const first = await enqueue('card_create', `card:create:${incidentId}`);
    expect(first).toBeTypeOf('number');
    expect(await enqueue('card_create', `card:create:${incidentId}`)).toBeNull();
    expect(h.queue.take(QUEUES.outbound)).toEqual([{ id: first }]);
  });

  it('бюджет новых сообщений аварии: не больше трёх, повтор ключа не считается', async () => {
    expect(INCIDENT_MESSAGE_BUDGET).toBe(3);
    await enqueue('check_question', `check:${incidentId}`);
    await enqueue('result', `result:${incidentId}`);
    await expect(enqueue('result', `result:${incidentId}`)).resolves.toBeNull();
    await expect(enqueue('card_create', `card:create:${incidentId}:again`)).rejects.toBeInstanceOf(OutboundBudgetError);
    // Сообщения вне бюджета (например, в личку) не ограничиваются.
    await expect(enqueue('dm', `dm:any:${incidentId}`)).resolves.toBeTypeOf('number');
    h.queue.take(QUEUES.outbound);
  });

  it('временная ошибка MAX: задача повторяется, сообщение уходит один раз', async () => {
    const id = (await h.handle.db.transaction((tx) =>
      enqueueOutbound(tx, h.queue, { kind: 'dm', idempotencyKey: 'retry:1', target: { chatId: CHAT }, message: message('повтор') }),
    ))!;
    h.max.failNext({ operation: 'sendMessage', kind: 'rate_limited', times: 1, retryAfterMs: 1000 });
    await expect(sendOutbound(h.ctx, { id })).rejects.toBeInstanceOf(MaxApiError);
    let [row] = await h.handle.db.select().from(outboundMessage).where(eq(outboundMessage.id, id));
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row?.payload).not.toBeNull();

    expect(await sendOutbound(h.ctx, { id })).toBe('sent');
    expect(await sendOutbound(h.ctx, { id })).toBe('skipped');
    [row] = await h.handle.db.select().from(outboundMessage).where(eq(outboundMessage.id, id));
    expect(row).toMatchObject({ status: 'sent', attempts: 2, payload: null });
    expect(row?.mid).toMatch(/^mid\.fake\./);
    expect(h.max.messagesIn({ chatId: CHAT }).filter((m) => m.message.text === 'повтор')).toHaveLength(1);
  });

  it('постоянная ошибка (400): без повторов, тело удалено', async () => {
    const id = (await h.handle.db.transaction((tx) =>
      enqueueOutbound(tx, h.queue, { kind: 'dm', idempotencyKey: 'bad:1', target: { chatId: CHAT }, message: message('x'.repeat(4001)) }),
    ))!;
    expect(await sendOutbound(h.ctx, { id })).toBe('failed');
    const [row] = await h.handle.db.select().from(outboundMessage).where(eq(outboundMessage.id, id));
    expect(row).toMatchObject({ status: 'failed', payload: null });
    expect(row?.error).toContain('bad_request');
  });
});
