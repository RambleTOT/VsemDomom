import type { Clock, Translator } from '@vsemdomom/core';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.ts';
import type { Db } from '../db/client.ts';
import type { MaxApi } from '../max/types.ts';
import type { JobQueue } from './queue.ts';

/** Всё, что нужно обработчикам задач и событий. */
export interface JobContext {
  config: AppConfig;
  db: Db;
  queue: JobQueue;
  max: MaxApi;
  log: Logger;
  clock: Clock;
  i18n: Translator;
}
