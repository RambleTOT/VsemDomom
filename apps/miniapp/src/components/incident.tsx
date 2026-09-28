/**
 * Блоки аварии: статус, первая строка «знает ли УК и когда» (IncidentHeadline), сроки по нормативу
 * с основанием, шаги статуса УК, отметки по подъездам и хронология.
 */
import { Button, Typography } from '@maxhub/max-ui';
import type { Deadline, DisplayStatus, EntranceCount, IncidentSummary, StatusStep, TimelineEvent } from '@vsemdomom/shared';
import { useState } from 'react';
import { minutesLeft, minutesText, whenIn } from '../format.ts';
import { has, plural, statusName, t } from '../i18n.ts';
import { eventText, headlineText } from '../texts.ts';
import type { IconName } from '../icons/icons.ts';
import { Icon } from './Icon.tsx';
import { NormBasisLink } from './norm.tsx';
import { Chip, type Tone } from './ui.tsx';

const STATUS_ICON: Record<DisplayStatus, IconName> = {
  open: 'circle-slash',
  accepted: 'clock',
  brigade_on_site: 'wrench',
  localized: 'shield',
  checking: 'circle-help',
  discrepancy: 'triangle-alert',
  closed: 'circle-check',
  closed_with_discrepancy: 'triangle-alert',
  merged: 'merge',
};

const STATUS_TONE: Record<DisplayStatus, Tone> = {
  open: 'negative',
  accepted: 'warning',
  brigade_on_site: 'warning',
  localized: 'warning',
  checking: 'info',
  discrepancy: 'negative',
  closed: 'positive',
  closed_with_discrepancy: 'negative',
  merged: 'neutral',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Chip tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
      <span className="sr-only">{t('status.sr_prefix')}</span>
      {statusName(status)}
    </Chip>
  );
}

export function IncidentHeadline({ incident, compact = false, onOpenActual }: { incident: IncidentSummary; compact?: boolean; onOpenActual?: () => void }) {
  const { title, sub } = headlineText(incident);
  const deadline = incident.headline.nextDeadline;
  return (
    <div className={`headline tone-border-${STATUS_TONE[incident.displayStatus]}`} aria-live="polite">
      <StatusBadge status={incident.displayStatus} />
      <Typography.Text variant={compact ? 'title' : 'subheader'} asChild>
        <h2 className="headline-title">{title}</h2>
      </Typography.Text>
      {sub ? <p className="muted">{sub}</p> : null}
      {deadline ? <DeadlineChip deadline={deadline} timezone={incident.house.timezone} withPrefix /> : null}
      {incident.displayStatus === 'merged' && onOpenActual ? (
        <Button size="medium" variant="secondary" onClick={onOpenActual}>
          {t('incident.headline.action.open_actual')}
        </Button>
      ) : null}
    </div>
  );
}

function deadlinePrefix(kind: Deadline['kind']): string | null {
  return has(`deadline.prefix.${kind}`) ? t(`deadline.prefix.${kind}`) : null;
}

export function DeadlineChip({ deadline, timezone, withPrefix = false, now = new Date() }: { deadline: Deadline; timezone: string; withPrefix?: boolean; now?: Date }) {
  const due = whenIn(deadline.dueAt, timezone, now);
  const left = minutesLeft(deadline.dueAt, now);
  let text: string;
  let label: string;
  let tone: Tone;
  let icon: IconName;
  switch (deadline.state) {
    case 'pending':
      text = t('deadline.normal', { time: due, left: minutesText(left) });
      label = t('deadline.sr.normal', { time: due, left: minutesText(left) });
      tone = 'neutral';
      icon = 'clock';
      break;
    case 'soon':
      text = t('deadline.soon', { time: due, minutes: left });
      label = t('deadline.sr.soon', { time: due, left: minutesText(left) });
      tone = 'warning';
      icon = 'alarm-clock';
      break;
    case 'breached':
      text = t('deadline.expired', { time: due });
      label = t('deadline.sr.expired', { time: due });
      tone = 'negative';
      icon = 'circle-alert';
      break;
    case 'met': {
      const done = whenIn(deadline.doneAt ?? deadline.dueAt, timezone, now);
      text = t('deadline.done', { time: done });
      label = t('deadline.sr.done', { time: done });
      tone = 'positive';
      icon = 'check';
      break;
    }
    case 'cancelled':
      return null;
  }
  const prefix = withPrefix ? deadlinePrefix(deadline.kind) : null;
  return (
    <Chip tone={tone} icon={icon} role="img" aria-label={label} className="deadline-chip">
      {prefix ? `${prefix} ${text}` : text}
    </Chip>
  );
}

/** Сроки по нормативу: чип, название и основание; выполненные свёрнуты «Выполнено: N». */
export function DeadlineList({ deadlines, timezone, collapseDone = true }: { deadlines: Deadline[]; timezone: string; collapseDone?: boolean }) {
  const [showDone, setShowDone] = useState(!collapseDone);
  const visible = deadlines.filter((d) => d.state !== 'cancelled');
  const done = visible.filter((d) => d.state === 'met');
  const active = visible.filter((d) => d.state !== 'met');
  const rows = showDone ? visible : active;
  return (
    <div className="deadlines">
      {rows.map((d) => (
        <div className="deadline-row" key={`${d.kind}-${d.dueAt}`}>
          <p className="deadline-title">{d.title}</p>
          <DeadlineChip deadline={d} timezone={timezone} />
          <NormBasisLink norm={d.norm} />
        </div>
      ))}
      {collapseDone && done.length > 0 ? (
        <button type="button" className="link-button" onClick={() => setShowDone((v) => !v)}>
          {showDone ? t('screen.S05.done.hide') : t('screen.S05.done.count', { n: done.length })}
        </button>
      ) : null}
      {visible.length === 0 ? <p className="muted">{t('deadline.no_norm')}</p> : null}
    </div>
  );
}

export function StatusStepper({ steps, timezone }: { steps: StatusStep[]; timezone: string }) {
  return (
    <ol className="stepper">
      {steps.map((s) => (
        <li key={s.step} className={`step step-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="step-dot" aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={14} /> : null}
          </span>
          <span className="step-name">{t(`stepper.step.${s.step}`)}</span>
          <span className="step-at muted">{s.state === 'skipped' ? t('stepper.skipped') : s.at ? whenIn(s.at, timezone) : ''}</span>
        </li>
      ))}
    </ol>
  );
}

export function EntranceCounter({ byEntrance, unknown = 0 }: { byEntrance: EntranceCount[]; unknown?: number }) {
  if (byEntrance.length === 0 && unknown === 0) return null;
  return (
    <ul className="entrance-counter">
      {byEntrance.map((e) => (
        <li key={e.entrance} className="chip tone-neutral">
          {t('bot.card.entrance_count', { entrance: e.entrance, count: e.count > 99 ? '99+' : e.count })}
        </li>
      ))}
      {unknown > 0 ? (
        <li className="chip tone-neutral">
          {t('screen.U02.grid.floor_unknown')} — {unknown}
        </li>
      ) : null}
    </ul>
  );
}

export function Timeline({ events, timezone }: { events: TimelineEvent[]; timezone: string }) {
  if (events.length === 0) return <p className="muted">{t('timeline.empty')}</p>;
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const icon: IconName = e.type === 'discrepancy' ? 'triangle-alert' : e.actorType === 'uk' ? 'building-2' : e.actorType === 'resident' ? 'users' : 'circle-dot';
        const src = e.actorType === 'uk' ? t('timeline.src.uk') : e.actorType === 'resident' ? t('timeline.src.res', { count: 1, flats: plural(1, 'flats') }) : t('timeline.src.sys');
        return (
          <li key={`${e.at}-${i}`} className={`timeline-item actor-${e.actorType} ${e.type === 'discrepancy' ? 'is-disc' : ''}`}>
            <span className="timeline-dot" aria-hidden="true">
              <Icon name={icon} size={16} />
            </span>
            <div className="timeline-body">
              <p className="timeline-line">
                <strong>{whenIn(e.at, timezone)}</strong> {eventText(e, timezone)}
                {e.payload.model === true ? <span className="muted"> · {t('timeline.event.model')}</span> : null}
              </p>
              <p className="muted timeline-src">{src}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
