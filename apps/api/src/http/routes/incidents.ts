/**
 * Аварии со стороны жителя (F01–F03): создание (409 duplicate_incident при открытой аварии того же вида),
 * просмотр, «У меня тоже» с подъездом и этажом, «Не у меня», регистрация в АДС, «Уведомлять меня».
 */
import { botLink, checkStartedAt, flatLocation, isEntranceInRange, isFloorInRange, isOpenStatus, startedAtFromPreset } from '@vsemdomom/core';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { PARAMS } from '../../config/params.ts';
import { incidentParticipant } from '../../db/schema.ts';
import type { HouseRow } from '../../db/queries.ts';
import { observeBrigade } from '../../services/brigade.ts';
import { answerCheck, rereportAds } from '../../services/check.ts';
import { incidentDetail, loadIncidentBundle } from '../../services/incident-view.ts';
import { recalcForFlat } from '../../services/recalc.ts';
import { resultView } from '../../services/result.ts';
import { sendStatementToDm } from '../../services/statement.ts';
import {
  adsNotReached,
  createIncident,
  incidentByPublicId,
  joinIncident,
  markNotAffected,
  registerAds,
  scheduleAdsReminder,
  type IncidentRow,
} from '../../services/incidents.ts';
import { assertHouseAccess, assertResident, houseById, incidentViewer, isStaffOf, loadViewer, notFound, visibleHouse, type Viewer } from '../access.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { withIdempotency } from '../idempotency.ts';
import { ApiError } from '../problem.ts';

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;
const monthlyChargeInvalid = () => new ApiError(422, 'monthly_charge_invalid', 'Введите сумму из квитанции', 'Сумма должна быть больше нуля');
const startedChecks = { futureSkewMs: PARAMS.startedAtFutureSkewSec * MS_PER_SECOND, confirmOldAfterMs: PARAMS.oldStartConfirmHours * MS_PER_HOUR };

export function registerIncidentRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { ctx, config } = deps;

  const detail = async (viewer: Viewer, incidentId: number) => {
    const bundle = await loadIncidentBundle(ctx.db, incidentId);
    if (!bundle) throw notFound('Авария не найдена');
    return incidentDetail(bundle, incidentViewer(viewer, bundle.house), config, ctx.clock.now());
  };

  /** Авария и её дом с проверкой доступа; «только квартира» видна автору и УК. */
  const load = async (viewer: Viewer, publicId: string): Promise<{ inc: IncidentRow; house: HouseRow }> => {
    const inc = await incidentByPublicId(ctx.db, publicId);
    if (!inc) throw notFound('Авария не найдена');
    const h = await houseById(ctx.db, inc.houseId);
    assertHouseAccess(viewer, h);
    if (inc.scope === 'flat' && inc.createdBy !== viewer.userId && !isStaffOf(viewer, h)) throw notFound('Авария не найдена');
    return { inc, house: h };
  };

  const assertOpen = (inc: IncidentRow, mergedInto: string | null = null) => {
    if (!isOpenStatus(inc.status)) {
      throw new ApiError(409, 'incident_not_open', 'Авария уже закрыта', undefined, mergedInto ? { mergedInto } : {});
    }
  };

  const assertLocation = (h: HouseRow, entrance: number | undefined, floor: number | undefined) => {
    if (entrance !== undefined && !isEntranceInRange(h, entrance)) throw new ApiError(422, 'entrance_out_of_range', 'Такого подъезда в доме нет');
    if (floor !== undefined && !isFloorInRange(h, floor)) throw new ApiError(422, 'floor_out_of_range', 'Такого этажа в доме нет');
  };

  registerApiRoute(app, deps, 'createIncident', async ({ principal, body, headers }) =>
    withIdempotency(ctx, principal, 'createIncident', headers['idempotency-key'], async () => {
      const viewer = await loadViewer(ctx.db, principal);
      const h = await visibleHouse(ctx.db, viewer, body.houseId);
      const residency = assertResident(viewer, h);
      const now = ctx.clock.now();
      const preset = body.startedPreset ?? (body.startedAt ? 'custom' : 'now');
      if (preset === 'custom' && !body.startedAt) {
        throw new ApiError(400, 'validation_error', 'Неверный формат запроса', 'startedAt обязателен для startedPreset=custom');
      }
      const startedAt = preset === 'custom' ? new Date(body.startedAt as string) : startedAtFromPreset(preset, now);
      const check = checkStartedAt(startedAt, now, startedChecks);
      if (check === 'future') throw new ApiError(422, 'started_at_in_future', 'Время начала ещё не наступило');
      if (check === 'old' && body.confirmOld !== true) {
        throw new ApiError(422, 'confirm_old_required', 'Авария началась больше суток назад', 'Подтвердите дату: confirmOld=true');
      }
      assertLocation(h, body.entrance, body.floor);
      if (body.scope === 'entrance' && body.entrance === undefined && !flatLocation(h, residency.flatNo)) {
        throw new ApiError(422, 'entrance_required', 'Укажите подъезд');
      }
      const created = await createIncident(ctx, {
        house: h,
        service: body.service,
        scope: body.scope,
        entrance: body.entrance ?? null,
        floor: body.floor ?? null,
        startedAt,
        startedSource: preset,
        reporter: { userId: principal.userId, residency },
        source: principal.kind === 'checker' ? 'api' : 'miniapp',
      });
      if (created.status === 'duplicate') {
        throw new ApiError(409, 'duplicate_incident', 'Такая авария уже открыта', 'Отметьтесь в ней: «У меня тоже»', {
          duplicateOf: created.incident.publicId,
        });
      }
      return { status: 201, body: await detail(viewer, created.incident.id) };
    }),
  );

  registerApiRoute(app, deps, 'getIncident', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc } = await load(viewer, params.id);
    return { status: 200, body: await detail(viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'joinIncident', async ({ principal, params, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc, house: h } = await load(viewer, params.id);
    assertResident(viewer, h);
    assertOpen(inc);
    assertLocation(h, body.entrance, body.floor);
    const joined = await joinIncident(ctx, {
      incident: inc,
      userId: principal.userId,
      entrance: body.entrance ?? null,
      floor: body.floor ?? null,
      preferExplicit: true,
      source: principal.kind === 'checker' ? 'api' : 'miniapp',
      fromHouseChat: false,
    });
    return { status: 200, body: { ...(await detail(viewer, inc.id)), joinResult: joined.result } };
  });

  registerApiRoute(app, deps, 'leaveIncident', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc, house: h } = await load(viewer, params.id);
    assertResident(viewer, h);
    assertOpen(inc);
    await markNotAffected(ctx, { incident: inc, userId: principal.userId, source: principal.kind === 'checker' ? 'api' : 'miniapp' });
    return { status: 200, body: await detail(viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'registerAds', async ({ principal, params, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc, house: h } = await load(viewer, params.id);
    assertResident(viewer, h);
    assertOpen(inc);
    const source = principal.kind === 'checker' ? 'api' : 'miniapp';
    if (inc.status === 'checking' || inc.status === 'discrepancy') {
      // После «Устранено» — повторное сообщение в АДС (п. 108): номер и время у участника.
      if (body.number === undefined) {
        throw new ApiError(400, 'validation_error', 'Неверный формат запроса', 'После «Устранено» нужен номер повторного сообщения в АДС');
      }
      const now = ctx.clock.now();
      const at = body.registeredAt ? new Date(body.registeredAt) : now;
      if (checkStartedAt(at, now, startedChecks) === 'future') throw new ApiError(422, 'registered_at_in_future', 'Время регистрации ещё не наступило');
      const saved = await rereportAds(ctx, { incidentId: inc.id, userId: principal.userId, number: body.number, at, source });
      if (saved === 'not_checking') throw new ApiError(409, 'invalid_transition', 'Сначала ответьте на вопрос о восстановлении');
      return { status: 200, body: await detail(viewer, inc.id) };
    }
    if (body.number === undefined && body.notReached !== true && body.remindLater !== true) {
      throw new ApiError(400, 'validation_error', 'Неверный формат запроса', 'Нужен number, notReached или remindLater');
    }
    if (body.number !== undefined) {
      const now = ctx.clock.now();
      const registeredAt = body.registeredAt ? new Date(body.registeredAt) : now;
      if (checkStartedAt(registeredAt, now, startedChecks) === 'future') {
        throw new ApiError(422, 'registered_at_in_future', 'Время регистрации ещё не наступило');
      }
      const result = await registerAds(ctx, { incident: inc, userId: principal.userId, number: body.number, registeredAt, source });
      if (result === 'too_late') {
        throw new ApiError(409, 'invalid_transition', 'УК уже отметила устранение', 'Если услуги нет — ответьте «Нет» на вопрос о восстановлении');
      }
    } else if (body.notReached === true) {
      await adsNotReached(ctx, { incident: inc, userId: principal.userId, source });
    } else {
      await scheduleAdsReminder(ctx, inc.id, principal.userId);
    }
    return { status: 200, body: await detail(viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'postObservation', async ({ principal, params, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc, house: h } = await load(viewer, params.id);
    assertResident(viewer, h);
    const source = principal.kind === 'checker' ? 'api' : 'miniapp';
    if (body.kind === 'brigade_confirmed' || body.kind === 'brigade_absent') {
      const saved = await observeBrigade(ctx, { incidentId: inc.id, userId: principal.userId, seen: body.kind === 'brigade_confirmed', source });
      if (saved === 'not_applicable') throw new ApiError(409, 'invalid_transition', 'Отметка о бригаде — только в статусе «Бригада на месте»');
    } else {
      const answer = body.kind === 'restored_yes' ? 'yes' : body.kind === 'restored_no' ? 'no' : 'weak';
      if (body.viaAds && answer !== 'yes') {
        throw new ApiError(400, 'validation_error', 'Неверный формат запроса', 'viaAds — только для restored_yes');
      }
      const viaAds = body.viaAds
        ? { ...(body.viaAds.number ? { number: body.viaAds.number } : {}), ...(body.viaAds.at ? { at: new Date(body.viaAds.at) } : {}) }
        : undefined;
      const saved = await answerCheck(ctx, { incidentId: inc.id, userId: principal.userId, answer, ...(viaAds ? { viaAds } : {}), source, fromHouseChat: false });
      if (saved.status === 'not_checking') throw new ApiError(409, 'invalid_transition', 'Проверка ещё не началась или уже завершена');
    }
    return { status: 200, body: await detail(viewer, inc.id) };
  });

  registerApiRoute(app, deps, 'getIncidentResult', async ({ principal, params }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc, house: h } = await load(viewer, params.id);
    if (inc.status !== 'closed') throw new ApiError(409, 'incident_not_closed', 'Итог будет после закрытия аварии');
    const bundle = await loadIncidentBundle(ctx.db, inc.id);
    if (!bundle) throw notFound('Авария не найдена');
    return { status: 200, body: await resultView(ctx.db, bundle, incidentViewer(viewer, h), ctx.i18n, ctx.clock.now()) };
  });

  registerApiRoute(
    app,
    deps,
    'recalculate',
    async ({ principal, params, headers, body }) =>
      withIdempotency(ctx, principal, `recalculate:${params.id}`, headers['idempotency-key'], async () => {
        const viewer = await loadViewer(ctx.db, principal);
        const { inc, house: h } = await load(viewer, params.id);
        const residency = assertResident(viewer, h);
        if (inc.status !== 'closed' && inc.status !== 'checking' && inc.status !== 'discrepancy') {
          throw new ApiError(409, 'incident_not_closed', 'Расчёт — после отметки УК «Устранено»');
        }
        const bundle = await loadIncidentBundle(ctx.db, inc.id);
        if (!bundle) throw notFound('Авария не найдена');
        const result = await recalcForFlat(ctx.db, bundle, residency, body.monthlyCharge, ctx.i18n, ctx.clock.now());
        if (result === 'monthly_charge_invalid') throw monthlyChargeInvalid();
        return { status: 200, body: result };
      }),
    { bodyError: monthlyChargeInvalid },
  );

  registerApiRoute(app, deps, 'sendApplicationToDm', async ({ principal, params, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { house: h } = await load(viewer, params.id);
    assertResident(viewer, h);
    const result = await sendStatementToDm(ctx, principal.userId, body.text);
    switch (result) {
      case 'sent':
        return { status: 200, body: { sent: true } };
      case 'dialog_not_started':
        throw new ApiError(409, 'dialog_not_started', 'Бот пока не может написать вам', 'Откройте бота и нажмите «Старт»', {
          botLink: botLink(config.max.botUsername),
        });
      case 'text_too_long':
        throw new ApiError(422, 'text_too_long', 'Текст длиннее одного сообщения MAX');
      case 'max_unavailable':
        throw new ApiError(502, 'max_unavailable', 'MAX не ответил', 'Скопируйте текст заявления');
    }
  });

  registerApiRoute(app, deps, 'patchParticipation', async ({ principal, params, body }) => {
    const viewer = await loadViewer(ctx.db, principal);
    const { inc } = await load(viewer, params.id);
    const updated = await ctx.db
      .update(incidentParticipant)
      .set({ notify: body.notify })
      .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.userId, principal.userId)))
      .returning({ notify: incidentParticipant.notify });
    if (updated.length === 0) throw notFound('Вы не отмечались в этой аварии');
    return { status: 200, body: { notify: body.notify } };
  });
}
