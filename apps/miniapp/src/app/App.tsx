/**
 * Корень мини-приложения: тема и платформа MAX UI, запросы, тосты, сессия и маршруты.
 * Экраны после входа открываются только при готовой сессии; разделы УК — только сотрудникам.
 */
import { MaxUI, useSystemColorScheme } from '@maxhub/max-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { ApiError } from '../api/client.ts';
import { getPlatform } from '../bridge/webapp.ts';
import { SystemScreen } from '../components/errors.tsx';
import { ToastProvider } from '../components/Toast.tsx';
import { Skeleton } from '../components/ui.tsx';
import { t } from '../i18n.ts';
import { useErrorAction } from '../screens/common.tsx';
import { HouseScreen } from '../screens/HouseScreen.tsx';
import { IncidentScreen } from '../screens/IncidentScreen.tsx';
import { ConsentScreen, ResidenceScreen } from '../screens/Onboarding.tsx';
import { ProfileScreen } from '../screens/ProfileScreen.tsx';
import { ReportScreen } from '../screens/ReportScreen.tsx';
import { SessionPending, StartScreen } from '../screens/StartScreen.tsx';
import { SystemRoute } from '../screens/SystemRoute.tsx';
import { SessionProvider, useSession, useSessionState } from './session.tsx';
import { onboardingFor } from './start.ts';

const STALE_MS = 5_000;

// Экраны УК и редкие экраны жителя грузятся отдельно: первый экран открывается быстрее.
const ActScreen = lazy(() => import('../screens/ActScreen.tsx').then((m) => ({ default: m.ActScreen })));
const OwnerScreen = lazy(() => import('../screens/OwnerScreen.tsx').then((m) => ({ default: m.OwnerScreen })));
const RecalcScreen = lazy(() => import('../screens/RecalcScreen.tsx').then((m) => ({ default: m.RecalcScreen })));
const ResultScreen = lazy(() => import('../screens/ResultScreen.tsx').then((m) => ({ default: m.ResultScreen })));
const UkListScreen = lazy(() => import('../screens/UkIncidentScreens.tsx').then((m) => ({ default: m.UkListScreen })));
const UkIncidentScreen = lazy(() => import('../screens/UkIncidentScreens.tsx').then((m) => ({ default: m.UkIncidentScreen })));
const UkHousesScreen = lazy(() => import('../screens/UkHouseScreens.tsx').then((m) => ({ default: m.UkHousesScreen })));
const UkHouseScreen = lazy(() => import('../screens/UkHouseScreens.tsx').then((m) => ({ default: m.UkHouseScreen })));
const UkHeatScreen = lazy(() => import('../screens/UkHouseScreens.tsx').then((m) => ({ default: m.UkHeatScreen })));
const UkMonthScreen = lazy(() => import('../screens/UkHouseScreens.tsx').then((m) => ({ default: m.UkMonthScreen })));
const UkResidentsScreen = lazy(() => import('../screens/UkHouseScreens.tsx').then((m) => ({ default: m.UkResidentsScreen })));
const ChatBindScreen = lazy(() => import('../screens/UkHouseScreens.tsx').then((m) => ({ default: m.ChatBindScreen })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      refetchOnWindowFocus: true,
      // Ошибки 4xx не повторяем: экран сразу объясняет, что случилось.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/** Экраны после входа: пока сессии нет — загрузка или ошибка входа. */
function SessionGate() {
  const { state } = useSessionState();
  if (state.status !== 'ready') return <SessionPending />;
  return (
    <>
      {state.devAuth ? <p className="dev-banner">{t('dev.banner')}</p> : null}
      <Suspense
        fallback={
          <div className="screen">
            <Skeleton count={3} />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </>
  );
}

/** Житель без согласия или квартиры — сначала S01–S02, потом запрошенный экран. */
function Onboarded() {
  const session = useSession();
  const location = useLocation();
  const target = `${location.pathname}${location.search}`;
  const redirect = onboardingFor(session.me, target);
  return redirect ? <Navigate to={redirect} replace /> : <Outlet />;
}

/** Разделы УК: без роли сотрудника — «Раздел для сотрудников УК» с переходом в профиль. */
function StaffOnly() {
  const session = useSession();
  const action = useErrorAction();
  return session.staff ? <Outlet /> : <SystemScreen kind="forbidden" onAction={action('forbidden')} />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<StartScreen />} />
      <Route element={<SessionGate />}>
        <Route path="/onboarding" element={<ConsentScreen />} />
        <Route path="/onboarding/residence" element={<ResidenceScreen />} />
        <Route path="/owner/:token" element={<OwnerScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/error/:kind" element={<SystemRoute />} />
        <Route element={<Onboarded />}>
          <Route path="/house/:id" element={<HouseScreen />} />
          <Route path="/report" element={<ReportScreen />} />
          <Route path="/incident/:id" element={<IncidentScreen />} />
          <Route path="/incident/:id/result" element={<ResultScreen />} />
          <Route path="/incident/:id/recalc" element={<RecalcScreen />} />
          <Route path="/incident/:id/act" element={<ActScreen />} />
        </Route>
        <Route element={<StaffOnly />}>
          <Route path="/uk" element={<UkListScreen />} />
          <Route path="/uk/incident/:id" element={<UkIncidentScreen />} />
          <Route path="/uk/houses" element={<UkHousesScreen />} />
          <Route path="/uk/houses/:id" element={<UkHouseScreen />} />
          <Route path="/uk/houses/:id/heat" element={<UkHeatScreen />} />
          <Route path="/uk/houses/:id/month" element={<UkMonthScreen />} />
          <Route path="/uk/residents" element={<UkResidentsScreen />} />
          <Route path="/uk/bind/:token" element={<ChatBindScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/error/notfound" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const scheme = useSystemColorScheme({ listenChanges: true });
  return (
    <MaxUI platform={getPlatform()} colorScheme={scheme} className={`app-root max-${scheme}`}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <SessionProvider>
              <AppRoutes />
            </SessionProvider>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
      <div id="portal-root" />
    </MaxUI>
  );
}
