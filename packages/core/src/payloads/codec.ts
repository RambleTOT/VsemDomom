/**
 * Форматы payload (разбор — через zod; неизвестный формат → null, ответ «Ссылка устарела»):
 * - callback-кнопка: `v1:<action>:<id>[:<arg>]`, id — публичный ID (10 символов) или `-`;
 * - диплинк бота `?start=`: `h_<houseId>`;
 * - `open_app` и `?startapp=`: `n_`, `i_`, `h_`, `r_`, `a_`, `o_`, `c_` + ID или токен.
 */
import { z } from 'zod';
import { MAX_LIMITS } from '../constants/max-limits.ts';

const PUBLIC_ID = /^[A-Za-z0-9]{10}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export const CALLBACK_ACTIONS = [
  // карточка аварии
  'join',
  'notme',
  'crew_yes',
  'crew_no',
  // вопрос о восстановлении (C03): arg yes | no | weak
  'restore',
  // личка: регистрация и меню
  'pdn',
  'house',
  'role',
  'menu',
  'cancel',
  'delete',
  // личка: сообщить об аварии пошагово
  'rep_service',
  'rep_when',
  'rep_where',
  'rep_entrance',
  // личка: АДС и уведомления
  'ads_number',
  'ads_fail',
  'ads_later',
  'ads_again',
  'mute',
  // демо-пульт УК в личке: следующий статус аварии (arg — accepted | brigade_on_site | localized | resolved)
  'uk_status',
  // акт без исполнителя (S09): «Я готов подписать», знакомство с готовыми подписать
  'act_ready',
  'act_intro',
  // опросы (волна 3)
  'poll',
  'heat',
  'heat_ent',
] as const;
export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

export interface CallbackPayload {
  action: CallbackAction;
  /** Публичный ID аварии, дома или null. */
  id: string | null;
  arg: string | null;
}

const ARG = /^[A-Za-z0-9_]{1,32}$/;

const callbackSchema = z
  .string()
  .max(MAX_LIMITS.callbackPayload)
  .transform((s, ctx) => {
    const parts = s.split(':');
    const [version, action, id, arg, ...rest] = parts;
    const ok =
      version === 'v1' &&
      action !== undefined &&
      (CALLBACK_ACTIONS as readonly string[]).includes(action) &&
      id !== undefined &&
      (id === '-' || PUBLIC_ID.test(id)) &&
      (arg === undefined || ARG.test(arg)) &&
      rest.length === 0;
    if (!ok) {
      ctx.addIssue({ code: 'custom', message: 'unknown callback payload' });
      return z.NEVER;
    }
    return { action: action as CallbackAction, id: id === '-' ? null : id, arg: arg ?? null };
  });

export function encodeCallback(action: CallbackAction, id: string | null, arg?: string | number): string {
  return arg === undefined ? `v1:${action}:${id ?? '-'}` : `v1:${action}:${id ?? '-'}:${arg}`;
}

export function decodeCallback(payload: string | null | undefined): CallbackPayload | null {
  const r = callbackSchema.safeParse(payload ?? '');
  return r.success ? r.data : null;
}

export const START_APP_KINDS = {
  n: 'new_incident',
  i: 'incident',
  h: 'house',
  r: 'result',
  a: 'act',
  o: 'owner_invite',
  c: 'chat_binding',
} as const;
export type StartAppKind = (typeof START_APP_KINDS)[keyof typeof START_APP_KINDS];
export type StartAppPrefix = keyof typeof START_APP_KINDS;

export interface StartAppPayload {
  kind: StartAppKind;
  value: string;
}

/** Префикс payload мини-приложения: одна буква и «_». */
const PREFIX_WITH_SEPARATOR = 'n_';

const startAppSchema = z
  .string()
  .max(MAX_LIMITS.startAppPayload)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((s, ctx) => {
    const [prefixChar, separator] = s;
    const prefix = prefixChar as StartAppPrefix;
    const value = s.slice(PREFIX_WITH_SEPARATOR.length);
    const kind = START_APP_KINDS[prefix] as StartAppKind | undefined;
    const tokenKind = prefix === 'o' || prefix === 'c';
    if (separator !== '_' || !kind || !(tokenKind ? TOKEN.test(value) : PUBLIC_ID.test(value))) {
      ctx.addIssue({ code: 'custom', message: 'unknown start payload' });
      return z.NEVER;
    }
    return { kind, value };
  });

export function encodeStartApp(prefix: StartAppPrefix, value: string): string {
  return `${prefix}_${value}`;
}

export function decodeStartApp(payload: string | null | undefined): StartAppPayload | null {
  const r = startAppSchema.safeParse(payload ?? '');
  return r.success ? r.data : null;
}

/** Диплинк бота ?start=h_<houseId> (QR в подъезде). */
export function decodeBotStart(payload: string | null | undefined): { houseId: string } | null {
  if (!payload || payload.length > MAX_LIMITS.botStartPayload) return null;
  const m = /^h_([A-Za-z0-9]{10})$/.exec(payload);
  return m?.[1] ? { houseId: m[1] } : null;
}

export function botStartLink(botUsername: string, houseId: string): string {
  return `https://max.ru/${botUsername}?start=h_${houseId}`;
}

export function startAppLink(botUsername: string, payload: string): string {
  return `https://max.ru/${botUsername}?startapp=${payload}`;
}

export function botLink(botUsername: string): string {
  return `https://max.ru/${botUsername}`;
}
