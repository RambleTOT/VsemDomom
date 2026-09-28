/** S01 — согласие на обработку ПДн; S02 — дом, квартира и роль (без Госуслуг, F10). */
import { Button, Input, Radio, Switch } from '@maxhub/max-ui';
import { RESIDENCY_ROLES } from '@vsemdomom/shared/browser';
import type { HouseSummary, ResidencyRole } from '@vsemdomom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { openLink, setClosingConfirmation } from '../bridge/webapp.ts';
import { InlineError } from '../components/errors.tsx';
import { Icon } from '../components/Icon.tsx';
import { Screen } from '../components/Screen.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, ModelDataBadge, Muted, Skeleton } from '../components/ui.tsx';
import { roleName, t } from '../i18n.ts';
import type { IconName } from '../icons/icons.ts';
import { homePath, houseFromTarget, safeNext } from '../app/start.ts';
import { useSession } from '../app/session.tsx';

const POINTS: { icon: IconName; key: string }[] = [
  { icon: 'message-circle', key: 'point1' },
  { icon: 'clock', key: 'point2' },
  { icon: 'receipt', key: 'point3' },
];

export function ConsentScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const switchId = useId();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.consent(session.me.currentConsentVersion);
      const me = await session.refresh();
      const after = safeNext(next, '');
      void navigate(me.residencies.length === 0 ? `/onboarding/residence${after ? `?next=${encodeURIComponent(after)}` : ''}` : after || homePath(me), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('screen.S01.title')}
      width="narrow"
      actionsReason={agree ? undefined : t('screen.S01.disabled')}
      actions={
        <Button size="large" stretched disabled={!agree} loading={busy} onClick={() => void submit()}>
          {t('screen.S01.cta')}
        </Button>
      }
    >
      <Muted>{t('screen.S01.lead')}</Muted>
      <Card>
        {POINTS.map((p) => (
          <div className="row top" key={p.key}>
            <Icon name={p.icon} size={24} />
            <div className="stack tight">
              <p>{t(`screen.S01.${p.key}.title`)}</p>
              <p className="muted small">{t(`screen.S01.${p.key}.sub`)}</p>
            </div>
          </div>
        ))}
      </Card>
      <Card>
        <p className="section-title">{t('screen.S01.stored.title')}</p>
        <p>{t('screen.S01.stored.text')}</p>
        <button type="button" className="link-button" onClick={() => openLink(`${globalThis.location.origin}/privacy`)}>
          {t('screen.S01.policy')}
        </button>
      </Card>
      <label className="radio-row card" htmlFor={switchId}>
        <span className="radio-text">
          <span>{t('screen.S01.consent.title')}</span>
          <span className="muted small">{t('screen.S01.consent.sub')}</span>
        </span>
        <Switch id={switchId} checked={agree} onChange={(e) => setAgree(e.currentTarget.checked)} />
      </label>
      {error ? <InlineError error={error} /> : null}
    </Screen>
  );
}

function HousePicker({ onPick }: { onPick: (h: HouseSummary) => void }) {
  const [q, setQ] = useState('');
  const houses = useQuery({ queryKey: ['houses', q], queryFn: () => api.searchHouses(q || undefined) });
  return (
    <div className="stack">
      <Input size="large" mode="contrast" value={q} placeholder={t('screen.S02.search.placeholder')} onChange={(e) => setQ(e.currentTarget.value)} />
      {houses.isPending ? <Skeleton count={2} kind="line" /> : null}
      {houses.isError ? <InlineError error={houses.error} onRetry={() => void houses.refetch()} /> : null}
      {houses.data?.items.length === 0 ? <Muted>{t('screen.S02.house.not_found')}</Muted> : null}
      <div className="radio-list">
        {houses.data?.items.map((h) => (
          <button type="button" key={h.id} className="radio-row plain-button" onClick={() => onPick(h)}>
            <span className="radio-text">
              <span>{t('screen.S03.title', { house: h.label })}</span>
              <span className="muted small">{h.address}</span>
            </span>
            {h.isModel ? <ModelDataBadge compact /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ResidenceScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = params.get('next');
  const current = session.me.residencies[0] ?? null;
  // Дом из ссылки (payload чата дома) — с пометкой «Выбран по ссылке»; иначе — текущий дом жителя.
  const linkHouse = params.get('house') ?? houseFromTarget(next);
  const presetHouse = linkHouse ?? current?.house.id ?? null;
  const preset = useQuery({ queryKey: ['house-summary', presetHouse], queryFn: () => api.houseSummary(presetHouse!), enabled: presetHouse !== null });
  const [house, setHouse] = useState<HouseSummary | null>(null);
  const [changing, setChanging] = useState(false);
  const [flat, setFlat] = useState(current && current.house.id === presetHouse ? String(current.flatNo) : '');
  const [role, setRole] = useState<ResidencyRole | null>(current?.role ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const flatId = useId();

  const chosen = changing ? null : (house ?? preset.data ?? null);
  const flatNo = Number(flat);
  const flatValid = chosen !== null && /^\d{1,5}$/.test(flat) && flatNo >= chosen.flatFrom && flatNo <= chosen.flatTo;
  const flatError = chosen !== null && flat !== '' && !flatValid;
  const dirty = flat !== '' || role !== null;

  useEffect(() => {
    setClosingConfirmation(dirty);
    return () => setClosingConfirmation(false);
  }, [dirty]);

  const submit = async () => {
    if (!chosen || !role || !flatValid) return;
    setBusy(true);
    setError(null);
    try {
      await api.residency({ houseId: chosen.id, flatNo, role });
      await session.refresh();
      toast(t('screen.S02.done', { house: chosen.label, flat: flatNo }));
      setClosingConfirmation(false);
      void navigate(safeNext(next, `/house/${chosen.id}`), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const reason = !chosen ? t('screen.S02.house.pick') : flatError ? t('screen.S02.disabled.flat') : !flatValid || !role ? t('screen.S02.disabled') : undefined;
  const switching = current !== null && chosen !== null && current.house.id === chosen.id && flat !== '' && Number(flat) !== current.flatNo;

  return (
    <Screen
      title={t('screen.S02.title')}
      width="narrow"
      model={chosen?.isModel ?? false}
      back={current ? `/house/${current.house.id}` : null}
      actionsReason={reason}
      actions={
        <Button size="large" stretched disabled={reason !== undefined} loading={busy} onClick={() => void submit()}>
          {t('screen.S02.cta')}
        </Button>
      }
    >
      <section className="stack">
        <p className="section-title">{t('screen.S02.house')}</p>
        {presetHouse && preset.isPending && !house ? <Skeleton kind="line" /> : null}
        {chosen ? (
          <Card>
            <div className="row between">
              <div className="stack tight">
                <p>{t('screen.S03.title', { house: chosen.label })}</p>
                <p className="muted small">{chosen.address}</p>
                {linkHouse === chosen.id ? <p className="muted small">{t('screen.S02.house.from_chat')}</p> : null}
              </div>
              <Button size="small" variant="ghost" onClick={() => setChanging(true)}>
                {t('screen.S02.house.change')}
              </Button>
            </div>
          </Card>
        ) : (
          <HousePicker
            onPick={(h) => {
              setHouse(h);
              setChanging(false);
            }}
          />
        )}
        {presetHouse && preset.isError && !house ? <Muted>{t('screen.S02.house.not_found')}</Muted> : null}
      </section>

      {chosen ? (
        <>
          <section className="field">
            <label className="field-label" htmlFor={flatId}>
              {t('screen.S02.flat.label')}
            </label>
            <Input
              id={flatId}
              size="large"
              mode="contrast"
              inputMode="numeric"
              value={flat}
              placeholder={t('screen.S02.flat.placeholder')}
              aria-invalid={flatError}
              aria-describedby={`${flatId}-hint`}
              onChange={(e) => setFlat(e.currentTarget.value.replace(/[^\d]/g, '').slice(0, 5))}
            />
            {flatError ? (
              <p className="field-error" id={`${flatId}-hint`}>
                <Icon name="circle-alert" size={16} />
                {t('screen.S02.flat.error', { from: chosen.flatFrom, to: chosen.flatTo })}
              </p>
            ) : (
              <p className="field-hint" id={`${flatId}-hint`}>
                {t('screen.S02.flat.hint', { from: chosen.flatFrom, to: chosen.flatTo })}
              </p>
            )}
          </section>

          <section className="stack" role="radiogroup" aria-label={t('screen.S02.role.title')}>
            <p className="section-title">{t('screen.S02.role.title')}</p>
            <div className="radio-list">
              {RESIDENCY_ROLES.map((r) => (
                <label className="radio-row" key={r}>
                  <span className="radio-text">{roleName(r)}</span>
                  <Radio name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                </label>
              ))}
            </div>
            <Muted>{t('screen.S02.trust')}</Muted>
          </section>
        </>
      ) : null}

      {switching ? (
        <Banner tone="warning" title={t('screen.S02.already', { flat: current.flatNo })}>
          {t('screen.S02.already.warn')}
        </Banner>
      ) : null}
      {error instanceof ApiError && error.code === 'flat_out_of_range' && chosen ? (
        <p className="field-error">{t('screen.S02.flat.error', { from: chosen.flatFrom, to: chosen.flatTo })}</p>
      ) : error ? (
        <InlineError error={error} />
      ) : null}
    </Screen>
  );
}
