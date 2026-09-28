/**
 * S10. Подтверждение жильца собственником (флаг trustLevels): без имени жильца — только квартира и итог
 * аварии. После подтверждения собственник может оформить перерасчёт от своего имени.
 */
import { Button } from '@maxhub/max-ui';
import type { OwnerInviteView } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/endpoints.ts';
import { SystemScreen } from '../components/errors.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, Muted, SectionTitle } from '../components/ui.tsx';
import { dateIn } from '../format.ts';
import { lowerFirst, serviceNo, t } from '../i18n.ts';
import { onboardingFor } from '../app/start.ts';
import { useSession } from '../app/session.tsx';
import { errorText, Loaded, useErrorAction } from './common.tsx';
import { MonthBlock } from './ResultScreen.tsx';

function OwnerBody({ token, view }: { token: string; view: OwnerInviteView }) {
  const navigate = useNavigate();
  const session = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null);
  const result = view.result;

  const decide = async (kind: 'confirm' | 'reject') => {
    setBusy(kind);
    try {
      await (kind === 'confirm' ? api.confirmOwnerInvite(token) : api.rejectOwnerInvite(token));
      await client.invalidateQueries({ queryKey: ['owner', token] });
      toast(kind === 'confirm' ? t('screen.S10.confirmed') : t('screen.S10.unknown.saved'));
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const recalc = () => {
    const target = `/incident/${view.incidentId}/recalc`;
    void navigate(onboardingFor(session.me, target) ?? target);
  };

  const actions =
    view.status === 'pending' ? (
      <>
        <Button size="large" stretched loading={busy === 'confirm'} disabled={busy !== null} onClick={() => void decide('confirm')}>
          {t('screen.S10.confirm')}
        </Button>
        <Button size="large" stretched variant="secondary" loading={busy === 'reject'} disabled={busy !== null} onClick={() => void decide('reject')}>
          {t('screen.S10.unknown')}
        </Button>
      </>
    ) : view.status === 'confirmed' && result?.month && !result.month.withinNorm ? (
      <Button size="large" stretched onClick={recalc}>
        {t('screen.S07.cta')}
      </Button>
    ) : undefined;

  return (
    <Screen title={t('screen.S10.title')} sub={`${t('screen.S03.title', { house: view.house.label })} · ${view.house.address}`} back={session.home} actions={actions}>
      {view.status === 'pending' ? (
        <Card>
          <p className="banner-title">{t('screen.S10.ask', { flat: view.flatNo })}</p>
          <Muted>{t('screen.S10.note')}</Muted>
        </Card>
      ) : view.status === 'confirmed' ? (
        <Banner tone="positive" title={t('screen.S10.done')} />
      ) : (
        <Banner tone="neutral" title={t('screen.S10.unknown.saved')} />
      )}
      {result ? (
        <Card>
          <SectionTitle>{t('screen.S10.result', { service_lower: lowerFirst(serviceNo(result.service)), date: dateIn(result.startedAt, result.house.timezone) })}</SectionTitle>
          <MonthBlock result={result} />
          <p className="muted small">{result.disclaimer}</p>
        </Card>
      ) : (
        <Muted>{t('screen.S10.result.pending')}</Muted>
      )}
    </Screen>
  );
}

export function OwnerScreen() {
  const { token = '' } = useParams();
  const session = useSession();
  const action = useErrorAction();
  const query = useQuery({ queryKey: ['owner', token], queryFn: () => api.ownerInvite(token) });
  if (!session.me.features.trustLevels) return <SystemScreen kind="feature_off" onAction={action('feature_off')} />;
  return <Loaded query={query}>{(view) => <OwnerBody token={token} view={view} />}</Loaded>;
}
