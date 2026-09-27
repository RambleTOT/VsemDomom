/** Общие части текстов бота: разметка, названия услуг, подпись «Модельные данные». */
import { SERVICE_I18N_KEY, type ServiceType } from '../domain/enums.ts';
import type { Translator } from '../i18n/translator.ts';

/** Экранирование разметки MAX (CommonMark): данные из БД не должны ломать форматирование. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_~+^#>[\]])/g, '\\$1');
}

export function bold(text: string): string {
  return `**${text}**`;
}

export function serviceName(t: Translator, service: ServiceType): string {
  return t.t(`service.${SERVICE_I18N_KEY[service]}`);
}

/** «Нет горячей воды». */
export function serviceNo(t: Translator, service: ServiceType): string {
  return t.t(`service.no.${SERVICE_I18N_KEY[service]}`);
}

/** Услуга есть: «горячая вода есть», «канализация работает», «протечки нет». */
export function serviceOk(t: Translator, service: ServiceType): string {
  return t.t(`service.ok.${SERVICE_I18N_KEY[service]}`);
}

/** Родительный падеж: «горячей воды». */
export function serviceGen(t: Translator, service: ServiceType): string {
  return t.t(`service_gen.${SERVICE_I18N_KEY[service]}`);
}

/** «Нет горячей воды» → «нет горячей воды»; аббревиатуры («УК сообщит…») не меняются. */
export function lowerFirst(text: string): string {
  const [first, second] = text;
  if (first === undefined) return text;
  if (second !== undefined && second !== second.toLowerCase()) return text;
  return `${first.toLowerCase()}${text.slice(1)}`;
}

/** Строки сообщения: пустые (необязательные) пропускаются. */
export function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');
}
