/**
 * Long polling (MAX_MODE=polling) — только для отдельного dev-бота: при активной подписке
 * webhook он не работает. События идут в тот же приём, что и webhook.
 */
import type { Logger } from 'pino';
import type { IngestResult } from '../webhook/ingest.ts';
import { realSleep, type Sleep } from './rate-limiter.ts';
import type { MaxApi } from './types.ts';
import { SUBSCRIBED_UPDATE_TYPES } from './update.ts';

const POLL_TIMEOUT_SEC = 30;
const ERROR_PAUSE_MS = 5000;

export async function runPolling(deps: {
  max: MaxApi;
  ingest: (update: unknown) => Promise<IngestResult>;
  log: Logger;
  signal: AbortSignal;
  sleep?: Sleep;
}): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  let marker: number | null = null;
  deps.log.info('long polling запущен');
  while (!deps.signal.aborted) {
    try {
      const page = await deps.max.getUpdates({ marker, timeoutSec: POLL_TIMEOUT_SEC, types: [...SUBSCRIBED_UPDATE_TYPES] });
      for (const update of page.updates) {
        try {
          await deps.ingest(update);
        } catch (err) {
          deps.log.warn({ err }, 'long polling: событие не принято');
        }
      }
      marker = page.marker ?? marker;
    } catch (err) {
      deps.log.warn({ err }, 'long polling: ошибка, пауза');
      await sleep(ERROR_PAUSE_MS);
    }
  }
}
