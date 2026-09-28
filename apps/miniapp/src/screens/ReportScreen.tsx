/**
 * S04. Сообщить об аварии: что → когда → где (авария создаётся после шага 3), найденная открытая
 * авария — предложение присоединиться, шаг 4 — АДС (номер заявки), затем «Готово».
 */
import { Button, Input, Radio } from '@maxhub/max-ui';
import { SERVICE_TYPES, STARTED_PRESET_HOURS, STARTED_PRESETS } from '@vsemdomom/shared/browser';
import type { IncidentDetail, IncidentScope, ServiceType, StartedPreset } from '@vsemdomom/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, newIdempotencyKey } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { copyText, isWebPlatform, openLink, openMaxLink, setClosingConfirmation } from '../bridge/webapp.ts';
import { InlineError } from '../components/errors.tsx';
import { Icon } from '../components/Icon.tsx';
import { EntranceCounter, IncidentHeadline } from '../components/incident.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, EmptyState, Muted, Skeleton } from '../components/ui.tsx';
import { localInputValue, timeIn, whenIn } from '../format.ts';
import { plural, serviceGen, serviceName, serviceNo, t } from '../i18n.ts';
import type { IconName } from '../icons/icons.ts';
import { useSession } from '../app/session.tsx';
import { useWide } from '../app/useWide.ts';
import { whenLabel } from '../texts.ts';
import { errorText } from './common.tsx';

const SERVICE_ICON: Record<ServiceType, IconName> = {
  cold_water: 'droplet',
  hot_water: 'shower-head',
  heating: 'heater',
  electricity: 'zap',
  sewerage: 'waves',
  gas: 'flame',
  leak: 'droplets',
};

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
/** Порядок как в макете: от узкого к широкому. */
const SCOPES: readonly IncidentScope[] = ['flat', 'entrance', 'house'];

type Step = 1 | 2 | 3 | 'duplicate' | 4 | 'done';

export function Progress({ step, of, label }: { step: number; of: number; label?: string }) {
  return (
    <div className="stack tight">
      <p className="muted small">{label ?? t('report.step.progress', { n: step })}</p>
      <div className="progress" aria-hidden="true">
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={i < step ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

/** Вопрос шага («Что случилось?») — крупнее заголовка секции. */
export function StepQuestion({ children }: { children: ReactNode }) {
  return <h2 className="step-question">{children}</h2>;
}

/** Плитки вида услуги (radiogroup): стрелки переключают выбор. */
export function ServiceTypePicker({ value, onChange }: { value: ServiceType | null; onChange: (s: ServiceType) => void }) {
  return (
    <div className="tiles" role="radiogroup" aria-label={t('screen.S04.step1.title')}>
      {SERVICE_TYPES.map((s) => (
        <button type="button" role="radio" aria-checked={value === s} key={s} className="tile" onClick={() => onChange(s)}>
          <Icon name={SERVICE_ICON[s]} size={28} />
          <span>{serviceName(s)}</span>
        </button>
      ))}
    </div>
  );
}

export function ReportScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const houseId = params.get('house') ?? session.me.residencies[0]?.house.id ?? '';
  const house = useQuery({ queryKey: ['house', houseId], queryFn: () => api.house(houseId), enabled: houseId !== '' });

  const [step, setStep] = useState<Step>(1);
  const [service, setService] = useState<ServiceType | null>(null);
  const [preset, setPreset] = useState<StartedPreset>('now');
  const [custom, setCustom] = useState(() => localInputValue(new Date()));
  const [confirmOld, setConfirmOld] = useState(false);
  const [scope, setScope] = useState<IncidentScope>('house');
  const [entrance, setEntrance] = useState<number | null>(null);
  const [floor, setFloor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<IncidentDetail | null>(null);
  const [duplicate, setDuplicate] = useState<IncidentDetail | null>(null);
  const [key] = useState(newIdempotencyKey);
  const [adsNumber, setAdsNumber] = useState('');
  const [adsTime, setAdsTime] = useState(() => localInputValue(new Date()));
  const floorId = useId();
  const wide = useWide();
  // Шаг назад — и для кнопки «Назад» внизу, и для нативной «Назад» MAX (стабильная ссылка: без мигания кнопки).
  const stepBack = useCallback(() => setStep((s) => (s === 2 ? 1 : s === 3 ? 2 : s === 'duplicate' ? 3 : s)), []);

  const now = new Date();
  const customDate = new Date(custom);
  const customFuture = preset === 'custom' && customDate.getTime() > now.getTime();
  const customOld = preset === 'custom' && now.getTime() - customDate.getTime() > HOURS_PER_DAY * MS_PER_HOUR;

  // Пока форма заполнена частично — подтверждение закрытия.
  const dirty = service !== null && created === null;
  useEffect(() => {
    setClosingConfirmation(dirty);
    return () => setClosingConfirmation(false);
  }, [dirty]);

  const back = useMemo(() => {
    if (step === 2) return 1;
    if (step === 3) return 2;
    if (step === 'duplicate') return 3;
    return null;
  }, [step]);

  const create = async () => {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const incident = await api.createIncident(
        {
          houseId,
          service,
          scope,
          ...(entrance !== null && scope === 'entrance' ? { entrance } : {}),
          ...(floor !== '' && scope !== 'flat' ? { floor: Number(floor) } : {}),
          startedPreset: preset,
          ...(preset === 'custom' ? { startedAt: customDate.toISOString() } : {}),
          ...(customOld && confirmOld ? { confirmOld: true } : {}),
        },
        key,
      );
      setCreated(incident);
      setClosingConfirmation(false);
      setStep(4);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate_incident' && typeof err.body?.duplicateOf === 'string') {
        try {
          setDuplicate(await api.incident(err.body.duplicateOf));
          setStep('duplicate');
        } catch (inner) {
          setError(inner);
        }
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const joinDuplicate = async () => {
    if (!duplicate) return;
    setBusy(true);
    try {
      const joined = await api.join(duplicate.id, entrance !== null ? { entrance } : {});
      setClosingConfirmation(false);
      const at = joined.me?.entrance ?? null;
      toast(joined.joinResult === 'already_joined' ? t('join.already') : at !== null ? t('join.done.dm', { entrance: at }) : t('join.done.no_entrance'));
      void navigate(`/incident/${duplicate.id}`, { replace: true });
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const ads = async (body: Parameters<typeof api.ads>[1], done: string) => {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(await api.ads(created.id, body));
      toast(done);
      setStep('done');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!houseId) {
    return (
      <Screen title={t('report.cta')} back="/">
        <Banner tone="warning" title={t('screen.S02.house.pick')} />
      </Screen>
    );
  }

  const title = t('report.cta');
  const houseInfo = house.data;
  const sub = houseInfo ? `${t('screen.S03.title', { house: houseInfo.label })} · ${houseInfo.address}` : undefined;
  const tz = houseInfo?.timezone ?? 'Europe/Moscow';
  const backTo = back === null ? (houseInfo ? `/house/${houseInfo.id}` : session.home) : null;

  // ---------- шаги 1–3: что, когда, где ----------
  const entrances = houseInfo?.entrances ?? 0;
  const needEntrance = scope === 'entrance' && entrance === null;
  const timeBlocked = customFuture || (customOld && !confirmOld);
  const futureText = t('screen.S04.step2.error.future', { time: timeIn(now.toISOString(), tz) });
  const startAt = preset === 'custom' ? (customFuture || Number.isNaN(customDate.getTime()) ? null : customDate) : new Date(now.getTime() - STARTED_PRESET_HOURS[preset] * MS_PER_HOUR);
  const whereTitle = service ? t('screen.S04.step3.title', { service_gen: serviceGen(service) }) : t('screen.S04.step3.title.any');

  const whatBody = (
    <>
      <StepQuestion>{t('screen.S04.step1.title')}</StepQuestion>
      <ServiceTypePicker value={service} onChange={setService} />
      {service === 'gas' ? (
        <Banner tone="negative" icon="flame" title={t('screen.S04.gas.title')}>
          {t('screen.S04.gas.text')}
        </Banner>
      ) : null}
    </>
  );

  const whenBody = (
    <>
      <StepQuestion>{t('screen.S04.step2.title')}</StepQuestion>
      <div className="chip-radios" role="radiogroup" aria-label={t('screen.S04.step2.title')}>
        {STARTED_PRESETS.map((p) => (
          <button type="button" role="radio" aria-checked={preset === p} className="chip-radio" key={p} onClick={() => setPreset(p)}>
            {t(`since.${p}`)}
          </button>
        ))}
      </div>
      {preset === 'custom' ? (
        <div className="field">
          <input
            className="native-input"
            type="datetime-local"
            value={custom}
            max={localInputValue(now)}
            aria-invalid={customFuture}
            onChange={(e) => setCustom(e.currentTarget.value)}
          />
          {customFuture ? (
            <p className="field-error">
              <Icon name="circle-alert" size={16} />
              {futureText}
            </p>
          ) : null}
          {customOld ? (
            <label className="radio-row card">
              <input type="checkbox" checked={confirmOld} onChange={(e) => setConfirmOld(e.currentTarget.checked)} />
              <span className="radio-text">{t('screen.S04.step2.confirm.old')}</span>
            </label>
          ) : null}
        </div>
      ) : null}
      <p className="muted small">{t('screen.S04.step2.hint')}</p>
      <p className="start-line">{t('screen.S04.step2.start', { when: startAt ? whenLabel(startAt.toISOString(), tz) : '—' })}</p>
    </>
  );

  const whereBody = (
    <>
      <StepQuestion>{whereTitle}</StepQuestion>
      <div className="radio-list" role="radiogroup" aria-label={whereTitle}>
        {SCOPES.map((s) => (
          <label className="radio-row" key={s}>
            <span className="radio-text">
              <span>{t(`scope.${s}`)}</span>
              <span className="muted small">{t(`scope.${s}.sub`)}</span>
            </span>
            <Radio name="scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
          </label>
        ))}
      </div>
      {scope === 'entrance' && entrances > 0 ? (
        <div className="field">
          <p className="field-label">{t('screen.S04.entrance')}</p>
          <div className="entrance-buttons" role="radiogroup" aria-label={t('screen.S04.entrance')}>
            {Array.from({ length: entrances }, (_, i) => i + 1).map((n) => (
              <button type="button" role="radio" aria-checked={entrance === n} className="chip-radio" key={n} onClick={() => setEntrance(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {scope !== 'flat' ? (
        <div className="field">
          <label className="field-label" htmlFor={floorId}>
            {t('screen.S04.floor')}
          </label>
          <Input id={floorId} size="large" mode="contrast" inputMode="numeric" value={floor} onChange={(e) => setFloor(e.currentTarget.value.replace(/[^\d]/g, '').slice(0, 2))} />
        </div>
      ) : null}
    </>
  );

  // Ноутбук: шаги 1–3 на одном экране в две колонки, одна кнопка «Отметить аварию».
  if (wide && (step === 1 || step === 2 || step === 3)) {
    const reason = !service
      ? t('report.disabled.what')
      : customFuture
        ? futureText
        : customOld && !confirmOld
          ? t('screen.S04.step2.confirm.old')
          : needEntrance
            ? t('screen.S04.step3.disabled')
            : undefined;
    return (
      <Screen
        title={title}
        sub={sub}
        model={houseInfo?.isModel ?? false}
        back={houseInfo ? `/house/${houseInfo.id}` : session.home}
        width="wide"
        actionsReason={reason}
        actions={
          <Button size="large" stretched disabled={reason !== undefined || !houseInfo} loading={busy} onClick={() => void create()}>
            {t('screen.S04.step3.cta')}
          </Button>
        }
      >
        <div className="report-columns">
          <div className="stack">{whatBody}</div>
          <div className="stack">
            {whenBody}
            {whereBody}
          </div>
        </div>
        {house.isPending ? <Skeleton kind="line" /> : null}
        {error ? <InlineError error={error} /> : null}
      </Screen>
    );
  }

  // ---------- шаг 1: что случилось ----------
  if (step === 1) {
    return (
      <Screen
        title={title}
        sub={sub}
        model={houseInfo?.isModel ?? false}
        back={backTo}
        actionsReason={service ? undefined : t('report.disabled.what')}
        actions={
          <Button size="large" stretched disabled={!service} onClick={() => setStep(2)}>
            {t('common.continue')}
          </Button>
        }
      >
        <Progress step={1} of={4} />
        {whatBody}
      </Screen>
    );
  }

  // ---------- шаг 2: с какого времени ----------
  if (step === 2) {
    return (
      <Screen
        title={title}
        sub={sub}
        model={houseInfo?.isModel ?? false}
        back={stepBack}
        actionsReason={customFuture ? futureText : undefined}
        actions={
          <Button size="large" stretched disabled={timeBlocked} onClick={() => setStep(3)}>
            {t('common.continue')}
          </Button>
        }
      >
        <Progress step={2} of={4} />
        {whenBody}
      </Screen>
    );
  }

  // ---------- шаг 3: где ----------
  if (step === 3) {
    return (
      <Screen
        title={title}
        sub={sub}
        model={houseInfo?.isModel ?? false}
        back={stepBack}
        actionsReason={needEntrance ? t('screen.S04.step3.disabled') : undefined}
        actions={
          <Button size="large" stretched disabled={needEntrance || !houseInfo} loading={busy} onClick={() => void create()}>
            {t('screen.S04.step3.cta')}
          </Button>
        }
      >
        <Progress step={3} of={4} />
        {whereBody}
        {house.isPending ? <Skeleton kind="line" /> : null}
        {error ? <InlineError error={error} /> : null}
      </Screen>
    );
  }

  // ---------- найденная открытая авария ----------
  if (step === 'duplicate' && duplicate) {
    return (
      <Screen
        title={title}
        sub={sub}
        model={duplicate.isModel}
        back={stepBack}
        actions={
          <>
            <Button size="large" stretched loading={busy} onClick={() => void joinDuplicate()}>
              {t('screen.S04.dup.join')}
            </Button>
            <Button size="large" stretched variant="secondary" disabled={busy} onClick={stepBack}>
              {t('screen.S04.dup.other')}
            </Button>
          </>
        }
      >
        <Progress step={3} of={4} />
        <StepQuestion>{t('screen.S04.dup.title')}</StepQuestion>
        <Muted>{t('screen.S04.dup.text')}</Muted>
        <Card>
          <IncidentHeadline incident={duplicate} compact />
          <div className="stack tight">
            <p className="hero-line">{serviceNo(duplicate.service)}</p>
            <p className="muted small">
              {t('screen.S03.card.since', { time: whenIn(duplicate.startedAt, duplicate.house.timezone), joined: plural(duplicate.participantsCount, 'joined'), count: duplicate.participantsCount, residents: plural(duplicate.participantsCount, 'residents'), entrances: duplicate.byEntrance.map((e) => e.entrance).join(', ') || '—' })}
            </p>
          </div>
          <EntranceCounter byEntrance={duplicate.byEntrance} entrances={duplicate.house.entrances} />
        </Card>
      </Screen>
    );
  }

  // ---------- шаг 4: АДС ----------
  if (step === 4 && created) {
    const phone = created.ads.phone;
    const web = isWebPlatform();
    const flat = session.me.residencies.find((r) => r.house.id === created.house.id)?.flatNo;
    return (
      <Screen title={title} sub={sub} model={created.isModel}>
        <Progress step={4} of={4} />
        <Banner tone="positive" title={t('report.created')} />
        <StepQuestion>{t('report.ads.title')}</StepQuestion>
        <Muted>{t('report.ads.body')}</Muted>
        <Card>
          <p className="muted small">{t('report.ads.label', { uk: houseInfo?.uk.name ?? '' })}</p>
          <p className="big-number">{phone}</p>
          {web ? (
            <>
              <Button
                size="large"
                stretched
                variant="secondary"
                onClick={() => void copyText(phone).then((ok) => ok && toast(t('report.ads.copied')))}
              >
                {t('report.ads.copy')}
              </Button>
              <p className="muted small">{t('report.ads.laptop_note')}</p>
            </>
          ) : (
            <Button size="large" stretched variant="secondary" aria-label={t('report.ads.call')} onClick={() => openLink(`tel:${phone.replace(/[^\d+]/g, '')}`)}>
              {t('report.ads.call')}
            </Button>
          )}
        </Card>
        <div className="field">
          <p className="field-label">{t('report.ads.say')}</p>
          <ul className="say-list">
            <li>{t('report.ads.say.name')}</li>
            <li>{flat ? t('report.ads.say.address', { address: created.house.address, flat }) : t('report.ads.say.address.no_flat', { address: created.house.address })}</li>
            <li>{t('report.ads.say.what', { service_no: serviceNo(created.service), time: whenIn(created.startedAt, created.house.timezone) })}</li>
          </ul>
        </div>
        <Card>
          <div className="field">
            <label className="field-label" htmlFor="ads-number">
              {t('report.ads.number')}
            </label>
            <Input id="ads-number" size="large" mode="default" value={adsNumber} placeholder={t('report.ads.number.placeholder')} onChange={(e) => setAdsNumber(e.currentTarget.value.slice(0, 32))} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ads-time">
              {t('report.ads.time')}
            </label>
            <input id="ads-time" className="native-input" type="datetime-local" value={adsTime} max={localInputValue(new Date())} onChange={(e) => setAdsTime(e.currentTarget.value)} />
          </div>
          <Button
            size="large"
            stretched
            disabled={adsNumber.trim() === ''}
            loading={busy}
            onClick={() => void ads({ number: adsNumber.trim(), registeredAt: new Date(adsTime).toISOString() }, t('report.ads.saved'))}
          >
            {t('report.ads.save')}
          </Button>
          <Button size="large" stretched variant="secondary" disabled={busy} onClick={() => void ads({ notReached: true }, t('report.ads.no_answer.saved'))}>
            {t('report.ads.no_answer')}
          </Button>
          <Button size="large" stretched variant="ghost" disabled={busy} onClick={() => void ads({ remindLater: true }, t('report.ads.later.saved'))}>
            {t('report.ads.later')}
          </Button>
        </Card>
        {error ? <InlineError error={error} /> : null}
      </Screen>
    );
  }

  // ---------- готово ----------
  if (step === 'done' && created) {
    const invite = houseInfo?.chat?.inviteLink ?? null;
    return (
      <Screen
        title={title}
        sub={sub}
        model={created.isModel}
        actions={
          <>
            <Button size="large" stretched onClick={() => void navigate(`/incident/${created.id}`, { replace: true })}>
              {t('report.done.open')}
            </Button>
            {invite && created.scope !== 'flat' ? (
              <Button size="large" stretched variant="secondary" onClick={() => openMaxLink(invite)}>
                {t('report.done.chat')}
              </Button>
            ) : null}
          </>
        }
      >
        <Card className="done-card">
          <EmptyState icon="circle-check" title={t('report.done.title')} text={created.scope === 'flat' ? t('report.done.flat') : t('report.done')} />
        </Card>
        <div className="list-card">
          <div className="list-row static">
            <span className="list-row-text">
              <span className="list-row-title">{t('report.done.what', { service: serviceName(created.service), time: whenIn(created.startedAt, created.house.timezone) })}</span>
              {created.me?.entrance ? (
                <span className="muted small">
                  {created.me.floor ? t('report.done.where.floor', { entrance: created.me.entrance, floor: created.me.floor }) : t('report.done.where', { entrance: created.me.entrance })}
                </span>
              ) : null}
            </span>
          </div>
          {created.ads.registration?.number ? (
            <div className="list-row static">
              <span className="list-row-text">
                <span className="list-row-title">{t('report.done.ads', { number: created.ads.registration.number })}</span>
                {created.ads.registration.at ? <span className="muted small">{t('report.done.ads.at', { time: whenIn(created.ads.registration.at, created.house.timezone) })}</span> : null}
              </span>
            </div>
          ) : null}
        </div>
      </Screen>
    );
  }

  return <Skeleton />;
}
