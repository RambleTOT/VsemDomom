/**
 * Регистрация в личке (F10, уровень 0): согласие на обработку ПДн → дом → роль в квартире →
 * квартира в диапазоне дома. Состояние — в БД (max_user.dialog_state), любой шаг прерывается
 * командой /menu или кнопкой «Отмена» без потери регистрации.
 */
import {
  decodeBotStart,
  isFlatInRange,
  isOneOf,
  renderAnsweredStep,
  renderAskFlat,
  renderAskRole,
  renderChooseHouse,
  renderFlatError,
  renderMenu,
  renderText,
  renderUnregisteredMenu,
  renderWelcome,
  renderWelcomeAgreed,
  RESIDENCY_ROLE_I18N_KEY,
  RESIDENCY_ROLES,
  type ResidencySource,
} from '@vsemdomom/core';
import { eq } from 'drizzle-orm';
import { PARAMS } from '../config/params.ts';
import { maxUser } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { activeDialogState, answerDmPrompt, sendDm, setDialogState } from './dm.ts';
import { saveResidency } from '../services/residency.ts';
import { chatOfHouse, dmHouse, houseByPublicId, listResidentialHouses, residenciesOf, userById, type HouseRow } from '../db/queries.ts';
import type { CallbackHandler, CallbackReply, DialogState, UpdateMeta } from './types.ts';

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
  // Незарегистрированный посреди регистрации: черновик не сбрасываем — «Продолжить регистрацию» вернёт на тот же шаг.
  const draft = first ? null : await currentState(ctx, userId);
  const resume = draft?.flow === 'registration' && draft.step !== 'consent';
  const message = first
    ? renderMenu(
        {
          house: dmHouse(first.house),
          flatNo: first.residency.flatNo,
          botUsername: ctx.config.max.botUsername,
          joinChatLink: options.joinChatLink ?? null,
          justRegistered: options.justRegistered ?? false,
          trustReset: options.trustReset ?? false,
          noChat: (await chatOfHouse(ctx.db, first.house.id)) === null,
        },
        ctx.i18n,
      )
    : renderUnregisteredMenu(ctx.i18n, resume);
  await ctx.db.transaction(async (tx) => {
    if (!resume) await setDialogState(tx, ctx, userId, null);
    await sendDm(tx, ctx, userId, message, key);
  });
}

/** Продолжить начатую регистрацию с того же шага: дом, роль или квартира. false — продолжать нечего. */
async function resumeRegistration(ctx: JobContext, userId: number, key: string): Promise<boolean> {
  const state = await currentState(ctx, userId);
  if (state?.flow !== 'registration') return false;
  if (state.step === 'house') {
    const houses = await listResidentialHouses(ctx.db);
    await ctx.db.transaction(async (tx) => sendDm(tx, ctx, userId, renderChooseHouse(houses.map(dmHouse), ctx.i18n), key));
    return true;
  }
  const h = await residentialHouse(ctx, state.houseId);
  if (!h) return false;
  if (state.step === 'role') {
    await ctx.db.transaction(async (tx) => sendDm(tx, ctx, userId, renderAskRole(ctx.i18n), key));
    return true;
  }
  if (state.step === 'flat' && state.role) {
    await ctx.db.transaction(async (tx) => {
      await setDialogState(tx, ctx, userId, { ...state, promptKey: key });
      await sendDm(tx, ctx, userId, renderAskFlat(dmHouse(h), ctx.i18n), key);
    });
    return true;
  }
  return false;
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
  if (await resumeRegistration(ctx, userId, meta.dedupeKey)) return;
  await nextAfterConsent(ctx, userId, null, source, meta.dedupeKey);
}

// ---------- нажатия ----------

const answered = (ctx: JobContext) => ctx.i18n.t('bot.answer.ok');

/** Нажатие принято: сообщение шага становится «вопрос — ответ» без кнопок. */
const answeredStep = (ctx: JobContext, question: string, answer: string, footer: string | null = null): CallbackReply => ({
  notification: answered(ctx),
  message: renderAnsweredStep(question, answer, footer),
});

export const onConsent: CallbackHandler = async (e, ctx) => {
  const state = await currentState(ctx, e.userId);
  await ctx.db
    .update(maxUser)
    .set({ consentVersion: PARAMS.consentVersion, consentAt: ctx.clock.now(), deletedAt: null })
    .where(eq(maxUser.id, e.userId));
  const reg = state?.flow === 'registration' ? state : null;
  await nextAfterConsent(ctx, e.userId, reg?.houseId ?? null, reg?.source ?? 'dm', e.meta.dedupeKey);
  return { notification: answered(ctx), message: renderWelcomeAgreed({ privacyUrl: privacyUrl(ctx) }, ctx.i18n) };
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
  return answeredStep(ctx, ctx.i18n.t('bot.dm.house.choose'), ctx.i18n.t('bot.dm.house.btn', { house: h.label, address: h.address }), h.isModel ? ctx.i18n.t('bot.footer') : null);
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
    await setDialogState(tx, ctx, e.userId, { ...state, step: 'flat', role, promptKey: e.meta.dedupeKey });
    await sendDm(tx, ctx, e.userId, renderAskFlat(dmHouse(h), ctx.i18n), e.meta.dedupeKey);
  });
  // В ответе — полное название роли («Снимаю квартиру»), а не короткая подпись кнопки.
  return answeredStep(ctx, ctx.i18n.t('bot.dm.role'), ctx.i18n.t(`role.${RESIDENCY_ROLE_I18N_KEY[role]}`));
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
  // «Отмена» есть только на сообщениях-шагах: шаг становится «Отменили» без кнопок.
  const key = state?.flow === 'registration' ? 'bot.dm.cancelled' : 'bot.answer.cancelled';
  return { notification: ctx.i18n.t(key), message: renderText(key, ctx.i18n) };
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
  const saved = await saveResidency(ctx, { userId, house: h, flatNo, role: state.role, source: state.source });
  if (!saved.ok) return true;
  if (state.promptKey) await answerDmPrompt(ctx, userId, state.promptKey, renderAnsweredStep(ctx.i18n.t('bot.dm.flat.label'), String(flatNo)));
  const { trustReset } = saved;
  const membership = { inChat: saved.inChat };
  const chat = await chatOfHouse(ctx.db, h.id);
  const joinChatLink = ctx.config.features.joinChat && membership.inChat !== true && chat?.inviteLink ? chat.inviteLink : null;
  await sendMenu(ctx, userId, meta.dedupeKey, { justRegistered: true, trustReset, joinChatLink, houseId: h.id });
  return true;
}
