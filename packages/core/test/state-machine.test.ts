import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FROM,
  INCIDENT_STATUSES,
  allowedUkActions,
  displayStatus,
  nextUkAction,
  transition,
  type IncidentCommand,
  type IncidentStatus,
} from '../src/index.ts';

const eta = new Date('2026-09-27T15:00:00Z');
const commands: IncidentCommand[] = [
  { type: 'accept', eta },
  { type: 'brigade_on_site' },
  { type: 'localize' },
  { type: 'resolve' },
  { type: 'restored_no' },
  { type: 'close', reason: 'all_confirmed' },
  { type: 'close', reason: 'check_window_elapsed' },
  { type: 'close', reason: 'discrepancy_cleared' },
  { type: 'close', reason: 'discrepancy_timeout' },
  { type: 'merge', intoId: 'Xyz1234567' },
];

/** Каноническая таблица переходов: из → команда → в. */
const EXPECTED: Record<string, IncidentStatus> = {
  'open accept': 'accepted',
  'open brigade_on_site': 'brigade_on_site',
  'accepted brigade_on_site': 'brigade_on_site',
  'open localize': 'localized',
  'accepted localize': 'localized',
  'brigade_on_site localize': 'localized',
  'open resolve': 'checking',
  'accepted resolve': 'checking',
  'brigade_on_site resolve': 'checking',
  'localized resolve': 'checking',
  'discrepancy resolve': 'checking',
  'checking restored_no': 'discrepancy',
  'checking close:all_confirmed': 'closed',
  'checking close:check_window_elapsed': 'closed',
  'discrepancy close:discrepancy_cleared': 'closed',
  'discrepancy close:discrepancy_timeout': 'closed',
  'open merge': 'merged',
  'accepted merge': 'merged',
};

const key = (from: IncidentStatus, c: IncidentCommand) =>
  `${from} ${c.type === 'close' ? `close:${c.reason}` : c.type}`;

describe('машина состояний аварии', () => {
  for (const from of INCIDENT_STATUSES) {
    for (const command of commands) {
      const k = key(from, command);
      const expected = EXPECTED[k];
      it(`${k} → ${expected ?? 'invalid_transition'}`, () => {
        const r = transition(from, command);
        if (expected) {
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.transition.to).toBe(expected);
        } else {
          expect(r).toEqual({ ok: false, error: 'invalid_transition', from, command: command.type });
        }
      });
    }
  }

  it('из конечных статусов переходов нет', () => {
    for (const from of ['closed', 'merged'] as const) {
      for (const c of commands) expect(transition(from, c).ok).toBe(false);
    }
  });

  it('«Принято» с ориентиром: срок «сообщить сроки» выполнен, карточка и уведомления', () => {
    const r = transition('open', { type: 'accept', eta });
    expect(r.ok && r.transition.events).toEqual(['uk_accepted']);
    expect(r.ok && r.transition.effects).toEqual([
      { type: 'set_eta', eta },
      { type: 'mark_deadlines_met', kinds: ['answer'] },
      { type: 'edit_card' },
      { type: 'notify_participants' },
    ]);
  });

  it('пропуск шагов помечается skipped_steps', () => {
    const r = transition('open', { type: 'resolve' });
    expect(r.ok && r.transition.skippedSteps).toEqual(['accepted', 'brigade_on_site', 'localized']);
    expect(r.ok && r.transition.events).toEqual(['uk_resolved', 'skipped_steps', 'check_asked']);
    const b = transition('open', { type: 'brigade_on_site' });
    expect(b.ok && b.transition.skippedSteps).toEqual(['accepted']);
    const l = transition('accepted', { type: 'localize' });
    expect(l.ok && l.transition.skippedSteps).toEqual(['brigade_on_site']);
    const ok = transition('localized', { type: 'resolve' });
    expect(ok.ok && ok.transition.skippedSteps).toEqual([]);
    expect(ok.ok && ok.transition.events).toEqual(['uk_resolved', 'check_asked']);
  });

  it('«Устранено» без «Принято» закрывает и срок ответа: после устранения «сообщить сроки» уже не нужно', () => {
    const r = transition('open', { type: 'resolve' });
    expect(r.ok && r.transition.effects.find((e) => e.type === 'mark_deadlines_met')).toEqual({
      type: 'mark_deadlines_met',
      kinds: ['answer', 'localize', 'clog', 'fix', 'single_limit'],
    });
  });

  it('«Устранено» публикует вопрос C03 — второе новое сообщение', () => {
    const r = transition('localized', { type: 'resolve' });
    expect(r.ok && r.transition.effects.map((e) => e.type)).toEqual([
      'set_resolved_at_uk',
      'mark_deadlines_met',
      'start_check',
      'post_check_question',
      'edit_card',
      'notify_participants',
    ]);
  });

  it('повторное «Устранено» в расхождении правит вопрос, а не пишет новый', () => {
    const r = transition('discrepancy', { type: 'resolve' });
    expect(r.ok && r.transition.to).toBe('checking');
    expect(r.ok && r.transition.events).toEqual(['uk_resolved', 'check_repeated']);
    const types = r.ok ? r.transition.effects.map((e) => e.type) : [];
    expect(types).toContain('edit_check_question');
    expect(types).not.toContain('post_check_question');
  });

  it('в песочнице «Устранено» сразу закрывает аварию без сообщений', () => {
    const r = transition('accepted', { type: 'resolve', sandbox: true });
    expect(r.ok && r.transition.to).toBe('closed');
    expect(r.ok && r.transition.events).toEqual(['uk_resolved', 'skipped_steps', 'closed']);
    const types = r.ok ? r.transition.effects.map((e) => e.type) : [];
    expect(types).not.toContain('post_check_question');
    expect(types).not.toContain('post_result');
    expect(types).not.toContain('edit_card');
  });

  it('закрытие публикует итог — третье новое сообщение; по предельному сроку — с флагом', () => {
    const a = transition('checking', { type: 'close', reason: 'all_confirmed' });
    expect(a.ok && a.transition.effects.map((e) => e.type)).toContain('post_result');
    const t = transition('discrepancy', { type: 'close', reason: 'discrepancy_timeout' });
    expect(t.ok && t.transition.effects[0]).toEqual({ type: 'set_discrepancy_unresolved' });
  });

  it('объединение переносит участников и отменяет сроки', () => {
    const r = transition('open', { type: 'merge', intoId: 'Target0001' });
    expect(r.ok && r.transition.effects).toContainEqual({ type: 'move_participants', intoId: 'Target0001' });
    expect(r.ok && r.transition.effects).toContainEqual({ type: 'cancel_pending_deadlines' });
  });

  it('ориентир при «Бригада на месте» тоже закрывает срок «сообщить сроки»', () => {
    const r = transition('open', { type: 'brigade_on_site', eta });
    expect(r.ok && r.transition.effects).toContainEqual({ type: 'mark_deadlines_met', kinds: ['answer'] });
  });

  it('действия УК и главная кнопка', () => {
    expect(allowedUkActions('open')).toEqual(['accept', 'brigade_on_site', 'localize', 'resolve', 'merge']);
    expect(allowedUkActions('localized')).toEqual(['resolve']);
    expect(allowedUkActions('discrepancy')).toEqual(['resolve']);
    expect(allowedUkActions('checking')).toEqual([]);
    expect(nextUkAction('open')).toBe('accept');
    expect(nextUkAction('discrepancy')).toBe('resolve');
    expect(nextUkAction('closed')).toBeNull();
    expect(Object.keys(ALLOWED_FROM)).toHaveLength(7);
  });

  it('девять названий: «Закрыта с расхождением» — closed с флагом', () => {
    expect(displayStatus('closed', true)).toBe('closed_with_discrepancy');
    expect(displayStatus('closed', false)).toBe('closed');
    expect(displayStatus('checking', true)).toBe('checking');
  });
});
