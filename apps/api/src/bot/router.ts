/**
 * Маршрутизация событий бота: нажатия кнопок (по действию из payload), текст в личке
 * (команды и шаги диалога), команды в группе и события чатов. Ответ нажавшему ставится
 * в очередь callback-answer в той же транзакции, что и изменения.
 */
import { decodeCallback, renderDeleteConfirm, renderHelp, renderText, type CallbackAction } from '@vsemdomom/core';
import type { JobContext } from '../jobs/context.ts';
import { markDialogStarted, type UpdateHandlers } from '../jobs/process-update.ts';
import { MaxApiError } from '../max/types.ts';
import type { NormalizedUpdate } from '../max/update.ts';
import { deleteUserData } from '../services/user-data.ts';
import { onBotAdded, onBotPermissionsChanged, onBotRemoved, onChatTitleChanged, onConnectCommand } from './binding.ts';
import { answerCallbackLater, sendDm, type CallbackAnswerJob } from './dm.ts';
import { onUserAdded, onUserRemoved } from './membership.ts';
import { onConsent, onFlatInput, onHouseChosen, onMenu, onRoleChosen, sendMenu, startDialog } from './registration.ts';
import type { CallbackEvent, CallbackHandler, UpdateMeta } from './types.ts';

export type CallbackHandlers = Partial<Record<CallbackAction, CallbackHandler>>;

/** Удаление данных: подтверждение и выполнение. */
const onDelete: CallbackHandler = async (e, ctx) => {
  if (e.payload.arg !== 'yes') {
    await sendMenu(ctx, e.userId, e.meta.dedupeKey);
    return ctx.i18n.t('bot.dm.delete.kept');
  }
  await deleteUserData(ctx.db, e.userId, ctx.clock.now());
  await ctx.db.transaction(async (tx) => sendDm(tx, ctx, e.userId, renderText('bot.dm.deleted', ctx.i18n), e.meta.dedupeKey));
  return ctx.i18n.t('bot.answer.ok');
};

export const registrationCallbacks: CallbackHandlers = {
  pdn: onConsent,
  house: onHouseChosen,
  role: onRoleChosen,
  menu: onMenu,
  cancel: onMenu,
  delete: onDelete,
};

/** Текстовые шаги диалогов (регистрация, позже — номер АДС и время аварии). Возвращают true, если обработали. */
export type DialogInput = (ctx: JobContext, userId: number, text: string, meta: UpdateMeta) => Promise<boolean>;

export interface BotRouting {
  callbacks: CallbackHandlers;
  dialogInputs: DialogInput[];
  /** Команда /report — пошаговое сообщение об аварии в личке. */
  onReportCommand?: (ctx: JobContext, userId: number, meta: UpdateMeta) => Promise<void>;
  /** F13: сообщение группы с ключевыми словами. */
  onKeywordHit?: (u: NormalizedUpdate, ctx: JobContext, meta: UpdateMeta) => Promise<void>;
}

async function handleCallback(u: NormalizedUpdate, ctx: JobContext, meta: UpdateMeta, routing: BotRouting): Promise<void> {
  if (!u.callbackId || u.userId === null) return;
  // Нажатие в личке — диалог с ботом открыт (в том числе после /delete или сброса БД).
  if (u.chatType === 'dialog') await markDialogStarted(u, ctx, meta);
  const payload = decodeCallback(u.payload);
  const handler = payload ? routing.callbacks[payload.action] : undefined;
  let notification: string;
  if (!payload || !handler) {
    notification = ctx.i18n.t('bot.answer.expired');
  } else {
    const event: CallbackEvent = { update: u, payload, callbackId: u.callbackId, userId: u.userId, chatId: u.chatId, meta };
    notification = await handler(event, ctx);
  }
  const job: CallbackAnswerJob = { callbackId: u.callbackId, chatId: u.chatId, notification };
  await ctx.db.transaction(async (tx) => answerCallbackLater(tx, ctx, job));
}

async function handleDmText(u: NormalizedUpdate, ctx: JobContext, meta: UpdateMeta, routing: BotRouting): Promise<void> {
  if (u.userId === null) return;
  await markDialogStarted(u, ctx, meta);
  const text = (u.text ?? '').trim();
  if (text.startsWith('/')) {
    const [command, arg] = text.split(/\s+/);
    switch ((command ?? '').toLowerCase()) {
      case '/start':
        await startDialog(ctx, u.userId, arg ?? null, meta);
        return;
      case '/menu':
        await sendMenu(ctx, u.userId, meta.dedupeKey);
        return;
      case '/help':
        await ctx.db.transaction(async (tx) => sendDm(tx, ctx, u.userId as number, renderHelp(ctx.i18n), meta.dedupeKey));
        return;
      case '/delete':
        await ctx.db.transaction(async (tx) => sendDm(tx, ctx, u.userId as number, renderDeleteConfirm(ctx.i18n), meta.dedupeKey));
        return;
      case '/report':
        if (routing.onReportCommand) {
          await routing.onReportCommand(ctx, u.userId, meta);
          return;
        }
        break;
      default:
        break;
    }
  }
  for (const input of [onFlatInput, ...routing.dialogInputs]) {
    if (await input(ctx, u.userId, text, meta)) return;
  }
  await ctx.db.transaction(async (tx) => sendDm(tx, ctx, u.userId as number, renderText('bot.dm.unknown', ctx.i18n), `${meta.dedupeKey}:unknown`));
  await sendMenu(ctx, u.userId, `${meta.dedupeKey}:menu`);
}

async function handleMessage(u: NormalizedUpdate, ctx: JobContext, meta: UpdateMeta, routing: BotRouting): Promise<void> {
  if (u.chatType === 'dialog') {
    await handleDmText(u, ctx, meta, routing);
    return;
  }
  // Из группы текст приходит только для команды /connect (см. normalizeUpdate).
  if (u.text !== undefined) {
    await onConnectCommand(u, ctx, meta);
    return;
  }
  if (u.keywordHit && routing.onKeywordHit) await routing.onKeywordHit(u, ctx, meta);
}

export function createBotHandlers(routing: BotRouting): UpdateHandlers {
  return {
    bot_started: [async (u, ctx, meta) => (u.userId === null ? undefined : startDialog(ctx, u.userId, u.payload, meta))],
    message_callback: [(u, ctx, meta) => handleCallback(u, ctx, meta, routing)],
    message_created: [(u, ctx, meta) => handleMessage(u, ctx, meta, routing)],
    bot_added: [onBotAdded],
    bot_removed: [onBotRemoved],
    user_added: [onUserAdded],
    user_removed: [onUserRemoved],
    chat_title_changed: [onChatTitleChanged],
    bot_admin_permissions_changed: [onBotPermissionsChanged],
  };
}

/** Задача callback-answer: уведомление нажавшему. Устаревший callback — не повторять. */
export async function answerCallbackJob(ctx: JobContext, job: CallbackAnswerJob): Promise<void> {
  try {
    await ctx.max.answerCallback(job.callbackId, { notification: job.notification }, { chatId: job.chatId });
  } catch (err) {
    if (err instanceof MaxApiError && !err.retryable) {
      ctx.log.warn({ kind: err.kind }, 'ответ на нажатие не доставлен');
      return;
    }
    throw err;
  }
}
