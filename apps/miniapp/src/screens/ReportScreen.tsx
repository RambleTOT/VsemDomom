/**
 * S04. Сообщить об аварии: что → когда → где (авария создаётся после шага 3), найденная открытая
 * авария — предложение присоединиться, шаг 4 — АДС (номер заявки), затем «Готово».
 */
import { Button, Input, Radio } from '@maxhub/max-ui';
import { SERVICE_TYPES, STARTED_PRESETS } from '@vsemdomom/shared/browser';
import type { IncidentDetail, IncidentScope, ServiceType, StartedPreset } from '@vsemdomom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, newIdempotencyKey } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { copyText, isWebPlatform, openLink, openMaxLink, setClosingConfirmation } from '../bridge/webapp.ts';
import { InlineError } from '../components/errors.tsx';
import { Icon } from '../components/Icon.tsx';
import { EntranceCounter, IncidentHeadline } from '../components/incident.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, Muted, SectionTitle, Skeleton } from '../components/ui.tsx';
import { localInputValue, timeIn, whenIn } from '../format.ts';
import { plural, serviceGen, serviceName, serviceNo, t } from '../i18n.ts';
import type { IconName } from '../icons/icons.ts';
import { useSession } from '../app/session.tsx';
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
const SCOPES: readonly IncidentScope[] = ['entrance', 'house', 'flat'];

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
      await api.join(duplicate.id, entrance !== null ? { entrance } : {});
      setClosingConfirmation(false);
      toast(entrance !== null ? t('join.done.dm', { entrance }) : t('join.done.no_entrance'));
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
  const tz = houseInfo?.timezone ?? 'Europe/Moscow';
  const backTo = back === null ? (houseInfo ? `/house/${houseInfo.id}` : session.home) : null;

  // ---------- шаг 1: что случилось ----------
  if (step === 1) {
    return (
      <Screen
        title={title}
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
        <SectionTitle>{t('screen.S04.step1.title')}</SectionTitle>
        <ServiceTypePicker value={service} onChange={setService} />
        {service === 'gas' ? (
          <Banner tone="negative" icon="flame" title={t('screen.S04.gas.title')}>
            {t('screen.S04.gas.text')}
          </Banner>
        ) : null}
      </Screen>
    );
  }

  const stepBack = () => setStep((s) => (s === 2 ? 1 : s === 3 ? 2 : s === 'duplicate' ? 3 : s));

  // ---------- шаг 2: с какого времени ----------
  if (step === 2) {
    const blocked = customFuture || (customOld && !confirmOld);
    return (
      <Screen
        title={title}
        model={houseInfo?.isModel ?? false}
        actionsReason={customFuture ? t('screen.S04.step2.error.future', { time: timeIn(now.toISOString(), tz) }) : undefined}
        actions={
          <>
            <Button size="large" stretched disabled={blocked} onClick={() => setStep(3)}>
              {t('common.continue')}
            </Button>
            <Button size="large" stretched variant="secondary" onClick={stepBack}>
              {t('common.back')}
            </Button>
          </>
        }
      >
        <Progress step={2} of={4} />
        <SectionTitle>{t('screen.S04.step2.title')}</SectionTitle>
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
                {t('screen.S04.step2.error.future', { time: timeIn(now.toISOString(), tz) })}
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
        <Muted>{t('screen.S04.step2.hint')}</Muted>
      </Screen>
    );
  }

  // ---------- шаг 3: где ----------
  if (step === 3) {
    const entrances = houseInfo?.entrances ?? 0;
    const needEntrance = scope === 'entrance' && entrance === null;
    return (
      <Screen
        title={title}
        model={houseInfo?.isModel ?? false}
        actionsReason={needEntrance ? t('screen.S04.step3.disabled') : undefined}
        actions={
          <>
            <Button size="large" stretched disabled={needEntrance || !houseInfo} loading={busy} onClick={() => void create()}>
              {t('screen.S04.step3.cta')}
            </Button>
            <Button size="large" stretched variant="secondary" disabled={busy} onClick={stepBack}>
              {t('common.back')}
            </Button>
          </>
        }
      >
        <Progress step={3} of={4} />
        <SectionTitle>{t('screen.S04.step3.title', { service_gen: service ? serviceGen(service) : '' })}</SectionTitle>
        <div className="radio-list" role="radiogroup" aria-label={t('screen.S04.step3.title', { service_gen: service ? serviceGen(service) : '' })}>
          {SCOPES.map((s) => (
            <label className="radio-row" key={s}>
              <Radio name="scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
              <span className="radio-text">
                <span>{t(`scope.${s}`)}</span>
                <span className="muted small">{t(`scope.${s}.sub`)}</span>
              </span>
            </label>
          ))}
        </div>
        {scope === 'entrance' && entrances > 0 ? (
          <div className="stack">
            <p className="section-title">{t('screen.S04.entrance')}</p>
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
        {house.isPending ? <Skeleton kind="line" /> : null}
        {error ? <InlineError error={error} /> : null}
      </Screen>
    );
  }

  // ---------- найденная открытая авария ----------
  if (step === 'duplicate' && duplicate) {
    return (
      <Screen
        title={t('screen.S04.dup.title')}
        model={duplicate.isModel}
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
        <Muted>{t('screen.S04.dup.text')}</Muted>
        <Card>
          <IncidentHeadline incident={duplicate} compact />
          <p className="muted small">
            {t('screen.S05.meta', { house: duplicate.house.label, time: whenIn(duplicate.startedAt, duplicate.house.timezone), joined: plural(duplicate.participantsCount, 'joined'), count: duplicate.participantsCount, residents: plural(duplicate.participantsCount, 'residents') })}
          </p>
          <EntranceCounter byEntrance={duplicate.byEntrance} />
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
      <Screen title={t('report.ads.title')} model={created.isModel}>
        <Progress step={4} of={4} />
        <Banner tone="positive" title={t('report.created')} />
        <Muted>{t('report.ads.body')}</Muted>
        <Card>
          <p className="section-title">{t('report.ads.label', { uk: houseInfo?.uk.name ?? '' })}</p>
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
        <Card>
          <p className="section-title">{t('report.ads.say')}</p>
          <ul className="say-list">
            <li>{t('report.ads.say.name')}</li>
            <li>{flat ? t('report.ads.say.address', { address: created.house.address, flat }) : t('report.ads.say.address.no_flat', { address: created.house.address })}</li>
            <li>{t('report.ads.say.what', { service_no: serviceNo(created.service), time: whenIn(created.startedAt, created.house.timezone) })}</li>
          </ul>
        </Card>
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
        title={t('report.done.title')}
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
        <Banner tone="positive" icon="circle-check" title={t('report.done.title')}>
          {created.scope === 'flat' ? t('report.done.flat') : t('report.done')}
        </Banner>
        <Card>
          <IncidentHeadline incident={created} compact />
        </Card>
      </Screen>
    );
  }

  return <Skeleton />;
}
