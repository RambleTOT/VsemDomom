/**
 * Сессия: вход по initData MAX (POST /auth/max), локально — dev-вход (?dev_user=&dev_role=).
 * Токен живёт только в памяти вкладки: при перезапуске мини-приложения MAX даёт свежий initData.
 */
import type { Me } from '@vsemdomom/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, setSessionToken, setUnauthorizedHandler } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { getInitData, getStartParam, ready } from '../bridge/webapp.ts';
import { errorKind, type ErrorKind } from '../components/errors.tsx';
import { homePath, isStaff } from './start.ts';

type SessionState =
  | { status: 'loading'; slow: boolean }
  | { status: 'ready'; me: Me; startParam: string | null; devAuth: boolean }
  | { status: 'error'; kind: ErrorKind; code: string | null };

export interface Session {
  me: Me;
  startParam: string | null;
  devAuth: boolean;
  staff: boolean;
  home: string;
  setMe: (me: Me) => void;
  refresh: () => Promise<Me>;
}

const SLOW_MS = 3000;
const SessionContext = createContext<Session | null>(null);
const StateContext = createContext<{ state: SessionState; retry: () => void } | null>(null);

const DEV_KEY = 'vsemdomom.dev';

/**
 * Dev-вход (только при DEV_AUTH на сервере): ?dev_user=&dev_role= в адресе. Запоминаем во вкладке,
 * чтобы перезагрузка на вложенном экране не выкидывала на «Откройте в MAX».
 */
function devParams(): { userId: number; role: 'resident' | 'uk' } | null {
  const q = new URLSearchParams(globalThis.location.search);
  let user = Number(q.get('dev_user'));
  let role = q.get('dev_role');
  try {
    if (Number.isInteger(user) && user > 0) {
      globalThis.sessionStorage.setItem(DEV_KEY, JSON.stringify({ user, role }));
    } else {
      const saved = JSON.parse(globalThis.sessionStorage.getItem(DEV_KEY) ?? 'null') as { user?: unknown; role?: unknown } | null;
      user = Number(saved?.user);
      role = typeof saved?.role === 'string' ? saved.role : null;
    }
  } catch {
    // Хранилище недоступно — только параметры адреса.
  }
  if (!Number.isInteger(user) || user <= 0) return null;
  return { userId: user, role: role === 'uk' ? 'uk' : 'resident' };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', slow: false });

  const start = useCallback(async () => {
    setState({ status: 'loading', slow: false });
    const slow = setTimeout(() => setState((s) => (s.status === 'loading' ? { status: 'loading', slow: true } : s)), SLOW_MS);
    try {
      const initData = getInitData();
      const dev = devParams();
      const session = initData ? await api.authMax(initData) : dev ? await api.authDev(dev.userId, dev.role, getStartParam()) : null;
      if (!session) {
        setState({ status: 'error', kind: 'outside', code: null });
        return;
      }
      setSessionToken(session.token);
      setState({ status: 'ready', me: session.user, startParam: session.startParam ?? getStartParam(), devAuth: session.devAuth });
    } catch (err) {
      // Вне MAX dev-вход выключен (404) — значит, приложение открыто не из MAX.
      const kind = err instanceof ApiError && err.status === 404 ? 'outside' : errorKind(err);
      setState({ status: 'error', kind, code: err instanceof ApiError ? (err.body?.traceId ?? null) : null });
    } finally {
      clearTimeout(slow);
      // MAX убирает свой экран загрузки: показываем и главный экран, и экран ошибки входа.
      ready();
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ status: 'error', kind: 'session', code: null }));
    void start();
    return () => setUnauthorizedHandler(null);
  }, [start]);

  const setMe = useCallback((me: Me) => setState((s) => (s.status === 'ready' ? { ...s, me } : s)), []);
  const refresh = useCallback(async () => {
    const me = await api.me();
    setMe(me);
    return me;
  }, [setMe]);

  const session = useMemo<Session | null>(
    () =>
      state.status === 'ready'
        ? { me: state.me, startParam: state.startParam, devAuth: state.devAuth, staff: isStaff(state.me), home: homePath(state.me), setMe, refresh }
        : null,
    [state, setMe, refresh],
  );
  const stateValue = useMemo(() => ({ state, retry: () => void start() }), [state, start]);

  return (
    <StateContext.Provider value={stateValue}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </StateContext.Provider>
  );
}

export function useSessionState(): { state: SessionState; retry: () => void } {
  const value = useContext(StateContext);
  if (!value) throw new Error('SessionProvider is missing');
  return value;
}

/** Сессия на экранах после входа (роутер показывает их только при status=ready). */
export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session is not ready');
  return value;
}
