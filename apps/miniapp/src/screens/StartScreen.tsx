/** S00. Запуск: вход, роль и payload → нужный экран. */
import { Spinner, Typography } from '@maxhub/max-ui';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { api } from '../api/endpoints.ts';
import { close, openLink } from '../bridge/webapp.ts';
import { SystemScreen } from '../components/errors.tsx';
import { Icon } from '../components/Icon.tsx';
import { t } from '../i18n.ts';
import { onboardingFor, routeForStart } from '../app/start.ts';
import { useSessionState } from '../app/session.tsx';

/** Вне MAX: «Откройте приложение в MAX» и ссылка на бота (адрес — из /version, без входа). */
function OutsideScreen() {
  const version = useQuery({ queryKey: ['version'], queryFn: () => api.version(), staleTime: Infinity, retry: 1 });
  const link = version.data?.botLink;
  return <SystemScreen kind="outside" onAction={link ? () => openLink(link) : undefined} />;
}

/** Пока сессии нет: загрузка («Проверяем вход…») или ошибка входа с одним действием. */
export function SessionPending() {
  const { state, retry } = useSessionState();
  if (state.status === 'error') {
    if (state.kind === 'outside') return <OutsideScreen />;
    const onAction = state.kind === 'session' ? close : state.kind === 'network' || state.kind === 'server' ? retry : undefined;
    return <SystemScreen kind={state.kind} code={state.code} onAction={onAction} />;
  }
  return (
    <div className="start-screen">
      <Icon name="brand-mark" size={48} label={t('screen.S00.mark_label')} />
      <Typography.Text variant="subheader">{t('screen.S00.title')}</Typography.Text>
      <Spinner size={24} aria-label={t('common.loading')} />
      <p className="muted" aria-live="polite">
        {state.status === 'loading' && state.slow ? t('screen.S00.slow') : ''}
      </p>
    </div>
  );
}

export function StartScreen() {
  const { state } = useSessionState();
  if (state.status !== 'ready') return <SessionPending />;
  const target = routeForStart(state.startParam, state.me);
  return <Navigate to={onboardingFor(state.me, target) ?? target} replace />;
}
