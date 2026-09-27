/**
 * Проверка после «Устранено» (F07): вопрос дому, расхождение, правило закрытия
 * и время восстановления для каждой квартиры (F08).
 */
import type { RestoredAnswer, RestoredSource, TrustLevel } from '../domain/enums.ts';
import type { CloseReason, IncidentCommand } from './state-machine.ts';

export interface CheckParticipant {
  /** false — ответил «Не у меня»: в проверке не участвует. */
  affected: boolean;
  /** Текущий уровень доверия; незарегистрированные — 0. */
  trustLevel: TrustLevel;
  answer: RestoredAnswer | null;
  answeredAt: Date | null;
}

export interface CheckInput {
  status: 'checking' | 'discrepancy';
  /** Начало текущей проверки (последнее «Устранено» УК). */
  checkStartedAt: Date;
  /** Когда авария перешла в расхождение. */
  discrepancyAt: Date | null;
  participants: readonly CheckParticipant[];
  now: Date;
  checkWindowMs: number;
  discrepancyMaxMs: number;
}

/** Уровни 1–2 учитываются в порогах и в правиле закрытия (а). */
export function countsForThreshold(level: TrustLevel): boolean {
  return level >= 1;
}

/** Ответ актуален, если дан после начала текущей проверки: действует последний. */
export function isActualAnswer(p: Pick<CheckParticipant, 'answer' | 'answeredAt'>, checkStartedAt: Date): boolean {
  return p.answer !== null && p.answeredAt !== null && p.answeredAt.getTime() >= checkStartedAt.getTime();
}

function hasActualNo(input: CheckInput): boolean {
  return input.participants.some((p) => p.affected && p.answer === 'no' && isActualAnswer(p, input.checkStartedAt));
}

/**
 * Что делать с аварией в статусе checking или discrepancy сейчас:
 * - checking + актуальное «Нет» → discrepancy;
 * - checking → closed, когда (а) все участники уровня 1–2 ответили «Да» или «плохая»,
 *   или (б) окно проверки прошло и актуальных «Нет» нет;
 * - discrepancy → closed, когда актуальных «Нет» не осталось, иначе по предельному сроку
 *   с флагом discrepancy_unresolved.
 */
export function evaluateCheck(input: CheckInput): IncidentCommand | null {
  const actualNo = hasActualNo(input);

  if (input.status === 'checking') {
    if (actualNo) return { type: 'restored_no' };
    const trusted = input.participants.filter((p) => p.affected && countsForThreshold(p.trustLevel));
    const allConfirmed =
      trusted.length > 0 &&
      trusted.every((p) => isActualAnswer(p, input.checkStartedAt) && (p.answer === 'yes' || p.answer === 'weak'));
    if (allConfirmed) return close('all_confirmed');
    if (input.now.getTime() - input.checkStartedAt.getTime() >= input.checkWindowMs) return close('check_window_elapsed');
    return null;
  }

  if (!actualNo) return close('discrepancy_cleared');
  const since = input.discrepancyAt ?? input.checkStartedAt;
  if (input.now.getTime() - since.getTime() >= input.discrepancyMaxMs) return close('discrepancy_timeout');
  return null;
}

function close(reason: CloseReason): IncidentCommand {
  return { type: 'close', reason };
}

/** Когда наступит следующее событие по времени (окно проверки или предельный срок расхождения). */
export function nextCheckDeadline(input: Omit<CheckInput, 'now' | 'participants'>): Date {
  if (input.status === 'checking') return new Date(input.checkStartedAt.getTime() + input.checkWindowMs);
  const since = input.discrepancyAt ?? input.checkStartedAt;
  return new Date(since.getTime() + input.discrepancyMaxMs);
}

export interface Restoration {
  answer: RestoredAnswer;
  answeredAt: Date;
  restoredAt: Date | null;
  restoredSource: RestoredSource | null;
}

/**
 * Новый ответ жителя на вопрос о восстановлении. Время окончания для квартиры:
 * по умолчанию — отметка УК; если житель отвечал «Нет», а затем подтвердил восстановление
 * (ответом или сообщением в АДС) — время этого подтверждения.
 */
export function applyRestoredAnswer(
  previous: { answer: RestoredAnswer | null; restoredAt: Date | null; restoredSource: RestoredSource | null },
  input: { answer: RestoredAnswer; at: Date; resolvedAtUk: Date; viaAds?: boolean },
): Restoration {
  if (input.answer === 'no') {
    return { answer: 'no', answeredAt: input.at, restoredAt: null, restoredSource: null };
  }
  if (previous.answer === 'no' || input.viaAds) {
    return {
      answer: input.answer,
      answeredAt: input.at,
      restoredAt: input.at,
      restoredSource: input.viaAds ? 'ads_report' : 'resident_answer',
    };
  }
  // «Да» или «плохая» без предыдущего «Нет»: время восстановления — отметка УК (или уже известное).
  return {
    answer: input.answer,
    answeredAt: input.at,
    restoredAt: previous.restoredAt ?? input.resolvedAtUk,
    restoredSource: previous.restoredSource ?? 'uk_mark',
  };
}
