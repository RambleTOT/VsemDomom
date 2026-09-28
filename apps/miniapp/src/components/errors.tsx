/** Ошибки: вид по ответу API, системный экран S12 (один понятный выход) и ошибка внутри экрана. */
import { Button, Typography } from '@maxhub/max-ui';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.ts';
import { t } from '../i18n.ts';
import type { IconName } from '../icons/icons.ts';
import { Icon } from './Icon.tsx';

export type ErrorKind = 'outside' | 'session' | 'network' | 'server' | 'busy' | 'forbidden' | 'notfound' | 'merged' | 'expired' | 'feature_off' | 'slow';

export function errorKind(err: unknown): ErrorKind {
  if (!(err instanceof ApiError)) return 'server';
  if (err.isNetwork) return 'network';
  if (err.status === 401) return 'session';
  // Лимит запросов: не «ошибка сервиса», а просьба подождать.
  if (err.status === 429) return 'busy';
  if (err.status === 403) return 'forbidden';
  if (err.status === 404) return err.code === 'feature_disabled' ? 'feature_off' : 'notfound';
  if (err.status === 410) return 'expired';
  if (err.status === 409 && err.code === 'incident_not_open' && typeof err.body?.mergedInto === 'string') return 'merged';
  return 'server';
}

const ERROR_VIEW: Record<ErrorKind, { icon: IconName; title: string; text: string; cta: string | null }> = {
  outside: { icon: 'smartphone', title: 'error.outside.title', text: 'error.outside', cta: null },
  session: { icon: 'log-in', title: 'error.session.title', text: 'error.session', cta: 'common.close' },
  network: { icon: 'wifi-off', title: 'error.network.title', text: 'error.network', cta: 'common.retry' },
  server: { icon: 'server-crash', title: 'error.server.title', text: 'error.server', cta: 'common.retry' },
  busy: { icon: 'clock', title: 'error.busy.title', text: 'error.busy', cta: 'common.retry' },
  forbidden: { icon: 'lock', title: 'error.forbidden.title', text: 'error.forbidden.uk', cta: 'error.forbidden.cta' },
  notfound: { icon: 'search-x', title: 'error.notfound.title', text: 'error.notfound', cta: 'common.to_home' },
  merged: { icon: 'merge', title: 'error.merged.title', text: 'error.merged', cta: 'incident.headline.action.open_actual' },
  expired: { icon: 'link-2-off', title: 'error.expired.title', text: 'error.expired', cta: 'common.to_home' },
  feature_off: { icon: 'square-dashed', title: 'feature.off.title', text: 'feature.off', cta: 'common.to_home' },
  slow: { icon: 'refresh-cw', title: 'loading.slow.title', text: 'loading.slow', cta: 'common.retry' },
};

export interface ErrorViewProps {
  kind: ErrorKind;
  onAction?: () => void;
  /** Код для поддержки (traceId) у ошибки сервера. */
  code?: string | null;
  loading?: boolean;
}

/** S12: на весь экран, заголовок получает фокус. */
export function SystemScreen({ kind, onAction, code, loading }: ErrorViewProps) {
  const view = ERROR_VIEW[kind];
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), [kind]);
  return (
    <div className="system-screen" role="alert">
      <Icon name={view.icon} size={48} className="system-icon" />
      <Typography.Text variant="subheader" asChild>
        <h1 ref={titleRef} tabIndex={-1}>
          {t(view.title)}
        </h1>
      </Typography.Text>
      <p className="muted">{t(view.text)}</p>
      {kind === 'server' && code ? <p className="muted small">{t('error.server.code', { code })}</p> : null}
      {view.cta && onAction ? (
        <Button size="large" stretched loading={loading} onClick={onAction}>
          {t(view.cta)}
        </Button>
      ) : null}
    </div>
  );
}

/** Ошибка внутри экрана (карточкой): введённые данные остаются. */
export function InlineError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const kind = errorKind(error);
  const view = ERROR_VIEW[kind];
  const code = error instanceof ApiError ? (error.body?.traceId ?? null) : null;
  const text = error instanceof ApiError && error.detail && kind !== 'network' && kind !== 'busy' ? error.detail : t(view.text);
  return (
    <div className="inline-error" role="alert">
      <Icon name={view.icon} size={20} />
      <div>
        <p className="banner-title">{error instanceof ApiError && kind === 'server' && !error.isNetwork ? error.message : t(view.title)}</p>
        <p className="banner-text">{text}</p>
        {kind === 'server' && code ? <p className="muted small">{t('error.server.code', { code })}</p> : null}
        {onRetry ? (
          <Button size="small" variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Долгая загрузка: через 8 секунд — «Загружаем дольше обычного» и «Повторить». */
export function useSlow(loading: boolean, afterMs = 8000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [loading, afterMs]);
  return slow;
}
