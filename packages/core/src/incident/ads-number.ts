/**
 * Номер заявки АДС виден всем жителям дома, поэтому в нём не должно быть телефона:
 * 10 и больше цифр подряд (без пробелов, скобок и дефисов) считаем похожим на телефон.
 */
const PHONE_DIGITS = 10;

export function looksLikePhone(value: string): boolean {
  const compact = value.replace(/[\s()+-]/g, '');
  return new RegExp(`\\d{${PHONE_DIGITS},}`).test(compact);
}
