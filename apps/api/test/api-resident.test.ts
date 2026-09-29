import { apiRoutes, type HouseDetail, type HouseSummary, type IncidentDetail, type Me, type Norm, type Problem } from '@vsemdomom/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARAMS } from '../src/config/params.ts';
import { incident, staff } from '../src/db/schema.ts';
import { fastifyPath } from '../src/http/api-route.ts';
import { PENDING_OPERATIONS } from '../src/http/routes/index.ts';
import { CHECKER, createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const HOUR = 3_600_000;

type Session = { token: string; expiresAt: string; user: Me; startParam: string | null; devAuth: boolean };
type HouseMonth = {
  totalMinutes: number;
  intervals: { incidentId: string; minutes: number }[];
  single: { limitMinutes: number; longestMinutes: number; exceeded: boolean } | null;
  monthly: { limitMinutes: number; excessMinutes: number } | null;
};

describe.skipIf(!url)('REST API жителя (A6, PostgreSQL)', () => {
  let api: ApiHarness;
  let alice = '';
  let bob = '';
  let carol = '';
  let hotId = '';

  beforeAll(async () => {
    api = await createApiHarness(url!);
    alice = await api.resident(8001, 'dom1model1', 57);
    bob = await api.resident(8002, 'dom1model1', 100);
    carol = await api.resident(8003, 'dom2model2', 12);
  });
  afterAll(async () => {
    await api?.close();
  });

  describe('вход и ошибки', () => {
    it('без токена — 401 problem+json с traceId = X-Request-Id', async () => {
      const res = await api.call<Problem>('GET', '/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 401, code: 'unauthorized', type: 'urn:vsemdomom:problem:unauthorized' });
      expect(res.body.traceId).toBe(res.headers['x-request-id']);
    });

    it('вход по initData: сессия, профиль, startParam; неверная подпись — 401 invalid_init_data', async () => {
      const authDate = String(Math.floor(api.clock.now().getTime() / 1000) - 10);
      const user = JSON.stringify({ id: 8100, first_name: 'Имя', last_name: 'Фамилия', username: null, language_code: 'ru', photo_url: null });
      const initData = api.initData({ auth_date: authDate, query_id: 'q1', user, start_param: 'h_dom1model1' });
      const ok = await api.call<Session>('POST', '/api/v1/auth/max', { body: { initData } });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ startParam: 'h_dom1model1', devAuth: false, user: { userId: 8100, consentRequired: true, roles: [] } });
      expect(new Date(ok.body.expiresAt).getTime() - api.clock.now().getTime()).toBe(12 * HOUR);
      expect(JSON.stringify(ok.body)).not.toContain('Фамилия');
      const me = await api.call<Me>('GET', '/api/v1/me', { token: ok.body.token });
      expect(me.body.userId).toBe(8100);

      const bad = await api.call<Problem>('POST', '/api/v1/auth/max', { body: { initData: initData.replace('8100', '8101') } });
      expect(bad.status).toBe(401);
      expect(bad.body.code).toBe('invalid_init_data');
      const empty = await api.call<Problem>('POST', '/api/v1/auth/max', { body: {} });
      expect(empty.status).toBe(400);
      expect(empty.body.code).toBe('validation_error');
    });

    it('сессия истекает через 12 часов — 401 session_expired', async () => {
      const token = await api.login(8200);
      api.clock.advance(12 * HOUR + 1000);
      const res = await api.call<Problem>('GET', '/api/v1/me', { token });
      api.clock.advance(-(12 * HOUR + 1000));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('session_expired');
    });

    it('dev-вход сотрудника — демо-роль модельной УК', async () => {
      const res = await api.call<Session>('POST', '/api/v1/auth/dev', { body: { userId: 8300, role: 'uk' } });
      expect(res.status).toBe(200);
      expect(res.body.devAuth).toBe(true);
      expect(res.body.user.roles).toEqual(['uk']);
      expect(res.body.user.staff).toMatchObject({ isDemo: true, uk: { id: 'ukmodel001' } });
    });
  });

  describe('профиль', () => {
    it('согласие: другая версия — 422, действующая — 204; проживание до согласия — 403', async () => {
      const token = await api.login(8400);
      const before = await api.call<Problem>('PUT', '/api/v1/me/residency', { token, body: { houseId: 'dom1model1', flatNo: 5, role: 'renter' } });
      expect(before.status).toBe(403);
      expect(before.body.code).toBe('consent_required');
      expect((await api.call('POST', '/api/v1/me/consent', { token, body: { version: '2020-01-01' } })).status).toBe(422);
      expect((await api.call('POST', '/api/v1/me/consent', { token, body: { version: PARAMS.consentVersion } })).status).toBe(204);
      const out = await api.call<Problem>('PUT', '/api/v1/me/residency', { token, body: { houseId: 'dom1model1', flatNo: 999, role: 'renter' } });
      expect(out.status).toBe(422);
      expect(out.body).toMatchObject({ code: 'flat_out_of_range', flatFrom: 1, flatTo: 144 });
      const sandbox = await api.call<Problem>('PUT', '/api/v1/me/residency', { token, body: { houseId: 'dom5sandbx', flatNo: 1, role: 'renter' } });
      expect(sandbox.status).toBe(404);
      const ok = await api.call<{ residency: Me['residencies'][number]; trustReset: boolean }>('PUT', '/api/v1/me/residency', {
        token,
        body: { houseId: 'dom1model1', flatNo: 5, role: 'renter' },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.residency).toMatchObject({ flatNo: 5, role: 'renter', house: { id: 'dom1model1' } });
      expect(ok.body.residency.id).toMatch(/^[A-Za-z0-9]{10}$/);
      const me = await api.call<Me>('GET', '/api/v1/me', { token });
      expect(me.body).toMatchObject({ consentRequired: false, roles: ['resident'], settings: { notifyDefault: true } });
      expect((await api.call('PATCH', '/api/v1/me/settings', { token, body: { notifyDefault: false } })).body).toEqual({ notifyDefault: false });
    });

    it('DELETE /me: проживание удалено, согласие отозвано', async () => {
      const token = await api.resident(8500, 'dom2model2', 3);
      expect((await api.call('DELETE', '/api/v1/me', { token })).status).toBe(204);
      const me = await api.call<Me>('GET', '/api/v1/me', { token });
      expect(me.body).toMatchObject({ consentRequired: true, residencies: [], roles: [] });
    });
  });

  describe('дома и нормы', () => {
    it('поиск: модельные дома без песочницы; checker-токен видит только песочницу', async () => {
      const all = await api.call<{ items: HouseSummary[] }>('GET', '/api/v1/houses/search', { token: alice });
      expect(all.body.items.map((h) => h.id)).toEqual(['dom1model1', 'dom2model2', 'dom3model3', 'dom4model4']);
      const q = await api.call<{ items: HouseSummary[] }>('GET', `/api/v1/houses/search?q=${encodeURIComponent('Модельная, 2')}`, { token: alice });
      expect(q.body.items.map((h) => h.id)).toEqual(['dom2model2']);
      const checker = await api.call<{ items: HouseSummary[] }>('GET', '/api/v1/houses/search', { token: CHECKER.resident });
      expect(checker.body.items.map((h) => h.id)).toEqual(['dom5sandbx']);
    });

    it('главная дома: только жителям и УК; история месяца по квартире', async () => {
      expect((await api.call<Problem>('GET', '/api/v1/houses/dom1model1', { token: carol })).body.code).toBe('not_resident');
      expect((await api.call('GET', '/api/v1/houses/dom1model1/summary', { token: carol })).status).toBe(200);
      const res = await api.call<HouseDetail>('GET', '/api/v1/houses/dom1model1', { token: alice });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'dom1model1', uk: { name: 'УК Модельная', isModel: true }, chat: null, activeIncidents: [] });
      expect(res.body.recentResults.map((r) => [r.service, r.overNormFlats])).toEqual([['hot_water', 0]]);
      expect(res.body.myResidency).toMatchObject({ flatNo: 57 });
      expect(res.body.month.scope).toBe('flat');
      expect(res.body.month.services).toEqual([
        expect.objectContaining({ service: 'hot_water', totalMinutes: 360, limitMinutes: 480, excessMinutes: 0 }),
      ]);
    });

    it('месяц против лимита: единовременный лимит превышен, месячный — нет', async () => {
      const res = await api.call<HouseMonth>('GET', '/api/v1/houses/dom1model1/month?service=hot_water', { token: alice });
      expect(res.status).toBe(200);
      expect(res.body.totalMinutes).toBe(360);
      expect(res.body.intervals).toEqual([expect.objectContaining({ incidentId: 'hist1gvs06', minutes: 360 })]);
      expect(res.body.single).toMatchObject({ limitMinutes: 240, longestMinutes: 360, exceeded: true });
      expect(res.body.monthly).toMatchObject({ limitMinutes: 480, excessMinutes: 0 });
      expect((await api.call('GET', '/api/v1/houses/dom1model1/month?service=steam', { token: alice })).status).toBe(400);
    });

    it('нормы: по услуге и общие, с основаниями; без региона — федеральные', async () => {
      const res = await api.call<Norm[]>('GET', '/api/v1/norms?service=hot_water', { token: alice });
      expect(res.status).toBe(200);
      const codes = res.body.map((n) => n.code);
      expect(codes).toEqual(expect.arrayContaining(['pp416.p13.uk_eta', 'pp416.p13.localize.hot_water', 'pr354.app1.p4.monthly']));
      expect(codes).not.toContain('pp416.p13.localize.cold_water');
      const monthly = res.body.find((n) => n.code === 'pr354.app1.p4.monthly');
      expect(monthly).toMatchObject({ value: 8, unit: 'h', ratePercent: 0.15, basis: { doc: 'Правила № 354', point: 'прил. 1, п. 4' } });
    });
  });

  describe('аварии', () => {
    it('создание: 201 с дедлайнами и хронологией; без входа — 401; не житель — 403', async () => {
      const body = { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: '1h' };
      expect((await api.call('POST', '/api/v1/incidents', { body })).status).toBe(401);
      expect((await api.call<Problem>('POST', '/api/v1/incidents', { token: carol, body })).body.code).toBe('not_resident');
      const res = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: alice, body, headers: { 'idempotency-key': 'create-hot-0001' } });
      expect(res.status).toBe(201);
      hotId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'open',
        displayStatus: 'open',
        scope: 'house',
        participantsCount: 1,
        flatsCount: 1,
        byEntrance: [{ entrance: 2, count: 1 }],
        joined: true,
        cardInChat: false,
        me: { joined: true, isAuthor: true, entrance: 2, floor: 6, notify: true },
        ads: { phone: '+7 (000) 000-00-01', registration: null },
      });
      // Срок 30 минут: предупреждение «до срока 30 минут» наступает сразу — состояние soon.
      expect(res.body.deadlines.map((d) => [d.kind, d.anchor, d.state])).toEqual([
        ['answer', 'service_report', 'soon'],
        ['localize', 'service_report', 'soon'],
        ['single_limit', 'started', 'pending'],
        ['fix', 'started', 'pending'],
      ]);
      expect(res.body.headline.nextDeadline).toMatchObject({ kind: 'answer', norm: { doc: 'ПП № 416', point: 'п. 13' } });
      expect(res.body.timeline.map((e) => [e.type, e.mine])).toEqual([['reported', true]]);
      expect(res.body.steps.map((s) => s.state)).toEqual(['current', 'pending', 'pending', 'pending', 'pending', 'pending']);
    });

    it('Idempotency-Key: повтор возвращает первый ответ, вторая авария не создаётся', async () => {
      const body = { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: '1h' };
      const again = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: alice, body, headers: { 'idempotency-key': 'create-hot-0001' } });
      expect(again.status).toBe(201);
      expect(again.body.id).toBe(hotId);
      const rows = await api.handle.db.select().from(incident).where(and(eq(incident.serviceType, 'hot_water'), eq(incident.isModel, false)));
      expect(rows).toHaveLength(1);
    });

    it('дубль — 409 duplicate_incident с duplicateOf; время в будущем и старше суток — 422', async () => {
      const dup = await api.call<Problem>('POST', '/api/v1/incidents', { token: bob, body: { houseId: 'dom1model1', service: 'hot_water', scope: 'entrance' } });
      expect(dup.status).toBe(409);
      expect(dup.body).toMatchObject({ code: 'duplicate_incident', duplicateOf: hotId });
      const now = api.clock.now().getTime();
      const future = await api.call<Problem>('POST', '/api/v1/incidents', {
        token: bob,
        body: { houseId: 'dom1model1', service: 'heating', scope: 'house', startedPreset: 'custom', startedAt: new Date(now + HOUR).toISOString() },
      });
      expect(future.body.code).toBe('started_at_in_future');
      const oldBody = { houseId: 'dom1model1', service: 'heating', scope: 'entrance', startedAt: new Date(now - 26 * HOUR).toISOString() };
      expect((await api.call<Problem>('POST', '/api/v1/incidents', { token: bob, body: oldBody })).body.code).toBe('confirm_old_required');
      const outOfRange = await api.call<Problem>('POST', '/api/v1/incidents', { token: bob, body: { ...oldBody, confirmOld: true, entrance: 9 } });
      expect(outOfRange.body.code).toBe('entrance_out_of_range');
      const ok = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: bob, body: { ...oldBody, confirmOld: true } });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ service: 'heating', scope: 'entrance', entrance: 3 });
    });

    it('просмотр: соседу — 200, жителю другого дома — 403, чужой «только квартира» — 404', async () => {
      const view = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${hotId}`, { token: bob });
      expect(view.status).toBe(200);
      expect(view.body.me).toMatchObject({ joined: false, isAuthor: false, entrance: 3 });
      expect(view.body.joined).toBe(false);
      expect((await api.call('GET', `/api/v1/incidents/${hotId}`, { token: carol })).status).toBe(403);
      const flat = await api.call<IncidentDetail>('POST', '/api/v1/incidents', {
        token: alice,
        body: { houseId: 'dom1model1', service: 'electricity', scope: 'flat' },
      });
      expect(flat.status).toBe(201);
      expect((await api.call('GET', `/api/v1/incidents/${flat.body.id}`, { token: bob })).status).toBe(404);
      const ukToken = await api.login(8600, 'uk');
      const ukView = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${flat.body.id}`, { token: ukToken });
      expect(ukView.status).toBe(200);
      expect(ukView.body.me).toBeNull();
      expect(ukView.body.joined).toBeNull();
    });

    it('«У меня тоже»: подъезд и этаж из формы; повтор — already_joined; смена подъезда — updated; «Не у меня»', async () => {
      const join = await api.call<IncidentDetail & { joinResult: string }>('POST', `/api/v1/incidents/${hotId}/join`, {
        token: bob,
        body: { entrance: 4, floor: 2 },
      });
      expect(join.status).toBe(200);
      expect(join.body).toMatchObject({ joinResult: 'joined', participantsCount: 2, me: { joined: true, entrance: 4, floor: 2 } });
      const again = await api.call<{ joinResult: string }>('POST', `/api/v1/incidents/${hotId}/join`, { token: bob, body: { entrance: 4, floor: 2 } });
      expect(again.body.joinResult).toBe('already_joined');
      const moved = await api.call<IncidentDetail & { joinResult: string }>('POST', `/api/v1/incidents/${hotId}/join`, { token: bob, body: { entrance: 3 } });
      expect(moved.body).toMatchObject({ joinResult: 'updated', byEntrance: [{ entrance: 2, count: 1 }, { entrance: 3, count: 1 }] });
      expect((await api.call<Problem>('POST', `/api/v1/incidents/${hotId}/join`, { token: bob, body: { floor: 40 } })).body.code).toBe('floor_out_of_range');
      const left = await api.call<IncidentDetail>('POST', `/api/v1/incidents/${hotId}/leave`, { token: bob });
      expect(left.body).toMatchObject({ participantsCount: 1, counters: { notMe: 1 }, me: { joined: false, notMe: true } });
    });

    it('номер заявки АДС: сроки от регистрации; «не дозвонился»; пустой запрос — 400', async () => {
      const registeredAt = new Date(api.clock.now().getTime() - 10 * 60_000).toISOString();
      const res = await api.call<IncidentDetail>('POST', `/api/v1/incidents/${hotId}/ads-registration`, { token: alice, body: { number: '4127', registeredAt } });
      expect(res.status).toBe(200);
      expect(res.body.ads.registration).toMatchObject({ number: '4127', at: registeredAt, notReached: false });
      expect(res.body.deadlines.find((d) => d.kind === 'answer')).toMatchObject({ anchor: 'ads_registration', dueAt: new Date(Date.parse(registeredAt) + 30 * 60_000).toISOString() });
      expect(res.body.timeline[0]).toMatchObject({ type: 'ads_registered', mine: true, payload: { number: '4127' } });
      // Номер и «не дозвонился» — только от отметившихся: Боб ответил «Не у меня».
      expect((await api.call<Problem>('POST', `/api/v1/incidents/${hotId}/ads-registration`, { token: bob, body: { notReached: true } })).body.code).toBe('not_participant');
      const fail = await api.call<IncidentDetail>('POST', `/api/v1/incidents/${hotId}/ads-registration`, { token: alice, body: { notReached: true } });
      expect(fail.body.ads.registration).toMatchObject({ number: '4127', notReached: true });
      expect((await api.call('POST', `/api/v1/incidents/${hotId}/ads-registration`, { token: alice, body: {} })).status).toBe(400);
    });

    it('«Уведомлять меня»: только участнику', async () => {
      const res = await api.call('PATCH', `/api/v1/incidents/${hotId}/participation`, { token: alice, body: { notify: false } });
      expect(res).toMatchObject({ status: 200, body: { notify: false } });
      const other = await api.login(8700);
      expect((await api.call('PATCH', `/api/v1/incidents/${hotId}/participation`, { token: other, body: { notify: false } })).status).toBe(403);
    });

    it('закрытая авария: «У меня тоже» — 409 incident_not_open', async () => {
      const [row] = await api.handle.db.select().from(incident).where(eq(incident.publicId, hotId));
      await api.handle.db.update(incident).set({ status: 'closed', closedAt: api.clock.now() }).where(eq(incident.id, row!.id));
      const res = await api.call<Problem>('POST', `/api/v1/incidents/${hotId}/join`, { token: bob, body: {} });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('incident_not_open');
      await api.handle.db.update(incident).set({ status: 'open', closedAt: null }).where(eq(incident.id, row!.id));
    });

    it('checker-токен жителя работает только с песочницей', async () => {
      const own = await api.call<IncidentDetail>('POST', '/api/v1/incidents', {
        token: CHECKER.resident,
        body: { houseId: 'dom5sandbx', service: 'cold_water', scope: 'house' },
      });
      expect(own.status).toBe(201);
      expect(own.body.timeline[0]?.source).toBe('api');
      expect((await api.call('GET', `/api/v1/incidents/${hotId}`, { token: CHECKER.resident })).status).toBe(404);
      const join = await api.call<{ participantsCount: number }>('POST', `/api/v1/incidents/${own.body.id}/join`, { token: CHECKER.resident2, body: {} });
      expect(join.body.participantsCount).toBe(2);
    });
  });

  describe('контракт', () => {
    it('каждая операция контракта либо зарегистрирована с тем же методом и путём, либо запланирована', () => {
      for (const route of apiRoutes) {
        const registered = api.app.hasRoute({ method: route.method.toUpperCase(), url: fastifyPath(route.path) });
        const pending = route.operationId in PENDING_OPERATIONS;
        expect(registered !== pending, `${route.operationId}: зарегистрирован=${registered}, в плане=${pending}`).toBe(true);
      }
    });

    it('сотрудник модельной УК из сидов — не житель: создание аварии — 403', async () => {
      const [row] = await api.handle.db.select().from(staff).where(eq(staff.isChecker, true));
      expect(row).toBeDefined();
      const res = await api.call<Problem>('POST', '/api/v1/incidents', {
        token: CHECKER.uk,
        body: { houseId: 'dom5sandbx', service: 'gas', scope: 'house' },
      });
      expect(res.status).toBe(403);
    });
  });
});

describe.skipIf(!url)('лимиты запросов (A6)', () => {
  let api: ApiHarness;
  beforeAll(async () => {
    api = await createApiHarness(url!, { rateLimits: { userPerMinute: 3, authPerMinute: 2 } });
  });
  afterAll(async () => {
    await api?.close();
  });

  it('на пользователя и на вход с IP — 429 rate_limited в формате problem+json', async () => {
    const token = await api.login(9100);
    expect((await api.call('POST', '/api/v1/auth/dev', { body: { userId: 9101, role: 'resident' } })).status).toBe(200);
    const limited = await api.call<Problem>('POST', '/api/v1/auth/dev', { body: { userId: 9102, role: 'resident' } });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('rate_limited');
    expect(limited.body.detail).toMatch(/^Повторите через \d+ с$/);
    for (let i = 0; i < 3; i += 1) expect((await api.call('GET', '/api/v1/me', { token })).status).toBe(200);
    const over = await api.call<Problem>('GET', '/api/v1/me', { token });
    expect(over.status).toBe(429);
    expect(over.headers['content-type']).toContain('application/problem+json');
    expect((await api.call('GET', '/api/v1/health')).status).toBe(200);
  });
});
