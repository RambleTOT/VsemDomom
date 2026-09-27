import { describe, expect, it } from 'vitest';
import { applyRestoredAnswer, evaluateCheck, nextCheckDeadline, trustLevel, type CheckParticipant } from '../src/index.ts';

const MIN = 60_000;
const start = new Date('2026-09-27T16:10:00Z');
const after = (m: number) => new Date(start.getTime() + m * MIN);
const window = 360 * MIN;
const maxDiscrepancy = 72 * 60 * MIN;

function p(trustLevel: 0 | 1 | 2, answer: CheckParticipant['answer'], answeredMin: number | null, affected = true): CheckParticipant {
  return { trustLevel, answer, answeredAt: answeredMin === null ? null : after(answeredMin), affected };
}

const base = { checkStartedAt: start, discrepancyAt: null, checkWindowMs: window, discrepancyMaxMs: maxDiscrepancy };

describe('правило закрытия после «Устранено» (F07)', () => {
  it('(а) все участники уровня 1–2 ответили «Да» или «плохая» → закрыть', () => {
    const participants = [p(1, 'yes', 5), p(2, 'weak', 6), p(0, null, null)];
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(10) })).toEqual({
      type: 'close',
      reason: 'all_confirmed',
    });
  });

  it('(а) не выполняется, пока ответили не все доверенные', () => {
    const participants = [p(1, 'yes', 5), p(1, null, null)];
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(10) })).toBeNull();
  });

  it('(а) без участников уровня 1–2 не срабатывает — ждём окно проверки', () => {
    const participants = [p(0, 'yes', 5)];
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(10) })).toBeNull();
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(360) })).toEqual({
      type: 'close',
      reason: 'check_window_elapsed',
    });
  });

  it('(б) окно проверки прошло и актуальных «Нет» нет → закрыть', () => {
    expect(evaluateCheck({ ...base, status: 'checking', participants: [p(1, null, null)], now: after(359) })).toBeNull();
    expect(evaluateCheck({ ...base, status: 'checking', participants: [p(1, null, null)], now: after(360) })).toEqual({
      type: 'close',
      reason: 'check_window_elapsed',
    });
  });

  it('первое актуальное «Нет» (в том числе от не подтверждённого) → расхождение', () => {
    expect(evaluateCheck({ ...base, status: 'checking', participants: [p(1, 'yes', 1), p(0, 'no', 2)], now: after(3) })).toEqual({
      type: 'restored_no',
    });
  });

  it('«Нет» до начала текущей проверки не актуально: не даёт расхождения, но и ответом не считается', () => {
    const participants = [p(1, 'no', -30), p(1, 'yes', 4)];
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(5) })).toBeNull();
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(360) })).toEqual({
      type: 'close',
      reason: 'check_window_elapsed',
    });
  });

  it('ответившие «Не у меня» в проверке не участвуют', () => {
    const participants = [p(1, 'no', 5, false), p(1, 'yes', 4)];
    expect(evaluateCheck({ ...base, status: 'checking', participants, now: after(5) })).toEqual({
      type: 'close',
      reason: 'all_confirmed',
    });
  });

  it('расхождение закрывается, когда все ответившие «Нет» сменили ответ', () => {
    const d = { ...base, status: 'discrepancy' as const, discrepancyAt: after(2) };
    expect(evaluateCheck({ ...d, participants: [p(1, 'no', 2), p(1, 'yes', 3)], now: after(30) })).toBeNull();
    expect(evaluateCheck({ ...d, participants: [p(1, 'yes', 20), p(1, 'yes', 3)], now: after(30) })).toEqual({
      type: 'close',
      reason: 'discrepancy_cleared',
    });
  });

  it('расхождение по предельному сроку закрывается с флагом', () => {
    const d = { ...base, status: 'discrepancy' as const, discrepancyAt: after(2) };
    expect(evaluateCheck({ ...d, participants: [p(1, 'no', 2)], now: after(2 + 72 * 60) })).toEqual({
      type: 'close',
      reason: 'discrepancy_timeout',
    });
    expect(nextCheckDeadline({ ...d })).toEqual(after(2 + 72 * 60));
    expect(nextCheckDeadline({ ...base, status: 'checking' })).toEqual(after(360));
  });
});

describe('время восстановления для квартиры (F08)', () => {
  const resolvedAtUk = start;

  it('«Да» без «Нет» — по отметке УК', () => {
    expect(applyRestoredAnswer({ answer: null, restoredAt: null, restoredSource: null }, { answer: 'yes', at: after(5), resolvedAtUk })).toEqual({
      answer: 'yes',
      answeredAt: after(5),
      restoredAt: resolvedAtUk,
      restoredSource: 'uk_mark',
    });
  });

  it('«Нет», затем «Да» — время подтверждения жителя', () => {
    const no = applyRestoredAnswer({ answer: null, restoredAt: null, restoredSource: null }, { answer: 'no', at: after(5), resolvedAtUk });
    expect(no.restoredAt).toBeNull();
    const yes = applyRestoredAnswer(no, { answer: 'yes', at: after(250), resolvedAtUk });
    expect(yes).toMatchObject({ restoredAt: after(250), restoredSource: 'resident_answer' });
  });

  it('подтверждение сообщением в АДС', () => {
    const r = applyRestoredAnswer({ answer: 'no', restoredAt: null, restoredSource: null }, { answer: 'yes', at: after(90), resolvedAtUk, viaAds: true });
    expect(r).toMatchObject({ restoredAt: after(90), restoredSource: 'ads_report' });
  });

  it('смена «Да» на «плохая» не меняет время восстановления', () => {
    const yes = applyRestoredAnswer({ answer: null, restoredAt: null, restoredSource: null }, { answer: 'yes', at: after(5), resolvedAtUk });
    expect(applyRestoredAnswer(yes, { answer: 'weak', at: after(9), resolvedAtUk })).toMatchObject({
      answer: 'weak',
      restoredAt: resolvedAtUk,
      restoredSource: 'uk_mark',
    });
  });
});

describe('уровни доверия', () => {
  it('0 — заявлено, 1 — в чате дома, 2 — подтверждён', () => {
    expect(trustLevel({ registered: false, inHouseChat: true, confirmed: true })).toBe(0);
    expect(trustLevel({ registered: true, inHouseChat: null, confirmed: false })).toBe(0);
    expect(trustLevel({ registered: true, inHouseChat: true, confirmed: false })).toBe(1);
    expect(trustLevel({ registered: true, inHouseChat: false, confirmed: true })).toBe(2);
  });
});
