/** S05. Авария (житель): за 3 секунды понять — знает ли УК, когда дадут, что делать. */
import { Button, Input, Switch } from '@maxhub/max-ui';
import type { IncidentDetail, ObservationRequest } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/endpoints.ts';
import { copyText, isWebPlatform, openLink } from '../bridge/webapp.ts';
import { DeadlineList, EntranceCounter, IncidentHeadline, StatusStepper, Timeline } from '../components/incident.tsx';
import { Screen } from '../components/Screen.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { NormBasisLink } from '../components/norm.tsx';
import { Banner, Card, SectionTitle } from '../components/ui.tsx';
import { whenIn } from '../format.ts';
import { plural, restoreBadLabel, restoreQuestion, serviceGen, serviceName, t } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { errorText, Loaded } from './common.tsx';

const REFRESH_MS = 15_000;
const BEFORE_RESOLVE = new Set(['open', 'accepted', 'brigade_on_site', 'localized']);

function useIncidentAction(incident: IncidentDetail) {
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, call: () => Promise<IncidentDetail>, done: string | ((updated: IncidentDetail) => string)) => {
    setBusy(key);
    try {
      const updated = await call();
      client.setQueryData(['incident', incident.id], updated);
      toast(typeof done === 'string' ? done : done(updated));
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function AdsSheet({ incident, open, onClose, rereport }: { incident: IncidentDetail; open: boolean; onClose: () => void; rereport: boolean }) {
  const [number, setNumber] = useState('');
  const { busy, run } = useIncidentAction(incident);
  const id = useId();
  const save = async () => {
    await run('ads', () => api.ads(incident.id, { number: number.trim() }), rereport ? t('screen.S05.disc.saved') : t('report.ads.saved'));
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      focusField
      title={rereport ? t('screen.S05.disc.repeat') : t('report.ads.number')}
      footer={
        <Button size="large" stretched disabled={number.trim() === ''} loading={busy === 'ads'} onClick={() => void save()}>
          {rereport ? t('screen.S05.disc.save') : t('report.ads.save')}
        </Button>
      }
    >
      <label className="field-label" htmlFor={id}>
        {rereport ? t('screen.S05.disc.repeat') : t('report.ads.number')}
      </label>
      <Input id={id} size="large" mode="default" value={number} placeholder={t('report.ads.number.placeholder')} onChange={(e) => setNumber(e.currentTarget.value.slice(0, 32))} />
    </Sheet>
  );
}

function IncidentBody({ incident }: { incident: IncidentDetail }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const { busy, run } = useIncidentAction(incident);
  const [adsOpen, setAdsOpen] = useState<'first' | 'rereport' | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const tz = incident.house.timezone;
  const me = incident.me;
  const features = session.me.features;
  const phone = incident.ads.phone;
  const web = isWebPlatform();

  const observe = (body: ObservationRequest, done: string) => run(body.kind, () => api.observe(incident.id, body), done);
  // Авария в подъезде: «У меня тоже» — тот же подъезд; для дома подъезд житель укажет в боте.
  const join = () =>
    run(
      'join',
      () => api.join(incident.id, incident.scope === 'entrance' && incident.entrance ? { entrance: incident.entrance } : {}),
      (updated) => (updated.me?.entrance ? t('join.done.dm', { entrance: updated.me.entrance }) : t('join.done.no_entrance')),
    );
  const notMe = () => run('leave', () => api.leave(incident.id), t('join.not_me.done'));
  const setNotify = async (notify: boolean) => {
    try {
      await api.participation(incident.id, notify);
      await client.invalidateQueries({ queryKey: ['incident', incident.id] });
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    }
  };

  const actions = BEFORE_RESOLVE.has(incident.status) ? (
    web ? (
      <Button size="large" stretched onClick={() => void copyText(phone).then((ok) => ok && toast(t('report.ads.copied')))}>
        {t('report.ads.copy')}
      </Button>
    ) : (
      <Button size="large" stretched onClick={() => openLink(`tel:${phone.replace(/[^\d+]/g, '')}`)}>
        {t('report.ads.call')}
      </Button>
    )
  ) : incident.status === 'closed' ? (
    <Button size="large" stretched onClick={() => void navigate(`/incident/${incident.id}/result`)}>
      {t('screen.S05.result_cta')}
    </Button>
  ) : undefined;

  const answer = me?.restoredAnswer ?? null;
  const bad = restoreBadLabel(incident.service);
  const scopeText = incident.scope === 'entrance' && incident.entrance ? t('screen.S05.scope.entrance', { entrance: incident.entrance }) : t(`screen.S05.scope.${incident.scope}`);

  return (
    <Screen
      title={serviceName(incident.service)}
      sub={t('screen.S05.meta', { house: incident.house.label, time: whenIn(incident.startedAt, tz), joined: plural(incident.participantsCount, 'joined'), count: incident.participantsCount, residents: plural(incident.participantsCount, 'residents') })}
      model={incident.isModel}
      back={session.staff ? '/uk' : `/house/${incident.house.id}`}
      width="wide"
      actions={actions}
      headerAfter={
        session.staff ? (
          <Button size="small" variant="secondary" onClick={() => void navigate(`/uk/incident/${incident.id}`)}>
            {t('screen.S05.view.uk')}
          </Button>
        ) : null
      }
    >
      <IncidentHeadline incident={incident} onOpenActual={incident.mergedInto ? () => void navigate(`/incident/${incident.mergedInto}`) : undefined} />

      {incident.status === 'brigade_on_site' && features.brigadeConfirm && me?.joined ? (
        <Banner
          tone="info"
          icon="wrench"
          title={t('screen.S05.brigade.ask', { time: incident.brigadeOnSiteAt ? whenIn(incident.brigadeOnSiteAt, tz) : '' })}
          actions={
            <>
              <Button size="small" loading={busy === 'brigade_confirmed'} onClick={() => void observe({ kind: 'brigade_confirmed' }, t('brigade.confirmed'))}>
                {t('brigade.confirm')}
              </Button>
              <Button size="small" variant="secondary" loading={busy === 'brigade_absent'} onClick={() => void observe({ kind: 'brigade_absent' }, t('brigade.none.saved'))}>
                {t('brigade.none')}
              </Button>
            </>
          }
        />
      ) : null}

      {incident.status === 'checking' || incident.status === 'discrepancy' ? (
        <Banner
          tone={incident.status === 'discrepancy' ? 'negative' : 'info'}
          icon="circle-help"
          title={restoreQuestion(incident.service)}
          actions={
            <>
              <Button size="small" variant={answer === 'yes' ? 'primary' : 'secondary'} loading={busy === 'restored_yes'} onClick={() => void observe({ kind: 'restored_yes' }, t('restore.answer.saved'))}>
                {t('restore.answer.yes')}
              </Button>
              <Button size="small" variant={answer === 'no' ? 'primary' : 'secondary'} loading={busy === 'restored_no'} onClick={() => void observe({ kind: 'restored_no' }, t('restore.answer.no_saved'))}>
                {t('restore.answer.no')}
              </Button>
              {bad ? (
                <Button size="small" variant={answer === 'weak' ? 'primary' : 'secondary'} loading={busy === 'restored_weak'} onClick={() => void observe({ kind: 'restored_weak' }, t('restore.answer.saved'))}>
                  {bad}
                </Button>
              ) : null}
            </>
          }
        />
      ) : null}

      {incident.status === 'discrepancy' && answer === 'no' ? (
        <Card>
          <div className="row between">
            <p className="banner-title">{t('screen.S05.disc.title')}</p>
            <button type="button" className="link-button" onClick={() => setShowHelp((v) => !v)}>
              {showHelp ? t('incident.headline.action.hide') : t('incident.headline.action.what_to_do')}
            </button>
          </div>
          {showHelp ? (
            <>
              <p>{t('screen.S05.disc.step1')}</p>
              {me?.adsRereport ? (
                <p className="muted">{t('screen.S05.ads.number', { number: me.adsRereport.number ?? '—', time: whenIn(me.adsRereport.at, tz) })}</p>
              ) : (
                <Button size="medium" variant="secondary" onClick={() => setAdsOpen('rereport')}>
                  {t('screen.S05.disc.repeat')}
                </Button>
              )}
              <p>
                {incident.act?.checkDueAt
                  ? t('screen.S05.disc.step2.at', { time: whenIn(incident.act.checkDueAt, tz), persons: `${incident.act.requiredConsumers} ${plural(incident.act.requiredConsumers, 'neighbours')}` })
                  : t('screen.S05.disc.step2.plain')}
              </p>
              {incident.act ? <NormBasisLink norm={incident.act.norm} /> : null}
              {features.actTemplate && incident.act?.available ? (
                <Button size="medium" variant="secondary" onClick={() => void navigate(`/incident/${incident.id}/act`)}>
                  {t('screen.S05.act_cta')}
                </Button>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      <div className="columns">
        <div className="stack">
          <Card>
            <SectionTitle>{t('screen.S05.deadlines')}</SectionTitle>
            <DeadlineList deadlines={incident.deadlines} timezone={tz} />
          </Card>
          <Card>
            <SectionTitle>{t('screen.S05.stepper')}</SectionTitle>
            <StatusStepper steps={incident.steps} timezone={tz} />
          </Card>
          <Card>
            <SectionTitle>{t('screen.S05.where')}</SectionTitle>
            <p>{scopeText}</p>
            <EntranceCounter byEntrance={incident.counters.byEntrance} unknown={incident.counters.unknownEntrance} />
            {incident.counters.unconfirmed > 0 ? (
              <p className="muted small">{t('screen.S05.where.unconfirmed', { count: incident.counters.unconfirmed, residents: plural(incident.counters.unconfirmed, 'residents') })}</p>
            ) : null}
          </Card>
          {me ? (
            <Card>
              <SectionTitle>{t('screen.S05.me')}</SectionTitle>
              {me.joined ? (
                <p>{me.entrance ? t('screen.S05.me.joined', { entrance: me.entrance }) : t('join.done.no_entrance')}</p>
              ) : BEFORE_RESOLVE.has(incident.status) ? (
                <>
                  <p>{t('screen.S05.me.ask', { service_gen: serviceGen(incident.service) })}</p>
                  <div className="row">
                    <Button size="medium" loading={busy === 'join'} onClick={() => void join()}>
                      {t('join.me_too')}
                    </Button>
                    <Button size="medium" variant="secondary" loading={busy === 'leave'} onClick={() => void notMe()}>
                      {t('join.not_me')}
                    </Button>
                  </div>
                </>
              ) : null}
              {me.joined ? (
                <label className="radio-row plain-button">
                  <span className="radio-text">
                    <span>{t('screen.S05.notify')}</span>
                    <span className="muted small">{t('screen.S05.notify.sub')}</span>
                  </span>
                  <Switch checked={me.notify} onChange={(e) => void setNotify(e.currentTarget.checked)} />
                </label>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <SectionTitle>{t('screen.S05.ads')}</SectionTitle>
            {incident.ads.registration?.number ? (
              <p>{t('screen.S05.ads.number', { number: incident.ads.registration.number, time: incident.ads.registration.at ? whenIn(incident.ads.registration.at, tz) : '' })}</p>
            ) : (
              <>
                <p className="muted">{t('screen.S05.ads.none')}</p>
                {me?.joined && BEFORE_RESOLVE.has(incident.status) ? (
                  <Button size="medium" variant="secondary" onClick={() => setAdsOpen('first')}>
                    {t('screen.S05.ads.add')}
                  </Button>
                ) : null}
              </>
            )}
            <p className="muted small">{t('screen.S05.ads.phone', { phone })}</p>
          </Card>
        </div>
        <Card>
          <SectionTitle>{t('screen.S05.timeline')}</SectionTitle>
          <Timeline events={incident.timeline} timezone={tz} />
        </Card>
      </div>
      <AdsSheet incident={incident} open={adsOpen !== null} rereport={adsOpen === 'rereport'} onClose={() => setAdsOpen(null)} />
    </Screen>
  );
}

export function IncidentScreen() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['incident', id], queryFn: () => api.incident(id), refetchInterval: REFRESH_MS });
  return <Loaded query={query}>{(incident) => <IncidentBody incident={incident} />}</Loaded>;
}
