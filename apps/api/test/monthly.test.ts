import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthlySummaryJob } from '../src/services/monthly.ts';
import { createHarness, fakeChat, STAFF_ID, updates, type Harness } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const msk = (s: string) => new Date(`${s}+03:00`);

describe.skipIf(!url)('F15: итог месяца в чат дома', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness(url!, { chats: [fakeChat(CHAT)] });
    await h.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
  });
  afterAll(async () => {
    await h?.close();
  });

  const summaries = () => h.max.messagesIn({ chatId: CHAT }).filter((m) => m.message.text.includes(' в доме 1: '));

  it('1-го числа до 10:00 по времени дома — рано; в 10:05 — итог прошедшего месяца', async () => {
    h.clock.set(msk('2026-10-01T09:30:00'));
    expect(await monthlySummaryJob(h.ctx)).toBe(0);
    h.clock.set(msk('2026-10-01T10:05:00'));
    expect(await monthlySummaryJob(h.ctx)).toBe(1);
    await h.drain();
    const [summary] = summaries();
    const text = summary!.message.text.split('\n');
    expect(text[0]).toMatch(/^\*\*Сентябрь в доме 1: \d+ авари(я|и|й), \d+ устранен[аы] в норматив\*\*$/);
    expect(text.at(-1)).toBe('Модельные данные');
    expect(summary!.message.keyboard).toEqual([[{ type: 'open_app', text: 'Подробнее', webApp: expect.any(String), payload: 'h_dom1model1' }]]);
    expect(summary!.message.text).not.toMatch(/кв\.\s*\d/);
  });

  it('повторный запуск в тот же день не шлёт второе сообщение; 2-го числа и в тихие часы — ничего', async () => {
    h.clock.set(msk('2026-10-01T11:05:00'));
    expect(await monthlySummaryJob(h.ctx)).toBe(0);
    h.clock.set(msk('2026-10-01T22:30:00'));
    expect(await monthlySummaryJob(h.ctx)).toBe(0);
    h.clock.set(msk('2026-10-02T10:05:00'));
    expect(await monthlySummaryJob(h.ctx)).toBe(0);
    await h.drain();
    expect(summaries()).toHaveLength(1);
  });

  it('флаг FEATURE_MONTHLY_SUMMARY выключен — итога нет', async () => {
    h.clock.set(msk('2026-11-01T10:05:00'));
    const off = { ...h.ctx, config: { ...h.ctx.config, features: { ...h.ctx.config.features, monthlySummary: false } } };
    expect(await monthlySummaryJob(off)).toBe(0);
    expect(await monthlySummaryJob(h.ctx)).toBe(1);
  });
});
