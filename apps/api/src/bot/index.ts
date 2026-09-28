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
import { actTimerJob, type ActJob } from '../services/act.ts';
import { checkTimerJob, type CheckJob } from '../services/check.ts';
import { deadlineJob, type DeadlineJob } from '../services/deadline-timers.ts';
import { demoAnswersJob, type DemoAnswersJob } from '../services/demo-answers.ts';
import { notifyJob, type NotifyJob } from '../services/notify.ts';
import { pollJob, type PollJob } from '../services/polls.ts';
import { onActIntro, onActReady } from './act.ts';
import { onAdsAgain, onCrewNo, onCrewYes, onRestore } from './check.ts';
import type { CallbackAnswerJob } from './dm.ts';
import { onJoin, onMute, onNotMe } from './incident.ts';
import { onHeatEntrance, onHeatPoll, onWaterPoll } from './poll.ts';
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
    mute: onMute,
    restore: onRestore,
    crew_yes: onCrewYes,
    crew_no: onCrewNo,
    ads_again: onAdsAgain,
    act_ready: onActReady,
    act_intro: onActIntro,
    poll: onWaterPoll,
    heat: onHeatPoll,
    heat_ent: onHeatEntrance,
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
  [QUEUES.deadline]: (data: DeadlineJob, ctx) => deadlineJob(ctx, data),
  [QUEUES.notify]: (data: NotifyJob, ctx) => notifyJob(ctx, data),
  [QUEUES.check]: (data: CheckJob, ctx) => checkTimerJob(ctx, data),
  [QUEUES.act]: (data: ActJob, ctx) => actTimerJob(ctx, data),
  [QUEUES.poll]: (data: PollJob, ctx) => pollJob(ctx, data),
  [QUEUES.demo]: (data: DemoAnswersJob, ctx) => demoAnswersJob(ctx, data),
};
