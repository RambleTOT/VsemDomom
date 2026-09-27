/**
 * Лимиты частоты запросов к MAX. Резервирование слотов: каждый вызов получает своё время
 * отправки, поэтому параллельные вызовы в один чат выстраиваются с равным шагом, а не
 * соревнуются. Общий лимит на бота — отдельный ключ.
 */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MS_PER_SECOND = 1000;
/** Ключи, которые давно не использовались, забываются. */
const IDLE_FORGET_MS = 60_000;

export interface RateLimiterOptions {
  /** Общий лимит запросов в секунду на бота. */
  globalRps: number;
  now?: () => number;
  sleep?: Sleep;
}

export class RateLimiter {
  private readonly nextFree = new Map<string, number>();
  private readonly globalInterval: number;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private lastSweep = 0;

  constructor(options: RateLimiterOptions) {
    this.globalInterval = MS_PER_SECOND / options.globalRps;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Сколько ждать до своего слота по ключу при шаге intervalMs (слот резервируется). */
  reserve(key: string, intervalMs: number): number {
    const now = this.now();
    this.sweep(now);
    const at = Math.max(now, this.nextFree.get(key) ?? now);
    this.nextFree.set(key, at + intervalMs);
    return at - now;
  }

  /**
   * Дождаться слота: сначала по ключу чата (если задан лимит), затем общий слот бота.
   * perSecond = 0 — без лимита по ключу.
   */
  async acquire(key: string | null, perSecond: number): Promise<void> {
    if (key !== null && perSecond > 0) {
      const wait = this.reserve(key, MS_PER_SECOND / perSecond);
      if (wait > 0) await this.sleep(wait);
    }
    const globalWait = this.reserve('global', this.globalInterval);
    if (globalWait > 0) await this.sleep(globalWait);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < IDLE_FORGET_MS) return;
    this.lastSweep = now;
    for (const [key, free] of this.nextFree) {
      if (free < now - IDLE_FORGET_MS) this.nextFree.delete(key);
    }
  }
}
