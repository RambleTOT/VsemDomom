/**
 * Кнопки карточки в чате дома (F02, F03): подъезд = «У меня тоже» + подъезд, «Не знаю подъезд»,
 * «Не у меня». Нажавшему — личное уведомление (POST /answers); текст зависит от того,
 * начинал ли он диалог с ботом.
 */
import { botLink, isOpenStatus, serviceOk } from '@vsemdomom/core';
import { and, eq } from 'drizzle-orm';
import { incidentParticipant } from '../db/schema.ts';
import { joinIncident, incidentByPublicId, markNotAffected } from '../services/incidents.ts';
import { chatOfHouse } from '../db/queries.ts';
import type { CallbackHandler } from './types.ts';

const ENTRANCE_ARG = /^[1-9]\d{0,2}$/;

export const onJoin: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!inc) return ctx.i18n.t('bot.answer.expired');
  if (!isOpenStatus(inc.status)) return ctx.i18n.t('bot.answer.closed');
  const entrance = e.payload.arg && ENTRANCE_ARG.test(e.payload.arg) ? Number(e.payload.arg) : null;
  const chat = await chatOfHouse(ctx.db, inc.houseId);
  const r = await joinIncident(ctx, { incident: inc, userId: e.userId, entrance, source: 'bot', fromHouseChat: chat?.chatId === e.chatId });
  if (r.result === 'already_joined') return ctx.i18n.t('bot.answer.already');
  if (r.entrance === null) return ctx.i18n.t('bot.answer.joined_no_entrance');
  return r.dialogActive
    ? ctx.i18n.t('bot.answer.joined', { entrance: r.entrance })
    : ctx.i18n.t('bot.answer.joined_unregistered', { entrance: r.entrance, bot_link: botLink(ctx.config.max.botUsername) });
};

export const onNotMe: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!inc) return ctx.i18n.t('bot.answer.expired');
  if (!isOpenStatus(inc.status)) return ctx.i18n.t('bot.answer.closed');
  await markNotAffected(ctx, { incident: inc, userId: e.userId, source: 'bot' });
  return ctx.i18n.t('bot.answer.not_me', { service_ok: serviceOk(ctx.i18n, inc.serviceType) });
};

/** «Не присылать» в личном уведомлении: выключить «Уведомлять меня» по этой аварии. */
export const onMute: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!inc) return ctx.i18n.t('bot.answer.expired');
  await ctx.db
    .update(incidentParticipant)
    .set({ notify: false })
    .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.userId, e.userId)));
  return ctx.i18n.t('bot.answer.muted');
};
