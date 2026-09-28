/** Тексты интерфейса — только по ключам общего словаря packages/shared/i18n/ru.json. */
import { DISPLAY_STATUS_I18N_KEY, RESIDENCY_ROLE_I18N_KEY, ruTranslator, SERVICE_I18N_KEY } from '@vsemdomom/shared/browser';
import type { DisplayStatus, ResidencyRole, ServiceType } from '@vsemdomom/shared';

export type TextParams = Record<string, string | number>;

export const t = (key: string, params?: TextParams): string => ruTranslator.t(key, params);
export const has = (key: string): boolean => ruTranslator.has(key);
/** Форма слова по числу: plural.<name>.one|few|many. */
export const plural = (count: number, name: string): string => ruTranslator.plural(count, name);

export const serviceKey = (s: ServiceType): string => SERVICE_I18N_KEY[s];
export const serviceName = (s: ServiceType): string => t(`service.${serviceKey(s)}`);
export const serviceGen = (s: ServiceType): string => t(`service_gen.${serviceKey(s)}`);
export const serviceNo = (s: ServiceType): string => (has(`service.no.${serviceKey(s)}`) ? t(`service.no.${serviceKey(s)}`) : serviceName(s));
export const statusName = (s: DisplayStatus): string => t(`status.${DISPLAY_STATUS_I18N_KEY[s]}`);
export const roleName = (r: ResidencyRole): string => t(`role.${RESIDENCY_ROLE_I18N_KEY[r]}`);
export const restoreQuestion = (s: ServiceType): string => t(`restore.question.${serviceKey(s)}`);

/** «Есть, но плохая» по виду услуги; null — для этой услуги варианта нет. */
export function restoreBadLabel(s: ServiceType): string | null {
  if (s === 'cold_water' || s === 'hot_water') return t('restore.answer.bad.water');
  if (s === 'heating') return t('restore.answer.bad.heat');
  if (s === 'electricity') return t('restore.answer.bad.power');
  return null;
}

export const lowerFirst = (text: string): string => (text ? text[0]!.toLowerCase() + text.slice(1) : text);
export const upperFirst = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
