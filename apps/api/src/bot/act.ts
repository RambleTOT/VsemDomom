/** S09 в личке: «Я готов подписать» и «Познакомить с соседями» из предложения акта без исполнителя. */
import { setActReady } from '../services/act.ts';
import { incidentByPublicId } from '../services/incidents.ts';
import type { CallbackHandler } from './types.ts';

const act =
  (intro: boolean): CallbackHandler =>
  async (e, ctx) => {
    const inc = e.payload.id ? await incidentByPublicId(ctx.db, e.payload.id) : null;
    if (!inc) return ctx.i18n.t('bot.answer.expired');
    const saved = await setActReady(ctx, {
      incidentId: inc.id,
      userId: e.userId,
      ready: true,
      ...(intro ? { introOptIn: true } : {}),
      source: 'bot',
      // После «Я готов подписать» следующий шаг — вопрос о знакомстве новым сообщением.
      nextStepDm: !intro,
    });
    if (saved.status !== 'saved') return ctx.i18n.t('bot.answer.act.not_available');
    if (intro) return ctx.i18n.t('bot.answer.act.intro');
    return ctx.i18n.t('bot.answer.act.ready', { count: saved.info.readyCount, neighbours: ctx.i18n.plural(saved.info.readyCount, 'neighbours') });
  };

export const onActReady = act(false);
export const onActIntro = act(true);
