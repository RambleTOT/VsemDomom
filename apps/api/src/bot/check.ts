/**
 * Кнопки проверки в чате дома: ответ на вопрос о восстановлении (C03) и «Подтверждаю» / «Бригады нет»
 * (F06); в личке — «Я сообщил в АДС» из инструкции «Воды нет — что делать».
 */
import { isOneOf, renderText, RESTORED_ANSWERS } from '@vsemdomom/core';
import { and, eq } from 'drizzle-orm';
import { chatOfHouse, userById } from '../db/queries.ts';
import { incidentParticipant } from '../db/schema.ts';
import { observeBrigade } from '../services/brigade.ts';
import { answerCheck } from '../services/check.ts';
import { incidentByPublicId } from '../services/incidents.ts';
import { sendDm, setDialogState } from './dm.ts';
import type { CallbackHandler } from './types.ts';

export const onRestore: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  const answer = e.payload.arg;
  if (!inc || !isOneOf(RESTORED_ANSWERS, answer)) return ctx.i18n.t('bot.answer.expired');
  const chat = await chatOfHouse(ctx.db, inc.houseId);
  const saved = await answerCheck(ctx, { incidentId: inc.id, userId: e.userId, answer, source: 'bot', fromHouseChat: chat?.chatId === e.chatId });
  if (saved.status === 'not_checking') return ctx.i18n.t('bot.answer.check_closed');
  if (answer !== 'no') return ctx.i18n.t('restore.answer.saved');
  return ctx.i18n.t(saved.instructed ? 'restore.answer.no_saved' : 'restore.answer.no_saved.no_dialog');
};

const brigade =
  (seen: boolean): CallbackHandler =>
  async (e, ctx) => {
    const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
    if (!inc) return ctx.i18n.t('bot.answer.expired');
    const saved = await observeBrigade(ctx, { incidentId: inc.id, userId: e.userId, seen, source: 'bot' });
    if (saved === 'not_applicable') return ctx.i18n.t('bot.answer.expired');
    return ctx.i18n.t(seen ? 'brigade.confirmed' : 'brigade.none.saved');
  };

export const onCrewYes = brigade(true);
export const onCrewNo = brigade(false);

/** «Я сообщил в АДС» после «Нет»: номер повторного сообщения — следующим сообщением. */
export const onAdsAgain: CallbackHandler = async (e, ctx) => {
  const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
  if (!inc) return ctx.i18n.t('bot.answer.expired');
  const [p] = await ctx.db
    .select({ id: incidentParticipant.id })
    .from(incidentParticipant)
    .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.userId, e.userId)));
  const user = await userById(ctx.db, e.userId);
  if (!p || !user) return ctx.i18n.t('bot.answer.expired');
  await ctx.db.transaction(async (tx) => {
    await setDialogState(tx, ctx, e.userId, { flow: 'ads', incidentId: inc.publicId, kind: 'rereport' });
    await sendDm(tx, ctx, e.userId, renderText('bot.dm.ads.rereport.ask', ctx.i18n), e.meta.dedupeKey);
  });
  return ctx.i18n.t('bot.answer.ok');
};
