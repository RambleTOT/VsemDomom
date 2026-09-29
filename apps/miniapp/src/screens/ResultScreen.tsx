/** S07. Итог: сколько не было услуги в квартире, месячная норма (от неё зависит перерасчёт), кто может оформить. */
import { Button } from '@maxhub/max-ui';
import type { IncidentDetail, Result } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCopy } from '../components/useCopy.ts';
import { Banner, Card } from '../components/ui.tsx';
import { dayMonthIn, minutesText, monthOfKey, timeIn, whenIn } from '../format.ts';
import { plural, serviceGen, serviceName, t } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { timelineText } from '../documents.ts';
import { rangeLabel } from '../texts.ts';
import { errorText, Loaded } from './common.tsx';

const WATER = new Set(['cold_water', 'hot_water']);

/** Месячная норма: превышение (от него зависят деньги) или «в пределах» — вся карточка в цвете результата. */
export function MonthCard({ result, label = true }: { result: Result; label?: boolean }) {
  const m = result.month;
  if (!m) {
    return (
      <Card>
        <p className="muted">{t('money.no_norm')}</p>
      </Card>
    );
  }
  const month = monthOfKey(m.month);
  return (
    <Card className={m.withinNorm ? 'tone-positive' : 'tone-negative'}>
      {label ? <p className="small">{t('screen.S07.month.label')}</p> : null}
      {m.withinNorm ? (
        <div className="stack tight">
          <p className="card-title">{t('result.within_norm')}</p>
          <p>{t('result.within_norm.detail', { month, total: minutesText(m.totalMinutes), limit: minutesText(m.limitMinutes) })}</p>
        </div>
      ) : (
        <p className="card-title">{t('result.over_norm', { month, total: minutesText(m.totalMinutes), limit: minutesText(m.limitMinutes), excess: minutesText(m.excessMinutes) })}</p>
      )}
      <NormBasisLink norm={m.norm} />
    </Card>
  );
}

function sourceText(result: Result): string | null {
  const my = result.my;
  if (!my) return null;
  if (my.ongoing) return t('screen.S07.source.ongoing');
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
  const copy = useCopy();
  const incidentQuery = useQuery({ queryKey: ['incident', result.incidentId], queryFn: () => api.incident(result.incidentId) });
  const tz = result.house.timezone;
  const my = result.my;
  const ukTime = timeIn(result.uk.resolvedAt, tz);
  const ukDuration = minutesText(result.uk.durationMinutes);
  // Перерасчёт — всякому участнику аварии, в том числе сотруднику УК, который живёт в доме (демо-роль проверяющего).
  const canApply = my !== null && result.month !== null && !result.month.withinNorm;

  const copyTimeline = async () => {
    try {
      // Хронология загружена заранее: копирование идёт прямо в обработчике нажатия (Safari требует жест пользователя).
      const incident: IncidentDetail = incidentQuery.data ?? (await client.fetchQuery({ queryKey: ['incident', result.incidentId], queryFn: () => api.incident(result.incidentId) }));
      await copy(timelineText(incident), t('screen.S07.copied'));
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    }
  };

  const actions = (
    <>
      {canApply ? (
        <Button size="large" stretched onClick={() => void navigate(`/incident/${result.incidentId}/recalc`)}>
          {t(result.preliminary ? 'screen.S07.cta.preliminary' : 'screen.S07.cta')}
        </Button>
      ) : null}
      <Button size="large" stretched variant="secondary" onClick={() => void copyTimeline()}>
        {t('screen.S07.copy')}
      </Button>
    </>
  );

  return (
    <Screen
      title={t(result.preliminary ? 'screen.S07.title.preliminary' : 'screen.S07.title')}
      sub={t('screen.S07.sub', { service: serviceName(result.service), house: result.house.label, date: dayMonthIn(result.startedAt, tz) })}
      model={result.house.isModel}
      back={session.staff && !my ? `/uk/incident/${result.incidentId}` : `/incident/${result.incidentId}`}
      actions={actions}
    >
      {result.preliminary ? (
        <Banner tone="info" title={t('screen.S07.preliminary')}>
          <p>{t('screen.S07.preliminary.text')}</p>
        </Banner>
      ) : null}
      <Card>
        {my ? (
          <>
            <p className="muted small">{t('screen.S07.my', { service_gen: serviceGen(result.service) })}</p>
            <p className="big-number">{minutesText(my.durationMinutes)}</p>
            <p className="muted">{rangeLabel(result.startedAt, my.restoredAt, tz)}</p>
            <p>
              {my.ongoing
                ? t('screen.S07.ongoing', { uk_time: ukTime, uk_duration: ukDuration })
                : my.source === 'uk_mark'
                  ? t('screen.S07.by_uk.same', { uk_time: ukTime, uk_duration: ukDuration })
                  : t('screen.S07.by_uk', { uk_time: ukTime, uk_duration: ukDuration, my_time: timeIn(my.restoredAt, tz) })}
            </p>
            <p className="muted small">{sourceText(result)}</p>
          </>
        ) : (
          <>
            <p className="muted small">{serviceName(result.service)}</p>
            <p className="big-number">{ukDuration}</p>
            <p>{t('screen.S07.by_uk.same', { uk_time: ukTime, uk_duration: ukDuration })}</p>
          </>
        )}
      </Card>

      <MonthCard result={result} />

      {result.single ? (
        <Card>
          <p>{result.single.exceeded ? t('screen.S07.single.over.n', { limit: minutesText(result.single.limitMinutes) }) : t('screen.S07.single.ok.n', { limit: minutesText(result.single.limitMinutes) })}</p>
          <p className="muted small">{t('screen.S07.single.note')}</p>
          <NormBasisLink norm={result.single.norm} />
        </Card>
      ) : null}

      {result.eligibleFlats > 0 ? (
        <Card>
          <p className="card-title">{t('screen.S07.flats', { count: result.eligibleFlats, flats: plural(result.eligibleFlats, 'flats'), can: plural(result.eligibleFlats, 'can') })}</p>
          {result.lateFlats.count > 0 && result.lateFlats.lastRestoredAt ? (
            <p className="muted small">{t(WATER.has(result.service) ? 'screen.S07.flats.sub' : 'screen.S07.flats.sub.other', { time: whenIn(result.lateFlats.lastRestoredAt, tz) })}</p>
          ) : null}
        </Card>
      ) : null}

      {result.month?.withinNorm ? <p>{t('screen.S07.thanks')}</p> : null}

      {result.actCopyNorm ? (
        <Card>
          <p>{t('screen.S07.act_copy.short')}</p>
          <p className="muted small">{result.actCopyNorm.textPlain}</p>
          <NormBasisLink norm={result.actCopyNorm} />
        </Card>
      ) : null}
      <p className="muted small">{result.disclaimer}</p>
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
