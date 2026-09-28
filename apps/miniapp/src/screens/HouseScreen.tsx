/** S03. Мой дом: есть ли сейчас авария и знает ли УК; сообщить; итоги; месяц против нормы; чат. */
import { Button, IconButton } from '@maxhub/max-ui';
import type { HouseDetail, IncidentSummary } from '@vsemdomom/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/endpoints.ts';
import { openMaxLink } from '../bridge/webapp.ts';
import { Icon } from '../components/Icon.tsx';
import { IncidentHeadline } from '../components/incident.tsx';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { Banner, Card, EmptyState, SectionTitle } from '../components/ui.tsx';
import { dateIn, minutesText, monthOfKey, whenIn } from '../format.ts';
import { plural, serviceName, t, upperFirst } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { Loaded } from './common.tsx';

const REFRESH_MS = 30_000;

function IncidentCard({ incident, onOpen }: { incident: IncidentSummary; onOpen: () => void }) {
  const tz = incident.house.timezone;
  const entrances = incident.byEntrance.map((e) => e.entrance).join(', ') || '—';
  return (
    <button type="button" className="card clickable incident-row" onClick={onOpen}>
      <IncidentHeadline incident={incident} compact />
      <p className="meta">
        {t('screen.S03.card.since', { time: whenIn(incident.startedAt, tz), joined: plural(incident.participantsCount, 'joined'), count: incident.participantsCount, residents: plural(incident.participantsCount, 'residents'), entrances })}
      </p>
    </button>
  );
}

function HouseBody({ house }: { house: HouseDetail }) {
  const navigate = useNavigate();
  const joinChat = useSession().me.features.joinChat;
  const me = house.myResidency;
  const tz = house.timezone;
  const flats = house.flatTo - house.flatFrom + 1;
  const active = [...house.activeIncidents].sort(
    (a, b) => new Date(a.headline.nextDeadline?.dueAt ?? a.createdAt).getTime() - new Date(b.headline.nextDeadline?.dueAt ?? b.createdAt).getTime(),
  );
  return (
    <Screen
      title={t('screen.S03.title', { house: house.label })}
      sub={t('screen.S03.sub', { address: house.address, flats, flats_word: plural(flats, 'flats') })}
      model={house.isModel}
      width="wide"
      headerAfter={
        <IconButton size="medium" variant="secondary" aria-label={t('screen.S03.profile')} onClick={() => void navigate('/profile')}>
          <Icon name="user" size={20} />
        </IconButton>
      }
    >
      {joinChat && me && me.inHouseChat === false && house.chat?.inviteLink ? (
        <Banner
          tone="info"
          icon="message-circle"
          title={t('screen.S03.join.title')}
          actions={
            <Button size="small" variant="secondary" onClick={() => openMaxLink(house.chat!.inviteLink!)}>
              {t('screen.S02.join_chat')}
            </Button>
          }
        />
      ) : null}
      <div className="columns">
        <div className="stack">
          <SectionTitle>{t('screen.S03.active')}</SectionTitle>
          {active.length === 0 ? (
            <Card>
              <EmptyState icon="house" title={t('empty.incidents.resident.title')} text={t('empty.incidents.resident')} />
            </Card>
          ) : (
            active.map((i) => <IncidentCard key={i.id} incident={i} onOpen={() => void navigate(`/incident/${i.id}`)} />)
          )}
          <Button size="large" stretched onClick={() => void navigate(`/report?house=${house.id}`)}>
            {t('report.cta')}
          </Button>
        </div>
        <div className="stack">
          {house.recentResults.length > 0 ? (
            <>
              <SectionTitle>{t('screen.S03.results')}</SectionTitle>
              {house.recentResults.map((r) => (
                <button type="button" key={r.id} className="card clickable" onClick={() => void navigate(`/incident/${r.id}/result`)}>
                  <div className="row">
                    <strong>{serviceName(r.service)}</strong>
                    <span className="muted">{r.closedAt ? dateIn(r.closedAt, tz) : ''}</span>
                  </div>
                  <p className="muted small">
                    {r.displayStatus === 'closed' && r.headline.durationMinutes !== null
                      ? t('screen.S03.result.in_norm', { duration: minutesText(r.headline.durationMinutes) })
                      : t(r.displayStatus === 'closed_with_discrepancy' ? 'status.closed_disc' : 'status.closed')}
                  </p>
                </button>
              ))}
            </>
          ) : null}
          {house.month.services.length > 0 ? (
            <>
              <SectionTitle>{t('screen.S07.month.label')}</SectionTitle>
              {house.month.services.map((s) => (
                <Card key={s.service}>
                  <p>{t('screen.S03.month.title', { month: upperFirst(monthOfKey(house.month.month)), service: serviceName(s.service) })}</p>
                  <p className="muted">
                    {s.limitMinutes === null
                      ? t('deadline.no_norm')
                      : t('screen.S03.month.value', { total: minutesText(s.totalMinutes), limit: minutesText(s.limitMinutes) })}
                  </p>
                  {s.norm ? <NormBasisLink norm={s.norm} /> : null}
                </Card>
              ))}
            </>
          ) : null}
          {house.chat?.bound ? (
            <>
              <SectionTitle>{t('screen.S03.chat.title')}</SectionTitle>
              <Card>
                <p>{house.chat.title ?? t('screen.S03.chat.title')}</p>
                {house.chat.participantsCount !== null ? <p className="muted small">{t('screen.S03.chat.members', { count: house.chat.participantsCount })}</p> : null}
                {house.chat.inviteLink ? (
                  <Button size="medium" variant="secondary" onClick={() => openMaxLink(house.chat!.inviteLink!)}>
                    {t('screen.S03.chat.open')}
                  </Button>
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}

export function HouseScreen() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['house', id], queryFn: () => api.house(id), refetchInterval: REFRESH_MS });
  return <Loaded query={query}>{(house) => <HouseBody house={house} />}</Loaded>;
}
