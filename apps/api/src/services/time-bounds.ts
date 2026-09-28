/**
 * Границы времён, которые присылает житель: начало аварии (не в будущем, старше суток — с
 * подтверждением, старше месяца — нельзя), регистрация в АДС (не раньше начала), повторное
 * сообщение и восстановление через АДС (не раньше «Устранено»). Общие для бота и API.
 */
import { checkMomentInRange, checkStartedAt } from '@vsemdomom/core';
import { PARAMS } from '../config/params.ts';
import type { incident } from '../db/schema.ts';

type IncidentRow = typeof incident.$inferSelect;

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const futureSkewMs = PARAMS.startedAtFutureSkewSec * MS_PER_SECOND;

export const STARTED_CHECKS = {
  futureSkewMs,
  confirmOldAfterMs: PARAMS.oldStartConfirmHours * MS_PER_HOUR,
  maxAgeMs: PARAMS.startedAtMaxAgeDays * MS_PER_DAY,
};

export function checkIncidentStart(startedAt: Date, now: Date) {
  return checkStartedAt(startedAt, now, STARTED_CHECKS);
}

/** С какого момента допустимо время: регистрация — с начала аварии, повторное сообщение — с «Устранено». */
export function momentFloor(inc: Pick<IncidentRow, 'startedAt' | 'resolvedAtUk' | 'checkStartedAt'>, kind: 'registration' | 'after_resolve'): Date {
  return kind === 'registration' ? inc.startedAt : (inc.resolvedAtUk ?? inc.checkStartedAt ?? inc.startedAt);
}

export function checkIncidentMoment(at: Date, now: Date, notBefore: Date) {
  return checkMomentInRange(at, now, { notBefore, futureSkewMs });
}
