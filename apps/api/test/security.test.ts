/**
 * Регрессия по исследованию безопасности: границы времён от жителя, доступ к действиям,
 * тестовые токены проверяющих, ПДн во входящих данных, демо-роль и привязка чатов.
 */
import type { IncidentDetail, Problem } from '@vsemdomom/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { incident, incidentParticipant } from '../src/db/schema.ts';
import { CHECKER, createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { PARAMS } from '../src/config/params.ts';
import { dmTextAllowed } from '../src/bot/router.ts';
import { normalizeUpdate } from '../src/max/update.ts';
import { button, cb, dm, fakeChat, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CHAT = -1001;
const OTHER_CHAT = -1004;
const STRANGER_CHAT = -1007; // чат, где нет сотрудника УК

describe.skipIf(!url)('безопасность: границы, доступ, тестовые токены', () => {
  let api: ApiHarness;
  const tokens: Record<number, string> = {};
  let hotId = '';
  const A = 9101; // кв. 57
  const B = 9102; // кв. 100
  const C = 9103; // житель чата, без регистрации

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT), fakeChat(OTHER_CHAT), fakeChat(STRANGER_CHAT, { members: new Set([424242]) })] });
    tokens[A] = await api.resident(A, 'dom1model1', 57);
    tokens[B] = await api.resident(B, 'dom1model1', 100);
  });
  afterAll(async () => {
    await api?.close();
  });

  const create = (body: Record<string, unknown>, token = tokens[A]) =>
    api.call<IncidentDetail>('POST', '/api/v1/incidents', { token, body: { houseId: 'dom1model1', scope: 'house', ...body } });
  const problem = (res: { body: unknown }) => res.body as Problem;

  describe('время от жителя', () => {
    it('начало аварии старше 31 дня не принимается даже с подтверждением', async () => {
      for (const startedAt of ['0001-01-01T00:00:00Z', new Date(api.clock.now().getTime() - 40 * DAY).toISOString()]) {
        const res = await create({ service: 'cold_water', startedPreset: 'custom', startedAt, confirmOld: true });
        expect(res.status, startedAt).toBe(422);
        expect(problem(res).code).toBe('started_at_too_old');
      }
      const ok = await create({ service: 'cold_water', startedPreset: 'custom', startedAt: new Date(api.clock.now().getTime() - 20 * DAY).toISOString(), confirmOld: true });
      expect(ok.status).toBe(201);
    });

    it('регистрация в АДС — не раньше начала аварии и не в будущем', async () => {
      const hot = await create({ service: 'hot_water', startedPreset: '1h' });
      hotId = hot.body.id;
      const register = (registeredAt: string) =>
        api.call<Problem>('POST', `/api/v1/incidents/${hot.body.id}/ads-registration`, { token: tokens[A], body: { number: '4127', registeredAt } });
      const before = await register(new Date(api.clock.now().getTime() - 2 * HOUR).toISOString());
      expect(before.status).toBe(422);
      expect(before.body.code).toBe('registered_at_before_start');
      expect((await register('9999-12-31T00:00:00Z')).body.code).toBe('registered_at_in_future');
      expect((await register(new Date(api.clock.now().getTime() - 30 * MIN).toISOString())).status).toBe(200);
    });

    it('восстановление через АДС — не раньше отметки «Устранено»', async () => {
      const uk = await api.login(9001, 'uk');
      const resolved = await api.call('POST', `/api/v1/uk/incidents/${hotId}/status`, { token: uk, body: { status: 'resolved' } });
      expect(resolved.status).toBe(200);
      const [row] = await api.handle.db.select().from(incident).where(eq(incident.publicId, hotId));
      expect(row?.status).toBe('checking');
      const observe = (at: string) =>
        api.call<Problem>('POST', `/api/v1/incidents/${hotId}/observations`, { token: tokens[A], body: { kind: 'restored_yes', viaAds: { number: '77', at } } });
      expect((await observe(new Date(api.clock.now().getTime() - 3 * HOUR).toISOString())).body.code).toBe('registered_at_before_start');
      expect((await observe('9999-12-31T00:00:00Z')).body.code).toBe('registered_at_in_future');
    });
  });

  describe('действия только для участников и только из чата дома', () => {
    it('номер АДС — только от отметившегося; после «У меня тоже» — можно', async () => {
      const cold = await create({ service: 'electricity', startedPreset: 'now' });
      const register = () => api.call<Problem>('POST', `/api/v1/incidents/${cold.body.id}/ads-registration`, { token: tokens[B], body: { number: '555' } });
      const denied = await register();
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('not_participant');
      await api.call('POST', `/api/v1/incidents/${cold.body.id}/join`, { token: tokens[B], body: {} });
      expect((await register()).status).toBe(200);
    });

    it('кнопки карточки и вопроса не принимаются из чужого чата и из лички', async () => {
      await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
      const gas = await create({ service: 'sewerage', startedPreset: 'now' });
      await api.drain();
      for (const where of [{ chatId: OTHER_CHAT, chatType: 'chat' as const }, dm(C)]) {
        await api.deliver(updates.callback(C, cb('join', gas.body.id, '2'), where));
        expect(api.max.callbacks.at(-1)?.answer.notification).toBe('Кнопка устарела. Откройте бота заново');
      }
      const people = await api.handle.db.select().from(incidentParticipant).where(eq(incidentParticipant.userId, C));
      expect(people).toEqual([]);
      await api.deliver(updates.callback(C, cb('join', gas.body.id, '2'), { chatId: CHAT, chatType: 'chat' }));
      expect(api.max.callbacks.at(-1)?.answer.notification).toContain('Вы отметились');
    });

    it('приглашение собственника по чужой аварии «только в квартире» — 404', async () => {
      const own = await create({ service: 'leak', scope: 'flat', startedPreset: 'now' });
      const res = await api.call<Problem>('POST', '/api/v1/owner-invites', { token: tokens[B], body: { incidentId: own.body.id } });
      expect(res.status).toBe(404);
      expect((await api.call('POST', '/api/v1/owner-invites', { token: tokens[A], body: { incidentId: own.body.id } })).status).toBe(201);
    });
  });

  describe('приглашение собственника', () => {
    const tokenOf = (link: string) => new URL(link).searchParams.get('startapp')!.slice(2);
    const invite = async (token: string, incidentId: string) =>
      (await api.call<{ link: string }>('POST', '/api/v1/owner-invites', { token, body: { incidentId } })).body.link;

    it('два аккаунта не подтверждают друг друга', async () => {
      const heat = await create({ service: 'heating', startedPreset: 'now' });
      await api.call('POST', `/api/v1/incidents/${heat.body.id}/join`, { token: tokens[B], body: {} });
      const fromA = await invite(tokens[A]!, heat.body.id);
      const fromB = await invite(tokens[B]!, heat.body.id);
      expect((await api.call('POST', `/api/v1/owner-invites/${tokenOf(fromA)}/confirm`, { token: tokens[B] })).status).toBe(200);
      const back = await api.call<Problem>('POST', `/api/v1/owner-invites/${tokenOf(fromB)}/confirm`, { token: tokens[A] });
      expect(back.status).toBe(403);
      expect(back.body.title).toBe('Подтверждать друг друга нельзя');
    });

    it('жилец сменил квартиру — старая ссылка недействительна', async () => {
      const [heat] = await api.handle.db.select().from(incident).where(eq(incident.serviceType, 'heating'));
      const link = await invite(tokens[B]!, heat!.publicId);
      await api.call('PUT', '/api/v1/me/residency', { token: tokens[B], body: { houseId: 'dom1model1', flatNo: 101, role: 'owner' } });
      const owner = await api.login(9150);
      const res = await api.call<Problem>('POST', `/api/v1/owner-invites/${tokenOf(link)}/confirm`, { token: owner });
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('token_expired');
    });
  });

  describe('привязка чатов', () => {
    const bindToken = async (chatId: number) => {
      await api.deliver(updates.botAdded(chatId, 424242));
      const invite = api.max.messagesIn({ chatId }).at(-1)!.message;
      const b = button(invite, 'Привязать к дому');
      return b.type === 'open_app' ? (b.payload ?? '').slice(2) : '';
    };

    it('демо-роль не перехватывает привязанный дом, свободный — привязывает', async () => {
      const demo = await api.login(9160, 'uk');
      const token = await bindToken(OTHER_CHAT);
      const taken = await api.call<Problem>('POST', '/api/v1/uk/chat-bindings', { token: demo, body: { token, houseId: 'dom1model1' } });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('already_bound');
      expect((await api.call('POST', '/api/v1/uk/chat-bindings', { token: demo, body: { token, houseId: 'dom2model2' } })).status).toBe(200);
    });

    it('по ссылке привязывает только участник этого чата', async () => {
      const staff = await api.login(STAFF_ID, 'uk');
      const token = await bindToken(STRANGER_CHAT);
      const res = await api.call<Problem>('POST', '/api/v1/uk/chat-bindings', { token: staff, body: { token, houseId: 'dom3model3' } });
      expect(res.status).toBe(403);
    });
  });

  describe('ПДн во входящих данных', () => {
    it('номер заявки, похожий на телефон, — 422', async () => {
      const [heat] = await api.handle.db.select().from(incident).where(eq(incident.serviceType, 'heating'));
      const res = await api.call<Problem>('POST', `/api/v1/incidents/${heat!.publicId}/ads-registration`, { token: tokens[A], body: { number: '+7 916 123-45-67' } });
      expect(res.status).toBe(422);
      expect(problem(res).code).toBe('ads_number_invalid');
    });

    it('в задачу очереди из лички попадают только команды и короткий ввод с цифрами', () => {
      const dmText = (text: string) =>
        normalizeUpdate(
          { update_type: 'message_created', timestamp: 1, message: { sender: { user_id: 1 }, recipient: { chat_id: 2, chat_type: 'dialog' }, timestamp: 1, body: { mid: 'm', text } } },
          { keywordMatcher: null },
        ).text;
      expect(dmText('/start')).toBe('/start');
      expect(dmText('57')).toBe('57');
      expect(dmText('4127 26.09 17:45')).toBe('4127 26.09 17:45');
      expect(dmText('Меня зовут Иван Петров, квартира 57')).toBe('');
      expect(dmText('8 916 123-45-67')).toBe('');
      expect(dmText('привет')).toBe('');
    });

    it('флуд в личку: сверх лимита в минуту бот не отвечает', () => {
      const t0 = new Date('2026-09-28T09:00:00Z');
      for (let i = 0; i < PARAMS.dmTextsPerMinute; i += 1) expect(dmTextAllowed(77, new Date(t0.getTime() + i * 100))).toBe(true);
      expect(dmTextAllowed(77, new Date(t0.getTime() + 5_000))).toBe(false);
      expect(dmTextAllowed(78, new Date(t0.getTime() + 5_000))).toBe(true);
      expect(dmTextAllowed(77, new Date(t0.getTime() + MIN + 5_000))).toBe(true);
    });
  });

  describe('ответы API', () => {
    it('не кешируются', async () => {
      const me = await api.call('GET', '/api/v1/me', { token: tokens[A] });
      expect(me.headers['cache-control']).toBe('no-store');
    });
  });

  describe('тестовые токены проверяющих не меняют профиль песочницы', () => {
    it('удаление данных и смена проживания — 403', async () => {
      const del = await api.call<Problem>('DELETE', '/api/v1/me', { token: CHECKER.resident });
      expect(del.status).toBe(403);
      const put = await api.call<Problem>('PUT', '/api/v1/me/residency', { token: CHECKER.resident, body: { houseId: 'dom5sandbx', flatNo: 7, role: 'owner' } });
      expect(put.status).toBe(403);
      const me = await api.call<{ residencies: { flatNo: number }[] }>('GET', '/api/v1/me', { token: CHECKER.resident });
      expect(me.body.residencies).toMatchObject([{ flatNo: 1 }]);
    });
  });
});
