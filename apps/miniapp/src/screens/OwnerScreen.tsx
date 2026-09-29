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
import { NormBasisLink } from '../components/norm.tsx';
import { Banner, Card, Muted } from '../components/ui.tsx';
import { dayMonthIn, minutesText, monthOfKey } from '../format.ts';
import { lowerFirst, serviceName, t } from '../i18n.ts';
import { onboardingFor } from '../app/start.ts';
import { useSession } from '../app/session.tsx';
import { errorText, Loaded, useErrorAction } from './common.tsx';

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
    // Собственник ещё не зарегистрирован: дом и квартира известны из приглашения, роль — собственник.
    void navigate(onboardingFor(session.me, target, { house: view.house.id, flat: view.flatNo, role: 'owner' }) ?? target);
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
    <Screen title={t('screen.S10.title')} model={result?.house.isModel ?? false} back={session.home} actions={actions}>
      <Card>
        <p className="card-title">{t('screen.S10.ask', { flat: view.flatNo })}</p>
        <Muted>{t('screen.S10.note')}</Muted>
        <p className="muted small">{t('screen.S10.address', { house: view.house.label, address: view.house.address, flat: view.flatNo })}</p>
      </Card>
      {result ? (
        <>
          <Card>
            <p className="muted small">{t('screen.S10.result', { service_lower: lowerFirst(serviceName(result.service)), date: dayMonthIn(result.startedAt, result.house.timezone) })}</p>
            {result.my ? <p className="big-number">{minutesText(result.my.durationMinutes)}</p> : null}
            {result.month ? (
              <p>
                {result.month.withinNorm
                  ? t('result.within_norm')
                  : t('screen.S10.over', { month: monthOfKey(result.month.month), excess: minutesText(result.month.excessMinutes) })}
              </p>
            ) : null}
            {result.month ? <NormBasisLink norm={result.month.norm} /> : null}
          </Card>
        </>
      ) : (
        <Muted>{t('screen.S10.result.pending')}</Muted>
      )}
      {view.status === 'confirmed' ? <Banner tone="positive" title={t('screen.S10.done')} /> : null}
      {view.status === 'rejected' ? <Banner tone="neutral" title={t('screen.S10.unknown.saved')} /> : null}
      {result ? <p className="muted small">{result.disclaimer}</p> : null}
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
