/**
 * U01. Аварии УК: фильтры «Открытые · Срок истёк · Закрытые», выбор дома, список по срочности.
 * U02. Авария глазами УК: следующий шаг одной кнопкой, остальное — в «Другой статус»; сетка подъездов,
 * жители, сроки, хронология. На широком экране — «список + деталь».
 */
import { Button, IconButton, Typography } from '@maxhub/max-ui';
import type { IncidentSummary, UkAction, UkIncidentDetail, UkStatusRequest } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api, type UkListStatus } from '../api/endpoints.ts';
import { EntranceFloorGridView, GridLegend } from '../components/grid.tsx';
import { Icon } from '../components/Icon.tsx';
import { DeadlineList, IncidentHeadline, IncidentHero, StatusStepper, Timeline } from '../components/incident.tsx';
import { headlineText } from '../texts.ts';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { ConfirmDialog, Sheet } from '../components/Sheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { Card, Chip, EmptyState, KeyValue, Muted, SectionTitle } from '../components/ui.tsx';
import { localInputValue, timeIn, todayAt, whenIn } from '../format.ts';
import { plural, restoreQuestion, serviceName, serviceNo, t } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { useWide } from '../app/useWide.ts';
import { errorText, Loaded } from './common.tsx';

const REFRESH_MS = 15_000;
const MS_PER_HOUR = 3_600_000;
/** Быстрые варианты ориентира — варианты интерфейса, не нормативы. */
const ETA_PLUS_HOURS = [1, 2, 4] as const;
const ETA_EVENING_HOUR = 22;
const STATUSES: readonly UkListStatus[] = ['open', 'expired', 'closed'];

// ---------- U01 ----------

/** «П2, П3» — подъезды с отметками. */
const entranceList = (incident: IncidentSummary) => incident.byEntrance.map((e) => t('entrance.short', { entrance: e.entrance })).join(', ');

function UkIncidentRow({ incident, selected, onOpen }: { incident: IncidentSummary; selected: boolean; onOpen: () => void }) {
  const tz = incident.house.timezone;
  const entrances = entranceList(incident);
  return (
    <button type="button" className={`card clickable incident-row ${selected ? 'selected' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onOpen}>
      <IncidentHeadline incident={incident} compact />
      <div className="stack tight">
        <p className="hero-line">
          {serviceName(incident.service)} <span className="muted">{t('screen.U01.row.since', { time: whenIn(incident.startedAt, tz) })}</span>
        </p>
        <p className="meta">
          {t('screen.U01.row.where', { house: incident.house.label, address: incident.house.address, count: incident.flatsCount, flats: plural(incident.flatsCount, 'flats') })}
          {entrances ? ` · ${entrances}` : ''}
        </p>
      </div>
    </button>
  );
}

export function UkListScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const wide = useWide();
  const [params, setParams] = useSearchParams();
  const staff = session.me.staff;
  const status: UkListStatus = STATUSES.find((s) => s === params.get('status')) ?? 'open';
  const houseId = params.get('house') ?? undefined;
  const selected = params.get('id');
  const query = useQuery({ queryKey: ['uk-incidents', status, houseId ?? null], queryFn: () => api.ukIncidents(status, houseId), refetchInterval: REFRESH_MS });

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const open = (id: string) => (wide ? update({ id }) : void navigate(`/uk/incident/${id}`));
  const houses = query.data?.houses ?? [];

  const list = (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label={t('screen.U01.title')}>
        {STATUSES.map((s) => {
          const count = query.data?.counts[s];
          return (
            <button type="button" role="tab" key={s} aria-selected={status === s} onClick={() => update({ status: s, id: null })}>
              {t(`filter.${s}`)}
              {count !== undefined ? <span className={`count ${s === 'expired' && count > 0 ? 'attention' : ''}`}>{count}</span> : null}
            </button>
          );
        })}
      </div>
      {houses.length > 1 ? (
        <select className="native-input" aria-label={t('screen.U03L.title')} value={houseId ?? ''} onChange={(e) => update({ house: e.currentTarget.value || null, id: null })}>
          <option value="">{t('filter.houses.all', { n: houses.length })}</option>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {t('screen.S03.title', { house: h.label })} · {h.address}
            </option>
          ))}
        </select>
      ) : null}
      <Loaded query={query}>
        {(data) =>
          data.items.length === 0 ? (
            <Card>
              <EmptyState icon="circle-check" title={t(status === 'closed' ? 'empty.incidents.uk.closed' : 'empty.incidents.uk.title')} text={status === 'closed' ? undefined : t('empty.incidents.uk')} />
            </Card>
          ) : (
            <div className="stack">
              {data.items.map((i) => (
                <UkIncidentRow key={i.id} incident={i} selected={wide && selected === i.id} onOpen={() => open(i.id)} />
              ))}
            </div>
          )
        }
      </Loaded>
    </div>
  );

  return (
    <Screen
      title={t('screen.U01.title')}
      sub={staff ? t('screen.U01.sub.n', { uk: staff.uk.name, n: houses.length, houses: plural(houses.length, 'houses') }) : undefined}
      model={staff?.uk.isModel ?? false}
      width="wide"
      badges={staff?.isDemo ? <Chip tone="info">{t('role.demo')}</Chip> : null}
      headerAfter={
        <>
          <IconButton size="medium" variant="secondary" aria-label={t('screen.U03L.title')} onClick={() => void navigate('/uk/houses')}>
            <Icon name="building-2" size={20} />
          </IconButton>
          <IconButton size="medium" variant="secondary" aria-label={t('screen.S03.profile')} onClick={() => void navigate('/profile')}>
            <Icon name="user" size={20} />
          </IconButton>
        </>
      }
    >
      {wide ? (
        <div className="split">
          {list}
          <div className="split-detail">
            {selected ? (
              <UkIncidentPanel id={selected} embedded onMoved={(id) => update({ id })} />
            ) : (
              <Card>
                <EmptyState icon="list-checks" title={t('screen.U02.pick')} />
              </Card>
            )}
          </div>
        </div>
      ) : (
        list
      )}
    </Screen>
  );
}

// ---------- U02 ----------

const ACTION_STATUS: Record<Exclude<UkAction, 'merge'>, UkStatusRequest['status']> = {
  accept: 'accepted',
  brigade_on_site: 'brigade_on_site',
  localize: 'localized',
  resolve: 'resolved',
};

function actionLabel(action: UkAction, incident: UkIncidentDetail): string {
  switch (action) {
    case 'accept':
      return t('uk.next.accept');
    case 'brigade_on_site':
      return t('uk.next.brigade');
    case 'localize':
      return t('uk.next.localized');
    case 'resolve':
      return incident.status === 'discrepancy' ? t('uk.next.resolved_again') : t('uk.next.resolved');
    case 'merge':
      return t('uk.merge');
  }
}

function EtaSheet({ incident, open, busy, onClose, onSend }: { incident: UkIncidentDetail; open: boolean; busy: boolean; onClose: () => void; onSend: (eta: Date) => void }) {
  const tz = incident.house.timezone;
  const now = new Date();
  const evening = todayAt(ETA_EVENING_HOUR, tz, now);
  const [choice, setChoice] = useState<string>(`+${ETA_PLUS_HOURS[0]}`);
  const [custom, setCustom] = useState(() => localInputValue(new Date(now.getTime() + MS_PER_HOUR)));
  const localize = incident.deadlines.find((d) => d.kind === 'localize' && d.state !== 'met' && d.state !== 'cancelled');

  const etaFor = (value: string): Date | null => {
    if (value === 'evening') return evening;
    if (value === 'custom') {
      const at = new Date(custom);
      return Number.isNaN(at.getTime()) || at.getTime() <= Date.now() ? null : at;
    }
    return new Date(Date.now() + Number(value.slice(1)) * MS_PER_HOUR);
  };
  const eta = etaFor(choice);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('uk.eta.title')}
      footer={
        <Button size="large" stretched disabled={!eta} loading={busy} onClick={() => eta && onSend(eta)}>
          {t('uk.eta.send')}
        </Button>
      }
    >
      <Muted>{t('uk.eta.text')}</Muted>
      <div className="chip-radios" role="radiogroup" aria-label={t('uk.eta.title')}>
        {ETA_PLUS_HOURS.map((h) => (
          <button type="button" role="radio" key={h} className="chip-radio" aria-checked={choice === `+${h}`} onClick={() => setChoice(`+${h}`)}>
            {t('uk.eta.plus', { hours: h })}
          </button>
        ))}
        {evening ? (
          <button type="button" role="radio" className="chip-radio" aria-checked={choice === 'evening'} onClick={() => setChoice('evening')}>
            {t('uk.eta.today', { time: timeIn(evening.toISOString(), tz) })}
          </button>
        ) : null}
        <button type="button" role="radio" className="chip-radio" aria-checked={choice === 'custom'} onClick={() => setChoice('custom')}>
          {t('uk.eta.custom')}
        </button>
      </div>
      {choice === 'custom' ? (
        <input className="native-input" type="datetime-local" aria-label={t('uk.eta.custom')} value={custom} min={localInputValue(now)} onChange={(e) => setCustom(e.currentTarget.value)} />
      ) : null}
      {eta ? <p className="banner-title">{whenIn(eta.toISOString(), tz)}</p> : null}
      {localize ? (
        <div className="stack tight">
          <p className="muted small">{t('uk.eta.norm', { time: whenIn(localize.dueAt, tz) })}</p>
          <NormBasisLink norm={localize.norm} />
        </div>
      ) : null}
    </Sheet>
  );
}

function PeopleBlock({ incident }: { incident: UkIncidentDetail }) {
  const session = useSession();
  const p = incident.people;
  const rows: { key: ReactNode; value: ReactNode; strong?: boolean }[] = [{ key: t('people.total'), value: p.total, strong: true }];
  if (session.me.features.trustLevels) {
    rows.push({ key: t('people.confirmed'), value: p.confirmed }, { key: t('people.unconfirmed'), value: p.unconfirmed });
  }
  rows.push({ key: t('people.not_me'), value: p.notMe });
  if (incident.status === 'checking' || incident.status === 'discrepancy' || incident.status === 'closed') {
    rows.push({ key: t('people.answers'), value: t('people.answers.value', { yes: p.answers.yes, no: p.answers.no }) });
  }
  if (session.me.features.brigadeConfirm && incident.counters.brigade.confirmed + incident.counters.brigade.absent > 0) {
    rows.push({ key: t('people.brigade'), value: t('people.brigade.value', { confirmed: incident.counters.brigade.confirmed, absent: incident.counters.brigade.absent }) });
  }
  return <KeyValue rows={rows} />;
}

function UkIncidentBody({ incident, embedded, onMoved }: { incident: UkIncidentDetail; embedded: boolean; onMoved?: (id: string) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<UkAction | null>(null);
  const [etaOpen, setEtaOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const tz = incident.house.timezone;
  const others = incident.allowedActions.filter((a) => a !== incident.nextAction && a !== 'merge');
  const canMerge = incident.allowedActions.includes('merge') && incident.mergeCandidates.length > 0;

  const refreshAll = (updated: UkIncidentDetail) => {
    client.setQueryData(['uk-incident', updated.id], updated);
    void client.invalidateQueries({ queryKey: ['uk-incidents'] });
    void client.invalidateQueries({ queryKey: ['incident', updated.id] });
  };

  const changeStatus = async (action: Exclude<UkAction, 'merge'>, eta?: Date) => {
    setBusy(action);
    try {
      const status = ACTION_STATUS[action];
      const updated = await api.ukStatus(incident.id, incident.version, { status, ...(eta ? { eta: eta.toISOString() } : {}) });
      refreshAll(updated);
      setEtaOpen(false);
      setResolveOpen(false);
      setMenuOpen(false);
      if (updated.cardUpdate === 'none') toast(t('toast.status.saved'));
      else if (status === 'accepted' && updated.eta) toast(t('toast.status.eta', { eta: whenIn(updated.eta, tz) }));
      else if (status === 'resolved' && updated.status === 'checking') toast(t('toast.status.checking', { restore_question: restoreQuestion(updated.service) }));
      else toast(t('toast.status.updated'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        await client.invalidateQueries({ queryKey: ['uk-incident', incident.id] });
        toast(t('toast.status.conflict'), 'info');
      } else {
        toast(errorText(err, t('error.network.title')), 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  const merge = async (intoId: string) => {
    setBusy('merge');
    try {
      const actual = await api.ukMerge(incident.id, incident.version, intoId);
      refreshAll(actual);
      setMergeOpen(false);
      setMenuOpen(false);
      toast(t('toast.status.merged'));
      if (onMoved) onMoved(actual.id);
      else void navigate(`/uk/incident/${actual.id}`, { replace: true });
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  const startAction = (action: UkAction) => {
    setMenuOpen(false);
    if (action === 'accept') setEtaOpen(true);
    else if (action === 'resolve') setResolveOpen(true);
    else if (action === 'merge') setMergeOpen(true);
    else void changeStatus(action);
  };

  const next = incident.nextAction;
  const buttons =
    next || others.length > 0 || canMerge ? (
      <>
        {next ? (
          <Button size="large" stretched loading={busy === next} disabled={busy !== null} onClick={() => startAction(next)}>
            {actionLabel(next, incident)}
          </Button>
        ) : null}
        {others.length > 0 || canMerge ? (
          <Button size="large" stretched variant="secondary" disabled={busy !== null} onClick={() => setMenuOpen(true)}>
            {t('uk.other')}
          </Button>
        ) : null}
      </>
    ) : null;

  const content = (
    <>
      {embedded ? (
        <Typography.Text variant="subheader" asChild>
          <h2 className="screen-title">{headlineText(incident).title}</h2>
        </Typography.Text>
      ) : null}
      <IncidentHero
        incident={incident}
        lines={[
          t('screen.U02.line', { service_no: serviceNo(incident.service), house: incident.house.label }),
          t('screen.U02.meta', { address: incident.house.address, time: whenIn(incident.startedAt, tz), count: incident.participantsCount, residents: plural(incident.participantsCount, 'residents') }),
        ]}
        {...(incident.mergedInto ? { onOpenActual: () => (onMoved ? onMoved(incident.mergedInto!) : void navigate(`/uk/incident/${incident.mergedInto}`)) } : {})}
      />
      {embedded && buttons ? <div className="row">{buttons}</div> : null}
      <div className="columns">
        <div className="stack">
          <Card>
            <div className="row between">
              <SectionTitle>{t('screen.U02.grid')}</SectionTitle>
              <GridLegend />
            </div>
            <EntranceFloorGridView grid={incident.grid} />
          </Card>
          <Card>
            <SectionTitle>{t('screen.U02.people')}</SectionTitle>
            <PeopleBlock incident={incident} />
          </Card>
          <Card>
            <SectionTitle>{t('screen.S05.deadlines')}</SectionTitle>
            <DeadlineList deadlines={incident.deadlines} timezone={tz} />
          </Card>
          <Card>
            <SectionTitle>{t('screen.S05.stepper')}</SectionTitle>
            <StatusStepper steps={incident.steps} timezone={tz} eta={incident.eta} discrepancy={incident.displayStatus === 'discrepancy'} />
          </Card>
          <Card>
            <SectionTitle>{t('screen.S05.ads')}</SectionTitle>
            {incident.ads.registration?.number ? (
              <p>{t('screen.S05.ads.number', { number: incident.ads.registration.number, time: incident.ads.registration.at ? whenIn(incident.ads.registration.at, tz) : '' })}</p>
            ) : (
              <Muted>{t('screen.S05.ads.none')}</Muted>
            )}
          </Card>
        </div>
        <Card>
          <SectionTitle>{t('screen.S05.timeline')}</SectionTitle>
          <Timeline events={incident.timeline} timezone={tz} />
        </Card>
      </div>

      <EtaSheet key={etaOpen ? 'open' : 'closed'} incident={incident} open={etaOpen} busy={busy === 'accept'} onClose={() => setEtaOpen(false)} onSend={(eta) => void changeStatus('accept', eta)} />
      <ConfirmDialog
        open={resolveOpen}
        title={t('confirm.resolve.title')}
        text={t('confirm.resolve', { restore_question: restoreQuestion(incident.service) })}
        ok={t('confirm.resolve.ok')}
        cancel={t('confirm.resolve.cancel')}
        loading={busy === 'resolve'}
        onConfirm={() => void changeStatus('resolve')}
        onCancel={() => setResolveOpen(false)}
      />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t('uk.other')}>
        <div className="stack">
          {others.map((a) => (
            <Button key={a} size="large" stretched variant="secondary" loading={busy === a} disabled={busy !== null} onClick={() => startAction(a)}>
              {actionLabel(a, incident)}
            </Button>
          ))}
          {canMerge ? (
            <Button size="large" stretched variant="secondary" disabled={busy !== null} onClick={() => startAction('merge')}>
              {t('uk.merge')}
            </Button>
          ) : null}
          <Muted>{t('uk.menu.note')}</Muted>
        </div>
      </Sheet>
      <Sheet open={mergeOpen} onClose={() => setMergeOpen(false)} title={t('uk.merge.pick')}>
        <div className="stack">
          {incident.mergeCandidates.map((c) => (
            <button type="button" key={c.id} className="card clickable incident-row" disabled={busy !== null} onClick={() => void merge(c.id)}>
              <IncidentHeadline incident={c} compact />
              <p className="meta">
                {serviceName(c.service)} {t('screen.U01.row.since', { time: whenIn(c.startedAt, c.house.timezone) })}
              </p>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );

  const asResident = (
    <Button size="small" variant="secondary" onClick={() => void navigate(`/incident/${incident.id}`)}>
      {t('screen.U02.as_resident')}
    </Button>
  );

  if (embedded) {
    return (
      <section className="stack panel" aria-label={serviceName(incident.service)}>
        <div className="panel-tools">{asResident}</div>
        {content}
      </section>
    );
  }

  return (
    <Screen
      title={headlineText(incident).title}
      back="/uk"
      width="wide"
      headerAfter={asResident}
      actions={buttons ?? undefined}
    >
      {content}
    </Screen>
  );
}

function UkIncidentPanel({ id, embedded = false, onMoved }: { id: string; embedded?: boolean; onMoved?: (id: string) => void }) {
  const query = useQuery({ queryKey: ['uk-incident', id], queryFn: () => api.ukIncident(id), refetchInterval: REFRESH_MS });
  return <Loaded query={query}>{(incident) => <UkIncidentBody incident={incident} embedded={embedded} {...(onMoved ? { onMoved } : {})} />}</Loaded>;
}

export function UkIncidentScreen() {
  const { id = '' } = useParams();
  return <UkIncidentPanel id={id} />;
}
