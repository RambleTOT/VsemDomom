/** S00. Запуск: вход, роль и payload → нужный экран. */
import { Spinner, Typography } from '@maxhub/max-ui';
import { Navigate } from 'react-router';
import { close } from '../bridge/webapp.ts';
import { SystemScreen } from '../components/errors.tsx';
import { Icon } from '../components/Icon.tsx';
import { t } from '../i18n.ts';
import { onboardingFor, routeForStart } from '../app/start.ts';
import { useSessionState } from '../app/session.tsx';

/** Пока сессии нет: загрузка («Проверяем вход…») или ошибка входа с одним действием. */
export function SessionPending() {
  const { state, retry } = useSessionState();
  if (state.status === 'error') {
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
