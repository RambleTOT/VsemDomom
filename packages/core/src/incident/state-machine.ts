/**
 * Машина состояний аварии — единственный источник правды о переходах.
 * Открытые статусы: open, accepted, brigade_on_site, localized, checking, discrepancy.
 * Конечные: closed, merged. Флаг overdue ставят сроки, а не переходы.
 */
import type { DeadlineKind, DisplayStatus, IncidentEventType, IncidentStatus } from '../domain/enums.ts';

/** Шаги УК, которые можно пропустить: пропуск виден в хронологии (skipped_steps). */
export type UkStep = 'accepted' | 'brigade_on_site' | 'localized';

export type CloseReason =
  | 'all_confirmed'
  | 'check_window_elapsed'
  | 'discrepancy_cleared'
  | 'discrepancy_timeout'
  | 'sandbox';

export type IncidentCommand =
  | { type: 'accept'; eta: Date }
  | { type: 'brigade_on_site'; eta?: Date }
  | { type: 'localize'; eta?: Date }
  | { type: 'resolve'; sandbox?: boolean }
  /** Первое актуальное «Нет» на вопрос о восстановлении. */
  | { type: 'restored_no' }
  /** Правило закрытия F07 или предельный срок расхождения. */
  | { type: 'close'; reason: CloseReason }
  | { type: 'merge'; intoId: string };

export type IncidentCommandType = IncidentCommand['type'];

/** Что сделать после перехода. Сервисы исполняют эффекты; ядро их только называет. */
export type TransitionEffect =
  | { type: 'set_eta'; eta: Date }
  | { type: 'mark_deadlines_met'; kinds: DeadlineKind[] }
  /** Сроки, которые после шага УК больше не нужны: не истёкшие — отменить без события, истёкшие — «истёк». */
  | { type: 'drop_deadlines'; kinds: DeadlineKind[] }
  | { type: 'cancel_pending_deadlines' }
  | { type: 'set_resolved_at_uk' }
  | { type: 'start_check' }
  /** Вопрос о восстановлении (C03) — второе новое сообщение в чат. */
  | { type: 'post_check_question' }
  /** Повторная проверка — правка того же вопроса, а не новое сообщение. */
  | { type: 'edit_check_question' }
  | { type: 'set_discrepancy_at' }
  /** Инструкция ответившему «Нет»: АДС и акт (личка, если диалог начат, и экран аварии). */
  | { type: 'instruct_answerer' }
  /** Итог (F08) — третье новое сообщение, ответом на карточку. */
  | { type: 'post_result' }
  | { type: 'set_discrepancy_unresolved' }
  | { type: 'move_participants'; intoId: string }
  | { type: 'edit_card' }
  | { type: 'notify_participants' };

export interface Transition {
  from: IncidentStatus;
  to: IncidentStatus;
  /** События хронологии в порядке записи. */
  events: IncidentEventType[];
  skippedSteps: UkStep[];
  effects: TransitionEffect[];
}

export type TransitionResult =
  | { ok: true; transition: Transition }
  | { ok: false; error: 'invalid_transition'; from: IncidentStatus; command: IncidentCommandType };

/** Из каких статусов разрешена каждая команда. */
export const ALLOWED_FROM: Record<IncidentCommandType, readonly IncidentStatus[]> = {
  accept: ['open'],
  brigade_on_site: ['open', 'accepted'],
  localize: ['open', 'accepted', 'brigade_on_site'],
  resolve: ['open', 'accepted', 'brigade_on_site', 'localized', 'discrepancy'],
  restored_no: ['checking'],
  close: ['checking', 'discrepancy'],
  merge: ['open', 'accepted'],
};

const CLOSE_REASONS_FROM: Record<CloseReason, IncidentStatus[]> = {
  all_confirmed: ['checking'],
  check_window_elapsed: ['checking'],
  discrepancy_cleared: ['discrepancy'],
  discrepancy_timeout: ['discrepancy'],
  sandbox: [],
};

/** Порядок шагов УК: пропущенными считаются шаги между текущим и целевым. */
const UK_STEP_ORDER: readonly IncidentStatus[] = ['open', 'accepted', 'brigade_on_site', 'localized'];

function skippedBetween(from: IncidentStatus, target: 'brigade_on_site' | 'localized' | 'resolved'): UkStep[] {
  const fromIndex = UK_STEP_ORDER.indexOf(from);
  if (fromIndex < 0) return [];
  const steps: UkStep[] = ['accepted', 'brigade_on_site', 'localized'];
  const targetIndex = target === 'resolved' ? UK_STEP_ORDER.length : UK_STEP_ORDER.indexOf(target);
  return steps.filter((_, i) => i + 1 > fromIndex && i + 1 < targetIndex);
}

function etaEffects(eta: Date | undefined): TransitionEffect[] {
  // Ориентир УК — это и есть сообщённый срок: срок «сообщить сроки» выполнен.
  return eta ? [{ type: 'set_eta', eta }, { type: 'mark_deadlines_met', kinds: ['answer'] }] : [];
}

function invalid(from: IncidentStatus, command: IncidentCommandType): TransitionResult {
  return { ok: false, error: 'invalid_transition', from, command };
}

function withSkipped(events: IncidentEventType[], skipped: UkStep[]): IncidentEventType[] {
  return skipped.length > 0 ? [...events, 'skipped_steps'] : events;
}

export function transition(from: IncidentStatus, command: IncidentCommand): TransitionResult {
  if (!ALLOWED_FROM[command.type].includes(from)) return invalid(from, command.type);

  switch (command.type) {
    case 'accept':
      return {
        ok: true,
        transition: {
          from,
          to: 'accepted',
          events: ['uk_accepted'],
          skippedSteps: [],
          effects: [...etaEffects(command.eta), { type: 'edit_card' }, { type: 'notify_participants' }],
        },
      };

    case 'brigade_on_site': {
      const skipped = skippedBetween(from, 'brigade_on_site');
      return {
        ok: true,
        transition: {
          from,
          to: 'brigade_on_site',
          events: withSkipped(['uk_brigade_on_site'], skipped),
          skippedSteps: skipped,
          effects: [...etaEffects(command.eta), { type: 'edit_card' }, { type: 'notify_participants' }],
        },
      };
    }

    case 'localize': {
      const skipped = skippedBetween(from, 'localized');
      return {
        ok: true,
        transition: {
          from,
          to: 'localized',
          events: withSkipped(['uk_localized'], skipped),
          skippedSteps: skipped,
          effects: [
            ...etaEffects(command.eta),
            { type: 'mark_deadlines_met', kinds: ['localize'] },
            { type: 'edit_card' },
            { type: 'notify_participants' },
          ],
        },
      };
    }

    case 'resolve': {
      const repeated = from === 'discrepancy';
      const skipped = repeated ? [] : skippedBetween(from, 'resolved');
      // Срок ответа («сообщить сроки работ») после «Устранено» не нужен: не выполнен, а отменён.
      const common: TransitionEffect[] = [
        { type: 'set_resolved_at_uk' },
        { type: 'drop_deadlines', kinds: ['answer'] },
        { type: 'mark_deadlines_met', kinds: ['localize', 'clog', 'fix', 'single_limit'] },
      ];
      if (command.sandbox && !repeated) {
        // Песочница API: «Устранено» сразу закрывает аварию без окна проверки и без сообщений.
        return {
          ok: true,
          transition: {
            from,
            to: 'closed',
            events: [...withSkipped(['uk_resolved'], skipped), 'closed'],
            skippedSteps: skipped,
            effects: [...common, { type: 'cancel_pending_deadlines' }],
          },
        };
      }
      return {
        ok: true,
        transition: {
          from,
          to: 'checking',
          events: repeated ? ['uk_resolved', 'check_repeated'] : [...withSkipped(['uk_resolved'], skipped), 'check_asked'],
          skippedSteps: skipped,
          effects: [
            ...common,
            { type: 'start_check' },
            repeated ? { type: 'edit_check_question' } : { type: 'post_check_question' },
            { type: 'edit_card' },
            { type: 'notify_participants' },
          ],
        },
      };
    }

    case 'restored_no':
      return {
        ok: true,
        transition: {
          from,
          to: 'discrepancy',
          events: ['discrepancy'],
          skippedSteps: [],
          effects: [{ type: 'set_discrepancy_at' }, { type: 'instruct_answerer' }, { type: 'edit_card' }],
        },
      };

    case 'close': {
      if (!CLOSE_REASONS_FROM[command.reason].includes(from)) return invalid(from, command.type);
      const effects: TransitionEffect[] = [];
      if (command.reason === 'discrepancy_timeout') effects.push({ type: 'set_discrepancy_unresolved' });
      effects.push(
        { type: 'cancel_pending_deadlines' },
        { type: 'post_result' },
        { type: 'edit_card' },
        { type: 'notify_participants' },
      );
      return { ok: true, transition: { from, to: 'closed', events: ['closed'], skippedSteps: [], effects } };
    }

    case 'merge':
      return {
        ok: true,
        transition: {
          from,
          to: 'merged',
          events: ['merged'],
          skippedSteps: [],
          effects: [
            { type: 'move_participants', intoId: command.intoId },
            { type: 'cancel_pending_deadlines' },
            { type: 'edit_card' },
          ],
        },
      };
  }
}

/** Действия УК на экране аварии: допустимые переходы из текущего статуса. */
export type UkAction = 'accept' | 'brigade_on_site' | 'localize' | 'resolve' | 'merge';

const UK_ACTIONS: readonly UkAction[] = ['accept', 'brigade_on_site', 'localize', 'resolve', 'merge'];

export function allowedUkActions(status: IncidentStatus): UkAction[] {
  return UK_ACTIONS.filter((a) => ALLOWED_FROM[a].includes(status));
}

/** Главная кнопка УК — следующий шаг. */
export function nextUkAction(status: IncidentStatus): UkAction | null {
  switch (status) {
    case 'open':
      return 'accept';
    case 'accepted':
      return 'brigade_on_site';
    case 'brigade_on_site':
      return 'localize';
    case 'localized':
    case 'discrepancy':
      return 'resolve';
    case 'checking':
    case 'closed':
    case 'merged':
      return null;
  }
}

/** Девять названий для показа: «Закрыта с расхождением» — closed с флагом. */
export function displayStatus(status: IncidentStatus, discrepancyUnresolved: boolean): DisplayStatus {
  return status === 'closed' && discrepancyUnresolved ? 'closed_with_discrepancy' : status;
}
