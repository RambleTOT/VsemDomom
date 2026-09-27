/**
 * Ограничения платформы MAX (dev.max.ru и schema.yaml 0.0.33, сверено 27.09.2026).
 * Это не нормативы: это лимиты сообщений и клавиатуры.
 */
export const MAX_LIMITS = {
  messageText: 4000,
  buttonText: 128,
  rows: 30,
  buttons: 210,
  buttonsPerRow: 7,
  /** В ряду с link, open_app, request_contact или request_geo_location. */
  buttonsPerRowWithWide: 3,
  callbackPayload: 1024,
  clipboardPayload: 1024,
  linkUrl: 2048,
  openAppPayload: 512,
  /** Диплинк бота ?start= — по справке MAX до 128 символов (поле в схеме допускает 512). */
  botStartPayload: 128,
  /** Диплинк мини-приложения ?startapp= и payload open_app. */
  startAppPayload: 512,
} as const;
