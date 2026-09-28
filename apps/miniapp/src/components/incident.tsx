/**
 * Блоки аварии: статус, первая строка «знает ли УК и когда» (IncidentHeadline), сроки по нормативу
 * с основанием, шаги статуса УК, отметки по подъездам и хронология.
 */
import { Button, Typography } from '@maxhub/max-ui';
import type { Deadline, DisplayStatus, EntranceCount, IncidentSummary, StatusStep, TimelineEvent } from '@vsemdomom/shared';
import { useState, type ReactNode } from 'react';
import { minutesLeft, minutesText, whenIn } from '../format.ts';
import { has, plural, statusName, t } from '../i18n.ts';
import { eventText, headlineText } from '../texts.ts';
import type { IconName } from '../icons/icons.ts';
import { Icon } from './Icon.tsx';
import { NormBasisLink } from './norm.tsx';
import { Chip, ModelDataBadge, type Tone } from './ui.tsx';

/** Статус — нейтральным чипом без значка (как в макете): первая строка уже отвечает «знает ли УК и когда». */
export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Chip tone="neutral" className="status-chip">
      <span className="sr-only">{t('status.sr_prefix')}</span>
      {statusName(status)}
    </Chip>
  );
}

/** Чипы под первой строкой: статус и ближайший срок по нормативу. */
export function HeadlineChips({ incident }: { incident: IncidentSummary }) {
  const deadline = incident.headline.nextDeadline;
  return (
    <div className="chips-row">
      <StatusBadge status={incident.displayStatus} />
      {deadline ? <DeadlineChip deadline={deadline} timezone={incident.house.timezone} withPrefix /> : null}
    </div>
  );
}

function OpenActual({ incident, onOpenActual }: { incident: IncidentSummary; onOpenActual?: (() => void) | undefined }) {
  if (incident.displayStatus !== 'merged' || !onOpenActual) return null;
  return (
    <div>
      <Button size="medium" variant="secondary" onClick={onOpenActual}>
        {t('incident.headline.action.open_actual')}
      </Button>
    </div>
  );
}

/** Карточка аварии в списке: первая строка, чипы статуса и срока. */
export function IncidentHeadline({ incident, compact = false, onOpenActual }: { incident: IncidentSummary; compact?: boolean; onOpenActual?: () => void }) {
  const { title, sub } = headlineText(incident);
  return (
    <div className="headline" aria-live="polite">
      <Typography.Text variant={compact ? 'title' : 'subheader'} asChild>
        <h2 className="headline-title">{title}</h2>
      </Typography.Text>
      <HeadlineChips incident={incident} />
      {sub ? <p className="muted">{sub}</p> : null}
      <OpenActual incident={incident} onOpenActual={onOpenActual} />
    </div>
  );
}

/**
 * Шапка экрана аварии под заголовком (заголовок — первая строка, его рисует Screen): чипы, пояснение,
 * вид аварии и дом, «Модельные данные».
 */
export function IncidentHero({ incident, lines, onOpenActual, children }: { incident: IncidentSummary; lines: [string, string]; onOpenActual?: () => void; children?: ReactNode }) {
  const { sub } = headlineText(incident);
  return (
    <div className="incident-hero" aria-live="polite">
      <HeadlineChips incident={incident} />
      {sub ? <p className="muted">{sub}</p> : null}
      {children}
      <div className="stack tight">
        <p className="hero-line">{lines[0]}</p>
        <p className="muted">{lines[1]}</p>
      </div>
      {incident.isModel ? <ModelDataBadge /> : null}
      <OpenActual incident={incident} onOpenActual={onOpenActual} />
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
  switch (deadline.state) {
    case 'pending':
      text = t('deadline.normal', { time: due, left: minutesText(left) });
      label = t('deadline.sr.normal', { time: due, left: minutesText(left) });
      tone = 'neutral';
      break;
    case 'soon':
      text = t('deadline.soon', { time: due, minutes: left });
      label = t('deadline.sr.soon', { time: due, left: minutesText(left) });
      tone = 'warning';
      break;
    case 'breached':
      text = t('deadline.expired', { time: due });
      label = t('deadline.sr.expired', { time: due });
      tone = 'negative';
      break;
    case 'met': {
      const done = whenIn(deadline.doneAt ?? deadline.dueAt, timezone, now);
      text = t('deadline.done', { time: done });
      label = t('deadline.sr.done', { time: done });
      tone = 'positive';
      break;
    }
    case 'cancelled':
      return null;
  }
  const prefix = withPrefix ? deadlinePrefix(deadline.kind) : null;
  return (
    <Chip tone={tone} role="img" aria-label={label} className="deadline-chip">
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
        <button type="button" className="deadline-done plain-button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
          {showDone ? t('screen.S05.done.hide') : t('screen.S05.done.count', { n: done.length })}
        </button>
      ) : null}
      {visible.length === 0 ? <p className="muted">{t('deadline.no_norm')}</p> : null}
    </div>
  );
}

/** Подпись шага: когда и что отметила УК; пропущенный шаг — «шаг пропущен». */
function stepSub(s: StatusStep, timezone: string, eta: string | null): string | null {
  if (s.state === 'skipped') return t('stepper.skipped');
  if (!s.at || s.state === 'pending') return null;
  const time = whenIn(s.at, timezone);
  if (s.step === 'accepted' && eta) return t('stepper.sub.accepted.eta', { time, eta: whenIn(eta, timezone) });
  return t(`stepper.sub.${s.step}`, { time });
}

/** Шаги статуса УК: пройденный — серый кружок, текущий — синий, будущий — контур. На широком экране — сеткой. */
export function StatusStepper({ steps, timezone, eta = null, discrepancy = false }: { steps: StatusStep[]; timezone: string; eta?: string | null; discrepancy?: boolean }) {
  return (
    <ol className="stepper">
      {steps.map((s) => {
        const sub = stepSub(s, timezone, eta);
        const label = s.step === 'resolved' && discrepancy ? t('stepper.label.resolved.disc') : t(`stepper.label.${s.step}`);
        return (
          <li key={s.step} className={`step step-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="step-dot" aria-hidden="true" />
            <span className="step-text">
              <span className="step-name">{label}</span>
              {sub ? <span className="step-at muted">{sub}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Отметки по подъездам: все подъезды дома, «П2 · 6»; «не указан» — если есть. */
export function EntranceCounter({ byEntrance, entrances, unknown = 0 }: { byEntrance: EntranceCount[]; entrances: number; unknown?: number }) {
  const count = new Map(byEntrance.map((e) => [e.entrance, e.count]));
  return (
    <ul className="entrance-counter">
      {Array.from({ length: entrances }, (_, i) => i + 1).map((n) => {
        const c = count.get(n) ?? 0;
        return (
          <li key={n} className={`chip ${c > 0 ? 'tone-strong' : 'tone-neutral'}`} aria-label={t('entrance.chip.sr', { entrance: n, count: c })}>
            {t('entrance.chip', { entrance: n, count: c > MAX_SHOWN ? `${MAX_SHOWN}+` : c })}
          </li>
        );
      })}
      {unknown > 0 ? <li className="chip tone-neutral">{t('entrance.chip.unknown', { count: unknown })}</li> : null}
    </ul>
  );
}

const MAX_SHOWN = 99;

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
                {e.payload.model === true && e.actorType === 'resident' ? <span className="muted"> · {t('timeline.event.model')}</span> : null}
              </p>
              <p className="muted timeline-src">{src}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
