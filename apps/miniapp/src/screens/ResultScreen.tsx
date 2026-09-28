/** S07. Итог: сколько не было услуги в квартире, месячная норма (от неё зависит перерасчёт), кто может оформить. */
import { Button } from '@maxhub/max-ui';
import type { Result } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { copyText } from '../bridge/webapp.ts';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, SectionTitle } from '../components/ui.tsx';
import { dateIn, minutesText, monthOfKey, timeIn, whenIn } from '../format.ts';
import { plural, serviceGen, serviceName, t } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { timelineText } from '../documents.ts';
import { errorText, Loaded } from './common.tsx';

const WATER = new Set(['cold_water', 'hot_water']);

/** Месячная норма: превышение (от него зависят деньги) или «в пределах». */
export function MonthBlock({ result }: { result: Result }) {
  const m = result.month;
  if (!m) return <p className="muted">{t('money.no_norm')}</p>;
  const month = monthOfKey(m.month);
  return (
    <div className="stack tight">
      <div className={`money-line ${m.withinNorm ? 'tone-positive' : 'tone-negative'}`}>
        {m.withinNorm ? (
          <>
            <p className="banner-title">{t('result.within_norm')}</p>
            <p>{t('result.within_norm.detail', { month, total: minutesText(m.totalMinutes), limit: minutesText(m.limitMinutes) })}</p>
          </>
        ) : (
          <p className="banner-title">
            {t('result.over_norm', { month, total: minutesText(m.totalMinutes), limit: minutesText(m.limitMinutes), excess: minutesText(m.excessMinutes) })}
          </p>
        )}
      </div>
      <NormBasisLink norm={m.norm} />
    </div>
  );
}

function sourceText(result: Result): string | null {
  const my = result.my;
  if (!my) return null;
  const time = timeIn(my.restoredAt, result.house.timezone);
  if (my.source === 'resident_answer') return t('screen.S07.source', { time });
  if (my.source === 'ads_report') return t('screen.S07.source.ads', { time });
  return t('screen.S07.source.uk', { time });
}

function ResultBody({ result }: { result: Result }) {
  const navigate = useNavigate();
  const session = useSession();
  const toast = useToast();
  const client = useQueryClient();
  const tz = result.house.timezone;
  const my = result.my;
  const ukTime = timeIn(result.uk.resolvedAt, tz);
  const ukDuration = minutesText(result.uk.durationMinutes);
  const canApply = my !== null && result.month !== null && !result.month.withinNorm && !session.staff;

  const copyTimeline = async () => {
    try {
      const incident = await client.fetchQuery({ queryKey: ['incident', result.incidentId], queryFn: () => api.incident(result.incidentId) });
      if (await copyText(timelineText(incident))) toast(t('screen.S07.copied'));
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    }
  };

  const actions = (
    <>
      {canApply ? (
        <Button size="large" stretched onClick={() => void navigate(`/incident/${result.incidentId}/recalc`)}>
          {t('screen.S07.cta')}
        </Button>
      ) : null}
      <Button size="large" stretched variant="secondary" onClick={() => void copyTimeline()}>
        {t('screen.S07.copy')}
      </Button>
    </>
  );

  return (
    <Screen
      title={t('screen.S07.title')}
      sub={t('screen.S07.sub', { service: serviceName(result.service), house: result.house.label, date: dateIn(result.startedAt, tz) })}
      model={result.house.isModel}
      back={session.staff ? `/uk/incident/${result.incidentId}` : `/incident/${result.incidentId}`}
      actions={actions}
    >
      <Card>
        {my ? (
          <>
            <p className="muted">{t('screen.S07.my', { service_gen: serviceGen(result.service) })}</p>
            <p className="big-number">{minutesText(my.durationMinutes)}</p>
            <p className="muted">
              {timeIn(result.startedAt, tz)}–{timeIn(my.restoredAt, tz)}
            </p>
            <p>
              {my.source === 'uk_mark'
                ? t('screen.S07.by_uk.same', { uk_time: ukTime, uk_duration: ukDuration })
                : t('screen.S07.by_uk', { uk_time: ukTime, uk_duration: ukDuration, my_time: timeIn(my.restoredAt, tz) })}
            </p>
            <p className="muted small">{sourceText(result)}</p>
          </>
        ) : (
          <>
            <p className="muted">{serviceName(result.service)}</p>
            <p className="big-number">{ukDuration}</p>
            <p>{t('screen.S07.by_uk.same', { uk_time: ukTime, uk_duration: ukDuration })}</p>
          </>
        )}
      </Card>

      {result.single ? (
        <Banner tone={result.single.exceeded ? 'warning' : 'positive'} title={result.single.exceeded ? t('screen.S07.single.over.n', { limit: minutesText(result.single.limitMinutes) }) : t('screen.S07.single.ok.n', { limit: minutesText(result.single.limitMinutes) })}>
          <p>{t('screen.S07.single.note')}</p>
          <NormBasisLink norm={result.single.norm} />
        </Banner>
      ) : null}

      <Card>
        <SectionTitle>{t('screen.S07.month.label')}</SectionTitle>
        <MonthBlock result={result} />
        <p className="muted small">{result.disclaimer}</p>
      </Card>

      {result.eligibleFlats > 0 ? (
        <Card>
          <p className="banner-title">{t('screen.S07.flats', { count: result.eligibleFlats, flats: plural(result.eligibleFlats, 'flats'), can: plural(result.eligibleFlats, 'can') })}</p>
          {result.lateFlats.count > 0 && result.lateFlats.lastRestoredAt ? (
            <p className="muted">{t(WATER.has(result.service) ? 'screen.S07.flats.sub' : 'screen.S07.flats.sub.other', { time: whenIn(result.lateFlats.lastRestoredAt, tz) })}</p>
          ) : null}
        </Card>
      ) : null}

      {result.month?.withinNorm ? <p className="muted">{t('screen.S07.thanks')}</p> : null}

      {result.actCopyNorm ? (
        <Card>
          <p>{t('screen.S07.act_copy.short')}</p>
          <NormBasisLink norm={result.actCopyNorm} />
        </Card>
      ) : null}
    </Screen>
  );
}

export function ResultScreen() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['result', id], queryFn: () => api.result(id), retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2 });
  // Авария ещё не закрыта — итог появится позже, показываем саму аварию.
  if (query.error instanceof ApiError && query.error.code === 'incident_not_closed') return <Navigate to={`/incident/${id}`} replace />;
  return <Loaded query={query}>{(result) => <ResultBody result={result} />}</Loaded>;
}
