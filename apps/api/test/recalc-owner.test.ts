import type { IncidentDetail, Problem } from '@vsemdomom/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outboundMessage, residency } from '../src/db/schema.ts';
import { createApiHarness, type ApiHarness } from './helpers/api-harness.ts';
import { dmMessages, fakeChat, lastDm, STAFF_ID, updates } from './helpers/bot-harness.ts';
import { testDatabaseUrl } from './helpers/test-db.ts';

const url = testDatabaseUrl();
const CHAT = -1001;
const MIN = 60_000;
const HOUR = 60 * MIN;
const plain = (x: string) => x.replace(/\u00a0/g, ' ');

type Recalc = {
  preliminary: boolean;
  totalMinutes: number;
  limitMinutes: number | null;
  excessMinutes: number;
  excessHours: number;
  round: string;
  ratePercent: number;
  amount: number;
  withinNorm: boolean;
  singleLimitExceeded: boolean;
  formula: string;
  norm: { code: string } | null;
  disclaimer: string;
};

describe.skipIf(!url)('перерасчёт, заявление в личку, приглашение собственника (A9)', () => {
  let api: ApiHarness;
  let uk = '';
  const tokens: Record<number, string> = {};
  const A = 8001; // кв. 57, диалог начат
  const B = 8002; // кв. 100, бота не запускал
  let hot: IncidentDetail;

  beforeAll(async () => {
    api = await createApiHarness(url!, { chats: [fakeChat(CHAT)] });
    await api.deliver(updates.groupText(CHAT, STAFF_ID, '/connect dom1model1'));
    uk = await api.login(STAFF_ID, 'uk');
    tokens[A] = await api.resident(A, 'dom1model1', 57);
    tokens[B] = await api.resident(B, 'dom1model1', 100);
    await api.deliver(updates.botStarted(A));
    // Горячей воды нет 5 ч 40 мин; в этом месяце уже был перерыв 6 ч (история модельного дома 1).
    const created = await api.call<IncidentDetail>('POST', '/api/v1/incidents', {
      token: tokens[A],
      body: { houseId: 'dom1model1', service: 'hot_water', scope: 'house', startedPreset: 'custom', startedAt: new Date(api.clock.now().getTime() - (5 * HOUR + 40 * MIN)).toISOString() },
    });
    hot = created.body;
  });
  afterAll(async () => {
    await api?.close();
  });

  const recalc = (token: string, body: unknown, headers?: Record<string, string>) =>
    api.call<Recalc & Problem>('POST', `/api/v1/incidents/${hot.id}/recalculation`, { token, body, ...(headers ? { headers } : {}) });

  describe('перерасчёт по нормам', () => {
    it('до «Устранено» — 409; после — предварительный расчёт по квартире (пример из ТЗ: 7,20 ₽)', async () => {
      expect((await recalc(tokens[A]!, { monthlyCharge: 1200 })).body.code).toBe('incident_not_closed');
      await api.call('POST', `/api/v1/uk/incidents/${hot.id}/status`, { token: uk, body: { status: 'resolved' } });
      await api.drain();
      const res = await recalc(tokens[A]!, { monthlyCharge: 1200 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        preliminary: true,
        totalMinutes: 700,
        limitMinutes: 480,
        excessMinutes: 220,
        excessHours: 4,
        round: 'ceil',
        ratePercent: 0.15,
        amount: 7.2,
        withinNorm: false,
        singleLimitExceeded: true,
        norm: { code: 'pr354.app1.p4.monthly' },
        disclaimer: 'Это расчёт по нормам, итог определяет исполнитель услуги',
      });
      expect(plain(res.body.formula)).toBe('4 ч × 0,15 % × 1 200 ₽ = 7,20 ₽');
    });

    it('сумма ≤ 0, не число или без суммы — 422 monthly_charge_invalid; не житель дома — 403', async () => {
      for (const body of [{ monthlyCharge: 0 }, { monthlyCharge: -5 }, { monthlyCharge: 'много' }, {}, { monthlyCharge: 1e9 }]) {
        const res = await recalc(tokens[A]!, body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.code).toBe('monthly_charge_invalid');
      }
      const stranger = await api.resident(8003, 'dom2model2', 1);
      expect((await recalc(stranger, { monthlyCharge: 1200 })).status).toBe(403);
    });

    it('Idempotency-Key: повтор возвращает первый ответ', async () => {
      const first = await recalc(tokens[A]!, { monthlyCharge: 1500 }, { 'idempotency-key': 'recalc-key-0001' });
      const again = await recalc(tokens[A]!, { monthlyCharge: 999 }, { 'idempotency-key': 'recalc-key-0001' });
      expect(again.body).toEqual(first.body);
      // Целые рубли — без копеек: «9 ₽».
      expect(plain(first.body.formula)).toBe('4 ч × 0,15 % × 1 500 ₽ = 9 ₽');
    });

    it('в пределах месячной нормы — 200 с amount = 0 и всеми полями', async () => {
      const cold = await api.call<IncidentDetail>('POST', '/api/v1/incidents', { token: tokens[B], body: { houseId: 'dom1model1', service: 'cold_water', scope: 'house', startedPreset: '1h' } });
      await api.call('POST', `/api/v1/uk/incidents/${cold.body.id}/status`, { token: uk, body: { status: 'resolved' } });
      const res = await api.call<Recalc>('POST', `/api/v1/incidents/${cold.body.id}/recalculation`, { token: tokens[B], body: { monthlyCharge: 800 } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ withinNorm: true, amount: 0, excessHours: 0, excessMinutes: 0, totalMinutes: 60, limitMinutes: 480 });
      expect(plain(res.body.formula)).toBe('Перерасчёт не положен: перерывы за месяц в пределах 8 ч');
    });
  });

  describe('заявление в личку', () => {
    const statement = 'В УК «Модельная» от Иванова Ивана Ивановича, ул. Модельная, 1, кв. 57, тел. +7 900 000-00-00\nЗаявление об изменении размера платы';
    const send = (token: string, text: string) =>
      api.call<Problem & { sent: boolean }>('POST', `/api/v1/incidents/${hot.id}/application/send-to-dm`, { token, body: { text } });

    it('отправляется синхронно; текст нигде не сохраняется, в журнале симулятора замаскирован', async () => {
      const before = dmMessages(api, A).length;
      const res = await send(tokens[A]!, statement);
      expect(res).toMatchObject({ status: 200, body: { sent: true } });
      expect(dmMessages(api, A)).toHaveLength(before + 1);
      expect(lastDm(api, A).text).not.toContain('Иванов');
      const journal = JSON.stringify(api.calls.calls);
      expect(journal).not.toContain('Иванов');
      expect(journal).not.toContain('900 000');
      const rows = JSON.stringify(await api.handle.db.select().from(outboundMessage));
      expect(rows).not.toContain('Иванов');
      expect(api.queue.sent.some((j) => JSON.stringify(j.data).includes('Иванов'))).toBe(false);
    });

    it('диалог не начат — 409 с ссылкой на бота; MAX не ответил — 502; слишком длинный — 422', async () => {
      const noDialog = await send(tokens[B]!, statement);
      expect(noDialog.status).toBe(409);
      expect(noDialog.body).toMatchObject({ code: 'dialog_not_started', botLink: 'https://max.ru/vsemdomom_test_bot' });
      api.max.failNext({ operation: 'sendMessage', kind: 'server', times: 1 });
      const down = await send(tokens[A]!, statement);
      expect(down.status).toBe(502);
      expect(down.body.code).toBe('max_unavailable');
      expect((await send(tokens[A]!, 'а'.repeat(3990))).body.code).toBe('text_too_long');
    });

    it('бот остановлен у MAX (403) — 409 и отметка «диалог закрыт»', async () => {
      api.max.failNext({ operation: 'sendMessage', kind: 'forbidden', times: 1 });
      expect((await send(tokens[A]!, statement)).body.code).toBe('dialog_not_started');
      const me = await api.call<{ dialogActive: boolean }>('GET', '/api/v1/me', { token: tokens[A] });
      expect(me.body.dialogActive).toBe(false);
      await api.deliver(updates.botStarted(A));
    });
  });

  describe('приглашение собственника', () => {
    let link = '';
    const tokenOf = (l: string) => new URL(l).searchParams.get('startapp')!.slice(2);

    it('жилец получает ссылку o_<токен> на 7 дней и текст для пересылки', async () => {
      const res = await api.call<{ link: string; shareText: string; expiresAt: string }>('POST', '/api/v1/owner-invites', {
        token: tokens[A],
        body: { incidentId: hot.id },
      });
      expect(res.status).toBe(201);
      link = res.body.link;
      expect(link).toMatch(/^https:\/\/max\.ru\/vsemdomom_test_bot\?startapp=o_[A-Za-z0-9_-]{24}$/);
      expect(res.body.shareText).toContain('квартире 57');
      expect(new Date(res.body.expiresAt).getTime() - api.clock.now().getTime()).toBe(7 * 24 * HOUR);
      expect((await api.call('POST', '/api/v1/owner-invites', { token: tokens[B], body: { incidentId: 'ZZZZZZZZZZ' } })).status).toBe(404);
    });

    it('собственник видит квартиру и роль жильца без имени; подтверждение — уровень 2 и сообщение жильцу', async () => {
      const owner = await api.login(8100);
      const view = await api.call<{ status: string; flatNo: number; tenantRole: string; result: unknown }>('GET', `/api/v1/owner-invites/${tokenOf(link)}`, { token: owner });
      expect(view.status).toBe(200);
      expect(view.body).toMatchObject({ status: 'pending', flatNo: 57, tenantRole: 'owner', result: null });
      const self = await api.call<Problem>('POST', `/api/v1/owner-invites/${tokenOf(link)}/confirm`, { token: tokens[A] });
      expect(self.status).toBe(403);
      const confirmed = await api.call<{ status: string; tenantTrustLevel: number }>('POST', `/api/v1/owner-invites/${tokenOf(link)}/confirm`, { token: owner });
      expect(confirmed.body).toMatchObject({ status: 'confirmed', tenantTrustLevel: 2 });
      const [res] = await api.handle.db.select().from(residency).where(eq(residency.userId, A));
      expect(res).toMatchObject({ trustLevel: 2, reviewStatus: 'confirmed', confirmedBy: 'owner:8100' });
      await api.drain();
      expect(lastDm(api, A).text).toBe('Собственник подтвердил ваше проживание в кв. 57. Уровень доверия — «подтверждён»');
      const again = await api.call<Problem>('POST', `/api/v1/owner-invites/${tokenOf(link)}/reject`, { token: owner });
      expect(again.status).toBe(410);
      expect(again.body.code).toBe('token_used');
    });

    it('«Не знаю этого человека» уровень не меняет; просроченная ссылка — 410', async () => {
      const second = await api.call<{ link: string }>('POST', '/api/v1/owner-invites', { token: tokens[B], body: { incidentId: hot.id } });
      const owner = await api.login(8101);
      const rejected = await api.call<{ status: string; tenantTrustLevel: number }>('POST', `/api/v1/owner-invites/${tokenOf(second.body.link)}/reject`, { token: owner });
      expect(rejected.body).toMatchObject({ status: 'rejected', tenantTrustLevel: 1 });
      const third = await api.call<{ link: string }>('POST', '/api/v1/owner-invites', { token: tokens[B], body: { incidentId: hot.id } });
      api.clock.advance(8 * 24 * HOUR);
      const late = await api.login(8102);
      const expired = await api.call<Problem>('GET', `/api/v1/owner-invites/${tokenOf(third.body.link)}`, { token: late });
      expect(expired.status).toBe(410);
      expect(expired.body.code).toBe('token_expired');
    });
  });
});
