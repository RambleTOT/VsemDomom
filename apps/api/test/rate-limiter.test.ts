import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/max/rate-limiter.ts';

function setup(globalRps = 25) {
  let now = 0;
  const slept: number[] = [];
  const limiter = new RateLimiter({
    globalRps,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  });
  return { limiter, slept, advance: (ms: number) => (now += ms), now: () => now };
}

describe('лимиты частоты запросов к MAX', () => {
  it('в один чат — не больше двух вызовов в секунду: слоты с шагом 500 мс', () => {
    const { limiter } = setup();
    const waits = [0, 1, 2, 3].map(() => limiter.reserve('send:chat:-1', 500));
    expect(waits).toEqual([0, 500, 1000, 1500]);
  });

  it('разные чаты не ждут друг друга', () => {
    const { limiter } = setup();
    expect(limiter.reserve('send:chat:-1', 500)).toBe(0);
    expect(limiter.reserve('send:chat:-2', 500)).toBe(0);
  });

  it('acquire ждёт слот чата, затем общий слот бота', async () => {
    const { limiter, slept } = setup(25);
    await limiter.acquire('answer:chat:-1', 2);
    await limiter.acquire('answer:chat:-1', 2);
    expect(slept).toEqual([500]);
  });

  it('perSecond = 0 — без лимита по ключу, только общий', async () => {
    const { limiter, slept } = setup(1000);
    for (let i = 0; i < 5; i += 1) await limiter.acquire('answer:chat:-1', 0);
    expect(slept.every((ms) => ms <= 1)).toBe(true);
  });

  it('общий лимит 25 rps: 30 вызовов растягиваются больше чем на секунду', async () => {
    const { limiter, now } = setup(25);
    for (let i = 0; i < 30; i += 1) await limiter.acquire(null, 0);
    expect(now()).toBeGreaterThanOrEqual(1160);
  });
});
