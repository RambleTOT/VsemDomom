import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.ts';

/** Проверка готовности одной зависимости (БД, миграции, MAX). */
export interface ReadinessCheck {
  name: string;
  check(): Promise<{ ok: boolean; detail?: string }>;
}

export interface AppDeps {
  config: AppConfig;
  log: Logger;
  readiness: ReadinessCheck[];
}
