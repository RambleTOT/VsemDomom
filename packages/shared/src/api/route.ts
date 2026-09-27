import type { FeatureFlag } from '@vsemdomom/core';
import type { z } from 'zod';

/** Кто может вызвать эндпоинт. */
export type RouteAuth =
  | 'none'
  /** Любой вошедший пользователь (сессия мини-приложения или checker-токен). */
  | 'user'
  /** Житель: сессия с проживанием в доме аварии. */
  | 'resident'
  /** Сотрудник УК (в том числе демо-роль и checker-УК). */
  | 'staff'
  /** Демо-роль УК при DEMO_MODE=true. */
  | 'demo_staff'
  /** Checker-УК при CHECKER_API_ENABLED=true. */
  | 'checker_uk'
  /** Webhook MAX: заголовок X-Max-Bot-Api-Secret. */
  | 'webhook';

/** Описания ошибок по умолчанию для поля errors маршрута. */
export const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Неверный формат запроса',
  401: 'Нет или неверная авторизация',
  403: 'Нет прав',
  404: 'Не найдено (в том числе функция выключена флагом)',
  409: 'Конфликт состояния или версии',
  410: 'Ссылка или токен больше не действуют',
  422: 'Ошибка бизнес-валидации',
  429: 'Превышен лимит запросов',
  502: 'MAX недоступен',
  503: 'Сервис временно недоступен',
};

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
  /** По умолчанию application/json для 2xx и application/problem+json для ошибок. */
  contentType?: string;
}

/** Описание эндпоинта: из него генерируется openapi.yaml и строятся тесты контракта. */
export interface ApiRoute {
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  auth: RouteAuth;
  params?: z.ZodObject;
  query?: z.ZodObject;
  headers?: z.ZodObject;
  body?: z.ZodType;
  responses: Record<number, RouteResponse>;
  /** Коды ошибок с описаниями по умолчанию (problem+json); явные responses важнее. */
  errors?: readonly number[];
  /** Функция за флагом: при выключенном флаге эндпоинт отвечает 404. */
  feature?: FeatureFlag;
}

export function defineRoutes<const T extends readonly ApiRoute[]>(routes: T): T {
  return routes;
}
