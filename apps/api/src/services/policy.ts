/** Параметры процессов, зависящие от дома и режима: окно проверки после «Устранено». */
import type { AppConfig } from '../config/env.ts';
import type { HouseRow } from '../db/queries.ts';

const MS_PER_MINUTE = 60_000;

/** CHECK_WINDOW_MIN (по умолчанию 360); в модельных домах демо-режима — DEMO_CHECK_WINDOW_MIN (5). */
export function checkWindowMs(config: AppConfig, h: Pick<HouseRow, 'isModel'>): number {
  const minutes = config.demo.enabled && h.isModel ? config.demo.checkWindowMin : config.checkWindowMin;
  return minutes * MS_PER_MINUTE;
}
