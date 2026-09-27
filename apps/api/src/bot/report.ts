/**
 * «Сообщить об аварии» в личке (F01): что → с какого времени → где → авария создана
 * (или житель отмечен в уже открытой) → инструкция АДС. Номер заявки — отдельным шагом;
 * пропустил — одно напоминание через 30 минут, если диалог с ботом начат.
 */
import {
  checkStartedAt,
  INCIDENT_SCOPES,
  isOneOf,
  parseLocalDateTime,
  renderAdsNumberError,
  renderAdsReminder,
  renderAskAdsNumber,
  renderReportAskTime,
  renderReportConfirmOld,
  renderReportDone,
  renderReportTimeError,
  renderReportWhat,
  renderReportWhen,
  renderReportWhere,
  renderText,
  SERVICE_TYPES,
  startedAtFromPreset,
  STARTED_PRESETS,
  type AdsBlockInput,
  type ReportOutcome,
  type ServiceType,
  type StartedPreset,
} from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { house, incident, managementCompany } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import {
  adsNotReached,
  createIncident,
  incidentByPublicId,
  joinIncident,
  registerAds,
  scheduleAdsReminder,
  type IncidentRow,
} from '../services/incidents.ts';
import { activeDialogState, sendDm, setDialogState } from './dm.ts';
import { chatOfHouse, residenciesOf, userById, type HouseRow, type ResidencyRow } from './queries.ts';
import { sendMenu } from './registration.ts';
import type { CallbackHandler, DialogState, UpdateMeta } from './types.ts';

type ReportState = Extract<DialogState, { flow: 'report' }>;
type Step = 'what' | 'when' | 'when_custom' | 'confirm_old' | 'where';

const MS_PER_SECOND = 1000;
const MS_PER_HOUR = 3_600_000;

async function state(ctx: JobContext, userId: number): Promise<DialogState | null> {
  const user = await userById(ctx.db, userId);
  return user ? activeDialogState(user, ctx.clock.now(), PARAMS.dialogDraftTtlHours) : null;
}

async function reportState(ctx: JobContext, userId: number, step?: Step): Promise<ReportState | null> {
  const s = await state(ctx, userId);
  if (s?.flow !== 'report') return null;
  return step === undefined || s.step === step ? s : null;
}

/** Дом, в котором житель зарегистрирован (по коду или первый). */
async function reporterHouse(ctx: JobContext, userId: number, housePublicId: string | null): Promise<{ house: HouseRow; residency: ResidencyRow } | null> {
  const list = await residenciesOf(ctx.db, userId);
  const found = housePublicId ? list.find((r) => r.house.publicId === housePublicId) : list[0];
  return found ?? null;
}

async function step(ctx: JobContext, userId: number, next: ReportState, message: Parameters<typeof sendDm>[3], key: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, userId, next);
    await sendDm(tx, ctx, userId, message, key);
  });
}

const ok = (ctx: JobContext) => ctx.i18n.t('bot.answer.ok');
const serviceOf = (s: ReportState): ServiceType | null => (isOneOf(SERVICE_TYPES, s.data.service) ? s.data.service : null);

/** /report и «Сообщить об аварии» в меню: шаг «что случилось». */
export async function startReport(ctx: JobContext, userId: number, housePublicId: string | null, meta: UpdateMeta): Promise<void> {
  const r = await reporterHouse(ctx, userId, housePublicId);
  if (!r) {
    await sendMenu(ctx, userId, meta.dedupeKey);
    return;
  }
  await step(ctx, userId, { flow: 'report', step: 'what', houseId: r.house.publicId, data: {} }, renderReportWhat(r.house.publicId, ctx.i18n), meta.dedupeKey);
}

export const onReportService: CallbackHandler = async (e, ctx) => {
  const service = e.payload.arg;
  const r = await reporterHouse(ctx, e.userId, e.payload.id);
  if (!r || !isOneOf(SERVICE_TYPES, service)) {
    await startReport(ctx, e.userId, e.payload.id, e.meta);
    return ok(ctx);
  }
  await step(
    ctx,
    e.userId,
    { flow: 'report', step: 'when', houseId: r.house.publicId, data: { service } },
    renderReportWhen({ housePublicId: r.house.publicId, service }, ctx.i18n),
    e.meta.dedupeKey,
  );
  return ok(ctx);
};

async function toWhere(ctx: JobContext, userId: number, s: ReportState, startedAt: Date, source: StartedPreset, key: string): Promise<void> {
  const service = serviceOf(s);
  if (!service) {
    await startReport(ctx, userId, s.houseId, { dedupeKey: key });
    return;
  }
  await step(
    ctx,
    userId,
    { ...s, step: 'where', data: { ...s.data, startedAt: startedAt.toISOString(), startedSource: source } },
    renderReportWhere({ housePublicId: s.houseId, service }, ctx.i18n),
    key,
  );
}

const startedChecks = () => ({ futureSkewMs: PARAMS.startedAtFutureSkewSec * MS_PER_SECOND, confirmOldAfterMs: PARAMS.oldStartConfirmHours * MS_PER_HOUR });

export const onReportWhen: CallbackHandler = async (e, ctx) => {
  const s = await reportState(ctx, e.userId);
  const arg = e.payload.arg;
  if (!s || s.houseId !== e.payload.id || !serviceOf(s)) {
    await startReport(ctx, e.userId, e.payload.id, e.meta);
    return ok(ctx);
  }
  if (arg === 'custom') {
    await step(ctx, e.userId, { ...s, step: 'when_custom' }, renderReportAskTime(ctx.i18n), e.meta.dedupeKey);
  } else if (arg === 'old_ok' && s.step === 'confirm_old' && typeof s.data.startedAt === 'string') {
    await toWhere(ctx, e.userId, s, new Date(s.data.startedAt), 'custom', e.meta.dedupeKey);
  } else if (isOneOf(STARTED_PRESETS, arg) && arg !== 'custom') {
    await toWhere(ctx, e.userId, s, startedAtFromPreset(arg, ctx.clock.now()), arg, e.meta.dedupeKey);
  } else {
    await startReport(ctx, e.userId, s.houseId, e.meta);
  }
  return ok(ctx);
};

/** Своё время начала текстом: «17:40» или «26.09 17:40» в поясе дома. */
export async function onReportTimeInput(ctx: JobContext, userId: number, text: string, meta: UpdateMeta): Promise<boolean> {
  const s = await reportState(ctx, userId, 'when_custom');
  if (!s) return false;
  const r = await reporterHouse(ctx, userId, s.houseId);
  if (!r) return false;
  const now = ctx.clock.now();
  const startedAt = parseLocalDateTime(text, now, r.house.timezone);
  const check = startedAt ? checkStartedAt(startedAt, now, startedChecks()) : null;
  if (!startedAt || check === 'future') {
    await ctx.db.transaction(async (tx) => sendDm(tx, ctx, userId, renderReportTimeError(startedAt ? 'future' : 'format', ctx.i18n), meta.dedupeKey));
    return true;
  }
  if (check === 'old') {
    await step(
      ctx,
      userId,
      { ...s, step: 'confirm_old', data: { ...s.data, startedAt: startedAt.toISOString() } },
      renderReportConfirmOld({ housePublicId: s.houseId, startedAt, timezone: r.house.timezone, now }, ctx.i18n),
      meta.dedupeKey,
    );
    return true;
  }
  await toWhere(ctx, userId, s, startedAt, 'custom', meta.dedupeKey);
  return true;
}

async function adsBlock(ctx: JobContext, inc: IncidentRow, flatNo: number): Promise<AdsBlockInput | null> {
  const [row] = await ctx.db
    .select({ house, adsPhone: managementCompany.adsPhone })
    .from(house)
    .innerJoin(managementCompany, eq(managementCompany.id, house.ukId))
    .where(eq(house.id, inc.houseId));
  if (!row) return null;
  return {
    incidentPublicId: inc.publicId,
    service: inc.serviceType,
    startedAt: inc.startedAt,
    house: { address: row.house.address, timezone: row.house.timezone, isModel: row.house.isModel },
    flatNo,
    adsPhone: row.adsPhone,
    telLinks: ctx.config.max.telLinks,
    botUsername: ctx.config.max.botUsername,
    now: ctx.clock.now(),
  };
}

export const onReportWhere: CallbackHandler = async (e, ctx) => {
  const s = await reportState(ctx, e.userId, 'where');
  const scope = e.payload.arg;
  const service = s ? serviceOf(s) : null;
  const r = s ? await reporterHouse(ctx, e.userId, s.houseId) : null;
  if (!s || !service || !r || s.houseId !== e.payload.id || typeof s.data.startedAt !== 'string' || !isOneOf(INCIDENT_SCOPES, scope)) {
    await startReport(ctx, e.userId, e.payload.id, e.meta);
    return ok(ctx);
  }
  const startedSource = isOneOf(STARTED_PRESETS, s.data.startedSource) ? s.data.startedSource : 'custom';
  const created = await createIncident(ctx, {
    house: r.house,
    service,
    scope,
    entrance: null,
    startedAt: new Date(s.data.startedAt),
    startedSource,
    reporter: { userId: e.userId, residency: r.residency },
    source: 'bot',
  });
  let outcome: ReportOutcome;
  if (created.status === 'duplicate') {
    await joinIncident(ctx, { incident: created.incident, userId: e.userId, entrance: null, source: 'bot', fromHouseChat: false });
    outcome = 'joined_existing';
  } else if (scope === 'flat') {
    outcome = 'created_flat';
  } else {
    outcome = (await chatOfHouse(ctx.db, r.house.id)) ? 'created' : 'created_no_chat';
  }
  const inc = created.incident;
  const block = await adsBlock(ctx, inc, r.residency.flatNo);
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, e.userId, null);
    if (block) {
      await sendDm(tx, ctx, e.userId, renderReportDone({ ...block, outcome, adsRegistered: inc.adsRegNumber !== null }, ctx.i18n), e.meta.dedupeKey);
    }
    if (inc.adsRegNumber === null) await scheduleAdsReminder(ctx, inc.id, e.userId, tx);
  });
  return ok(ctx);
};

// ---------- номер заявки АДС ----------

export const onAdsNumber: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!inc) return ctx.i18n.t('bot.answer.expired');
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, e.userId, { flow: 'ads', incidentId: inc.publicId, kind: 'register' });
    await sendDm(tx, ctx, e.userId, renderAskAdsNumber(ctx.i18n), e.meta.dedupeKey);
  });
  return ok(ctx);
};

export const onAdsFail: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!inc) return ctx.i18n.t('bot.answer.expired');
  await adsNotReached(ctx, { incident: inc, userId: e.userId, source: 'bot' });
  return ctx.i18n.t('report.ads.no_answer.saved');
};

/** Номер заявки: буквы, цифры, дефис и косая черта; время регистрации — по желанию. */
const ADS_INPUT = /^\s*([0-9A-Za-zА-Яа-яЁё/-]{1,32})(?:[\s,]+(.+?))?\s*$/;

export async function onAdsNumberInput(ctx: JobContext, userId: number, text: string, meta: UpdateMeta): Promise<boolean> {
  const s = await state(ctx, userId);
  if (s?.flow !== 'ads' || s.kind !== 'register') return false;
  const inc = await incidentByPublicId(ctx.db, s.incidentId);
  if (!inc) return false;
  const [h] = await ctx.db.select().from(house).where(eq(house.id, inc.houseId));
  const now = ctx.clock.now();
  const match = ADS_INPUT.exec(text);
  const number = match?.[1];
  const timeText = match?.[2];
  const at = timeText && h ? parseLocalDateTime(timeText, now, h.timezone) : now;
  const future = at !== null && checkStartedAt(at, now, startedChecks()) === 'future';
  if (!number || !at || future) {
    await ctx.db.transaction(async (tx) => sendDm(tx, ctx, userId, renderAdsNumberError(future ? 'future' : 'format', ctx.i18n), meta.dedupeKey));
    return true;
  }
  const result = await registerAds(ctx, { incident: inc, userId, number, registeredAt: at, source: 'bot' });
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, userId, null);
    await sendDm(tx, ctx, userId, renderText(result === 'too_late' ? 'bot.dm.ads.too_late' : 'report.ads.saved', ctx.i18n), meta.dedupeKey);
  });
  return true;
}

/** Задача ads-reminder: одно напоминание, если номер так и не введён и авария ещё до «Устранено». */
export async function adsReminderJob(ctx: JobContext, data: { incidentId: number; userId: number }): Promise<'sent' | 'skipped'> {
  const [inc] = await ctx.db.select().from(incident).where(eq(incident.id, data.incidentId));
  if (!inc || inc.adsRegNumber !== null || !['open', 'accepted', 'brigade_on_site', 'localized'].includes(inc.status)) return 'skipped';
  const user = await userById(ctx.db, data.userId);
  if (!user?.dialogActive) return 'skipped';
  const r = (await residenciesOf(ctx.db, data.userId)).find((x) => x.house.id === inc.houseId);
  const block = await adsBlock(ctx, inc, r?.residency.flatNo ?? 0);
  if (!block) return 'skipped';
  await ctx.db.transaction(async (tx) => sendDm(tx, ctx, data.userId, renderAdsReminder(block, ctx.i18n), `ads:reminder:${inc.id}`));
  return 'sent';
}
