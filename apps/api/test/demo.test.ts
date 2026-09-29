import type { IncidentDetail, Me, Problem } from '@vsemdomom/shared';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, chatCard, house, incident, incidentEvent, incidentParticipant, maxUser, outboundMessage, residency } from '../src/db/schema.ts';
import { CHECKER, createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { callbackPayload, cb, fakeChat, lastDm, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DEMO_CODE = 'DEMO-UK-TEST';

type UkDetail = Omit<IncidentDetail, 'deadlines'> & { deadlines: { kind: string; state: string; dueAt: string }[] };
type HouseDetail = { demo: { activeIncidentId: string | null } | null };

describe.skipIf(!url)('демо-инструменты (A10)', () => {
  let api: ApiHarness;
  let staffToken = '';
  let demoToken = '';
  let residentToken = '';
  const A = 8001; // житель, кв. 57 (подъезд 2), диалог с ботом начат
  const D = 8500; // проверяющий: вводит демо-код
  let hot: IncidentDetail;

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT)], env: { DEMO_UK_CODE: DEMO_CODE } });
    await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    staffToken = await api.login(STAFF_ID, 'uk');
    residentToken = await api.resident(A, 'dom1model1', 57);
    await api.deliver(updates.botStarted(A));
    demoToken = await api.login(D);
  });
  afterAll(async () => {
    await api?.close();
  });

  const row = async (publicId: string) => (await api.handle.db.select().from(incident).where(eq(incident.publicId, publicId)))[0]!;
  const events = async (publicId: string) =>
    api.handle.db.select().from(incidentEvent).where(eq(incidentEvent.incidentId, (await row(publicId)).id)).orderBy(desc(incidentEvent.id));
  const cardText = async (publicId: string) => {
    const [card] = await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, (await row(publicId)).id));
    return api.max.messages.get(card!.mid!)!.message.text;
  };
  const neighbours = () => api.call<{ incidentId: string; added: number } & Problem>('POST', '/api/v1/uk/houses/dom1model1/demo/neighbours', { token: demoToken, body: {} });
  const shift = (publicId: string, token = demoToken) => api.call<UkDetail>('POST', `/api/v1/uk/incidents/${publicId}/demo/time-shift`, { token, body: {} });
  const problem = (res: { body: unknown }) => res.body as Problem;
  const setStatus = async (publicId: string, body: object) => {
    const res = await api.call('POST', `/api/v1/uk/incidents/${publicId}/status`, { token: demoToken, body });
    expect(res.status).toBe(200);
    await api.drain();
  };

  describe('демо-код роли УК', () => {
    it('неверный код — 403 demo_code_invalid; верный — роль модельной УК с пометкой «Демо-роль»', async () => {
      const wrong = await api.call<Problem>('POST', '/api/v1/me/demo-uk-role', { token: demoToken, body: { code: 'DEMO-UK-WRONG' } });
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('demo_code_invalid');
      const ok = await api.call<Me>('POST', '/api/v1/me/demo-uk-role', { token: demoToken, body: { code: DEMO_CODE } });
      expect(ok.status).toBe(200);
      expect(ok.body.roles).toContain('uk');
      expect(ok.body.staff).toMatchObject({ isDemo: true, isChecker: false, uk: { name: 'УК «Садовый квартал»', isModel: true } });
      const again = await api.call<Me>('POST', '/api/v1/me/demo-uk-role', { token: demoToken, body: { code: DEMO_CODE } });
      expect(again.status).toBe(200);
      const log = await api.handle.db.select().from(auditLog).where(eq(auditLog.action, 'demo_uk_role'));
      expect(log.map((l) => l.actor)).toEqual([`user:${D}`, `user:${D}`]);
    });

    it('настоящий сотрудник модельной УК остаётся со своей ролью — она не становится демо', async () => {
      const staff = await api.call<Me>('POST', '/api/v1/me/demo-uk-role', { token: staffToken, body: { code: DEMO_CODE } });
      expect(staff.status).toBe(200);
      expect(staff.body.staff).toMatchObject({ isDemo: false, role: 'curator' });
    });

    it('тестовым токенам проверяющих демо-роль не выдаётся; пустой код — 400', async () => {
      const checker = await api.call<Problem>('POST', '/api/v1/me/demo-uk-role', { token: CHECKER.resident, body: { code: DEMO_CODE } });
      expect(checker.status).toBe(403);
      expect(checker.body.code).toBe('forbidden');
      expect((await api.call('POST', '/api/v1/me/demo-uk-role', { token: demoToken, body: { code: '' } })).status).toBe(400);
    });
  });

  describe('модельные соседи', () => {
    it('нет открытой аварии — 409; блок демо в U03 — только у демо-роли', async () => {
      const none = await neighbours();
      expect(none.status).toBe(409);
      expect(none.body.code).toBe('incident_not_open');
      const demoHouse = await api.call<HouseDetail>('GET', '/api/v1/uk/houses/dom1model1', { token: demoToken });
      expect(demoHouse.body.demo).toEqual({ activeIncidentId: null });
      const staffHouse = await api.call<HouseDetail>('GET', '/api/v1/uk/houses/dom1model1', { token: staffToken });
      expect(staffHouse.body.demo).toBeNull();
    });

    it('пять соседей уровня 1 в разных подъездах; карточка обновлена; личных сообщений им нет', async () => {
      const created = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: residentToken, body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: 'now' } });
      hot = created.body;
      await api.drain();
      const res = await neighbours();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ incidentId: hot.id, added: 5 });
      await api.drain();

      const inc = await row(hot.id);
      const model = await api.handle.db
        .select({ p: incidentParticipant, flatNo: residency.flatNo })
        .from(incidentParticipant)
        .innerJoin(residency, eq(residency.id, incidentParticipant.residencyId))
        .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.isModel, true)));
      expect(model.map((m) => m.flatNo).sort((a, b) => a - b)).toEqual([1, 5, 41, 81, 121]);
      expect(new Set(model.map((m) => m.p.entrance))).toEqual(new Set([1, 2, 3, 4]));
      expect(model.every((m) => m.p.trustLevelAtJoin === 1 && !m.p.notify && m.p.userId! < 0)).toBe(true);
      const users = await api.handle.db.select().from(maxUser).where(inArray(maxUser.id, model.map((m) => m.p.userId!)));
      expect(users.every((u) => u.isModel && !u.dialogActive)).toBe(true);

      expect(await cardText(hot.id)).toContain('отметились 6 жителей: подъезд 1 — 2, подъезд 2 — 2, подъезд 3 — 1, подъезд 4 — 1');
      const [added, ...joined] = await events(hot.id);
      expect(added).toMatchObject({ type: 'demo_neighbours_added', actorType: 'uk', actorId: D, payload: { added: 5, model: true } });
      expect(joined.slice(0, 5).every((e) => e.type === 'joined' && e.source === 'system' && e.payload?.model === true)).toBe(true);
      const toModel = await api.handle.db.select().from(outboundMessage).where(lt(outboundMessage.userId, 0));
      expect(toModel).toEqual([]);

      const detail = await api.call<HouseDetail>('GET', '/api/v1/uk/houses/dom1model1', { token: demoToken });
      expect(detail.body.demo).toEqual({ activeIncidentId: hot.id });
    });

    it('повторное нажатие не добавляет соседей сверх пяти', async () => {
      const again = await neighbours();
      expect(again.body).toEqual({ incidentId: hot.id, added: 0 });
    });
  });

  describe('сдвиг начала аварии на 6 ч', () => {
    it('начало раньше на 6 ч: допустимый перерыв 4 ч истёк сразу, срок ответа УК не сдвинут', async () => {
      const before = await row(hot.id);
      const res = await shift(hot.id);
      expect(res.status).toBe(200);
      expect(new Date(res.body.startedAt).getTime()).toBe(before.startedAt.getTime() - 6 * HOUR);
      expect(res.body.version).toBe(before.version + 1);
      const byKind = Object.fromEntries(res.body.deadlines.map((d) => [d.kind, d]));
      expect(byKind.single_limit).toMatchObject({ state: 'breached', dueAt: new Date(before.startedAt.getTime() - 2 * HOUR).toISOString() });
      expect(byKind.answer!.state).not.toBe('breached');
      expect(new Date(byKind.answer!.dueAt).getTime()).toBe(before.createdAt.getTime() + 30 * MIN);

      const after = await row(hot.id);
      expect(after.singleLimitExceeded).toBe(true);
      const recent = await events(hot.id);
      expect(recent.map((e) => e.type).slice(0, 2)).toEqual(['deadline_breached', 'demo_time_shift']);
      expect(recent[1]!.payload).toMatchObject({ hours: 6, from: before.startedAt.toISOString(), to: after.startedAt.toISOString() });

      await api.drain();
      // Часы стенда — 12:00 по Москве: начало 06:00, допустимый перерыв истёк в 10:00.
      expect(await cardText(hot.id)).toContain('С 06:00');
      expect(lastDm(api, A).text).toContain('Срок по нормативу истёк в 10:00');
      const log = await api.handle.db.select().from(auditLog).where(eq(auditLog.action, 'demo_time_shift'));
      expect(log).toMatchObject([{ actor: `staff:${D}`, entity: 'incident', entityId: hot.id }]);
    });

    it('закрытая авария — 409 incident_not_open; не демо-роль — 403; житель — 403', async () => {
      const closed = await shift('hist1gvs06');
      expect(closed.status).toBe(409);
      expect(problem(closed).code).toBe('incident_not_open');
      const staff = await shift(hot.id, staffToken);
      expect(staff.status).toBe(403);
      expect(problem(staff).code).toBe('forbidden');
      expect(problem(await shift(hot.id, residentToken)).code).toBe('not_staff');
      expect((await shift('ZZZZZZZZZZ')).status).toBe(404);
    });
  });

  describe('ответы модельных соседей на вопрос о восстановлении', () => {
    it('через минуту после вопроса соседи отвечают «Да»; авария ждёт ответа жителя из чата', async () => {
      // Житель A — участник чата дома (уровень 1): без его ответа правило (а) не выполнено.
      await api.handle.db.update(residency).set({ trustLevel: 1 }).where(eq(residency.userId, A));
      await setStatus(hot.id, { status: 'accepted', eta: new Date(api.clock.now().getTime() + HOUR).toISOString() });
      await setStatus(hot.id, { status: 'resolved' });
      expect((await row(hot.id)).status).toBe('checking');
      const tick = api.delayed().find((j) => j.queue === 'demo-tick');
      expect(tick?.startAfter.getTime()).toBe(api.clock.now().getTime() + 60 * SEC);

      await api.advance(59 * SEC);
      expect((await events(hot.id)).filter((e) => e.type === 'restored_yes')).toHaveLength(0);
      await api.advance(SEC);
      const yes = (await events(hot.id)).filter((e) => e.type === 'restored_yes');
      expect(yes).toHaveLength(5);
      expect(yes.every((e) => e.source === 'system' && e.payload?.model === true)).toBe(true);
      expect((await row(hot.id)).status).toBe('checking');

      const [card] = await api.handle.db.select().from(chatCard).where(eq(chatCard.incidentId, (await row(hot.id)).id));
      const question = api.max.messages.get(card!.checkMid!)!.message;
      await api.deliver(updates.callback(A, callbackPayload(question, 'Да, есть'), { chatId: CHAT, chatType: 'chat' }, card!.checkMid!));
      const closed = await row(hot.id);
      expect(closed.status).toBe('closed');
      const log = await api.handle.db.select().from(auditLog).where(and(eq(auditLog.entityId, hot.id), eq(auditLog.action, 'uk_status:resolved')));
      expect(log).toHaveLength(1);
    });

    it('соседи, добавленные после вопроса, отвечают через минуту после добавления', async () => {
      const cold = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: residentToken, body: { houseId: 'dom1model1', service: 'cold_water', scope: 'house', startedPreset: 'now' } });
      await api.drain();
      await setStatus(cold.body.id, { status: 'resolved' });
      expect(api.delayed().some((j) => j.queue === 'demo-tick')).toBe(false);
      await api.advance(30 * SEC);
      expect((await neighbours()).body.added).toBe(5);
      await api.advance(59 * SEC);
      expect((await events(cold.body.id)).filter((e) => e.type === 'restored_yes')).toHaveLength(0);
      await api.advance(SEC);
      expect((await events(cold.body.id)).filter((e) => e.type === 'restored_yes')).toHaveLength(5);
      expect((await row(cold.body.id)).status).toBe('checking');
    });
  });

  describe('сброс демо-данных дома', () => {
    it('аварии проверки удалены, история дома пересоздана, панель обновлена, роли и проживание остались', async () => {
      const [dom1] = await api.handle.db.select().from(house).where(eq(house.publicId, 'dom1model1'));
      const pending = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: residentToken, body: { houseId: 'dom1model1', service: 'electricity', scope: 'house', startedPreset: 'now' } });
      // Карточка ещё в очереди: после сброса она не уйдёт в чат.
      const res = await api.call<{ houseId: string; removedIncidents: number }>('POST', '/api/v1/uk/houses/dom1model1/demo/reset', { token: demoToken, body: {} });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ houseId: 'dom1model1', removedIncidents: 3 });
      await api.drain();

      const left = await api.handle.db.select().from(incident).where(eq(incident.houseId, dom1!.id));
      expect(left.map((i) => i.publicId)).toEqual(['hist1gvs06']);
      expect(left[0]!.isModel).toBe(true);
      expect(await api.handle.db.select().from(outboundMessage).where(and(eq(outboundMessage.status, 'pending')))).toEqual([]);
      expect(api.max.messagesIn({ chatId: CHAT }).some((m) => m.message.text.includes('Нет света'))).toBe(false);
      const panel = api.max.messagesIn({ chatId: CHAT }).find((m) => m.message.text.includes('Активн'));
      expect(panel?.message.text).toContain('Активных аварий нет');

      const me = await api.call<Me>('GET', '/api/v1/me', { token: demoToken });
      expect(me.body.staff?.isDemo).toBe(true);
      expect((await api.call<Me>('GET', '/api/v1/me', { token: residentToken })).body.residencies).toHaveLength(1);
      const detail = await api.call<HouseDetail>('GET', '/api/v1/uk/houses/dom1model1', { token: demoToken });
      expect(detail.body.demo).toEqual({ activeIncidentId: null });
      expect(await api.handle.db.select().from(auditLog).where(eq(auditLog.action, 'demo_reset'))).toMatchObject([{ actor: `staff:${D}`, entity: 'house', entityId: 'dom1model1' }]);
      expect(pending.status).toBe(201);
    });

    it('кнопки старых карточек отвечают «Кнопка устарела»', async () => {
      await api.deliver(updates.callback(A, cb('join', hot.id, '2'), { chatId: CHAT, chatType: 'chat' }));
      expect(api.max.callbacks.at(-1)?.answer.notification).toBe('Кнопка устарела. Откройте бота заново');
    });

    it('песочница и чужие роли: checker-УК — 404, сотрудник без демо-роли — 403, DEMO_MODE=false — 403', async () => {
      expect((await api.call('POST', '/api/v1/uk/houses/dom1model1/demo/reset', { token: CHECKER.uk, body: {} })).status).toBe(404);
      expect((await api.call('POST', '/api/v1/uk/houses/dom5sandbx/demo/reset', { token: demoToken, body: {} })).status).toBe(404);
      const staff = await api.call<Problem>('POST', '/api/v1/uk/houses/dom1model1/demo/reset', { token: staffToken, body: {} });
      expect(staff.status).toBe(403);
      api.ctx.config.demo.enabled = false;
      try {
        for (const [method, path, body] of [
          ['POST', '/api/v1/uk/houses/dom1model1/demo/reset', {}],
          ['POST', '/api/v1/uk/houses/dom1model1/demo/neighbours', {}],
          ['POST', '/api/v1/me/demo-uk-role', { code: DEMO_CODE }],
        ] as const) {
          const res = await api.call<Problem>(method, path, { token: demoToken, body });
          expect(res.status, path).toBe(403);
          expect(res.body.code).toBe('forbidden');
        }
        const detail = await api.call<HouseDetail>('GET', '/api/v1/uk/houses/dom1model1', { token: demoToken });
        expect(detail.body.demo).toBeNull();
      } finally {
        api.ctx.config.demo.enabled = true;
      }
    });
  });
});
