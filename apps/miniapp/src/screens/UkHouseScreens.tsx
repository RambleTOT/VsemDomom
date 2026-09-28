/**
 * Дома УК: список (U03L), дом с чатом и демо-инструментами (U03), привязка чата по c_<токен>,
 * подтверждение жильцов (U04), тепловая карта (U05), итог месяца (U06).
 */
import { Button, Radio } from '@maxhub/max-ui';
import type { ChatBindingInfo, HeatMap, MonthlySummary, ResidentRequest, UkHouse, UkHouseDetail } from '@vsemdomom/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { api } from '../api/endpoints.ts';
import { HeatGrid } from '../components/grid.tsx';
import { SystemScreen } from '../components/errors.tsx';
import { NormBasisLink } from '../components/norm.tsx';
import { Screen } from '../components/Screen.tsx';
import { ConfirmDialog } from '../components/Sheet.tsx';
import { useToast } from '../components/Toast.tsx';
import { Banner, Card, Chip, EmptyState, Muted, SectionTitle } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { dateIn, minutesText, monthOfKey, whenIn } from '../format.ts';
import { lowerFirst, plural, roleName, serviceName, t, upperFirst } from '../i18n.ts';
import { useSession } from '../app/session.tsx';
import { errorText, Loaded, useErrorAction } from './common.tsx';
import { useWide } from '../app/useWide.ts';

const houseTitle = (h: { label: string }) => t('screen.S03.title', { house: h.label });
const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function chatLine(h: UkHouse): string {
  const chat = h.chat;
  if (!chat?.bound) return t('screen.U03L.chat.off');
  const members = chat.participantsCount ?? 0;
  return [
    t('screen.U03.chat.on'),
    chat.botIsAdmin ? t('screen.U03.bind.admin.yes') : t('screen.U03.bind.admin.no'),
    `${members} ${plural(members, 'members')}`,
  ].join(' · ');
}

/** Разделы дома списком со стрелками: жильцы, тепловая карта, итог месяца (по флагам), чат и демо. */
function HouseLinks({ house, withChat = false }: { house: UkHouse; withChat?: boolean }) {
  const navigate = useNavigate();
  const f = useSession().me.features;
  const rows: { key: string; title: string; sub: string | null; badge?: number; to: string }[] = [];
  if (f.trustLevels) {
    rows.push({
      key: 'residents',
      title: t('screen.U03L.residents'),
      sub: house.pendingResidents > 0 ? t('screen.U03L.residents.sub', { count: house.pendingResidents, requests: plural(house.pendingResidents, 'requests') }) : t('screen.U03L.residents.none'),
      badge: house.pendingResidents,
      to: `/uk/residents?house=${house.id}`,
    });
  }
  if (f.polls) rows.push({ key: 'heat', title: t('screen.U03L.heat'), sub: t('screen.U03L.heat.sub'), to: `/uk/houses/${house.id}/heat` });
  if (f.monthlySummary) rows.push({ key: 'month', title: t('screen.U03L.month'), sub: null, to: `/uk/houses/${house.id}/month` });
  if (withChat) rows.push({ key: 'chat', title: t('screen.U03L.chat_tools'), sub: chatLine(house), to: `/uk/houses/${house.id}` });
  if (rows.length === 0) return null;
  return (
    <div className="list-card inset">
      {rows.map((r) => (
        <button type="button" key={r.key} className="list-row plain-button" onClick={() => void navigate(r.to)}>
          <span className="list-row-text">
            <span className="list-row-title">{r.title}</span>
            {r.sub ? <span className="muted small">{r.sub}</span> : null}
          </span>
          <span className="row">
            {r.badge ? <span className="count-badge">{r.badge}</span> : null}
            <Icon name="chevron-right" size={16} className="muted" />
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- U03L ----------

export function UkHousesScreen() {
  const staff = useSession().me.staff;
  const query = useQuery({ queryKey: ['uk-houses'], queryFn: api.ukHouses });
  const n = query.data?.items.length ?? 0;
  return (
    <Screen
      title={t('screen.U03L.title')}
      sub={staff && n > 0 ? t('screen.U01.sub.n', { uk: staff.uk.name, n, houses: plural(n, 'houses') }) : undefined}
      back="/uk"
      model={query.data?.items.some((h) => h.isModel) ?? false}
      width="wide"
    >
      <Loaded query={query}>
        {(data) => (
          <div className="stack">
            {data.items.map((h) => (
              <Card key={h.id}>
                <div className="stack tight">
                  <p className="card-title">
                    {houseTitle(h)} · {h.address}
                  </p>
                  <p className="muted small">
                    {chatLine(h)}
                    {h.activeIncidents > 0 ? ` · ${h.activeIncidents} ${plural(h.activeIncidents, 'incidents')}` : ''}
                  </p>
                </div>
                <HouseLinks house={h} withChat />
              </Card>
            ))}
          </div>
        )}
      </Loaded>
    </Screen>
  );
}

// ---------- U03 ----------

function MonthServices({ services, month }: { services: MonthlySummary['services']; month: string }) {
  if (services.length === 0) return <Muted>{t('screen.U06.none', { month: monthOfKey(month) })}</Muted>;
  return (
    <div className="stack">
      {services.map((s) => (
        <div key={s.service} className="deadline-row">
          <p className="deadline-title">{serviceName(s.service)}</p>
          {s.limitMinutes === null ? (
            <Muted>{t('deadline.no_norm')}</Muted>
          ) : (
            <>
              <p>{t('screen.U06.row.value', { total: minutesText(s.totalMinutes), limit: minutesText(s.limitMinutes) })}</p>
              <Chip tone={s.excessMinutes > 0 ? 'negative' : 'positive'}>{s.excessMinutes > 0 ? t('screen.U06.over', { excess: minutesText(s.excessMinutes) }) : t('screen.U06.ok')}</Chip>
            </>
          )}
          {s.norm ? <NormBasisLink norm={s.norm} /> : null}
        </div>
      ))}
    </div>
  );
}

function DemoTools({ house }: { house: UkHouseDetail }) {
  const toast = useToast();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const activeId = house.demo?.activeIncidentId ?? null;

  const run = async (key: string, call: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await call());
      await Promise.all([
        client.invalidateQueries({ queryKey: ['uk-house', house.id] }),
        client.invalidateQueries({ queryKey: ['uk-incidents'] }),
        client.invalidateQueries({ queryKey: ['uk-incident'] }),
        client.invalidateQueries({ queryKey: ['incident'] }),
      ]);
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="demo-tools">
      <SectionTitle>{t('demo.title')}</SectionTitle>
      <Muted>{t('demo.sub')}</Muted>
      <div className="demo-row">
        <div>
          <p>{t('demo.neighbors.title')}</p>
          <p className="muted small">{activeId ? t('demo.neighbors.sub') : t('demo.no_incident')}</p>
        </div>
        <Button size="small" variant="secondary" disabled={!activeId || busy !== null} loading={busy === 'neighbours'} onClick={() => void run('neighbours', async () => (await api.demoNeighbours(house.id), t('demo.neighbors.done')))}>
          {t('demo.neighbors.cta')}
        </Button>
      </div>
      <div className="demo-row">
        <div>
          <p>{t('demo.shift.title')}</p>
          <p className="muted small">{activeId ? t('demo.shift.sub') : t('demo.no_incident')}</p>
        </div>
        <Button
          size="small"
          variant="secondary"
          disabled={!activeId || busy !== null}
          loading={busy === 'shift'}
          onClick={() =>
            activeId &&
            void run('shift', async () => {
              const updated = await api.demoTimeShift(activeId);
              return t('demo.shift.done', { time: whenIn(updated.startedAt, house.timezone) });
            })
          }
        >
          {t('demo.shift.cta')}
        </Button>
      </div>
      <div className="demo-row">
        <div>
          <p>{t('demo.reset.title')}</p>
          <p className="muted small">{t('demo.reset.sub', { house: house.label })}</p>
        </div>
        <Button size="small" variant="destructive" disabled={busy !== null} onClick={() => setConfirmReset(true)}>
          {t('demo.reset.cta')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title={t('confirm.reset.title')}
        text={t('demo.reset.sub', { house: house.label })}
        ok={t('demo.reset.cta')}
        destructive
        loading={busy === 'reset'}
        onConfirm={() =>
          void run('reset', async () => {
            await api.demoReset(house.id);
            setConfirmReset(false);
            return t('demo.reset.done', { house: house.label });
          })
        }
        onCancel={() => setConfirmReset(false)}
      />
    </Card>
  );
}

export function UkHouseScreen() {
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: ['uk-house', id], queryFn: () => api.ukHouse(id) });
  return (
    <Loaded query={query}>
      {(house) => {
        const flats = house.flatTo - house.flatFrom + 1;
        const perFloor = Math.max(1, Math.round(flats / (house.entrances * house.floors)));
        return (
          <Screen title={houseTitle(house)} sub={house.address} model={house.isModel} back="/uk/houses" width="wide">
            <div className="columns">
              <div className="stack">
                <Card>
                  <p className="banner-title">
                    {t('screen.U03.params.n', { entrances: house.entrances, entrances_word: plural(house.entrances, 'entrances'), floors: house.floors, floors_word: plural(house.floors, 'floors') })}
                  </p>
                  <Muted>{t('screen.U03.params.sub.n', { flats, flats_word: plural(flats, 'flats'), per_floor: perFloor })}</Muted>
                </Card>
                <Card>
                  <SectionTitle>{t('screen.S03.chat.title')}</SectionTitle>
                  {house.chat?.bound && house.chat.title ? <p>{house.chat.title}</p> : null}
                  <p className={house.chat?.bound ? '' : 'muted'}>{chatLine(house)}</p>
                  {!house.chat?.bound ? <Muted>{t('screen.U03.chat.howto')}</Muted> : null}
                  {house.chat?.bound && !house.chat.botIsAdmin ? <Banner tone="warning" title={t('screen.U03.bind.error.title')}>{t('screen.U03.bind.error')}</Banner> : null}
                </Card>
                <HouseLinks house={house} />
              </div>
              <div className="stack">
                <Card>
                  <SectionTitle>{t('screen.U03.month', { month: monthOfKey(house.month.month) })}</SectionTitle>
                  <MonthServices services={house.month.services} month={house.month.month} />
                </Card>
                {house.demo ? <DemoTools house={house} /> : null}
              </div>
            </div>
          </Screen>
        );
      }}
    </Loaded>
  );
}

// ---------- Привязка чата ----------

function BindBody({ token, info }: { token: string; info: ChatBindingInfo }) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const houses = useQuery({ queryKey: ['uk-houses'], queryFn: api.ukHouses });
  const [houseId, setHouseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notAdmin, setNotAdmin] = useState(false);

  const bind = async () => {
    if (!houseId) return;
    setBusy(true);
    try {
      const res = await api.bindChat(token, houseId);
      await client.invalidateQueries({ queryKey: ['uk-houses'] });
      if (res.pinned) {
        toast(t('screen.U03.bind.done'));
        void navigate(`/uk/houses/${res.house.id}`, { replace: true });
      } else {
        setNotAdmin(true);
        toast(t('screen.U03.bind.error.toast'), 'error');
      }
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('screen.U03.bind.title')}
      back="/uk/houses"
      actionsReason={houseId ? undefined : t('screen.U03.bind.pick')}
      actions={
        <Button size="large" stretched disabled={!houseId} loading={busy} onClick={() => void bind()}>
          {t('screen.U03.bind.cta')}
        </Button>
      }
    >
      <Card>
        <Muted>{t('screen.U03.bind.from')}</Muted>
        <p className="banner-title">{info.chatTitle ?? t('screen.S03.chat.title')}</p>
      </Card>
      {notAdmin ? (
        <Banner tone="warning" title={t('screen.U03.bind.error.title')}>
          {t('screen.U03.bind.error')}
        </Banner>
      ) : null}
      <SectionTitle>{t('screen.U03.bind.pick')}</SectionTitle>
      <Loaded query={houses}>
        {(data) => (
          <div className="radio-list" role="radiogroup" aria-label={t('screen.U03.bind.pick')}>
            {data.items.map((h) => (
              <label className="radio-row" key={h.id}>
                <span className="radio-text">
                  <span>
                    {houseTitle(h)} · {h.address}
                  </span>
                  <span className="muted small">
                    {h.entrances} {plural(h.entrances, 'entrances')} · {h.flatTo - h.flatFrom + 1} {plural(h.flatTo - h.flatFrom + 1, 'flats')}
                  </span>
                  {h.chat?.bound ? <span className="muted small">{t('screen.U03.bind.rebind')}</span> : null}
                </span>
                <Radio name="house" value={h.id} checked={houseId === h.id} onChange={() => setHouseId(h.id)} />
              </label>
            ))}
          </div>
        )}
      </Loaded>
    </Screen>
  );
}

export function ChatBindScreen() {
  const { token = '' } = useParams();
  const action = useErrorAction();
  const query = useQuery({ queryKey: ['chat-binding', token], queryFn: () => api.chatBinding(token) });
  return (
    <Loaded query={query}>
      {(info) => (info.status === 'active' ? <BindBody token={token} info={info} /> : <SystemScreen kind="expired" onAction={action('expired')} />)}
    </Loaded>
  );
}

// ---------- U04 ----------

function ResidentRow({ item, decided, busy, onDecide }: { item: ResidentRequest; decided: 'confirmed' | 'rejected' | undefined; busy: boolean; onDecide: (ok: boolean) => void }) {
  const date = dateIn(item.createdAt, deviceTimezone());
  const from = item.source === 'chat' ? 'chat' : item.source === 'qr' ? 'qr' : item.source === 'owner_link' ? 'owner' : item.source ? 'app' : null;
  return (
    <Card>
      <div className="row between">
        <div>
          <p className="banner-title">
            {t('screen.S11.flat', { flat: item.flatNo })} · {lowerFirst(roleName(item.role))}
          </p>
          <Muted>{from ? t(`screen.U04.from.${from}`, { date }) : `${houseTitle(item.house)} · ${date}`}</Muted>
        </div>
        <Chip tone={item.trustLevel === 1 ? 'info' : 'neutral'}>{t(`trust.${item.trustLevel}`)}</Chip>
      </div>
      {decided ? (
        <Chip tone={decided === 'confirmed' ? 'positive' : 'neutral'} icon={decided === 'confirmed' ? 'circle-check' : 'x'}>
          {decided === 'confirmed' ? t('screen.U04.ok.done') : t('screen.U04.reject.done')}
        </Chip>
      ) : (
        <div className="row">
          <Button size="small" loading={busy} disabled={busy} onClick={() => onDecide(true)}>
            {t('screen.U04.ok')}
          </Button>
          <Button size="small" variant="secondary" disabled={busy} onClick={() => onDecide(false)}>
            {t('screen.U04.reject')}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function UkResidentsScreen() {
  const session = useSession();
  const action = useErrorAction();
  const toast = useToast();
  const wide = useWide();
  const [params] = useSearchParams();
  const houseId = params.get('house') ?? undefined;
  const query = useQuery({ queryKey: ['uk-residents', houseId ?? null], queryFn: () => api.residents(houseId), enabled: session.me.features.trustLevels });
  const [decided, setDecided] = useState<Record<string, 'confirmed' | 'rejected'>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  if (!session.me.features.trustLevels) return <SystemScreen kind="feature_off" onAction={action('feature_off')} />;

  const decide = async (id: string, ok: boolean) => {
    setBusy((s) => new Set(s).add(id));
    try {
      const res = await (ok ? api.confirmResident(id) : api.rejectResident(id));
      setDecided((d) => ({ ...d, [id]: res.reviewStatus }));
    } catch (err) {
      toast(errorText(err, t('error.network.title')), 'error');
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <Loaded query={query}>
      {(data) => {
        const pending = data.items.filter((i) => !decided[i.id]);
        const house = data.items[0]?.house;
        return (
          <Screen
            title={t('screen.U04.title')}
            sub={house && houseId ? t('screen.U04.sub.n', { house: house.label, count: pending.length }) : undefined}
            back={houseId ? `/uk/houses/${houseId}` : '/uk/houses'}
            width="wide"
            headerAfter={
              wide && pending.length > 1 ? (
                <Button size="small" variant="secondary" onClick={() => void Promise.all(pending.map((i) => decide(i.id, true)))}>
                  {t('screen.U04.all', { count: pending.length })}
                </Button>
              ) : null
            }
          >
            {data.items.length === 0 ? (
              <Card>
                <EmptyState icon="users" title={t('empty.residents.title')} text={t('empty.residents')} />
              </Card>
            ) : (
              <div className="stack">
                {data.items.map((i) => (
                  <ResidentRow key={i.id} item={i} decided={decided[i.id]} busy={busy.has(i.id)} onDecide={(ok) => void decide(i.id, ok)} />
                ))}
              </div>
            )}
          </Screen>
        );
      }}
    </Loaded>
  );
}

// ---------- U05 ----------

function HeatBody({ map, house }: { map: HeatMap; house: UkHouseDetail }) {
  const toast = useToast();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await api.startHeatingPoll(house.id);
      toast(t('screen.U05.started'));
      await client.invalidateQueries({ queryKey: ['heatmap', house.id] });
    } catch (err) {
      toast(err instanceof ApiError && err.status === 409 ? t('screen.U05.running') : errorText(err, t('error.network.title')), err instanceof ApiError && err.status === 409 ? 'info' : 'error');
    } finally {
      setBusy(false);
    }
  };
  const pollOpen = map.poll !== null && map.poll.closedAt === null;
  return (
    <Screen
      title={t('screen.U05.title')}
      sub={map.poll ? t('screen.U05.sub', { house: house.label, date: whenIn(map.poll.startedAt, house.timezone) }) : houseTitle(house)}
      model={house.isModel}
      back={`/uk/houses/${house.id}`}
      actions={
        pollOpen ? undefined : (
          <Button size="large" stretched loading={busy} onClick={() => void start()}>
            {t('screen.U05.start')}
          </Button>
        )
      }
    >
      {map.poll ? (
        <Card>
          <div className="stack tight">
            <SectionTitle>{t('screen.U02.grid')}</SectionTitle>
            <p className="muted small">{t('screen.U05.answered.n', { n: map.answered, total: map.totalFlats, flats: plural(map.totalFlats, 'flats_gen') })}</p>
          </div>
          <HeatGrid map={map} />
        </Card>
      ) : (
        <Card>
          <EmptyState icon="heater" title={t('screen.U05.empty')} text={t('screen.U05.empty.text')} />
        </Card>
      )}
      <p className="muted small">{t('screen.U05.legal')}</p>
      {map.norm ? <NormBasisLink norm={map.norm} /> : null}
    </Screen>
  );
}

export function UkHeatScreen() {
  const { id = '' } = useParams();
  const session = useSession();
  const action = useErrorAction();
  const house = useQuery({ queryKey: ['uk-house', id], queryFn: () => api.ukHouse(id) });
  const map = useQuery({ queryKey: ['heatmap', id], queryFn: () => api.heatmap(id), refetchInterval: 30_000, enabled: session.me.features.polls });
  if (!session.me.features.polls) return <SystemScreen kind="feature_off" onAction={action('feature_off')} />;
  return <Loaded query={house}>{(h) => <Loaded query={map}>{(m) => <HeatBody map={m} house={h} />}</Loaded>}</Loaded>;
}

// ---------- U06 ----------

export function UkMonthScreen() {
  const { id = '' } = useParams();
  const session = useSession();
  const action = useErrorAction();
  const query = useQuery({ queryKey: ['uk-house', id], queryFn: () => api.ukHouse(id) });
  if (!session.me.features.monthlySummary) return <SystemScreen kind="feature_off" onAction={action('feature_off')} />;
  return (
    <Loaded query={query}>
      {(house) => {
        const m = house.monthlySummary;
        return (
          <Screen title={t('screen.U06.title')} sub={m ? `${houseTitle(house)} · ${upperFirst(monthOfKey(m.month))}` : houseTitle(house)} model={house.isModel} back={`/uk/houses/${house.id}`}>
            {m ? (
              <>
                <div className="kpis">
                  <Card>
                    <Muted>{t('screen.U06.kpi.incidents')}</Muted>
                    <p className="big-number">{m.incidents}</p>
                    {m.services.length > 0 ? <p className="muted small">{m.services.map((x) => lowerFirst(serviceName(x.service))).join(', ')}</p> : null}
                  </Card>
                  <Card>
                    <Muted>{t('screen.U06.kpi.in_norm')}</Muted>
                    <p className="big-number">{t('screen.U06.kpi.in_norm.value', { n: m.inNorm, total: m.incidents })}</p>
                    <p className="muted small">{t('screen.U06.kpi.in_norm.sub')}</p>
                  </Card>
                  <Card>
                    <Muted>{t('screen.U06.kpi.to_accept')}</Muted>
                    <p className="big-number">{m.avgAcceptMinutes === null ? '—' : minutesText(m.avgAcceptMinutes)}</p>
                    <p className="muted small">{t('screen.U06.kpi.to_accept.sub')}</p>
                  </Card>
                  <Card>
                    <Muted>{t('screen.U06.kpi.disc')}</Muted>
                    <p className="big-number">{m.discrepancies}</p>
                    <p className="muted small">{t('screen.U06.kpi.disc.sub')}</p>
                  </Card>
                </div>
                <Card>
                  <SectionTitle>{t('screen.U06.services')}</SectionTitle>
                  <MonthServices services={m.services} month={m.month} />
                </Card>
                <p className="muted small">{t('calc.disclaimer')}</p>
              </>
            ) : (
              <Muted>{t('feature.off')}</Muted>
            )}
          </Screen>
        );
      }}
    </Loaded>
  );
}
