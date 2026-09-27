/**
 * Сборка бота для worker: обработчики событий MAX и задач очередей, которые шлют
 * сообщения и правят панель. Функции следующих задач добавляют свои нажатия и шаги диалога.
 */
import { cardJob } from '../chat/card.ts';
import { panelJob, type PanelJob } from '../chat/panel.ts';
import { sendOutbound } from '../jobs/outbound.ts';
import { baseHandlers, mergeHandlers, type UpdateHandlers } from '../jobs/process-update.ts';
import { QUEUES } from '../jobs/queue.ts';
import type { JobHandlers } from '../jobs/runtime.ts';
import type { CallbackAnswerJob } from './dm.ts';
import { onJoin, onNotMe } from './incident.ts';
import {
  adsReminderJob,
  onAdsFail,
  onAdsNumber,
  onAdsNumberInput,
  onReportService,
  onReportTimeInput,
  onReportWhen,
  onReportWhere,
  startReport,
} from './report.ts';
import { answerCallbackJob, createBotHandlers, registrationCallbacks, type BotRouting } from './router.ts';

export const botRouting: BotRouting = {
  callbacks: {
    ...registrationCallbacks,
    join: onJoin,
    notme: onNotMe,
    rep_service: onReportService,
    rep_when: onReportWhen,
    rep_where: onReportWhere,
    ads_number: onAdsNumber,
    ads_fail: onAdsFail,
  },
  dialogInputs: [onReportTimeInput, onAdsNumberInput],
  onReportCommand: (ctx, userId, meta) => startReport(ctx, userId, null, meta),
};

/** Порядок важен: сначала отметка «диалог открыт», затем сценарий. */
export const botUpdateHandlers: UpdateHandlers = mergeHandlers(baseHandlers, createBotHandlers(botRouting));

export const botJobHandlers: JobHandlers = {
  [QUEUES.outbound]: (data: { id: number }, ctx) => sendOutbound(ctx, data),
  [QUEUES.callbackAnswer]: (data: CallbackAnswerJob, ctx) => answerCallbackJob(ctx, data),
  [QUEUES.panelRender]: (data: PanelJob, ctx) => panelJob(ctx, data),
  [QUEUES.cardRender]: (data: { incidentId: number }, ctx) => cardJob(ctx, data),
  [QUEUES.adsReminder]: (data: { incidentId: number; userId: number }, ctx) => adsReminderJob(ctx, data),
};
