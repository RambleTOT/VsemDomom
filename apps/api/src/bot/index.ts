/**
 * Сборка бота для worker: обработчики событий MAX и задач очередей, которые шлют
 * сообщения и правят панель. Функции следующих задач добавляют свои нажатия и шаги диалога.
 */
import { sendOutbound } from '../jobs/outbound.ts';
import { baseHandlers, mergeHandlers, type UpdateHandlers } from '../jobs/process-update.ts';
import { QUEUES } from '../jobs/queue.ts';
import type { JobHandlers } from '../jobs/runtime.ts';
import type { CallbackAnswerJob } from './dm.ts';
import { panelJob, type PanelJob } from './panel.ts';
import { answerCallbackJob, createBotHandlers, registrationCallbacks, type BotRouting } from './router.ts';

export const botRouting: BotRouting = {
  callbacks: { ...registrationCallbacks },
  dialogInputs: [],
};

/** Порядок важен: сначала отметка «диалог открыт», затем сценарий. */
export const botUpdateHandlers: UpdateHandlers = mergeHandlers(baseHandlers, createBotHandlers(botRouting));

export const botJobHandlers: JobHandlers = {
  [QUEUES.outbound]: (data: { id: number }, ctx) => sendOutbound(ctx, data),
  [QUEUES.callbackAnswer]: (data: CallbackAnswerJob, ctx) => answerCallbackJob(ctx, data),
  [QUEUES.panelRender]: (data: PanelJob, ctx) => panelJob(ctx, data),
};
