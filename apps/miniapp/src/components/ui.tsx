/** Мелкие общие блоки: карточка, чип, баннер, пустое состояние, скелетон, строка «ключ — значение». */
import { Typography } from '@maxhub/max-ui';
import type { ReactNode } from 'react';
import { t } from '../i18n.ts';
import type { IconName } from '../icons/icons.ts';
import { Icon } from './Icon.tsx';

export type Tone = 'neutral' | 'positive' | 'warning' | 'negative' | 'info';

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

/** Заголовок секции: 13/16 strong, --text-secondary (вместо CellHeader — ради контраста). */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="section-title" id={id}>
      {children}
    </h2>
  );
}

export function Chip({ children, tone = 'neutral', icon, className = '', ...rest }: { children: ReactNode; tone?: Tone; icon?: IconName; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`chip tone-${tone} ${className}`} {...rest}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </span>
  );
}

/** Плашка «Модельные данные»: дома, УК и телефоны АДС — вымышленные. */
export function ModelDataBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`chip model-badge ${compact ? 'compact' : ''}`} title={t('model.badge.tooltip')}>
      <Icon name="info" size={16} />
      <span className={compact ? 'sr-only' : undefined}>{t('model.badge')}</span>
    </span>
  );
}

export function Banner({ tone = 'info', icon, title, children, actions, role }: { tone?: Tone; icon?: IconName; title?: ReactNode; children?: ReactNode; actions?: ReactNode; role?: 'alert' | 'status' }) {
  const defaultIcon: IconName = tone === 'negative' ? 'triangle-alert' : tone === 'warning' ? 'alarm-clock' : tone === 'positive' ? 'circle-check' : 'info';
  return (
    <div className={`banner tone-${tone}`} role={role}>
      <Icon name={icon ?? defaultIcon} size={20} className="banner-icon" />
      <div className="banner-body">
        {title ? <p className="banner-title">{title}</p> : null}
        {children ? <div className="banner-text">{children}</div> : null}
        {actions ? <div className="banner-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={48} className="empty-icon" />
      <Typography.Text variant="title" asChild>
        <p className="empty-title">{title}</p>
      </Typography.Text>
      {text ? <p className="muted">{text}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ kind = 'card', count = 1 }: { kind?: 'line' | 'card'; count?: number }) {
  return (
    <div className="skeleton-group" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton skeleton-${kind}`} />
      ))}
    </div>
  );
}

export function KeyValue({ rows }: { rows: { key: ReactNode; value: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="kv">
      {rows.map((r, i) => (
        <div className={`kv-row ${r.strong ? 'strong' : ''}`} key={i}>
          <dt>{r.key}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}
