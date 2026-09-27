import type { IncidentDetail, Me, Problem } from '@vsemdomom/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, house, incident, incidentParticipant, outboundMessage, residency } from '../src/db/schema.ts';
import { CHECKER, createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { dmMessages, fakeChat, lastDm, registerResident, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;

type Request = { id: string; house: { id: string }; flatNo: number; role: string; trustLevel: number; source: string | null; createdAt: string };
type Decision = { id: string; trustLevel: number; reviewStatus: string };

describe.skipIf(!url)('очередь подтверждения жильцов, переключатель роли, второй демо-дом (A11)', () => {
  let api: ApiHarness;
  let uk = '';
  const tokens: Record<number, string> = {};
  const A = 8301; // кв. 57, состоит в чате дома (уровень 1), бота не запускал
  const B = 8302; // кв. 100, не в чате (уровень 0), диалог с ботом начат
  const C = 8303; // дом 2, кв. 5
  const id: Record<number, string> = {};

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT, { members: new Set([A]) })] });
    await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    uk = await api.login(STAFF_ID, 'uk');
    tokens[A] = await api.resident(A, 'dom1model1', 57);
    tokens[B] = await api.resident(B, 'dom1model1', 100);
    tokens[C] = await api.resident(C, 'dom2model2', 5);
    await api.deliver(updates.botStarted(B));
    for (const user of [A, B, C]) {
      const me = await api.call<Me>('GET', '/api/v1/me', { token: tokens[user] });
      id[user] = me.body.residencies[0]!.id;
    }
  });
  afterAll(async () => {
    await api?.close();
  });

  const queue = async (query = '') => (await api.call<{ items: Request[] }>('GET', `/api/v1/uk/residents${query}`, { token: uk })).body.items;
  const decide = (resId: string, what: 'confirm' | 'reject', token = uk) => api.call<Decision & Problem>('POST', `/api/v1/uk/residents/${resId}/${what}`, { token });
  const row = async (user: number) => (await api.handle.db.select().from(residency).where(eq(residency.userId, user)))[0]!;

  describe('очередь U04', () => {
    it('заявки уровня 0–1 домов УК: старые сверху, без имён и без модельных жителей', async () => {
      const items = await queue();
      expect(items.map((i) => i.id)).toEqual([id[A], id[B], id[C]]);
      expect(items[0]).toMatchObject({ house: { id: 'dom1model1' }, flatNo: 57, role: 'owner', trustLevel: 1, source: 'miniapp' });
      expect(items[1]).toMatchObject({ flatNo: 100, trustLevel: 0 });
      expect(Object.keys(items[0]!).sort()).toEqual(['createdAt', 'flatNo', 'house', 'id', 'role', 'source', 'trustLevel']);
      expect((await queue('?houseId=dom2model2')).map((i) => i.id)).toEqual([id[C]]);
      const houses = await api.call<{ items: { id: string; pendingResidents: number }[] }>('GET', '/api/v1/uk/houses', { token: uk });
      expect(houses.body.items.find((h) => h.id === 'dom1model1')?.pendingResidents).toBe(2);
    });

    it('житель — 403; checker-УК видит только песочницу', async () => {
      const resident = await api.call<Problem>('GET', '/api/v1/uk/residents', { token: tokens[A] });
      expect(resident.status).toBe(403);
      expect(resident.body.code).toBe('not_staff');
      expect((await api.call<{ items: Request[] }>('GET', '/api/v1/uk/residents', { token: CHECKER.uk })).body.items).toEqual([]);
      expect((await decide(id[A]!, 'confirm', CHECKER.uk)).status).toBe(404);
    });
  });

  describe('решения УК', () => {
    it('«Подтвердить» — уровень 2 и сообщение в личку; повтор ничего не меняет', async () => {
      const res = await decide(id[B]!, 'confirm');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: id[B], trustLevel: 2, reviewStatus: 'confirmed' });
      expect(await row(B)).toMatchObject({ trustLevel: 2, reviewStatus: 'confirmed', confirmedBy: `staff:${STAFF_ID}` });
      await api.drain();
      expect(lastDm(api, B).text).toBe('УК подтвердила ваше проживание в кв. 100. Уровень доверия — «подтверждён»\nМодельные данные');
      const sent = dmMessages(api, B).length;
      expect((await decide(id[B]!, 'confirm')).body).toEqual({ id: id[B], trustLevel: 2, reviewStatus: 'confirmed' });
      await api.drain();
      expect(dmMessages(api, B)).toHaveLength(sent);
      expect((await queue()).map((i) => i.id)).toEqual([id[A], id[C]]);
      const me = await api.call<Me>('GET', '/api/v1/me', { token: tokens[B] });
      expect(me.body.residencies[0]).toMatchObject({ trustLevel: 2, reviewStatus: 'confirmed' });
      const log = await api.handle.db.select().from(auditLog).where(eq(auditLog.action, 'resident_confirm'));
      expect(log).toMatchObject([{ actor: `staff:${STAFF_ID}`, entity: 'residency', entityId: id[B] }]);
    });

    it('«Отклонить» — заявка уходит из очереди, уровень прежний; подтверждённого не отменяет', async () => {
      expect((await decide(id[A]!, 'reject')).body).toEqual({ id: id[A], trustLevel: 1, reviewStatus: 'rejected' });
      expect(await row(A)).toMatchObject({ trustLevel: 1, reviewStatus: 'rejected' });
      expect((await queue()).map((i) => i.id)).toEqual([id[C]]);
      // Житель без диалога с ботом: сообщений нет.
      expect(await api.handle.db.select().from(outboundMessage).where(eq(outboundMessage.userId, A))).toEqual([]);
      expect((await decide(id[B]!, 'reject')).body).toEqual({ id: id[B], trustLevel: 2, reviewStatus: 'confirmed' });
    });

    it('смена квартиры возвращает жителя в очередь', async () => {
      await api.call('PUT', '/api/v1/me/residency', { token: tokens[A], body: { houseId: 'dom1model1', flatNo: 58, role: 'owner' } });
      const items = await queue('?houseId=dom1model1');
      expect(items).toMatchObject([{ id: id[A], flatNo: 58, trustLevel: 1 }]);
    });

    it('модельный житель и неизвестная заявка — 404; при выключенном флаге — 404 feature_disabled', async () => {
      const [model] = await api.handle.db
        .select({ publicId: residency.publicId })
        .from(residency)
        .innerJoin(house, eq(house.id, residency.houseId))
        .where(and(eq(house.publicId, 'dom1model1'), eq(residency.isModel, true)));
      expect((await decide(model!.publicId, 'confirm')).status).toBe(404);
      expect((await decide('ZZZZZZZZZZ', 'reject')).status).toBe(404);
      api.ctx.config.features.trustLevels = false;
      try {
        for (const res of [await api.call<Problem>('GET', '/api/v1/uk/residents', { token: uk }), await decide(id[C]!, 'confirm')]) {
          expect(res.status).toBe(404);
          expect(res.body.code).toBe('feature_disabled');
        }
      } finally {
        api.ctx.config.features.trustLevels = true;
      }
      expect((await row(C)).trustLevel).toBe(0);
    });
  });

  describe('переключатель роли «Как житель / Как УК»', () => {
    let hot: IncidentDetail;

    it('сотрудник, который живёт в доме, видит аварию обоими способами; в /me — обе роли', async () => {
      const staffResident = await api.resident(STAFF_ID, 'dom1model1', 12);
      const me = await api.call<Me>('GET', '/api/v1/me', { token: staffResident });
      expect(me.body.roles).toEqual(['resident', 'uk']);
      hot = (await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: tokens[B], body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: 'now' } })).body;
      const asResident = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${hot.id}`, { token: staffResident });
      expect(asResident.status).toBe(200);
      expect(asResident.body.me).toMatchObject({ joined: false });
      const asUk = await api.call<{ grid: unknown; allowedActions: string[] }>('GET', `/api/v1/uk/incidents/${hot.id}`, { token: staffResident });
      expect(asUk.status).toBe(200);
      expect(asUk.body.allowedActions.length).toBeGreaterThan(0);
    });

    it('сотрудник без проживания видит экран жителя; житель экран УК не видит', async () => {
      const staffOnly = await api.login(8400, 'uk');
      const view = await api.call<IncidentDetail>('GET', `/api/v1/incidents/${hot.id}`, { token: staffOnly });
      expect(view.status).toBe(200);
      expect(view.body.me).toBeNull();
      const resident = await api.call<Problem>('GET', `/api/v1/uk/incidents/${hot.id}`, { token: tokens[A] });
      expect(resident.status).toBe(403);
      expect(resident.body.code).toBe('not_staff');
    });
  });

  describe('«Вступить в чат дома» (F12) и второй демо-дом', () => {
    it('при выключенном флаге joinChat бот не предлагает вступить в чат', async () => {
      api.ctx.config.features.joinChat = false;
      try {
        await registerResident(api, 8501, 8);
      } finally {
        api.ctx.config.features.joinChat = true;
      }
      const menu = lastDm(api, 8501);
      expect(menu.text).not.toContain('Вступите в чат дома');
      expect(menu.keyboard.flat().some((b) => b.text.includes('Вступить в чат'))).toBe(false);
    });

    it('дом 4 — копия дома 1: та же сетка и тот же перерыв ГВС 6 ч в истории месяца', async () => {
      const [dom1, dom4] = await Promise.all(['dom1model1', 'dom4model4'].map(async (publicId) => (await api.handle.db.select().from(house).where(eq(house.publicId, publicId)))[0]!));
      for (const key of ['entrances', 'floors', 'flatsPerFloor', 'flatFrom', 'flatTo', 'powerSources', 'hotWaterDeadEnd', 'isModel', 'isSandbox'] as const) {
        expect(dom4![key], key).toEqual(dom1![key]);
      }
      const [hist1, hist4] = await Promise.all(['hist1gvs06', 'hist4gvs06'].map(async (publicId) => (await api.handle.db.select().from(incident).where(eq(incident.publicId, publicId)))[0]!));
      expect(hist4).toMatchObject({ houseId: dom4!.id, serviceType: 'hot_water', status: 'closed', isModel: true });
      expect(hist4!.resolvedAtUk!.getTime() - hist4!.startedAt.getTime()).toBe(hist1!.resolvedAtUk!.getTime() - hist1!.startedAt.getTime());
      const people = await api.handle.db.select().from(incidentParticipant).where(eq(incidentParticipant.incidentId, hist4!.id));
      expect(people.map((p) => p.userId!).sort((a, b) => a - b)).toEqual([-400060, -400038, -400021]);
    });
  });
});
