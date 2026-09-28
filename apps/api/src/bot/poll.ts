/** F14: ответы на опросы в чате дома — «Как вода сейчас?», «Тепло ли у вас?» и номер подъезда. */
import { HEAT_POLL_VALUES, isOneOf, WATER_POLL_VALUES } from '@vsemdomom/core';
import { houseById, houseByPublicId } from '../db/queries.ts';
import type { JobContext } from '../jobs/context.ts';
import { incidentByPublicId } from '../services/incidents.ts';
import { answerHeatEntrance, answerPoll, type PollAnswerResult } from '../services/polls.ts';
import { fromHouseChat } from './incident.ts';
import type { CallbackEvent, CallbackHandler } from './types.ts';

function answerText(ctx: JobContext, r: PollAnswerResult, heating: boolean): string {
  if (r.status === 'closed') return ctx.i18n.t('bot.answer.poll.closed');
  if (r.status === 'not_found') return ctx.i18n.t('bot.answer.expired');
  return ctx.i18n.t(heating && r.needEntrance ? 'bot.answer.heat.entrance' : 'bot.answer.poll.saved');
}

/** Дом опроса «Тепло ли у вас?» по payload; кнопки принимаются только из чата этого дома. */
async function heatingHouse(e: CallbackEvent, ctx: JobContext) {
  const h = e.payload.id ? await houseByPublicId(ctx.db, e.payload.id) : null;
  return h && (await fromHouseChat(ctx, h.id, e.chatId)) ? h : null;
}

export const onWaterPoll: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  const value = e.payload.arg;
  if (!inc || !isOneOf(WATER_POLL_VALUES, value) || !(await fromHouseChat(ctx, inc.houseId, e.chatId))) return ctx.i18n.t('bot.answer.expired');
  const h = await houseById(ctx.db, inc.houseId);
  if (!h) return ctx.i18n.t('bot.answer.expired');
  return answerText(ctx, await answerPoll(ctx, { house: h, incidentId: inc.id, type: 'water_quality', userId: e.userId, value }), false);
};

export const onHeatPoll: CallbackHandler = async (e, ctx) => {
  const value = e.payload.arg;
  const h = await heatingHouse(e, ctx);
  if (!h || !isOneOf(HEAT_POLL_VALUES, value)) return ctx.i18n.t('bot.answer.expired');
  return answerText(ctx, await answerPoll(ctx, { house: h, type: 'heating', userId: e.userId, value }), true);
};

export const onHeatEntrance: CallbackHandler = async (e, ctx) => {
  const entrance = Number(e.payload.arg);
  const h = await heatingHouse(e, ctx);
  if (!h) return ctx.i18n.t('bot.answer.expired');
  const saved = await answerHeatEntrance(ctx, { house: h, userId: e.userId, entrance });
  if (saved === 'saved') return ctx.i18n.t('bot.answer.heat.entrance_saved', { entrance });
  if (saved === 'first') return ctx.i18n.t('bot.answer.heat.first');
  return ctx.i18n.t(saved === 'closed' ? 'bot.answer.poll.closed' : 'bot.answer.expired');
};
