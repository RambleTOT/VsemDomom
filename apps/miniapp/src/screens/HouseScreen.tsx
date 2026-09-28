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
import { Banner, Card, EmptyState, Muted, SectionTitle } from '../components/ui.tsx';
import { dayMonthIn, minutesText, monthOfKey, whenIn } from '../format.ts';
import { lowerFirst, plural, serviceName, serviceNo, t, upperFirst } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { Loaded } from './common.tsx';

const REFRESH_MS = 30_000;

function IncidentCard({ incident, onOpen }: { incident: IncidentSummary; onOpen: () => void }) {
  const tz = incident.house.timezone;
  const entrances = incident.byEntrance.map((e) => e.entrance).join(', ') || '—';
  return (
    <button type="button" className="card clickable incident-row" onClick={onOpen}>
      <IncidentHeadline incident={incident} compact />
      <div className="stack tight">
        <p className="hero-line">{serviceNo(incident.service)}</p>
        <p className="meta">
          {t('screen.S03.card.since', { time: whenIn(incident.startedAt, tz), joined: plural(incident.participantsCount, 'joined'), count: incident.participantsCount, residents: plural(incident.participantsCount, 'residents'), entrances })}
        </p>
        {incident.joined ? <p className="meta">{t('screen.S03.card.joined.plain')}</p> : null}
      </div>
    </button>
  );
}

/** Итог в списке: устранено в норматив или со сроком сверх норматива; расхождение — отдельно. */
function resultLine(r: IncidentSummary): string {
  if (r.displayStatus === 'closed_with_discrepancy') return t('status.closed_disc');
  const duration = minutesText(r.headline.durationMinutes ?? 0);
  return r.overdue ? t('screen.S03.result.done', { duration }) : t('screen.S03.result.in_norm', { duration });
}

/** Месяц против нормы: крупное число, полоса заполнения, основание. */
function MonthCard({ month, service, hasActive }: { month: string; service: HouseDetail['month']['services'][number]; hasActive: boolean }) {
  const limit = service.limitMinutes;
  const share = limit ? Math.min(1, service.totalMinutes / limit) : 0;
  const over = limit !== null && service.totalMinutes > limit;
  return (
    <Card>
      <p className="muted small">{t('screen.S03.month.title', { month: upperFirst(monthOfKey(month)), service: lowerFirst(serviceName(service.service)) })}</p>
      {limit === null ? (
        <Muted>{t('deadline.no_norm')}</Muted>
      ) : (
        <>
          <p className="month-value">
            <span className="big-number">{minutesText(service.totalMinutes)}</span> <span className="muted">{t('screen.S03.month.of', { limit: minutesText(limit) })}</span>
          </p>
          <div className={`meter ${over ? 'over' : ''}`} role="img" aria-label={t('screen.S03.month.value', { total: minutesText(service.totalMinutes), limit: minutesText(limit) })}>
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        </>
      )}
      {hasActive ? <p className="muted small">{t('screen.S03.month.note.current')}</p> : null}
      {service.norm ? <NormBasisLink norm={service.norm} /> : null}
    </Card>
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
              <div className="list-card">
                {house.recentResults.map((r) => (
                  <button type="button" key={r.id} className="list-row plain-button" onClick={() => void navigate(`/incident/${r.id}/result`)}>
                    <span className="list-row-text">
                      <span className="list-row-title">{t('screen.S03.result.title', { service: serviceName(r.service), date: dayMonthIn(r.closedAt ?? r.startedAt, tz) })}</span>
                      <span className="muted small">{resultLine(r)}</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="muted" />
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {house.month.services.length > 0 ? (
            <>
              <SectionTitle>{t('screen.S07.month.label')}</SectionTitle>
              {house.month.services.map((s) => (
                <MonthCard key={s.service} month={house.month.month} service={s} hasActive={house.activeIncidents.some((i) => i.service === s.service)} />
              ))}
            </>
          ) : null}
          {house.chat?.bound ? (
            <Card>
              <div className="row between">
                <div className="stack tight">
                  <p className="card-title">{t('screen.S03.chat.title')}</p>
                  {house.chat.participantsCount !== null ? (
                    <p className="muted small">
                      {house.chat.participantsCount} {plural(house.chat.participantsCount, 'members')}
                    </p>
                  ) : null}
                </div>
                {house.chat.inviteLink ? (
                  <Button size="medium" variant="secondary" onClick={() => openMaxLink(house.chat!.inviteLink!)}>
                    {t('screen.S03.chat.open')}
                  </Button>
                ) : null}
              </div>
            </Card>
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
