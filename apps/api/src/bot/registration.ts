/**
 * Регистрация в личке (F10, уровень 0): согласие на обработку ПДн → дом → роль в квартире →
 * квартира в диапазоне дома. Состояние — в БД (max_user.dialog_state), любой шаг прерывается
 * командой /menu или кнопкой «Отмена» без потери регистрации.
 */
import {
  decodeBotStart,
  isFlatInRange,
  isOneOf,
  renderAskFlat,
  renderAskRole,
  renderChooseHouse,
  renderFlatError,
  renderMenu,
  renderText,
  renderUnregisteredMenu,
  renderWelcome,
  RESIDENCY_ROLES,
  type ResidencySource,
} from '@vsemdomom/core';
import { and, eq } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { maxUser, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { activeDialogState, sendDm, setDialogState } from './dm.ts';
import { refreshMembership } from './membership.ts';
import { chatOfHouse, dmHouse, houseByPublicId, listResidentialHouses, residenciesOf, residencyIn, userById, type HouseRow } from './queries.ts';
import type { CallbackHandler, DialogState, UpdateMeta } from './types.ts';

export function privacyUrl(ctx: JobContext): string {
  return `${ctx.config.publicBaseUrl}/privacy`;
}

function consented(user: { consentVersion: string | null } | null): boolean {
  return user?.consentVersion === PARAMS.consentVersion;
}

async function residentialHouse(ctx: JobContext, publicId: string | null): Promise<HouseRow | null> {
  if (!publicId) return null;
  const h = await houseByPublicId(ctx.db, publicId);
  return h && !h.isSandbox ? h : null;
}

/** Главное меню: зарегистрированному — дом и кнопки, иначе — предложение зарегистрироваться. */
export async function sendMenu(
  ctx: JobContext,
  userId: number,
  key: string,
  options: { justRegistered?: boolean; trustReset?: boolean; joinChatLink?: string | null; houseId?: number } = {},
): Promise<void> {
  const list = await residenciesOf(ctx.db, userId);
  const first = list.find((r) => r.house.id === options.houseId) ?? list[0];
  const message = first
    ? renderMenu(
        {
          house: dmHouse(first.house),
          flatNo: first.residency.flatNo,
          botUsername: ctx.config.max.botUsername,
          joinChatLink: options.joinChatLink ?? null,
          justRegistered: options.justRegistered ?? false,
          trustReset: options.trustReset ?? false,
        },
        ctx.i18n,
      )
    : renderUnregisteredMenu(ctx.i18n);
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, userId, null);
    await sendDm(tx, ctx, userId, message, key);
  });
}

/** Следующий шаг регистрации после согласия: дом известен — роль, иначе — выбор дома. */
async function nextAfterConsent(ctx: JobContext, userId: number, houseId: string | null, source: ResidencySource, key: string): Promise<void> {
  const h = await residentialHouse(ctx, houseId);
  if (h) {
    await ctx.db.transaction(async (tx) => {
      await setDialogState(tx, ctx, userId, { flow: 'registration', step: 'role', houseId: h.publicId, role: null, source });
      await sendDm(tx, ctx, userId, renderAskRole(ctx.i18n), key);
    });
    return;
  }
  const houses = await listResidentialHouses(ctx.db);
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, userId, { flow: 'registration', step: 'house', houseId: null, role: null, source });
    await sendDm(tx, ctx, userId, renderChooseHouse(houses.map(dmHouse), ctx.i18n), key);
  });
}

/** bot_started и /start: приветствие и согласие, продолжение регистрации или меню. */
export async function startDialog(ctx: JobContext, userId: number, startPayload: string | null | undefined, meta: UpdateMeta): Promise<void> {
  const user = await userById(ctx.db, userId);
  const fromQr = decodeBotStart(startPayload);
  const qrHouse = await residentialHouse(ctx, fromQr?.houseId ?? null);
  const list = await residenciesOf(ctx.db, userId);
  const source: ResidencySource = qrHouse ? 'qr' : 'dm';
  if (!consented(user)) {
    await ctx.db.transaction(async (tx) => {
      await setDialogState(tx, ctx, userId, { flow: 'registration', step: 'consent', houseId: qrHouse?.publicId ?? null, role: null, source });
      await sendDm(tx, ctx, userId, renderWelcome({ privacyUrl: privacyUrl(ctx) }, ctx.i18n), meta.dedupeKey);
    });
    return;
  }
  if (qrHouse && !list.some((r) => r.house.id === qrHouse.id)) {
    await nextAfterConsent(ctx, userId, qrHouse.publicId, 'qr', meta.dedupeKey);
    return;
  }
  if (list.length > 0) {
    await sendMenu(ctx, userId, meta.dedupeKey);
    return;
  }
  await nextAfterConsent(ctx, userId, null, source, meta.dedupeKey);
}

// ---------- нажатия ----------

const answered = (ctx: JobContext) => ctx.i18n.t('bot.answer.ok');

export const onConsent: CallbackHandler = async (e, ctx) => {
  const state = await currentState(ctx, e.userId);
  await ctx.db
    .update(maxUser)
    .set({ consentVersion: PARAMS.consentVersion, consentAt: ctx.clock.now(), deletedAt: null })
    .where(eq(maxUser.id, e.userId));
  const reg = state?.flow === 'registration' ? state : null;
  await nextAfterConsent(ctx, e.userId, reg?.houseId ?? null, reg?.source ?? 'dm', e.meta.dedupeKey);
  return answered(ctx);
};

export const onHouseChosen: CallbackHandler = async (e, ctx) => {
  const user = await userById(ctx.db, e.userId);
  if (!consented(user)) {
    await startDialog(ctx, e.userId, null, e.meta);
    return answered(ctx);
  }
  const h = await residentialHouse(ctx, e.payload.id);
  if (!h) {
    await ctx.db.transaction(async (tx) => sendDm(tx, ctx, e.userId, renderText('bot.dm.house.none', ctx.i18n), e.meta.dedupeKey));
    return answered(ctx);
  }
  const state = await currentState(ctx, e.userId);
  await nextAfterConsent(ctx, e.userId, h.publicId, state?.flow === 'registration' ? state.source : 'dm', e.meta.dedupeKey);
  return answered(ctx);
};

export const onRoleChosen: CallbackHandler = async (e, ctx) => {
  const state = await currentState(ctx, e.userId);
  const role = e.payload.arg;
  if (state?.flow !== 'registration' || !state.houseId || !isOneOf(RESIDENCY_ROLES, role)) {
    await startDialog(ctx, e.userId, null, e.meta);
    return answered(ctx);
  }
  const h = await residentialHouse(ctx, state.houseId);
  if (!h) {
    await startDialog(ctx, e.userId, null, e.meta);
    return answered(ctx);
  }
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, e.userId, { ...state, step: 'flat', role });
    await sendDm(tx, ctx, e.userId, renderAskFlat(dmHouse(h), ctx.i18n), e.meta.dedupeKey);
  });
  return answered(ctx);
};

/** «Отмена» и «Главное меню»; menu:register — начать регистрацию. */
export const onMenu: CallbackHandler = async (e, ctx) => {
  if (e.payload.action === 'menu' && e.payload.arg === 'register') {
    await startDialog(ctx, e.userId, null, e.meta);
    return answered(ctx);
  }
  const state = await currentState(ctx, e.userId);
  await sendMenu(ctx, e.userId, e.meta.dedupeKey);
  if (e.payload.action !== 'cancel') return answered(ctx);
  return ctx.i18n.t(state?.flow === 'registration' ? 'bot.dm.cancelled' : 'bot.answer.cancelled');
};

async function currentState(ctx: JobContext, userId: number): Promise<DialogState | null> {
  const user = await userById(ctx.db, userId);
  return user ? activeDialogState(user, ctx.clock.now(), PARAMS.dialogDraftTtlHours) : null;
}

// ---------- ввод квартиры ----------

const FLAT_INPUT = /^\s*(\d{1,5})\s*$/;

/** Номер квартиры текстом на шаге flat. true — сообщение обработано. */
export async function onFlatInput(ctx: JobContext, userId: number, text: string, meta: UpdateMeta): Promise<boolean> {
  const state = await currentState(ctx, userId);
  if (state?.flow !== 'registration' || state.step !== 'flat' || !state.houseId || !state.role) return false;
  const h = await residentialHouse(ctx, state.houseId);
  if (!h) return false;
  const match = FLAT_INPUT.exec(text);
  const flatNo = match ? Number(match[1]) : Number.NaN;
  if (!isFlatInRange(h, flatNo)) {
    await ctx.db.transaction(async (tx) => sendDm(tx, ctx, userId, renderFlatError(dmHouse(h), ctx.i18n), meta.dedupeKey));
    return true;
  }
  const role = state.role;
  const existing = await residencyIn(ctx.db, userId, h.id);
  // Одна учётная запись MAX — одна квартира в доме; смена квартиры сбрасывает уровень доверия.
  const trustReset = existing !== null && existing.flatNo !== flatNo && existing.trustLevel > 0;
  if (existing) {
    await ctx.db
      .update(residency)
      .set({
        flatNo,
        role,
        updatedAt: ctx.clock.now(),
        ...(existing.flatNo !== flatNo ? { trustLevel: 0, reviewStatus: 'pending' as const, confirmedAt: null, confirmedBy: null, membershipCheckedAt: null } : {}),
      })
      .where(and(eq(residency.id, existing.id)));
  } else {
    await ctx.db.insert(residency).values({ userId, houseId: h.id, flatNo, role, trustLevel: 0, source: state.source });
  }
  const row = await residencyIn(ctx.db, userId, h.id);
  const membership = row ? await refreshMembership(ctx, row, { force: true }) : { inChat: null };
  const chat = await chatOfHouse(ctx.db, h.id);
  const joinChatLink = ctx.config.features.joinChat && membership.inChat !== true && chat?.inviteLink ? chat.inviteLink : null;
  await sendMenu(ctx, userId, meta.dedupeKey, { justRegistered: true, trustReset, joinChatLink, houseId: h.id });
  return true;
}
