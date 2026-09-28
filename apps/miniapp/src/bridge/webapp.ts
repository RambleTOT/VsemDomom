/**
 * Адаптер MAX Bridge (window.WebApp, скрипт https://st.max.ru/js/max-web-app.js).
 * Каждая функция проверяет наличие метода и отдаёт фолбэк для веб-версии MAX и dev-режима.
 * Не используем DeviceStorage, SecureStorage, BiometricManager, HapticFeedback, shareContent,
 * downloadFile — они не работают в веб-версии MAX.
 */
import type { PlatformType } from '@maxhub/max-ui';

interface WebAppBackButton {
  show?: () => void;
  hide?: () => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
}

interface WebAppLike {
  initData?: string;
  initDataUnsafe?: { start_param?: string; chat?: { id?: number; type?: string } };
  platform?: string | null;
  deviceName?: string;
  BackButton?: WebAppBackButton;
  ready?: () => void;
  close?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  openLink?: (url: string) => void;
  openMaxLink?: (url: string) => void;
  shareMaxContent?: (params: { text?: string; link?: string }) => Promise<unknown>;
  requestContact?: () => Promise<{ phone?: string }>;
}

const webApp = (): WebAppLike | undefined => (globalThis as { WebApp?: WebAppLike }).WebApp;

const SHARE_WAIT_MS = 3000;

/** initData для входа; вне MAX — null. */
export function getInitData(): string | null {
  const value = webApp()?.initData;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Payload запуска: start_param MAX, а в dev — ?startapp= в адресе. */
export function getStartParam(): string | null {
  const fromMax = webApp()?.initDataUnsafe?.start_param;
  if (fromMax) return fromMax;
  const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('startapp');
  return fromUrl && /^[A-Za-z0-9_-]{1,512}$/.test(fromUrl) ? fromUrl : null;
}

/** Платформа для MAX UI: ios / android; веб и десктоп — по устройству (MAX UI знает только ios и android). */
export function getPlatform(): PlatformType {
  const wa = webApp();
  const platform = wa?.platform;
  if (platform === 'ios' || platform === 'android') return platform;
  const device = `${wa?.deviceName ?? ''} ${globalThis.navigator?.userAgent ?? ''}`;
  return /mac|iphone|ipad/i.test(device) ? 'ios' : 'android';
}

/** Веб-версия или десктоп MAX (и вне MAX): нет звонка по tel:, копирование вместо «Позвонить». */
export function isWebPlatform(): boolean {
  const platform = webApp()?.platform;
  return platform !== 'ios' && platform !== 'android';
}

export function inMax(): boolean {
  return getInitData() !== null;
}

export function ready(): void {
  webApp()?.ready?.();
}

let backHandler: (() => void) | null = null;

/** Нативная «Назад»: показываем на вложенных экранах, на корневом — скрываем. */
export function setBackButton(handler: (() => void) | null): void {
  const button = webApp()?.BackButton;
  if (!button) return;
  if (backHandler) button.offClick?.(backHandler);
  backHandler = handler;
  if (handler) {
    button.onClick?.(handler);
    button.show?.();
  } else {
    button.hide?.();
  }
}

/** Подтверждение закрытия, пока форма заполнена частично. */
export function setClosingConfirmation(enabled: boolean): void {
  const wa = webApp();
  if (enabled) wa?.enableClosingConfirmation?.();
  else wa?.disableClosingConfirmation?.();
}

// Вне MAX (dev, браузер) объект моста есть, но без транспорта: ссылки открываем сами.
export function openLink(url: string): void {
  const wa = webApp();
  if (inMax() && wa?.openLink) wa.openLink(url);
  else globalThis.open?.(url, '_blank', 'noopener');
}

export function openMaxLink(url: string): void {
  const wa = webApp();
  if (inMax() && wa?.openMaxLink) wa.openMaxLink(url);
  else globalThis.open?.(url, '_blank', 'noopener');
}

export function close(): void {
  const wa = webApp();
  if (inMax() && wa?.close) wa.close();
  else globalThis.close?.();
}

/**
 * «Переслать собственнику»: shareMaxContent → при ошибке экран «Поделиться» MAX (:share) →
 * false, если ничего не вышло (тогда предлагаем скопировать ссылку).
 */
export async function shareMaxContent(text: string, link: string): Promise<boolean> {
  const wa = webApp();
  // Вне MAX мост есть, но отвечать некому — сразу предлагаем скопировать ссылку.
  if (!inMax()) return false;
  if (wa?.shareMaxContent) {
    try {
      // Нет ответа за SHARE_WAIT_MS — показываем и «Скопировать ссылку»; второй экран «Поделиться» не открываем.
      return await Promise.race([
        wa.shareMaxContent({ text, link }).then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHARE_WAIT_MS)),
      ]);
    } catch {
      // запасной путь ниже
    }
  }
  if (wa?.openMaxLink) {
    wa.openMaxLink(`https://max.ru/:share?text=${encodeURIComponent(`${text} ${link}`)}`);
    return true;
  }
  return false;
}

/** Телефон из MAX — только для подстановки в заявление, на сервер не отправляется. */
export async function requestContact(): Promise<string | null> {
  const wa = webApp();
  if (!wa?.requestContact) return null;
  try {
    const result = await wa.requestContact();
    return typeof result?.phone === 'string' && result.phone ? result.phone : null;
  } catch {
    return null;
  }
}

/** Копирование в буфер: navigator.clipboard, иначе выделение и execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
