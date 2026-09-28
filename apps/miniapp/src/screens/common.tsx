/** Общее для экранов: загрузка со скелетоном и «дольше обычного», ошибки запроса, переход на корень роли. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client.ts';
import { close } from '../bridge/webapp.ts';
import { errorKind, InlineError, SystemScreen, useSlow, type ErrorKind } from '../components/errors.tsx';
import { Skeleton } from '../components/ui.tsx';
import { useSession } from '../app/session.tsx';

/** Ошибки, при которых экран целиком заменяется на S12. */
const FULL_SCREEN: readonly ErrorKind[] = ['notfound', 'forbidden', 'feature_off', 'expired', 'session', 'merged'];

export function useErrorAction(): (kind: ErrorKind, retry?: () => void, mergedInto?: string | null) => (() => void) | undefined {
  const navigate = useNavigate();
  const session = useSession();
  return (kind, retry, mergedInto) => {
    switch (kind) {
      case 'session':
        return close;
      case 'forbidden':
        return () => void navigate('/profile');
      case 'merged':
        return mergedInto ? () => void navigate(session.staff ? `/uk/incident/${mergedInto}` : `/incident/${mergedInto}`) : () => void navigate(session.home);
      case 'notfound':
      case 'expired':
      case 'feature_off':
        return () => void navigate(session.home);
      case 'network':
      case 'server':
      case 'busy':
      case 'slow':
        return retry;
      case 'outside':
        return undefined;
    }
  };
}

/**
 * Состояние запроса: загрузка (скелетон, через 8 с — «дольше обычного»), ошибка (S12 или карточка
 * с «Повторить»), данные — children.
 */
export function Loaded<T>({ query, children, skeleton = 3 }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; skeleton?: number }) {
  const slow = useSlow(query.isPending);
  const action = useErrorAction();
  if (query.isPending) {
    if (slow) return <SystemScreen kind="slow" onAction={action('slow', () => void query.refetch())} />;
    return <Skeleton count={skeleton} />;
  }
  if (query.isError) {
    const kind = errorKind(query.error);
    const mergedInto = query.error instanceof ApiError && typeof query.error.body?.mergedInto === 'string' ? query.error.body.mergedInto : null;
    if (FULL_SCREEN.includes(kind)) return <SystemScreen kind={kind} onAction={action(kind, undefined, mergedInto)} />;
    return <InlineError error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

/** Ошибка мутации — текст для тоста. */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return fallback;
    return err.detail ?? err.message;
  }
  return fallback;
}
