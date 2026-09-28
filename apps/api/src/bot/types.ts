import type { BotMessage, CallbackPayload, ResidencyRole, ResidencySource } from '@vsemdomom/core';
import type { JobContext } from '../jobs/context.ts';
import type { UpdateMeta } from '../jobs/process-update.ts';
import type { NormalizedUpdate } from '../max/update.ts';

export type { UpdateMeta };

/** Состояние диалога в личке (max_user.dialog_state); живёт 24 часа. */
export type DialogState =
  | {
      flow: 'registration';
      step: 'consent' | 'house' | 'role' | 'flat';
      houseId: string | null;
      role: ResidencyRole | null;
      source: ResidencySource;
    }
  | { flow: 'report'; step: string; houseId: string; data: Record<string, string | number | boolean | null> }
  | {
      flow: 'ads';
      incidentId: string;
      kind: 'register' | 'rereport';
      /** Ключ сообщения-просьбы «Напишите номер заявки»: после ввода оно правится в «Номер заявки — 4127». */
      promptKey?: string;
    };

export interface CallbackEvent {
  update: NormalizedUpdate;
  payload: CallbackPayload;
  callbackId: string;
  userId: number;
  chatId: number | null;
  meta: UpdateMeta;
}

/** Ответ на нажатие (POST /answers): уведомление нажавшему и, если нужно, новая версия сообщения с кнопкой. */
export interface CallbackReply {
  notification: string;
  message?: BotMessage;
}

/** Обработчик нажатия: текст уведомления нажавшему или ответ с правкой сообщения. */
export type CallbackHandler = (event: CallbackEvent, ctx: JobContext) => Promise<string | CallbackReply>;
