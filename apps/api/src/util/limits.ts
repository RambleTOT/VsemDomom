/**
 * Ограничители частоты в памяти процесса (защита от флуда и перебора). Ключ — MAX user id.
 * Состояние живёт до перезапуска процесса: этого достаточно против всплесков, а постоянные
 * ограничения (лимит аварий) считаются по базе.
 */

/** Сколько ключей держать, прежде чем чистить неактивные. */
const MAX_TRACKED = 10_000;

interface Bucket {
  tokens: number;
  at: number;
  /** Отказ уже был в этой серии — повторные отказы не логируются. */
  rejected: boolean;
}

export interface BucketDecision {
  ok: boolean;
  /** Первый отказ в серии: пора записать предупреждение. */
  firstReject: boolean;
}

/** Корзина токенов: всплеск до `burst` событий, затем не чаще одного за `refillMs`. */
export class TokenBuckets {
  private readonly buckets = new Map<number, Bucket>();
  private readonly burst: number;
  private readonly refillMs: number;

  constructor(burst: number, refillMs: number) {
    this.burst = burst;
    this.refillMs = refillMs;
  }

  take(key: number, nowMs: number): BucketDecision {
    const prev = this.buckets.get(key);
    const tokens = prev ? Math.min(this.burst, prev.tokens + (nowMs - prev.at) / this.refillMs) : this.burst;
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: nowMs, rejected: true });
      return { ok: false, firstReject: !prev?.rejected };
    }
    this.buckets.set(key, { tokens: tokens - 1, at: nowMs, rejected: false });
    this.prune(nowMs);
    return { ok: true, firstReject: false };
  }

  private prune(nowMs: number): void {
    if (this.buckets.size <= MAX_TRACKED) return;
    const refilledAfter = this.burst * this.refillMs;
    for (const [key, b] of this.buckets) if (nowMs - b.at >= refilledAfter) this.buckets.delete(key);
  }
}

/** Неудачные попытки: после `max` неудач за `windowMs` новые попытки отклоняются до конца окна. */
export class FailureWindow {
  private readonly failures = new Map<number, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(key: number, nowMs: number): boolean {
    return this.recent(key, nowMs).length >= this.max;
  }

  fail(key: number, nowMs: number): void {
    const list = this.recent(key, nowMs);
    list.push(nowMs);
    this.failures.set(key, list);
    if (this.failures.size > MAX_TRACKED) {
      for (const [k, times] of this.failures) if (times.every((t) => t <= nowMs - this.windowMs)) this.failures.delete(k);
    }
  }

  reset(key: number): void {
    this.failures.delete(key);
  }

  private recent(key: number, nowMs: number): number[] {
    return (this.failures.get(key) ?? []).filter((t) => t > nowMs - this.windowMs);
  }
}
